import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, X509Certificate } from 'node:crypto';
import assert from 'node:assert/strict';
import { bootstrapDatabase, identifier } from '../../../scripts/database/bootstrap.ts';
import { migrateApplication, withMigrationLock } from '../../../scripts/database/migrate.ts';
import { migrateCms } from '../../../scripts/database/cms.ts';
import { loadSources } from '../../../scripts/database/manifest.ts';
import {
  expansionSQL,
  expansionDigest,
  admitExpansion,
} from '../../../scripts/deployment/preflight.ts';
import { deploymentContext, connect } from './context.ts';
async function main() {
  const ctx = deploymentContext();
  mkdirSync('/deployment', { recursive: true, mode: 0o700 });
  chmodSync('/deployment', 0o700);
  for (const kind of ['app', 'cms'] as const) {
    const admin = await connect(ctx.admin);
    try {
      await admin.query(`CREATE DATABASE ${identifier('tt_' + kind + '_deployment')}`);
    } finally {
      await admin.end();
    }
    const root = new URL(ctx.admin);
    root.pathname = '/tt_' + kind + '_deployment';
    await bootstrapDatabase(root.toString(), kind, 'tt_' + kind + '_deployment', ctx.passwords);
  }
  await migrateApplication(
    { url: ctx.url('app'), kind: 'app', database: 'tt_app_deployment' },
    loadSources('app'),
  );
  await migrateCms({ url: ctx.url('cms'), kind: 'cms', database: 'tt_cms_deployment' }, ctx.secret);
  const app = await connect(ctx.url('app')),
    cms = await connect(ctx.url('cms'));
  try {
    await app.query(
      "CREATE SCHEMA deployment_fixture;CREATE TABLE deployment_fixture.release_state(id integer PRIMARY KEY,label text NOT NULL);INSERT INTO deployment_fixture.release_state VALUES(1,'survivor')",
    );
    const target = { url: ctx.url('app'), kind: 'app' as const, database: 'tt_app_deployment' };
    let release!: () => void,
      started!: () => void,
      entered = false;
    const hold = new Promise<void>((r) => (release = r)),
      ready = new Promise<void>((r) => (started = r));
    const expand = async (c: Awaited<ReturnType<typeof connect>>) => {
      if (
        (
          await c.query(
            "SELECT 1 FROM information_schema.columns WHERE table_schema='deployment_fixture' AND table_name='release_state' AND column_name='additive_probe'",
          )
        ).rowCount
      )
        return false;
      await c.query('BEGIN');
      try {
        await c.query(admitExpansion(expansionSQL));
        await c.query('COMMIT');
        return true;
      } catch {
        await c.query('ROLLBACK');
        throw Error('Local expansion failed');
      }
    };
    const first = withMigrationLock(target, async (c) => {
      started();
      await hold;
      return expand(c);
    });
    await ready;
    try {
      await assert.rejects(
        withMigrationLock(target, async () => {
          entered = true;
        }),
        /Another migration executor/,
      );
    } finally {
      release();
    }
    assert.equal(entered, false);
    assert.equal(await first, true);
    assert.equal(await withMigrationLock(target, expand), false);
    // A fixture-only boolean capability keeps migration credentials out of the TLS ingress.
    for (const [kind, c] of [
      ['app', app],
      ['cms', cms],
    ] as const) {
      if (kind === 'cms') await c.query('CREATE SCHEMA deployment_fixture');
      await c.query(`CREATE TABLE deployment_fixture.expected_history AS SELECT * FROM migration_meta.applied;
      CREATE FUNCTION deployment_fixture.ready() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fixture$
      SELECT NOT EXISTS((SELECT * FROM migration_meta.applied EXCEPT SELECT * FROM deployment_fixture.expected_history) UNION ALL (SELECT * FROM deployment_fixture.expected_history EXCEPT SELECT * FROM migration_meta.applied))
      ${kind === 'app' ? "AND EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='deployment_fixture.release_state'::regclass AND attname='additive_probe' AND NOT attisdropped)" : ''}
      $fixture$;
      REVOKE ALL ON SCHEMA deployment_fixture FROM PUBLIC;
      REVOKE ALL ON FUNCTION deployment_fixture.ready() FROM PUBLIC;
      GRANT USAGE ON SCHEMA deployment_fixture TO tt_${kind}_runtime;
      GRANT EXECUTE ON FUNCTION deployment_fixture.ready() TO tt_${kind}_runtime;`);
    }
    const history = async (c: Awaited<ReturnType<typeof connect>>) =>
      (await c.query('SELECT * FROM migration_meta.applied ORDER BY position')).rows;
    writeFileSync(
      '/deployment/database-proof.json',
      JSON.stringify({
        serializedRefusal: true,
        expandApplied: true,
        repeatApplied: false,
        app: await history(app),
        cms: await history(cms),
      }),
      { mode: 0o600, flag: 'wx' },
    );
    writeFileSync(
      '/deployment/secrets.json',
      JSON.stringify({
        app: ctx.url('app', 'tt_app_runtime'),
        cms: ctx.url('cms', 'tt_cms_runtime'),
        callbackKey: 'signkey-test-' + randomBytes(32).toString('hex'),
        operatorFingerprint: new X509Certificate(readFileSync('/deploy-tls/operator.crt'))
          .fingerprint256,
      }),
      { mode: 0o600, flag: 'wx' },
    );
    writeFileSync(
      '/deployment/state.json',
      JSON.stringify({ version: 1, project: ctx.project, slot: 'current', expansionDigest }),
      { mode: 0o600, flag: 'wx' },
    );
  } finally {
    await Promise.all([app.end(), cms.end()]);
  }
  console.log(
    'Disposable deployment DBs prepared; serialized additive fixture proof passed; no startup migration',
  );
}
main()
  .then(() => process.exit(0))
  .catch(() => {
    console.error('Local deployment preparation refused');
    process.exit(1);
  });
