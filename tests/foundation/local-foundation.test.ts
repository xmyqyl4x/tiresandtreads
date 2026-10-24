import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, expect, it } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { getPayload, type Payload } from 'payload';
import { provisionProof, poolOptions } from '../fixtures/foundation/database.ts';
import { proofPayloadConfig } from '../fixtures/foundation/payload.ts';

let urls: Awaited<ReturnType<typeof provisionProof>>;
let appOwner: pg.Client;
let cmsOwner: pg.Client;
let app: pg.Pool;
let cms: pg.Client;
let payloadOwner: Payload | undefined;
let payloadRuntime: Payload | undefined;
const measured: Record<string, unknown> = {};

beforeAll(async () => {
  urls = await provisionProof();
  appOwner = new pg.Client({ connectionString: urls.app_migrator });
  cmsOwner = new pg.Client({ connectionString: urls.cms_migrator });
  cms = new pg.Client({ connectionString: urls.cms_runtime });
  await Promise.all([appOwner.connect(), cmsOwner.connect(), cms.connect()]);
  const db = drizzle(appOwner);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`create table foundation_records (id integer primary key, value text not null)`,
    );
    await tx.execute(sql`insert into foundation_records values (1, 'synthetic')`);
  });
  await appOwner.query(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON foundation_records TO proof_app_runtime',
  );
  app = new pg.Pool({ connectionString: urls.app_runtime, ...poolOptions });
  app.on('error', () => {
    measured.idlePoolError = true;
  });
}, 30000);

afterAll(async () => {
  await payloadRuntime?.destroy();
  await payloadOwner?.destroy();
  if (app) await app.end();
  await Promise.all([appOwner, cmsOwner, cms].filter(Boolean).map((client) => client.end()));
  mkdirSync('.local', { recursive: true });
  writeFileSync('.local/foundation-measurements.json', JSON.stringify(measured, null, 2) + '\n');
  console.log('Foundation measurements:', JSON.stringify(measured));
});

it('uses separate real migration/runtime roles and refuses cross-database access and DDL', async () => {
  for (const [connection, otherDatabase] of [
    [urls.app_runtime, 'tt_cms'],
    [urls.cms_runtime, 'tt_app'],
    [urls.app_migrator, 'tt_cms'],
    [urls.cms_migrator, 'tt_app'],
  ] as const) {
    const url = new URL(connection);
    url.pathname = `/${otherDatabase}`;
    const forbidden = new pg.Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 1000,
    });
    try {
      await expect(forbidden.connect()).rejects.toMatchObject({ code: '42501' });
    } finally {
      await forbidden.end();
    }
  }
  await expect(app.query('CREATE TABLE forbidden_ddl (id int)')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(cms.query('CREATE TABLE forbidden_ddl (id int)')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    app.query('ALTER TABLE foundation_records ADD COLUMN forbidden int'),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(app.query('SET ROLE proof_app_migrator')).rejects.toMatchObject({ code: '42501' });
  const rows = await app.query(
    'SELECT current_user AS role, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=current_user',
  );
  expect(rows.rows[0]).toEqual({
    role: 'proof_app_runtime',
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolbypassrls: false,
  });
});

it('rolls back failed direct Drizzle migration without affecting the runtime table', async () => {
  const db = drizzle(appOwner);
  await expect(
    db.transaction(async (tx) => {
      await tx.execute(sql`create table failed_migration_probe (id int)`);
      await tx.execute(sql`insert into foundation_records values (1, 'duplicate')`);
    }),
  ).rejects.toThrow();
  expect(
    (await appOwner.query("select to_regclass('public.failed_migration_probe') as relation"))
      .rows[0],
  ).toEqual({ relation: null });
  expect((await app.query('select value from foundation_records where id=1')).rows[0]).toEqual({
    value: 'synthetic',
  });
});

it('bounds pool admission, SQL duration and lock waits while recovering clients', async () => {
  const held = await Promise.all([app.connect(), app.connect()]);
  try {
    expect(app.totalCount).toBe(2);
    const started = performance.now();
    await expect(app.connect()).rejects.toThrow(/timeout/i);
    measured.poolAdmissionTimeoutMs = Math.round(performance.now() - started);
  } finally {
    held.forEach((client) => client.release());
  }
  await expect(app.query('select pg_sleep(2)')).rejects.toMatchObject({ code: '57014' });
  const client = await app.connect();
  await appOwner.query('BEGIN');
  try {
    await appOwner.query('LOCK TABLE foundation_records IN ACCESS EXCLUSIVE MODE');
    await expect(client.query('select * from foundation_records')).rejects.toMatchObject({
      code: '55P03',
    });
  } finally {
    await appOwner.query('ROLLBACK');
    client.release();
  }
  expect((await app.query('select 1 as recovered')).rows[0]).toEqual({ recovered: 1 });
  expect(app.waitingCount).toBe(0);
});

it('measures a bounded synthetic workload and pool drain with in-flight work', async () => {
  const latencies: number[] = [];
  let peakConnections = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let index = 0; index < 25; index++) {
        const start = performance.now();
        const result = await app.query('select value from foundation_records where id=$1', [1]);
        expect(result.rows[0]?.value).toBe('synthetic');
        latencies.push(performance.now() - start);
        peakConnections = Math.max(peakConnections, app.totalCount);
      }
    }),
  );
  latencies.sort((a, b) => a - b);
  measured.workload = {
    queries: 100,
    concurrency: 4,
    peakConnections,
    p95Ms: Number(latencies[94]?.toFixed(2)),
    scope: 'single-row local synthetic probe; not report capacity',
  };
  expect(peakConnections).toBeLessThanOrEqual(2);
  expect(latencies[94]).toBeLessThan(500);
  const draining = new pg.Pool({ connectionString: urls.app_runtime, ...poolOptions });
  const client = await draining.connect();
  const inFlight = client.query('select pg_sleep(0.1)');
  let drained = false;
  const ending = draining.end().then(() => {
    drained = true;
  });
  await inFlight;
  expect(drained).toBe(false);
  client.release();
  await ending;
  expect(drained).toBe(true);
  await expect(draining.connect()).rejects.toThrow(/end/i);
});

it('generates and applies real Payload migrations only through the CMS owner', async () => {
  mkdirSync('.local/foundation-migrations', { recursive: true });
  const secret = randomBytes(32).toString('hex');
  payloadOwner = await getPayload({
    key: 'foundation-owner',
    config: proofPayloadConfig(urls.cms_migrator, secret),
  });
  await payloadOwner.db.createMigration({
    payload: payloadOwner,
    migrationName: 'foundation_fixture',
    forceAcceptWarning: true,
  });
  // Payload 3.92 emits value imports for TS-only migration types. Keep the project's
  // strict verbatimModuleSyntax; normalize only this known generated fixture header.
  const migrationFile = readdirSync('.local/foundation-migrations').find((name) =>
    name.endsWith('_foundation_fixture.ts'),
  );
  if (!migrationFile) throw new Error('Payload did not generate the expected fixture migration');
  const migrationPath = `.local/foundation-migrations/${migrationFile}`;
  const generated = readFileSync(migrationPath, 'utf8');
  const header = "import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'";
  expect(generated).toContain(header);
  writeFileSync(
    migrationPath,
    generated.replace(
      header,
      "import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-postgres'",
    ),
  );
  await payloadOwner.db.migrate();
  const before = await cmsOwner.query('select count(*)::int as count from payload_migrations');
  await payloadOwner.db.migrate();
  expect(
    (await cmsOwner.query('select count(*)::int as count from payload_migrations')).rows,
  ).toEqual(before.rows);
  await cmsOwner.query(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO proof_cms_runtime',
  );
  await cmsOwner.query(
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO proof_cms_runtime',
  );
  await cmsOwner.query('REVOKE ALL ON payload_migrations FROM proof_cms_runtime');
  payloadRuntime = await getPayload({
    key: 'foundation-runtime',
    config: proofPayloadConfig(urls.cms_runtime, secret),
  });
  const owners = await cmsOwner.query(
    "select distinct tableowner from pg_tables where schemaname='public'",
  );
  expect(owners.rows).toEqual([{ tableowner: 'proof_cms_migrator' }]);
  await expect(cms.query('delete from payload_migrations')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    cms.query('ALTER TABLE proof_content ADD COLUMN forbidden int'),
  ).rejects.toMatchObject({ code: '42501' });
  expect(
    (await appOwner.query("select to_regclass('public.proof_content') as relation")).rows[0],
  ).toEqual({ relation: null });
  measured.payloadMigrationCount = before.rows[0]?.count;
}, 60000);

it('enforces Payload access, disables password login and rejects asserted external identity', async () => {
  if (!payloadRuntime) throw new Error('Payload migration proof must pass first');
  const content = { collection: 'proof-content' as const, overrideAccess: false as const };
  await expect(
    payloadRuntime.create({ ...content, data: { label: 'denied' } }),
  ).rejects.toMatchObject({ status: 403 });
  const viewer = { id: 42, collection: 'proof-staff', role: 'viewer' };
  await expect(payloadRuntime.find({ ...content, user: viewer })).rejects.toMatchObject({
    status: 403,
  });
  // Injected actor exists only in this non-HTTP proof composition; not an authentication claim.
  const editor = { ...viewer, role: 'editor' };
  const created = await payloadRuntime.create({
    ...content,
    user: editor,
    data: { label: 'synthetic local CMS proof' },
  });
  const found = await payloadRuntime.find({ ...content, user: editor });
  expect(found.docs.map((doc) => doc.id)).toContain(created.id);
  await expect(
    payloadRuntime.login({
      collection: 'proof-staff',
      data: { email: 'fixture@example.invalid', password: 'unused-synthetic' },
    }),
  ).rejects.toMatchObject({ status: 403 });
  const auth = await payloadRuntime.auth({
    headers: new Headers({ authorization: 'Bearer unverified', 'x-user-role': 'editor' }),
  });
  expect(auth.user).toBeNull();
  await expect(
    payloadRuntime.sendEmail({
      to: 'fixture@example.invalid',
      subject: 'proof',
      text: 'synthetic',
    }),
  ).rejects.toThrow('External email is forbidden');
  measured.payloadAccess = {
    anonymous: 'denied',
    viewer: 'denied',
    injectedTestEditor: 'allowed',
    passwordLogin: 'disabled',
    assertedHeader: 'denied',
    email: 'no-send',
  };
});
