import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import {
  schemaGateFixture,
  schemaGateSources,
  gateCatalog,
  gateDatabases,
} from '../fixtures/phase2/schema-gate.ts';
import { seedGateRecords } from '../fixtures/phase2/seed-schema-gate.ts';
import { purgeGatePhoto } from '../fixtures/phase2/purge-schema-gate.ts';
import { photoImportSources, photoImportRoles } from '../fixtures/phase2/photo-import.ts';
import { partnerRoles, partnerSources } from '../fixtures/phase2/partners.ts';
import { aiRoles, aiSources } from '../fixtures/phase2/ai.ts';
import { migrateApplication } from '../../scripts/database/migrate.ts';
import { createTransactions } from '../../packages/db/src/transactions.ts';
import { createReportRepository } from '../../packages/db/src/repositories/reports.ts';
import { databaseRoles } from '../../scripts/database/bootstrap.ts';

let f: Awaited<ReturnType<typeof schemaGateFixture>>,
  records: Awaited<ReturnType<typeof seedGateRecords>>,
  restored: pg.Client,
  rollback: pg.Client,
  replay: pg.Client,
  owner: pg.Client;
let sourceData: Awaited<ReturnType<typeof f.gateSnapshot>>,
  sourceCatalog: Awaited<ReturnType<typeof gateCatalog>>,
  fullArchiveBytes: string;
const roles = [...partnerRoles, ...aiRoles, ...photoImportRoles];
beforeAll(async () => {
  f = await schemaGateFixture();
  records = await seedGateRecords(f);
  sourceData = await f.gateSnapshot(f.observer);
  sourceCatalog = await gateCatalog(f.observer);
  fullArchiveBytes = await f.archive('full');
  restored = await f.restore('full');
  rollback = await f.restore('p1');
  replay = await f.restore('full', true);
  owner = await f.gateClient('restored', 'tt_app_migrator');
}, 60000);
afterAll(async () => {
  await f?.cleanup();
}, 60000);
const deny = async (p: Promise<unknown>, code = '23514') =>
  expect(p).rejects.toMatchObject({ code });
it('installs the complete Phase 2 track from a truly empty app database', async () => {
  expect(
    (await f.fresh.query("SELECT to_regclass('app.tire_photo_uploads')::text AS relation")).rows,
  ).toEqual([{ relation: 'app.tire_photo_uploads' }]);
  expect(f.freshApplied).toBe(43);
  expect(
    (await f.fresh.query('SELECT count(*)::int AS count FROM migration_meta.applied')).rows[0]!
      .count,
  ).toBe(43);
});
it('matches fresh and populated-upgrade columns, keys, grants, indexes, functions, triggers and RLS', async () => {
  expect(await gateCatalog(f.fresh)).toEqual(sourceCatalog);
  expect(f.appliedPartner + f.appliedAi + f.appliedPhoto + f.appliedGate).toBe(10);
  expect(await f.installFresh()).toBe(0);
});
it('preserves all original P1 rows with exactly two additional asset-purpose codes', () => {
  expect(f.p1Before).toHaveLength(141);
  for (const before of f.p1Before) {
    const after = f.p1After.find((r) => r.table === before.table)!;
    if (before.table === 'app.code_values') expect(after.count - before.count).toBe(2);
    else expect(after).toEqual(before);
  }
  expect(f.registryAfter).toEqual(f.registryBefore);
});
it('uses real custom archives and preserves every installed table row on full restore', async () => {
  expect(Number(f.p1ArchiveBytes)).toBeGreaterThan(10000);
  expect(Number(fullArchiveBytes)).toBeGreaterThan(Number(f.p1ArchiveBytes));
  expect(sourceData).toHaveLength(184);
  expect(await f.gateSnapshot(restored)).toEqual(sourceData);
  expect(await f.gateSnapshot(replay)).toEqual(sourceData);
});
// pg_dump reparses these exact existing CHECK definitions and flattens associative ANDs.
// No general SQL text stripping: all other definitions and all validation flags compare exactly.
const checkFormatting = JSON.parse(
  readFileSync('tests/fixtures/phase2/restore-check-formatting.json', 'utf8'),
) as { before: string; after: string }[];
function restoredCatalogExpected(catalog: Awaited<ReturnType<typeof gateCatalog>>) {
  return {
    ...catalog,
    constraints: catalog.constraints.map((row) => ({
      ...row,
      definition:
        checkFormatting.find((pair) => pair.before === row.definition)?.after ?? row.definition,
    })),
  };
}
it('restores restricted ownership, grants, constraints, indexes and RLS without bypassing runtime roles', async () => {
  for (const c of [restored, replay]) {
    const actual = await gateCatalog(c),
      expected = restoredCatalogExpected(sourceCatalog);
    for (const key of Object.keys(expected) as (keyof typeof expected)[])
      expect(actual[key], key).toEqual(expected[key]);
  }
  const flags = (
    await restored.query(
      'SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit FROM pg_roles WHERE rolname=ANY($1)',
      [roles],
    )
  ).rows;
  expect(flags).toHaveLength(10);
  expect(flags.every((row) => Object.values(row).every((value) => value === false))).toBe(true);
});
it('keeps every restored runtime CONNECT privilege closed before fixture admission', async () => {
  for (const target of ['restored', 'rollback', 'replay'] as const) {
    const rows = (
      await f.gateRoot.query(
        "SELECT rolname,has_database_privilege(rolname,$1,'CONNECT') AS allowed FROM pg_roles WHERE rolname=ANY($2)",
        [gateDatabases[target], [...databaseRoles.app.slice(1), ...roles]],
      )
    ).rows;
    expect(rows.every((r) => r.allowed === false)).toBe(true);
  }
});
it('restores the actual P1 schema and 33-entry history for rollback without reverse DDL', async () => {
  expect(await f.gateSnapshot(rollback, 33)).toEqual(f.p1Before);
  expect(
    (
      await rollback.query(
        "SELECT to_regnamespace('partners') AS schema,to_regclass('app.ai_policy_versions') AS ai",
      )
    ).rows,
  ).toEqual([{ schema: null, ai: null }]);
  expect(
    (await rollback.query('SELECT count(*)::int AS count FROM migration_meta.applied')).rows[0]!
      .count,
  ).toBe(33);
});
it.each(['source', 'restored', 'rollback'] as const)(
  'keeps the unchanged P1 report repository working on %s',
  async (database) => {
    if (database !== 'source') await f.grantGateConnect(database, 'tt_private_runtime');
    const pool = new pg.Pool({
      connectionString: f.gateUrl(database, 'tt_private_runtime'),
      max: 1,
      connectionTimeoutMillis: 3000,
    });
    try {
      const tx = createTransactions(pool, { transactionMs: 5000, statementMs: 3000, lockMs: 2000 }),
        repo = createReportRepository(tx);
      const result = await tx.unitOfWork.run(async (t) => ({
        ok: true as const,
        value: await repo.version(t, f.retainedOwner.identity, f.retainedReport.head.id, 1),
      }));
      expect(result).toEqual({ ok: true, value: f.retainedReport.version });
    } finally {
      await pool.end();
    }
  },
);
it('forces RLS across all 43 local P2 tables and denies their direct access to old app runtime', async () => {
  const tables = [
    ...partnerSources().manifest.tables,
    ...aiSources().manifest.tables,
    ...photoImportSources().manifest.tables,
  ];
  const rows = (
    await restored.query(
      "SELECT c.relrowsecurity,c.relforcerowsecurity,has_table_privilege('tt_app_runtime',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS old_access FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname||'.'||c.relname=ANY($1)",
      [tables],
    )
  ).rows;
  expect(rows).toHaveLength(43);
  expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity && !r.old_access)).toBe(true);
});
it('does not grant server-program execution to an ordinary existing runtime identity', async () => {
  const c = await f.gateClient('restored', 'tt_private_runtime');
  await deny(c.query("COPY (SELECT 1 WHERE false) TO PROGRAM 'true'"), '42501');
});
it('retains the complete accepted photo, candidate and confirmation across restore', async () => {
  await f.grantGateConnect('restored', 'tt_p2_photo_runtime');
  const reader = await f.gateClient('restored', 'tt_p2_photo_runtime');
  await reader.query("SELECT set_config('tt.p2_photo_subject',$1,false)", [records.owner]);
  expect(
    (
      await reader.query(
        'SELECT normalized_value FROM app.photo_current_candidates WHERE upload_id=$1',
        [records.photo.upload],
      )
    ).rows,
  ).toEqual([{ normalized_value: 'Synthetic Gate Brand' }]);
  expect(
    (
      await reader.query(
        'SELECT confirmed_value FROM app.photo_current_confirmations WHERE upload_id=$1',
        [records.photo.upload],
      )
    ).rows,
  ).toEqual([{ confirmed_value: 'Synthetic Gate Brand' }]);
  expect(
    (
      await restored.query('SELECT app.ai_artifact_current($1) AS current', [
        records.photo.artifact,
      ])
    ).rows[0]!.current,
  ).toBe(true);
  await reader.query("SELECT set_config('tt.p2_photo_subject',$1,false)", [randomUUID()]);
  expect(
    (
      await reader.query('SELECT * FROM app.photo_current_candidates WHERE upload_id=$1', [
        records.photo.upload,
      ])
    ).rowCount,
  ).toBe(0);
});
it('retains independent CSV approval and original run status across restore', async () => {
  await f.grantGateConnect('restored', 'tt_p2_csv_staff');
  const staff = await f.gateClient('restored', 'tt_p2_csv_staff');
  await staff.query("SELECT set_config('tt.p2_csv_actor',$1,false)", [records.csv.reviewer]);
  expect(
    (
      await staff.query('SELECT id FROM admin.csv_current_approvals WHERE id=$1', [
        records.csv.review,
      ])
    ).rowCount,
  ).toBe(1);
  expect(
    (
      await staff.query('SELECT status FROM admin.csv_workflow_status WHERE id=$1', [
        records.csv.intake,
      ])
    ).rows,
  ).toEqual([{ status: 'validated' }]);
});
it('retains tenant isolation on the restored partner membership using a real role', async () => {
  await f.grantGateConnect('restored', 'tt_p2_partner_runtime');
  const actor = await f.gateClient('restored', 'tt_p2_partner_runtime');
  await actor.query(
    "SELECT set_config('tt.p2_actor','gate-retained-actor',false),set_config('tt.p2_org',$1,false)",
    [f.organization],
  );
  expect(
    (await actor.query('SELECT id FROM partners.organizations WHERE id=$1', [f.organization]))
      .rowCount,
  ).toBe(1);
  await actor.query("SELECT set_config('tt.p2_actor','other-actor',false)");
  expect(
    (await actor.query('SELECT id FROM partners.organizations WHERE id=$1', [f.organization]))
      .rowCount,
  ).toBe(0);
});
it.each(['asset', 'upload', 'artifact', 'request', 'policy'] as const)(
  'refuses deleting a %s before its dependent graph',
  async (kind) => {
    const sql = {
      asset: 'DELETE FROM app.object_assets WHERE id=$1',
      upload: 'DELETE FROM app.tire_photo_uploads WHERE id=$1',
      artifact: 'DELETE FROM app.ai_artifacts WHERE id=$1',
      request: 'DELETE FROM app.ai_analysis_requests WHERE id=$1',
      policy: 'DELETE FROM app.ai_policy_versions WHERE id=$1',
    }[kind];
    const id = { asset: records.photo.original, ...records.photo }[kind];
    await owner.query('BEGIN');
    try {
      await deny(
        owner.query(sql, [id]),
        kind === 'request' || kind === 'policy' ? '23001' : '23503',
      );
    } finally {
      await owner.query('ROLLBACK');
    }
  },
);
it.each(['reserved', 'uncertain'] as const)(
  'refuses purging %s AI cost holds before their reconciliation',
  async (state) => {
    await owner.query('BEGIN');
    try {
      if (state === 'uncertain')
        await owner.query("UPDATE app.ai_budget_reservations SET state='uncertain' WHERE id=$1", [
          records.photo.reservation,
        ]);
      await deny(
        owner.query('DELETE FROM app.ai_budget_reservations WHERE id=$1', [
          records.photo.reservation,
        ]),
      );
    } finally {
      await owner.query('ROLLBACK');
    }
  },
);
it('refuses unknown fixture targets, actors and archive selectors before dispatch', async () => {
  expect(() => f.gateUrl('foreign' as never)).toThrow('Unknown fixed gate target');
  expect(() => f.gateUrl('fresh', 'foreign_actor')).toThrow('Unknown fixed gate actor');
  await expect(f.archive('foreign' as never)).rejects.toThrow('Unknown fixed gate archive');
  await expect(f.restore('foreign' as never)).rejects.toThrow('Unknown fixed gate restore');
  await expect(f.grantGateConnect('foreign' as never, 'tt_private_runtime')).rejects.toThrow(
    'Unknown fixed gate admission target',
  );
});
it('refuses restoring over its already populated fixed target', async () => {
  await expect(f.restore('full')).rejects.toThrow('empty owned target');
});
it('indexes the child side of high-cardinality P2 ownership, asset, request and workflow foreign keys', async () => {
  const tables = [
    ...partnerSources().manifest.tables,
    ...aiSources().manifest.tables,
    ...photoImportSources().manifest.tables,
  ];
  const missing = (
    await restored.query(
      `SELECT n.nspname,c.relname,k.conname
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class parent ON parent.oid=k.confrelid JOIN pg_namespace pn ON pn.oid=parent.relnamespace
    WHERE k.contype='f' AND n.nspname||'.'||c.relname=ANY($1)
    AND pn.nspname||'.'||parent.relname=ANY($2)
    AND NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=k.conrelid AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND i.indkey[0]=ANY(k.conkey))
    ORDER BY n.nspname,c.relname,k.conname`,
      [
        tables,
        [
          'app.subjects',
          'app.object_assets',
          'app.ai_reuse_scopes',
          'app.ai_analysis_requests',
          'app.ai_artifacts',
          'app.ai_attempts',
          'app.ai_budget_windows',
          'app.job_runs',
          'app.reports',
          'privacy.privacy_requests',
          'app.dataset_versions',
          'partners.organizations',
          'partners.offers',
          'partners.lead_pools',
          'partners.credit_reservations',
        ],
      ],
    )
  ).rows;
  expect(missing).toEqual([]);
});
it('rejects late candidate appends after archive restoration', async () => {
  await deny(
    owner.query(
      "INSERT INTO app.photo_field_candidates(extraction_id,upload_id,owner_subject_id,field_code,ordinal,normalized_value,quality) VALUES($1,$2,$3,'model',0,'Late','clear')",
      [records.photo.extraction, records.photo.upload, records.owner],
    ),
  );
});
it('checks atomic migration failure and checksum drift on the complete track', async () => {
  const source = 'CREATE TABLE app.p2_gate_failed(id int); SELECT missing_schema_gate_column;',
    sources = schemaGateSources().sources;
  await expect(
    migrateApplication(
      { url: f.gateUrl('fresh', 'tt_app_migrator'), kind: 'app', database: gateDatabases.fresh },
      [
        ...sources,
        {
          id: '0044_gate_failed',
          source,
          sha256: createHash('sha256').update(source).digest('hex'),
        },
      ],
    ),
  ).rejects.toThrow();
  expect(
    (await f.fresh.query("SELECT to_regclass('app.p2_gate_failed') AS relation")).rows[0]!.relation,
  ).toBeNull();
  expect(await f.installFresh()).toBe(0);
  const changed = sources.map((entry, index) =>
    index === sources.length - 1
      ? {
          ...entry,
          source: entry.source + '\n-- drift\n',
          sha256: createHash('sha256')
            .update(entry.source + '\n-- drift\n')
            .digest('hex'),
        }
      : entry,
  );
  await expect(
    migrateApplication(
      { url: f.gateUrl('fresh', 'tt_app_migrator'), kind: 'app', database: gateDatabases.fresh },
      changed,
    ),
  ).rejects.toThrow('Database migration history differs');
});
it('purges the restored synthetic photo graph in FK order after reconciliation while preserving P1, CSV and partner records', async () => {
  const accounting = await purgeGatePhoto(owner, records);
  expect(accounting).toEqual({
    accounting: { reserved_minor: 0, spent_minor: 40 },
    afterPurge: { reserved_minor: 0, spent_minor: 40 },
  });
  const p = records.photo;
  for (const [table, id] of [
    ['app.tire_photo_uploads', p.upload],
    ['app.photo_extractions', p.extraction],
    ['app.photo_field_candidates', p.candidate],
    ['app.ai_artifacts', p.artifact],
    ['app.ai_analysis_requests', p.request],
    ['app.ai_reuse_scopes', p.scope],
    ['app.ai_attempts', p.attempt],
    ['app.ai_budget_reservations', p.reservation],
    ['app.object_assets', p.original],
    ['app.object_assets', p.sanitized],
  ] as const) {
    expect((await owner.query(`SELECT id FROM ${table} WHERE id=$1`, [id])).rowCount).toBe(0);
  }
  expect(
    (
      await owner.query('SELECT asset_id FROM privacy.asset_barriers WHERE asset_id=ANY($1)', [
        [p.original, p.sanitized],
      ])
    ).rowCount,
  ).toBe(2);
  expect(
    (await owner.query('SELECT id FROM app.reports WHERE id=$1', [f.retainedReport.head.id]))
      .rowCount,
  ).toBe(1);
  await owner.query("SELECT set_config('tt.p2_csv_actor',$1,false)", [records.csv.reviewer]);
  expect(
    (
      await owner.query('SELECT id FROM admin.csv_current_approvals WHERE id=$1', [
        records.csv.review,
      ])
    ).rowCount,
  ).toBe(1);
  expect(
    (await owner.query('SELECT id FROM partners.organizations WHERE id=$1', [f.organization]))
      .rowCount,
  ).toBe(1);
  expect(await f.gateSnapshot(f.observer)).toEqual(sourceData);
});
it('replays parent-held synthetic erasure markers before opening the old archive to its photo reader', async () => {
  const p = records.photo;
  expect(
    (await replay.query('SELECT app.ai_artifact_current($1) AS current', [p.artifact])).rows[0]
      .current,
  ).toBe(true);
  const markers = (
    await owner.query(
      'SELECT asset_id FROM privacy.asset_barriers WHERE asset_id=ANY($1) ORDER BY asset_id',
      [[p.original, p.sanitized]],
    )
  ).rows;
  expect(markers).toHaveLength(2);
  await replay.query('INSERT INTO privacy.asset_barriers(asset_id) SELECT unnest($1::uuid[])', [
    markers.map((row) => row.asset_id),
  ]);
  expect(
    (await replay.query('SELECT app.ai_artifact_current($1) AS current', [p.artifact])).rows[0]
      .current,
  ).toBe(false);
  await f.grantGateConnect('replay', 'tt_p2_photo_runtime');
  const reader = await f.gateClient('replay', 'tt_p2_photo_runtime');
  await reader.query("SELECT set_config('tt.p2_photo_subject',$1,false)", [records.owner]);
  expect(
    (
      await reader.query('SELECT * FROM app.photo_current_candidates WHERE upload_id=$1', [
        p.upload,
      ])
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await reader.query('SELECT * FROM app.photo_current_confirmations WHERE upload_id=$1', [
        p.upload,
      ])
    ).rowCount,
  ).toBe(0);
  await deny(
    replay.query(
      "INSERT INTO app.object_assets(id,purpose,bucket,object_key,mime_type,state,expires_at) VALUES($1,'tire_photo_original','synthetic','blocked','image/jpeg','pending',now()+interval '1 hour')",
      [p.original],
    ),
  );
});
it('records the local-only combined schema proof without accepting S1 or opening gates', () => {
  console.log(
    'P2_SCHEMA_GATE_EVIDENCE ' +
      JSON.stringify({
        freshMigrationCount: 43,
        localExtensions: 10,
        extensionTables: 43,
        completeTableInventory: 184,
        actualCustomArchives: true,
        fullDataParity: true,
        fullCatalogParity: true,
        realP1RepositoryRead: true,
        rollbackViaArchive: true,
        sourceAndTargetsSameInstance: true,
        maintenanceRestoreOnly: true,
        syntheticPhotoPurgeAndMarkerReplay: true,
        unresolvedCostPurgeRefused: true,
        actualS1Approval: false,
        actualPrivacyAcceptance: false,
        hostedAccepted: false,
        productionBootstrapChanged: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
});
