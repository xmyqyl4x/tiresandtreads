import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import pg from 'pg';
import { getPayload, type Payload } from 'payload';
import { schemaFixture } from '../fixtures/schema/database.ts';
import { loadSources, type MigrationSource } from '../../scripts/database/manifest.ts';
import { migrateApplication, type MigrationTarget } from '../../scripts/database/migrate.ts';
import { migrateCms } from '../../scripts/database/cms.ts';
import { cmsFoundationConfig } from '../../scripts/database/cms-config.ts';
import type { DatabaseRole } from '../../scripts/database/bootstrap.ts';

let urls: Awaited<ReturnType<typeof schemaFixture>>;
const clients = {} as Record<DatabaseRole, pg.Client>;
let target: MigrationTarget;
let payload: Payload | undefined;
const sources = loadSources('app');
const id = randomUUID();

beforeAll(async () => {
  urls = await schemaFixture();
  for (const [role, url] of Object.entries(urls)) {
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
    await client.connect();
    clients[role as DatabaseRole] = client;
  }
  target = { url: urls.tt_app_migrator, database: 'tt_app_schema', kind: 'app' };
}, 30000);
afterAll(async () => {
  await payload?.destroy();
  await Promise.all(Object.values(clients).map((client) => client.end()));
});

it('migrates empty then populated previous schema, preserving data and replaying as a no-op', async () => {
  expect(await migrateApplication(target, sources.slice(0, 1))).toBe(1);
  await clients.tt_app_migrator.query(
    "INSERT INTO app.locales (code,label) VALUES ('zz-ZZ','Synthetic upgrade sentinel')",
  );
  expect(await migrateApplication(target, sources)).toBe(1);
  expect(await migrateApplication(target, sources)).toBe(0);
  expect(
    (await clients.tt_app_runtime.query("SELECT label FROM app.locales WHERE code='zz-ZZ'")).rows[0]
      ?.label,
  ).toBe('Synthetic upgrade sentinel');
  const seed = readFileSync('infra/database/seeds/synthetic.sql', 'utf8');
  await clients.tt_app_migrator.query(seed);
  await clients.tt_app_migrator.query(seed);
  expect(
    (await clients.tt_app_runtime.query('SELECT count(*)::int AS count FROM app.subjects')).rows[0]
      ?.count,
  ).toBe(1);
});

it('refuses a second executor and releases the migration lock afterward', async () => {
  await clients.tt_app_migrator.query('SELECT pg_advisory_lock(7724004, 1)');
  try {
    await expect(migrateApplication(target, sources)).rejects.toThrow(/executor/);
  } finally {
    await clients.tt_app_migrator.query('SELECT pg_advisory_unlock(7724004, 1)');
  }
  expect(await migrateApplication(target, sources)).toBe(0);
});

it('rolls back failed DDL and history together and can retry without partial objects', async () => {
  const source =
    "CREATE TABLE app.failed_probe (id int); INSERT INTO app.countries(code,label) VALUES ('US','duplicate');";
  const failed = {
    id: '0003_failure',
    source,
    sha256: createHash('sha256').update(source).digest('hex'),
  };
  await expect(migrateApplication(target, [...sources, failed])).rejects.toMatchObject({
    code: '23505',
  });
  expect(
    (await clients.tt_app_migrator.query("SELECT to_regclass('app.failed_probe') AS name")).rows[0]
      ?.name,
  ).toBeNull();
  expect(
    (
      await clients.tt_app_migrator.query(
        'SELECT count(*)::int AS count FROM migration_meta.applied',
      )
    ).rows[0]?.count,
  ).toBe(2);
  expect(await migrateApplication(target, sources)).toBe(0);
});

it('refuses changed applied SQL and unrecognized database history before applying anything', async () => {
  const changed: MigrationSource[] = sources.map((entry) => ({ ...entry }));
  const first = changed[0];
  if (!first) throw new Error('Missing migration');
  const source = first.source + '\n-- changed history\n';
  changed[0] = { ...first, source, sha256: createHash('sha256').update(source).digest('hex') };
  await expect(migrateApplication(target, changed)).rejects.toThrow(/history/);
  await clients.tt_app_migrator.query(
    "INSERT INTO migration_meta.applied VALUES (3,'0003_unknown',$1,now())",
    ['0'.repeat(64)],
  );
  try {
    await expect(migrateApplication(target, sources)).rejects.toThrow(/history/);
  } finally {
    await clients.tt_app_migrator.query('DELETE FROM migration_meta.applied WHERE position=3');
  }
});

it('denies runtime DDL, ownership escalation, migration execution, staff grants and future object access', async () => {
  const app = clients.tt_app_runtime;
  for (const sql of [
    'CREATE TABLE app.forbidden (id int)',
    'CREATE TEMP TABLE forbidden (id int)',
    'ALTER TABLE app.subjects ADD COLUMN forbidden int',
    'TRUNCATE app.subjects',
    'SET ROLE tt_app_migrator',
    'DELETE FROM migration_meta.applied',
    'SELECT * FROM admin.staff_identities',
    'SELECT * FROM app.object_assets',
    "INSERT INTO app.countries (code,label) VALUES ('ZZ','Forbidden')",
  ])
    await expect(app.query(sql)).rejects.toMatchObject({ code: '42501' });
  await expect(
    migrateApplication({ ...target, url: urls.tt_app_runtime }, sources),
  ).rejects.toThrow(/restricted database owner/);
  await expect(
    clients.tt_staff_runtime.query("UPDATE admin.staff_identities SET status='active'"),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    clients.tt_asset_runtime.query('SELECT * FROM app.owner_sessions'),
  ).rejects.toMatchObject({ code: '42501' });
  await clients.tt_app_migrator.query('CREATE TABLE app.future_private (id int)');
  await clients.tt_app_migrator.query(
    "CREATE FUNCTION app.future_private_value() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
  );
  await expect(app.query('SELECT * FROM app.future_private')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(app.query('SELECT app.future_private_value()')).rejects.toMatchObject({
    code: '42501',
  });
});

it('refuses every app/CMS role connecting to the other database', async () => {
  for (const [role, value] of Object.entries(urls)) {
    const capabilities = (
      await clients[role as DatabaseRole].query(
        'SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0];
    expect(Object.values(capabilities)).toEqual([false, false, false, false, false, false]);
    const url = new URL(value);
    url.pathname = role.startsWith('tt_cms_') ? '/tt_app_schema' : '/tt_cms_schema';
    const client = new pg.Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 1000,
    });
    try {
      await expect(client.connect()).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.end();
    }
  }
});

it('persists session digests and rejects missing owners, duplicate tokens and invalid lifetime/digest values', async () => {
  const app = clients.tt_app_runtime;
  await app.query('INSERT INTO app.subjects (id,kind) VALUES ($1,$2)', [id, 'guest']);
  const token = randomBytes(32);
  const insert =
    'INSERT INTO app.owner_sessions(subject_id,token_hash,key_version,expires_at) VALUES ($1,$2,$3,$4)';
  const expires = new Date(Date.now() + 3600000);
  await app.query(insert, [id, token, 'synthetic-v1', expires]);
  await expect(app.query(insert, [id, token, 'synthetic-v1', expires])).rejects.toMatchObject({
    code: '23505',
    constraint: 'owner_sessions_digest_uq',
  });
  await expect(
    app.query(insert, [randomUUID(), randomBytes(32), 'synthetic-v1', expires]),
  ).rejects.toMatchObject({ code: '23503', constraint: 'owner_sessions_subject_fk' });
  await expect(
    app.query(insert, [id, randomBytes(8), 'synthetic-v1', expires]),
  ).rejects.toMatchObject({ code: '23514', constraint: 'owner_sessions_digest_ck' });
  await expect(
    app.query(insert, [id, randomBytes(32), 'synthetic-v1', new Date(0)]),
  ).rejects.toMatchObject({ code: '23514', constraint: 'owner_sessions_times_ck' });
  await expect(
    app.query('UPDATE app.subjects SET permission_revision=0 WHERE id=$1', [id]),
  ).rejects.toMatchObject({ code: '23514', constraint: 'subjects_revision_ck' });
  await expect(
    clients.tt_app_migrator.query('DELETE FROM app.subjects WHERE id=$1', [id]),
  ).rejects.toMatchObject({ code: '23001', constraint: 'owner_sessions_subject_fk' });
});

it('validates asset purpose, readiness, digest, size, deletion and opaque object location', async () => {
  const asset = clients.tt_asset_runtime;
  const assetId = randomUUID();
  const insert =
    'INSERT INTO app.object_assets(id,purpose,bucket,object_key,mime_type) VALUES ($1,$2,$3,$4,$5)';
  const values = [
    assetId,
    'report_pdf',
    'synthetic-private',
    `assets/${assetId}`,
    'application/pdf',
  ];
  await asset.query(insert, values);
  await expect(asset.query(insert, [randomUUID(), ...values.slice(1)])).rejects.toMatchObject({
    code: '23505',
    constraint: 'object_assets_location_uq',
  });
  await expect(
    asset.query(insert, [
      randomUUID(),
      'unknown',
      'synthetic-private',
      `assets/${randomUUID()}`,
      'application/pdf',
    ]),
  ).rejects.toMatchObject({ code: '23503', constraint: 'object_assets_purpose_fk' });
  await expect(
    asset.query(insert, [
      randomUUID(),
      'report_pdf',
      'synthetic-private',
      'https://example.invalid/file.pdf',
      'application/pdf',
    ]),
  ).rejects.toMatchObject({ code: '23514', constraint: 'object_assets_key_ck' });
  for (const [change, constraint] of [
    ["state='ready'", 'object_assets_ready_ck'],
    ["sha256='invalid'", 'object_assets_hash_ck'],
    ['size_bytes=-1', 'object_assets_size_ck'],
    ["state='deleted'", 'object_assets_deleted_ck'],
  ])
    await expect(
      asset.query(`UPDATE app.object_assets SET ${change} WHERE id=$1`, [assetId]),
    ).rejects.toMatchObject({ code: '23514', constraint });
  await asset.query(
    "UPDATE app.object_assets SET state='ready',sha256=$2,size_bytes=12 WHERE id=$1",
    [assetId, 'a'.repeat(64)],
  );
  await asset.query("UPDATE app.object_assets SET state='deleted',deleted_at=now() WHERE id=$1", [
    assetId,
  ]);
  expect(
    (await asset.query('SELECT state FROM app.object_assets WHERE id=$1', [assetId])).rows[0]
      ?.state,
  ).toBe('deleted');
});

it('enforces staff references and permission JSON while leaving synthetic identities disabled', async () => {
  const owner = clients.tt_app_migrator;
  await expect(
    owner.query('INSERT INTO admin.staff_role_assignments(staff_id,role_id) VALUES ($1,$2)', [
      randomUUID(),
      randomUUID(),
    ]),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    owner.query(
      "INSERT INTO admin.roles(code,permissions,policy_version) VALUES ('invalid','[12]','synthetic')",
    ),
  ).rejects.toMatchObject({ code: '23514', constraint: 'roles_permissions_ck' });
  const staff = (await clients.tt_staff_runtime.query('SELECT status FROM admin.staff_identities'))
    .rows;
  expect(staff).toEqual([{ status: 'disabled' }]);
});

it('has migration ownership and a leading index for every application foreign key', async () => {
  const owner = clients.tt_app_migrator;
  const tables = await owner.query(
    "SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname IN ('app','admin','migration_meta')",
  );
  expect(tables.rows).toEqual([{ tableowner: 'tt_app_migrator' }]);
  const foreignKeys = await owner.query(
    "SELECT conname, conrelid, conkey FROM pg_constraint WHERE contype='f' AND connamespace IN ('app'::regnamespace,'admin'::regnamespace)",
  );
  expect(foreignKeys.rowCount).toBeGreaterThan(5);
  for (const fk of foreignKeys.rows) {
    const indexes = await owner.query(
      'SELECT indkey::text AS columns FROM pg_index WHERE indrelid=$1 AND indisvalid',
      [fk.conrelid],
    );
    expect(
      indexes.rows.some(
        (row) =>
          row.columns.split(' ').slice(0, fk.conkey.length).map(Number).join(',') ===
          fk.conkey.join(','),
      ),
      fk.conname,
    ).toBe(true);
  }
});

it('applies committed Payload migrations with transactional checksums and restricted runtime initialization', async () => {
  const cmsTarget = { url: urls.tt_cms_migrator, database: 'tt_cms_schema', kind: 'cms' as const };
  const secret = randomBytes(32).toString('hex');
  expect(await migrateCms(cmsTarget, secret)).toBe(1);
  await clients.tt_cms_migrator.query(
    "INSERT INTO public.cms_staff(app_staff_id) VALUES ('22222222-2222-4222-8222-222222222222')",
  );
  expect(await migrateCms(cmsTarget, secret)).toBe(0);
  expect(
    (await clients.tt_cms_runtime.query('SELECT app_staff_id FROM public.cms_staff')).rows,
  ).toEqual([{ app_staff_id: '22222222-2222-4222-8222-222222222222' }]);
  expect(
    (await clients.tt_cms_migrator.query('SELECT id FROM migration_meta.applied')).rows,
  ).toEqual([{ id: '0001_staff' }]);
  expect(
    (await clients.tt_cms_migrator.query('SELECT name FROM public.payload_migrations')).rows,
  ).toEqual([{ name: '0001_staff' }]);
  const cms = clients.tt_cms_runtime;
  for (const statement of [
    'CREATE TABLE public.forbidden(id int)',
    'DELETE FROM public.payload_migrations',
    'DELETE FROM migration_meta.applied',
    "INSERT INTO public.cms_staff(app_staff_id) VALUES ('00000000-0000-4000-8000-000000000000')",
  ])
    await expect(cms.query(statement)).rejects.toMatchObject({ code: '42501' });
  payload = await getPayload({
    key: 'schema-runtime',
    config: cmsFoundationConfig(urls.tt_cms_runtime, secret),
  });
  await expect(
    payload.find({ collection: 'cms-staff', overrideAccess: false }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    payload.login({
      collection: 'cms-staff',
      data: { email: 'synthetic@example.invalid', password: 'disabled' },
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    (
      await clients.tt_cms_migrator.query(
        "SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname IN ('public','migration_meta')",
      )
    ).rows,
  ).toEqual([{ tableowner: 'tt_cms_migrator' }]);
}, 60000);

it('refuses CMS checksum, native-ledger and schema-push drift before migration replay', async () => {
  const owner = clients.tt_cms_migrator;
  const cmsTarget = { url: urls.tt_cms_migrator, database: 'tt_cms_schema', kind: 'cms' as const };
  const original = loadSources('cms')[0];
  if (!original) throw new Error('Missing CMS migration');
  await owner.query('UPDATE migration_meta.applied SET sha256=$1', ['0'.repeat(64)]);
  try {
    await expect(migrateCms(cmsTarget, 'unused-for-replay')).rejects.toThrow(/history/);
  } finally {
    await owner.query('UPDATE migration_meta.applied SET sha256=$1', [original.sha256]);
  }
  await owner.query("UPDATE public.payload_migrations SET name='unknown'");
  try {
    await expect(migrateCms(cmsTarget, 'unused-for-replay')).rejects.toThrow(/histories differ/);
  } finally {
    await owner.query('UPDATE public.payload_migrations SET name=$1', [original.id]);
  }
  await owner.query('UPDATE public.payload_migrations SET batch=-1');
  try {
    await expect(migrateCms(cmsTarget, 'unused-for-replay')).rejects.toThrow(
      /schema push is forbidden/,
    );
  } finally {
    await owner.query('UPDATE public.payload_migrations SET batch=1');
  }
});
