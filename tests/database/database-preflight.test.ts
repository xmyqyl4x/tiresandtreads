import pg from 'pg';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { readFile, writeFile, mkdtemp, rm, chmod, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { contentFixture } from '../fixtures/content/database.ts';
import { disposableTargets } from '../fixtures/foundation/target.ts';
import { preflightLocalDatabase } from '../../packages/db/src/database-preflight.ts';
import {
  bootstrapDatabase,
  databaseRoles,
  type RolePasswords,
} from '../../scripts/database/bootstrap.ts';
import { schemaInventory } from '../../scripts/database/inventory.ts';
import { loadSources } from '../../scripts/database/manifest.ts';

let f: Awaited<ReturnType<typeof contentFixture>>, admin: pg.Client, ca: string, directory: string;
function input(target: 'app' | 'cms' = 'app') {
  const url = new URL(
    target === 'app' ? f.connectionUrl('tt_app_migrator') : f.cmsConnectionUrl('tt_cms_migrator'),
  );
  url.hostname = 'postgres.preflight.test';
  return {
    mode: 'local-preflight',
    target,
    url: url.toString(),
    ca,
    peerDatabase: new URL(
      target === 'app' ? f.cmsConnectionUrl('tt_cms_migrator') : f.connectionUrl('tt_app_migrator'),
    ).pathname.slice(1),
    expectedVersion: 180006,
    expectedMigrations: target === 'app' ? 33 : 3,
    expectedHistory: loadSources(target).map(({ id, sha256 }) => ({ id, sha256 })),
  };
}
const probe = (patch = {}) => preflightLocalDatabase({ ...input(), ...patch }, process.env);
beforeAll(async () => {
  f = await contentFixture();
  admin = new pg.Client({ connectionString: disposableTargets(process.env).app });
  await admin.connect();
  ca = await readFile('/tls/ca.crt', 'utf8');
  directory = await mkdtemp(join(tmpdir(), 'tt-db-preflight-'));
}, 60000);
afterAll(async () => {
  await admin?.end();
  await f?.cleanup();
  if (directory) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'tt-db-preflight-'))
      throw Error('Unexpected fixture directory');
    await rm(directory, { recursive: true, force: true });
  }
});
it('uses actual verified PostgreSQL TLS and read-only ownership inspection across both databases without changing schema', async () => {
  const before = [await schemaInventory(f.owner), await schemaInventory(f.cmsAdmin)];
  for (const target of ['app', 'cms'] as const) {
    const report = await preflightLocalDatabase(input(target), process.env);
    expect(report).toMatchObject({
      scope: 'local-fixture',
      compatible: true,
      status: 'compatible',
      findings: [],
      checks: {
        tls: true,
        readOnly: true,
        serverVersion: 180006,
        expectedRoles: target === 'app' ? 17 : 2,
        actualRoles: target === 'app' ? 17 : 2,
        migrations: target === 'app' ? 33 : 3,
      },
    });
  }
  expect([await schemaInventory(f.owner), await schemaInventory(f.cmsAdmin)]).toEqual(before);
});
it('refuses an unrelated CA and a certificate hostname mismatch without exposing credentials or SQL errors', async () => {
  for (const patch of [
    { ca: await readFile('/tls/wrong-ca.crt', 'utf8') },
    { url: input().url.replace('postgres.preflight.test', 'postgres.mismatch.preflight.test') },
  ]) {
    const r = await probe(patch);
    expect(r).toEqual({
      scope: 'local-fixture',
      status: 'unavailable',
      compatible: false,
      findings: [],
    });
    expect(JSON.stringify(r)).not.toContain(new URL(input().url).password);
  }
});
it.each(['expired certificate', 'plaintext-only server'])(
  'rejects a real PostgreSQL %s and recovers after fixture configuration is restored',
  async (kind) => {
    try {
      await admin.query(
        kind === 'expired certificate'
          ? "ALTER SYSTEM SET ssl_cert_file='/tls/expired.crt'"
          : "ALTER SYSTEM SET ssl='off'",
      );
      await admin.query('SELECT pg_reload_conf()');
      await vi.waitFor(async () => expect((await probe()).status).toBe('unavailable'), {
        timeout: 5000,
        interval: 50,
      });
    } finally {
      await admin.query("ALTER SYSTEM SET ssl_cert_file='/tls/server.crt'");
      await admin.query("ALTER SYSTEM SET ssl='on'");
      await admin.query('SELECT pg_reload_conf()');
    }
    await vi.waitFor(async () => expect((await probe()).compatible).toBe(true), {
      timeout: 5000,
      interval: 50,
    });
  },
  20000,
);
it('reports incompatible database, schema and relation ownership without adopting or repairing it', async () => {
  await admin.query('CREATE ROLE preflight_foreign');
  try {
    await admin.query('ALTER DATABASE tt_app_catalog OWNER TO preflight_foreign');
    await admin.query('GRANT CONNECT ON DATABASE tt_app_catalog TO tt_app_migrator');
    expect((await probe()).findings).toContain('database_owner');
    await admin.query('ALTER DATABASE tt_app_catalog OWNER TO tt_app_migrator');
    await f.owner.query('CREATE SCHEMA preflight_unused');
    await f.owner.query('CREATE TABLE app.preflight_foreign(id integer)');
    const root = new URL(disposableTargets(process.env).app);
    root.pathname = '/tt_app_catalog';
    const db = new pg.Client({ connectionString: root.toString() });
    await db.connect();
    try {
      await db.query('ALTER SCHEMA app OWNER TO preflight_foreign');
      await db.query('ALTER TABLE app.preflight_foreign OWNER TO preflight_foreign');
      const r = await probe();
      expect(r.findings).toEqual(expect.arrayContaining(['schema_owner', 'object_owner']));
      expect(
        (
          await db.query(
            "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='app'",
          )
        ).rows[0].owner,
      ).toBe('preflight_foreign');
    } finally {
      await db.query('ALTER SCHEMA app OWNER TO tt_app_migrator');
      await db.query('DROP TABLE app.preflight_foreign');
      await db.end();
    }
  } finally {
    await admin.query('ALTER DATABASE tt_app_catalog OWNER TO tt_app_migrator');
    await admin.query('GRANT ALL ON DATABASE tt_app_catalog TO tt_app_migrator');
    await f.owner.query('DROP SCHEMA IF EXISTS preflight_unused');
    await admin.query('DROP ROLE preflight_foreign');
  }
});
it('reports missing roles and unsafe capability flags without changing them', async () => {
  await admin.query('ALTER ROLE tt_app_runtime RENAME TO preflight_missing');
  try {
    expect((await probe()).findings).toContain('missing_role');
  } finally {
    await admin.query('ALTER ROLE preflight_missing RENAME TO tt_app_runtime');
  }
  await admin.query('ALTER ROLE tt_app_runtime BYPASSRLS');
  try {
    expect((await probe()).findings).toContain('role_capabilities');
  } finally {
    await admin.query('ALTER ROLE tt_app_runtime NOBYPASSRLS');
  }
});
it('detects PUBLIC/default and cross-database privilege drift without granting or revoking anything', async () => {
  await f.owner.query('GRANT CONNECT ON DATABASE tt_app_catalog TO PUBLIC');
  await f.owner.query('GRANT CREATE ON SCHEMA app TO PUBLIC');
  await f.owner.query('ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC');
  await f.cmsAdmin.query('GRANT CONNECT ON DATABASE tt_cms_content TO tt_app_runtime');
  try {
    expect((await probe()).findings).toEqual(
      expect.arrayContaining([
        'database_acl',
        'schema_acl',
        'default_privileges',
        'runtime_database_privileges',
      ]),
    );
    expect(
      (await f.owner.query("SELECT has_schema_privilege('public','app','CREATE') AS allowed"))
        .rows[0].allowed,
    ).toBe(true);
  } finally {
    await f.owner.query('REVOKE CONNECT ON DATABASE tt_app_catalog FROM PUBLIC');
    await f.owner.query('REVOKE CREATE ON SCHEMA app FROM PUBLIC');
    await f.owner.query('ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC');
    await f.cmsAdmin.query('REVOKE CONNECT ON DATABASE tt_cms_content FROM tt_app_runtime');
  }
});
it('reproduces non-superuser CREATEROLE membership and preserves strict bootstrap refusal rather than accepting provider defaults', async () => {
  const password = randomBytes(32).toString('hex');
  await admin.query('ALTER ROLE tt_app_runtime RENAME TO preflight_original');
  await admin.query(`CREATE ROLE preflight_creator LOGIN CREATEROLE PASSWORD '${password}'`);
  const creatorUrl = new URL(disposableTargets(process.env).app);
  creatorUrl.username = 'preflight_creator';
  creatorUrl.password = password;
  const creator = new pg.Client({ connectionString: creatorUrl.toString() });
  try {
    await creator.connect();
    await creator.query(
      'CREATE ROLE tt_app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
    );
    expect(
      (
        await admin.query(
          "SELECT admin_option,inherit_option,set_option FROM pg_auth_members WHERE roleid='tt_app_runtime'::regrole AND member='preflight_creator'::regrole",
        )
      ).rows,
    ).toEqual([{ admin_option: true, inherit_option: false, set_option: false }]);
    expect((await probe()).findings).toContain('role_memberships');
    const root = new URL(disposableTargets(process.env).app);
    root.pathname = '/tt_app_catalog';
    const passwords = Object.fromEntries(
      Object.values(databaseRoles)
        .flat()
        .map((r) => [r, randomBytes(32).toString('hex')]),
    ) as RolePasswords;
    await expect(
      bootstrapDatabase(root.toString(), 'app', 'tt_app_catalog', passwords),
    ).rejects.toThrow('Existing role has unexpected memberships');
    expect(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM pg_auth_members WHERE roleid='tt_app_runtime'::regrole",
        )
      ).rows[0].n,
    ).toBeGreaterThan(0);
  } finally {
    await creator.end();
    await admin.query('DROP ROLE IF EXISTS tt_app_runtime');
    await admin.query('ALTER ROLE preflight_original RENAME TO tt_app_runtime');
    await admin.query('DROP ROLE preflight_creator');
  }
});
it('reports version, migration-count and same-count digest mismatches without mutating the target', async () => {
  expect(
    (
      await probe({
        expectedVersion: 180005,
        expectedMigrations: 32,
        expectedHistory: input().expectedHistory.slice(0, -1),
      })
    ).findings,
  ).toEqual(expect.arrayContaining(['version', 'migrations']));
  expect((await probe()).compatible).toBe(true);
  const history = input().expectedHistory.map((r, i) =>
    i === 0 ? { ...r, sha256: '0'.repeat(64) } : r,
  );
  expect((await probe({ expectedHistory: history })).findings).toContain('migrations');
});
it('runs the local process CLI with bounded private input and redacted failures', async () => {
  const file = join(directory, 'settings.json');
  const run = () =>
    spawnSync(process.execPath, ['--import', 'tsx', 'scripts/database/preflight.ts', file], {
      env: process.env,
      encoding: 'utf8',
      timeout: 10000,
    });
  await writeFile(file, JSON.stringify(input()), { mode: 0o600 });
  const good = run();
  expect(good.status).toBe(0);
  expect(JSON.parse(good.stdout).compatible).toBe(true);
  await writeFile(
    file,
    JSON.stringify({
      ...input(),
      url: input().url.replace('postgres.preflight.test', 'example.com'),
    }),
  );
  const bad = run();
  expect(bad.status).toBe(1);
  expect(bad.stdout + bad.stderr).not.toContain(new URL(input().url).password);
  expect(bad.stdout + bad.stderr).not.toContain('example.com');
  for (const value of [
    { ...input(), expectedVersion: 180005 },
    {
      ...input(),
      expectedHistory: input().expectedHistory.map((r, i) =>
        i === 0 ? { ...r, sha256: '0'.repeat(64) } : r,
      ),
    },
  ]) {
    await writeFile(file, JSON.stringify(value));
    expect(run().status).toBe(1);
  }
  await writeFile(file, JSON.stringify(input()));
  await chmod(file, 0o644);
  expect(run().status).toBe(1);
  await chmod(file, 0o600);
  const source = join(directory, 'private-source.json');
  await writeFile(source, JSON.stringify(input()), { mode: 0o600 });
  await unlink(file);
  await symlink(source, file);
  expect(run().status).toBe(1);
  await unlink(file);
  for (const raw of ['invalid json', 'x'.repeat(131073)]) {
    await writeFile(file, raw, { mode: 0o600 });
    expect(run().status).toBe(1);
  }
});
