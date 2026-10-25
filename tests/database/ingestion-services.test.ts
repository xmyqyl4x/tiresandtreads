import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { catalogFixture, uid, time } from '../fixtures/catalog/database.ts';
import { createImportRuntime } from '../../packages/integrations/src/import-runtime.ts';
import { runImportCommand } from '../../packages/integrations/src/import-commands.ts';
import { openImportSnapshot } from '../../packages/integrations/src/import-files.ts';
import { rollbackDigest } from '../../packages/db/src/repositories/import-operations.ts';
import { digest } from '../../packages/db/src/repositories/bounds.ts';
import { revision } from '../../packages/domain/src/values/core.ts';
import type { RollbackInput } from '../../packages/application/src/ports/import-service.ts';

let f: Awaited<ReturnType<typeof catalogFixture>>,
  runtime: Awaited<ReturnType<typeof createImportRuntime>>,
  dir: string;
let env: Record<string, string>;
beforeAll(async () => {
  f = await catalogFixture();
  env = {
    INGEST_DATABASE_URL: f.connectionUrl('tt_ingest_runtime'),
    PUBLISH_DATABASE_URL: f.connectionUrl('tt_publish_runtime'),
  };
  runtime = await createImportRuntime(env);
  dir = await mkdtemp(join(tmpdir(), 'tt-ingestion-'));
}, 30000);
afterAll(async () => {
  await runtime?.shutdown();
  await f?.cleanup();
  if (dir) await rm(dir, { recursive: true, force: true });
});
const model = (key: string, name = 'Synthetic') => ({
  kind: 'tireModels',
  record: {
    id: uid('tire_model'),
    brand: 'Synthetic',
    model: name,
    category: 'touring',
    seasonalClass: 'all_season',
    sourceRecordKey: key,
  },
});
async function source(rows: unknown[], kind = 'catalog') {
  const key = randomUUID(),
    file = join(dir, key + '.jsonl'),
    manifest = join(dir, key + '.json');
  const bytes = Buffer.from(
    rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''),
  );
  const metadata = {
    id: uid('dataset'),
    providerId: f.provider,
    licenseId: f.license,
    kind,
    externalVersion: key,
    checksum: createHash('sha256').update(bytes).digest('hex'),
    effectiveAt: time(-10000),
    fetchedAt: time(-10000),
    upstreamRunKey: key,
    schemaVersion: '1',
    mappingVersion: '1',
    semantics: 'complete_snapshot',
    expectedRows: rows.length,
    expectedBytes: bytes.length,
  };
  await writeFile(file, bytes);
  await writeFile(manifest, JSON.stringify(metadata));
  return { file, manifest, metadata, rows };
}
async function prepare(s: Awaited<ReturnType<typeof source>>, command = 'dry-run') {
  const r = await runImportCommand(
    [command, '--manifest', s.manifest, '--file', s.file],
    runtime.service,
  );
  if (!r.ok || !('id' in (r.value as object))) throw Error('Prepare failed ' + JSON.stringify(r));
  return r.value as Awaited<ReturnType<typeof f.run>>['state'];
}
async function head(market = 'US') {
  const row = (
    await f.owner.query('SELECT bundle_id,revision FROM app.market_dataset_heads WHERE market=$1', [
      market,
    ])
  ).rows[0];
  if (!row) return null;
  const rev = revision(row.revision);
  if (!rev.ok) throw Error('fixture');
  return { bundleId: row.bundle_id, revision: rev.value };
}
async function plan(
  s: Awaited<ReturnType<typeof source>>,
  runId: ReturnType<typeof uid<'import_run'>>,
  market = 'US',
) {
  const bundleId = uid('bundle'),
    approvalId = uid('audit_event'),
    members = [{ key: s.metadata.kind, kind: s.metadata.kind, datasetId: s.metadata.id }];
  await f.owner.query(
    "INSERT INTO admin.audit_events(id,action,resource_kind,result,occurred_at,change_digest,field_names) VALUES($1,'import.publish','dataset_bundle','approved',now(),$2,'[]')",
    [approvalId, digest([market, members.map((m) => [m.key, m.datasetId])])],
  );
  return {
    bundleId,
    approvalId,
    actorId: f.staff,
    market,
    runId,
    members,
    required: members.map((m) => ({ key: m.key, kind: m.kind })),
    expectedHead: await head(market),
  };
}
async function approveRollback(input: Omit<RollbackInput, 'approvalId'>): Promise<RollbackInput> {
  const x = { ...input, approvalId: uid('audit_event') };
  await f.owner.query(
    "INSERT INTO admin.audit_events(id,action,resource_kind,result,occurred_at,change_digest,field_names) VALUES($1,'import.rollback','dataset_bundle','approved',now(),$2,'[]')",
    [x.approvalId, rollbackDigest(x)],
  );
  return x;
}
it('runs real dry-run/status/diff commands with separate SQL roles and no published visibility', async () => {
  const s = await source([model('a'), model('b')]),
    state = await prepare(s);
  expect(state.status).toBe('validated');
  expect(state.accepted).toBe(2n);
  expect((await runImportCommand(['status', '--run', state.id], runtime.service)).ok).toBe(true);
  const d = await runtime.service.diff(state.id, null);
  expect(d.ok && d.value.find((x) => x.kind === 'tireModels')?.added).toBe(2n);
  expect(
    (await f.owner.query('SELECT count(*)::int AS n FROM app.market_dataset_heads')).rows[0].n,
  ).toBe(0);
  const p = await plan(s, state.id);
  expect((await runtime.service.publish(p)).ok).toBe(true);
  expect((await runtime.service.publish(p)).ok).toBe(true);
  expect(
    (
      await f.owner.query('SELECT count(*)::int AS n FROM app.outbox WHERE aggregate_id=$1', [
        p.bundleId,
      ])
    ).rows[0].n,
  ).toBe(1);
  expect((await prepare(s)).status).toBe('published');
});
it('checkpoints interrupted streams and resumes from verified bytes without duplicate materialization', async () => {
  const s = await source(Array.from({ length: 26 }, (_, n) => model('resume-' + n))),
    snapshot = await openImportSnapshot(s.manifest, s.file);
  expect(
    (
      await runtime.service.prepare({
        ...snapshot,
        frames: async function* () {
          for (const row of s.rows.slice(0, 25)) yield { row };
          throw Error('interruption');
        },
      })
    ).ok,
  ).toBe(false);
  const saved = (
    await f.owner.query(
      'SELECT id,checkpoint,accepted_count,lease_until FROM app.import_runs WHERE upstream_run_key=$1',
      [s.metadata.upstreamRunKey],
    )
  ).rows[0];
  expect(saved.checkpoint.throughRow).toBe('25');
  expect(saved.lease_until).toBeNull();
  const state = await prepare(s, 'resume');
  expect(state.accepted).toBe(26n);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int AS n FROM app.import_materializations WHERE run_id=$1',
        [state.id],
      )
    ).rows[0].n,
  ).toBe(26);
  expect(
    (
      await runtime.service.prepare({
        ...snapshot,
        registration: { ...snapshot.registration, expectedRows: 27 },
      })
    ).ok,
  ).toBe(false);
});
it('blocks duplicate and malformed rows, forged completeness and partial downloads', async () => {
  for (const rows of [
    [model('duplicate'), model('duplicate')],
    [{ kind: 'unknown', record: {} }],
  ]) {
    const s = await source(rows),
      r = await runImportCommand(
        ['dry-run', '--manifest', s.manifest, '--file', s.file],
        runtime.service,
      );
    expect(r.ok).toBe(false);
    const run = (
      await f.owner.query(
        'SELECT status,rejected_count FROM app.import_runs WHERE upstream_run_key=$1',
        [s.metadata.upstreamRunKey],
      )
    ).rows[0];
    expect(run.status).toBe('staging');
    expect(Number(run.rejected_count)).toBe(1);
  }
  const s = await source([model('truncated')]);
  await writeFile(s.file, '');
  expect(
    (
      await runImportCommand(
        ['resume', '--manifest', s.manifest, '--file', s.file],
        runtime.service,
      )
    ).ok,
  ).toBe(false);
});
it('compares additions changes and removals against immutable published facts', async () => {
  const current = await head();
  expect(current).not.toBeNull();
  const s = await source([model('a', 'Changed'), model('new')]),
    state = await prepare(s);
  const d = await runtime.service.diff(state.id, current!.bundleId);
  expect(d.ok && d.value.find((x) => x.kind === 'tireModels')).toEqual({
    kind: 'tireModels',
    added: 1n,
    removed: 1n,
    changed: 1n,
  });
});
it('allows exactly one expected-head publisher and rolls back its losing transaction', async () => {
  const a = await source([model('race-a')]),
    b = await source([model('race-b')]);
  const ar = await prepare(a),
    br = await prepare(b),
    pa = await plan(a, ar.id),
    pb = await plan(b, br.id);
  const results = await Promise.all([runtime.service.publish(pa), runtime.service.publish(pb)]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.find((r) => !r.ok)).toMatchObject({ error: { code: 'conflict' } });
  const loser = results[0]!.ok ? pb : pa;
  expect(
    (
      await f.owner.query('SELECT status FROM app.dataset_versions WHERE id=$1', [
        loser.members[0]!.datasetId,
      ])
    ).rows[0].status,
  ).toBe('validated');
});
it('rolls back an approved compatible bundle once, with atomic invalidation and current authorization', async () => {
  const targets = (
    await f.owner.query(
      "SELECT id FROM app.dataset_bundles WHERE status='published' AND market='US' ORDER BY published_at",
    )
  ).rows;
  const current = (await head())!,
    input = await approveRollback({
      bundleId: targets[0]!.id,
      market: 'US',
      actorId: f.staff,
      expectedHead: current,
    });
  expect((await runtime.service.rollback(input)).ok).toBe(true);
  expect((await runtime.service.rollback(input)).ok).toBe(true);
  expect((await head())!.revision).toBe(current.revision + 1n);
  expect(
    (
      await f.owner.query('SELECT count(*)::int AS n FROM app.outbox WHERE event_id=$1', [
        input.approvalId,
      ])
    ).rows[0].n,
  ).toBe(1);
  await f.owner.query(
    "UPDATE admin.staff_identities SET status='disabled',updated_at=now(),revision=revision+1 WHERE id=$1",
    [f.staff],
  );
  expect(await runtime.service.rollback(input)).toMatchObject({ error: { code: 'forbidden' } });
  await f.owner.query(
    "UPDATE admin.staff_identities SET status='active',updated_at=now(),revision=revision+1 WHERE id=$1",
    [f.staff],
  );
});
it('refuses rollback that would suppress a newer recall warning, including mixed catalog datasets', async () => {
  const previous = (await head())!;
  const s = await source([
    {
      kind: 'recalls',
      record: {
        id: uid('recall'),
        authority: 'NHTSA',
        recallNumber: 'SYNTHETIC-015',
        announcedOn: '2026-10-24',
        reportReceivedOn: null,
        status: 'open',
        sourceUrl: 'https://example.test/recall',
        summary: 'Synthetic warning',
        productType: 'tire',
        manufacturerEntityId: null,
        componentCode: null,
        consequence: null,
        remedy: null,
        manufacturerCampaignNumber: null,
        affectedCount: null,
        sourceUpdatedAt: null,
        sourceRecordKey: 'recall-015',
      },
    },
  ]);
  const state = await prepare(s),
    p = await plan(s, state.id);
  expect((await runtime.service.publish(p)).ok).toBe(true);
  const current = (await head())!,
    rollback = await approveRollback({
      bundleId: previous.bundleId,
      market: 'US',
      actorId: f.staff,
      expectedHead: current,
    });
  expect(await runtime.service.rollback(rollback)).toMatchObject({ error: { code: 'forbidden' } });
  expect(await head()).toEqual(current);
  expect(
    (
      await f.owner.query('SELECT count(*)::int AS n FROM app.outbox WHERE event_id=$1', [
        rollback.approvalId,
      ])
    ).rows[0].n,
  ).toBe(0);
});
it('executes the process CLI and redacts failures without printing credentials or source data', async () => {
  const s = await source([model('process')]);
  const exec = promisify(execFile);
  const r = await exec(
    process.execPath,
    [
      '--import',
      'tsx',
      'scripts/data/import.ts',
      'dry-run',
      '--manifest',
      s.manifest,
      '--file',
      s.file,
    ],
    { env: { ...process.env, ...env }, timeout: 15000 },
  );
  expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, value: { status: 'validated' } });
  try {
    await exec(
      process.execPath,
      ['--import', 'tsx', 'scripts/data/import.ts', 'status', '--run', 'bad'],
      { env: { ...process.env, ...env }, timeout: 15000 },
    );
    throw Error('expected failure');
  } catch (error) {
    const e = error as { code: number; stderr: string };
    expect(e.code).toBe(1);
    expect(JSON.parse(e.stderr).error.code).toBe('invalid_input');
    expect(e.stderr).not.toContain('postgres://');
  }
});
it('creates stable domain identities through the shared import path and rejects conflicting identity reuse', async () => {
  const entity = uid('domain_entity'),
    key = 'synthetic:brand:' + randomUUID();
  const fact = {
    kind: 'domainEntityVersions',
    identities: [{ id: entity, kind: 'brand', stableKey: key }],
    record: {
      id: uid('domain_entity_version'),
      entityId: entity,
      displayName: 'Synthetic Brand',
      countryCode: null,
      officialUrl: null,
      validFrom: null,
      validTo: null,
      reviewStatus: 'reviewed',
      sourceRecordKey: 'brand',
    },
  };
  const s = await source([fact], 'reference');
  expect((await prepare(s)).status).toBe('validated');
  const conflicting = await source(
    [
      {
        ...fact,
        record: { ...fact.record, id: uid('domain_entity_version') },
        identities: [{ id: uid('domain_entity'), kind: 'company', stableKey: key }],
      },
    ],
    'reference',
  );
  expect(
    (
      await runtime.service.prepare(
        await openImportSnapshot(conflicting.manifest, conflicting.file),
      )
    ).ok,
  ).toBe(false);
  expect(
    (await f.owner.query('SELECT kind FROM app.domain_entities WHERE id=$1', [entity])).rows[0]
      .kind,
  ).toBe('brand');
});
it('rejects incoherent company/brand relationships before publication and preserves the current head', async () => {
  const a = uid('domain_entity'),
    b = uid('domain_entity');
  const s = await source(
    [
      {
        kind: 'domainRelationships',
        identities: [
          { id: a, kind: 'brand', stableKey: 'synthetic:' + a },
          { id: b, kind: 'brand', stableKey: 'synthetic:' + b },
        ],
        record: {
          id: uid('domain_relationship'),
          fromEntityId: a,
          toEntityId: b,
          kind: 'brand_owned_by',
          validFrom: null,
          validTo: null,
          sourceUrl: 'https://example.test/source',
          reviewStatus: 'reviewed',
          sourceRecordKey: 'bad-relationship',
        },
      },
    ],
    'reference',
  );
  const state = await prepare(s),
    p = await plan(s, state.id),
    before = await head();
  expect(await runtime.service.publish(p)).toMatchObject({ error: { code: 'integrity' } });
  expect(await head()).toEqual(before);
});
it('bounds private staging by license expiry and rechecks revoked rights on rollback', async () => {
  await f.owner.query(
    "UPDATE app.data_licenses SET expires_at=now()+interval '10 minutes' WHERE id=$1",
    [f.license],
  );
  try {
    const s = await source([model('expires')]),
      state = await prepare(s);
    expect(
      (
        await f.owner.query(
          'SELECT bool_and(s.expires_at<=l.expires_at) AS bounded FROM app.import_staging_rows s JOIN app.import_runs r ON r.id=s.run_id JOIN app.dataset_versions d ON d.id=r.dataset_version_id JOIN app.data_licenses l ON l.id=d.license_id WHERE r.id=$1',
          [state.id],
        )
      ).rows[0].bounded,
    ).toBe(true);
    const current = (await head())!,
      rollback = await approveRollback({
        bundleId: current.bundleId,
        expectedHead: current,
        market: 'US',
        actorId: f.staff,
      });
    await f.owner.query(
      "UPDATE app.data_licenses SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [f.license],
    );
    expect(await runtime.service.rollback(rollback)).toMatchObject({
      error: { code: 'forbidden' },
    });
    expect(await head()).toEqual(current);
  } finally {
    await f.owner.query('UPDATE app.data_licenses SET expires_at=NULL WHERE id=$1', [f.license]);
  }
});
