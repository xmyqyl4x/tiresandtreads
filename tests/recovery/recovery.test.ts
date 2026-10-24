import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseRoles, identifier } from '../../scripts/database/bootstrap.ts';
import { schemaInventory, schemaHealth, digest } from '../../scripts/database/inventory.ts';
import { loadSources } from '../../scripts/database/manifest.ts';
import { migrateApplication } from '../../scripts/database/migrate.ts';
import { migrateCms } from '../../scripts/database/cms.ts';
import {
  validateRecoveryArtifact,
  type RecoveryArtifact,
} from '../../scripts/database/recovery-artifact.ts';
import {
  context,
  connect,
  subjectId,
  survivorId,
  reportId,
  cmsId,
  lateId,
  readEvidence,
  writeEvidence,
} from '../fixtures/recovery/context.ts';
import { fingerprints } from '../fixtures/recovery/fingerprints.ts';
import {
  assertFixtureReady,
  validateJournal,
  restrictGraph,
  purgeGraph,
  rebuildFixtureMetrics,
  reconcileCms,
  type Journal,
} from '../fixtures/recovery/replay.ts';

const target = context('recovery-postgres');
let app: pg.Client;
let cms: pg.Client;
let bad: pg.Client;
let inventoryVerified = false;
let fingerprintsVerified = false;
const journal = readEvidence<Journal>('current-journal');
const window = readEvidence<{ startedAt: string; finishedAt: string }>('backup-window');
const artifacts = readEvidence<Record<'app' | 'cms', RecoveryArtifact>>('artifacts');
const contract = JSON.parse(readFileSync('infra/database/s1-contract.json', 'utf8')) as Record<
  'app' | 'cms',
  { tables: string[]; views: string[] }
>;
const checksStarted = Date.now();

beforeAll(async () => {
  app = await connect(target.url('app'));
  cms = await connect(target.url('cms'));
  bad = await connect(target.url('app', 'tt_app_migrator', true));
});
afterAll(async () => {
  await Promise.all([app?.end(), cms?.end(), bad?.end()]);
});

it('DB28 admits only matching real app/CMS archives and reviewed migration manifests', () => {
  for (const kind of ['app', 'cms'] as const)
    expect(() =>
      validateRecoveryArtifact(
        artifacts[kind],
        readFileSync(`/recovery/${kind}.dump`),
        kind,
        target.project,
        loadSources(kind),
      ),
    ).not.toThrow();
  expect(() =>
    validateRecoveryArtifact(
      artifacts.cms,
      readFileSync('/recovery/cms.dump'),
      'app',
      target.project,
      loadSources('app'),
    ),
  ).toThrow(/artifact/);
});

it('restores the complete P1 inventory, ownership, ACLs, functions, views and valid indexed constraints', async () => {
  const expected =
    readEvidence<Record<'app' | 'cms', Awaited<ReturnType<typeof schemaInventory>>>>(
      'source-inventory',
    );
  for (const [kind, db] of [
    ['app', app],
    ['cms', cms],
  ] as const) {
    const actual = await schemaInventory(db);
    expect(actual).toEqual(expected[kind]);
    expect(
      actual.relations
        ?.filter((row) => row.kind === 'r')
        .map((row) => row.name)
        .sort(),
    ).toEqual(contract[kind].tables);
    expect(
      actual.relations
        ?.filter((row) => row.kind === 'v')
        .map((row) => row.name)
        .sort(),
    ).toEqual(contract[kind].views);
    expect(actual.relations?.every((row) => row.owner === `tt_${kind}_migrator`)).toBe(true);
    expect(await schemaHealth(db)).toEqual([]);
  }
  inventoryVerified = true;
});

it('restores every table fingerprint and exposes the known post-backup gap without claiming PITR', async () => {
  const expected =
    readEvidence<Record<'app' | 'cms', Awaited<ReturnType<typeof fingerprints>>>>(
      'source-fingerprints',
    );
  expect(await fingerprints(app)).toEqual(expected.app);
  expect(await fingerprints(cms)).toEqual(expected.cms);
  fingerprintsVerified = true;
  expect((await app.query('SELECT id FROM app.subjects WHERE id=$1', [subjectId])).rowCount).toBe(
    1,
  );
  expect((await app.query('SELECT id FROM app.subjects WHERE id=$1', [lateId])).rowCount).toBe(0);
  const source = await connect(context('postgres').url('app'));
  try {
    expect(
      (await source.query('SELECT id FROM app.subjects WHERE id=$1', [subjectId])).rowCount,
    ).toBe(0);
    expect((await source.query('SELECT id FROM app.subjects WHERE id=$1', [lateId])).rowCount).toBe(
      1,
    );
  } finally {
    await source.end();
  }
});

it('rolls back a corrupt restore and keeps both recovery databases closed to every runtime', async () => {
  expect(
    (
      await bad.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')",
      )
    ).rows[0].n,
  ).toBe(0);
  for (const kind of ['app', 'cms'] as const)
    for (const role of databaseRoles[kind].slice(1))
      await expect(connect(target.url(kind, role))).rejects.toMatchObject({ code: '42501' });
  await expect(connect(target.url('app', 'tt_app_runtime', true))).rejects.toMatchObject({
    code: '42501',
  });
});

it('rebuilds restricted roles with fresh target credentials instead of restoring cluster secrets', async () => {
  const roles = Object.values(databaseRoles).flat();
  const rows = (
    await app.query(
      'SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=ANY($1)',
      [roles],
    )
  ).rows;
  expect(rows).toHaveLength(roles.length);
  for (const row of rows)
    expect(
      Object.entries(row)
        .filter(([key]) => key !== 'rolname')
        .every(([, value]) => value === false),
    ).toBe(true);
  const wrong = new URL(target.url('app'));
  wrong.password = context('postgres').passwords.tt_app_migrator;
  await expect(connect(wrong.toString())).rejects.toMatchObject({ code: '28P01' });
});

it('retains immutable history and composite ownership constraints after restore', async () => {
  await expect(
    app.query("UPDATE app.report_versions SET output_snapshot='{}' WHERE report_id=$1", [reportId]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    app.query(
      `INSERT INTO app.download_grants(asset_id,report_id,report_version,view_scope,owner_session_id,owner_subject_id,token_hash,key_version,expires_at)
       SELECT asset_id,report_id,report_version,view_scope,owner_session_id,$1,decode(repeat('ae',32),'hex'),key_version,now()+interval '10 minutes' FROM app.download_grants LIMIT 1`,
      [survivorId],
    ),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(cms.query("UPDATE _articles_v SET version_title='tampered'")).rejects.toMatchObject({
    code: '23514',
  });
});

it('DB13 refuses absent, stale or mismatched current journals and opening unreconciled restores', async () => {
  for (const value of [
    null,
    {},
    { ...journal, marker: '0'.repeat(64) },
    { ...journal, capturedAt: '2000-01-01T00:00:00Z' },
  ])
    expect(() => validateJournal(value, window.finishedAt)).toThrow(/journal/);
  await expect(assertFixtureReady(app, cms, journal, window.finishedAt)).rejects.toThrow(
    /quarantined/,
  );
  await restrictGraph(app, journal);
  expect((await app.query('SELECT * FROM analytics.visible_daily_metrics')).rowCount).toBe(0);
  expect(
    (await app.query('SELECT status FROM app.subjects WHERE id=$1', [subjectId])).rows[0].status,
  ).toBe('pending_deletion');
  expect(
    (await app.query('SELECT dispatch_state,anonymized_at FROM email.email_sends')).rows[0],
  ).toMatchObject({ dispatch_state: 'suppressed', anonymized_at: expect.any(Date) });
});

it('fails an incomplete retention order atomically instead of bypassing dependent FKs', async () => {
  await app.query(
    "INSERT INTO app.report_items(report_id,report_version,item_key,kind,rank,snapshot) VALUES($1,1,'unhandled-child','picked',1,'{}')",
    [reportId],
  );
  await expect(purgeGraph(app)).rejects.toThrow();
  expect(
    (
      await app.query('SELECT report_id FROM privacy.report_private_data WHERE report_id=$1', [
        reportId,
      ])
    ).rowCount,
  ).toBe(1);
  expect((await app.query('SELECT id FROM app.subjects WHERE id=$1', [subjectId])).rowCount).toBe(
    1,
  );
  await expect(connect(target.url('app', 'tt_app_runtime'))).rejects.toMatchObject({
    code: '42501',
  });
  await app.query(
    "DELETE FROM app.report_items WHERE report_id=$1 AND item_key='unhandled-child'",
    [reportId],
  );
});

it('DB13 replays deletion in dependency order, retains tombstones and cancels old work idempotently', async () => {
  await purgeGraph(app);
  expect((await app.query('SELECT * FROM analytics.visible_daily_metrics')).rowCount).toBe(0);
  await rebuildFixtureMetrics(app);
  await restrictGraph(app, journal);
  await purgeGraph(app);
  await rebuildFixtureMetrics(app);
  for (const table of [
    'app.reports',
    'app.report_versions',
    'app.download_grants',
    'app.report_assets',
    'privacy.contacts',
    'privacy.contact_lookups',
    'privacy.report_private_data',
    'analytics.events',
  ])
    expect((await app.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, table).toBe(0);
  expect(
    (
      await app.query(
        "SELECT id FROM app.object_assets WHERE id='88888888-8888-4888-8888-000000000041'",
      )
    ).rowCount,
  ).toBe(0);
  const sourceApp = await connect(context('postgres').url('app'));
  try {
    expect((await app.query('SELECT * FROM app.object_assets ORDER BY id')).rows).toEqual(
      (await sourceApp.query('SELECT * FROM app.object_assets ORDER BY id')).rows,
    );
  } finally {
    await sourceApp.end();
  }
  expect((await app.query('SELECT id FROM app.subjects WHERE id=$1', [subjectId])).rowCount).toBe(
    0,
  );
  expect((await app.query('SELECT id FROM app.subjects WHERE id=$1', [survivorId])).rowCount).toBe(
    1,
  );
  expect((await app.query('SELECT state FROM app.outbox')).rows).toEqual([{ state: 'cancelled' }]);
  expect(
    (
      await app.query(
        "SELECT count(*)::int AS n FROM privacy.deletion_markers WHERE resource_kind='subject'",
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (await app.query('SELECT count(*)::int AS n FROM privacy.suppression_tombstones')).rows[0].n,
  ).toBe(1);
  expect((await app.query('SELECT * FROM analytics.visible_daily_metrics')).rowCount).toBe(0);
  await expect(assertFixtureReady(app, cms, journal, window.finishedAt)).rejects.toThrow(
    /quarantined/,
  );
});

it('DB16 recovers an independent CMS publication after a crash between database commits', async () => {
  expect((await app.query('SELECT * FROM app.published_content')).rowCount).toBe(0);
  await expect(reconcileCms(app, cms, true)).rejects.toThrow(/Injected crash/);
  expect((await app.query('SELECT * FROM app.published_content')).rowCount).toBe(1);
  expect(
    (await cms.query('SELECT state FROM publication_work WHERE document_id=$1', [cmsId])).rows[0]
      .state,
  ).toBe('pending');
  await expect(assertFixtureReady(app, cms, journal, window.finishedAt)).rejects.toThrow(
    /quarantined/,
  );
  await reconcileCms(app, cms);
  await reconcileCms(app, cms);
  expect((await app.query('SELECT public_dto FROM app.published_content')).rows).toEqual([
    { public_dto: { title: 'Recovered editorial content' } },
  ]);
  await assertFixtureReady(app, cms, journal, window.finishedAt);
});

it('replays restored migration histories as a no-op and reopens only existing restricted runtime grants', async () => {
  expect(
    await migrateApplication(
      { url: target.url('app'), kind: 'app', database: 'tt_app_recovery' },
      loadSources('app'),
    ),
  ).toBe(0);
  expect(
    await migrateCms(
      { url: target.url('cms'), kind: 'cms', database: 'tt_cms_recovery' },
      target.secret,
    ),
  ).toBe(0);
  await assertFixtureReady(app, cms, journal, window.finishedAt);
  expect(
    inventoryVerified && fingerprintsVerified,
    'Pre-replay backup validation must succeed',
  ).toBe(true);
  for (const [kind, db] of [
    ['app', app],
    ['cms', cms],
  ] as const) {
    expect(await schemaHealth(db)).toEqual([]);
    for (const role of databaseRoles[kind].slice(1))
      await db.query(`GRANT CONNECT ON DATABASE tt_${kind}_recovery TO ${identifier(role)}`);
  }
  const runtime = await connect(target.url('app', 'tt_app_runtime'));
  const cmsRuntime = await connect(target.url('cms', 'tt_cms_runtime'));
  try {
    expect(
      (await runtime.query('SELECT id FROM app.subjects WHERE id=$1', [subjectId])).rowCount,
    ).toBe(0);
    expect(
      (await runtime.query('SELECT id FROM app.subjects WHERE id=$1', [survivorId])).rowCount,
    ).toBe(1);
    await expect(runtime.query('SELECT * FROM privacy.contacts')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(runtime.query('CREATE TABLE public.forbidden(id int)')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(cmsRuntime.query('SELECT * FROM public.articles')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(connect(target.url('app', 'tt_cms_runtime'))).rejects.toMatchObject({
      code: '42501',
    });
  } finally {
    await runtime.end();
    await cmsRuntime.end();
  }
  const inventory =
    readEvidence<Record<'app' | 'cms', Awaited<ReturnType<typeof schemaInventory>>>>(
      'source-inventory',
    );
  writeEvidence('result', {
    status: 'passed',
    checksMs: Date.now() - checksStarted,
    backupWindowMs: Date.parse(window.finishedAt) - Date.parse(window.startedAt),
    tables: { app: contract.app.tables.length, cms: contract.cms.tables.length },
    inventorySha256: { app: digest(inventory.app), cms: digest(inventory.cms) },
    backupBytes: { app: artifacts.app.bytes, cms: artifacts.cms.bytes },
    backupSha256: { app: artifacts.app.sha256, cms: artifacts.cms.sha256 },
    migrations: { app: loadSources('app').length, cms: loadSources('cms').length },
    failures: [
      'corrupt restore rolled back',
      'missing/stale journal denied',
      'incomplete deletion rolled back',
      'inter-database publication crash retried',
    ],
    lateWrite: 'known post-backup write absent; no PITR claim',
    scope:
      'isolated synthetic logical restore; hosted RPO/RTO and object/provider recovery remain unproven',
  });
});
