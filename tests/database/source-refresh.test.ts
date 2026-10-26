import { beforeAll, afterAll, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { catalogFixture, uid, success, result } from '../fixtures/catalog/database.ts';
import { zipFixture, recallLine } from '../fixtures/sources/zip.ts';
import { createImportRuntime } from '../../packages/integrations/src/import-runtime.ts';
import {
  createNhtsaAdapter,
  sourceLocation,
} from '../../packages/integrations/src/sources/nhtsa.ts';
import { createSourceHttp } from '../../packages/integrations/src/sources/http.ts';
import {
  createSourceRepository,
  sourceApprovalDigest,
} from '../../packages/db/src/repositories/sources.ts';
import { createSourceRefresh } from '../../packages/application/src/services/source-refresh.ts';
import { sourceKey } from '../../packages/application/src/services/source-policy.ts';
import { runSourceCommand } from '../../packages/integrations/src/source-commands.ts';
import type {
  SourceSpec,
  SourceDefinition,
  SourceReceipt,
} from '../../packages/application/src/ports/sources.ts';
import { digest } from '../../packages/db/src/repositories/bounds.ts';
import { pageRequest } from '../../packages/application/src/ports/pagination.ts';
import { createReportRecallRepository } from '../../packages/db/src/repositories/report-services.ts';

const server = setupServer(),
  dictionary = 'synthetic 29-field dictionary',
  dictionaryDigest = createHash('sha256').update(dictionary).digest('hex'),
  base = 'https://static.nhtsa.gov/odi/ffdd/rcl/';
let f: Awaited<ReturnType<typeof catalogFixture>>,
  runtime: Awaited<ReturnType<typeof createImportRuntime>>,
  sources: ReturnType<typeof createSourceRepository>,
  refresh: ReturnType<typeof createSourceRefresh>,
  dir: string;
let mode = 'full',
  requests = 0;
const conditionals: (string | null)[] = [];
let recall: SourceDefinition, receipt: SourceReceipt, bundle: ReturnType<typeof uid<'bundle'>>;
beforeAll(async () => {
  f = await catalogFixture();
  runtime = await createImportRuntime({
    INGEST_DATABASE_URL: f.connectionUrl('tt_ingest_runtime'),
    PUBLISH_DATABASE_URL: f.connectionUrl('tt_publish_runtime'),
  });
  sources = createSourceRepository(f.ingestScope);
  dir = await mkdtemp(join(tmpdir(), 'tt-source-cli-'));
  server.listen({ onUnhandledFrame: 'error' });
  server.use(
    http.get(base + 'RCL.txt', () => new HttpResponse(dictionary)),
    ...(['PRE', 'POST'] as const).map((part) =>
      http.get(base + `FLAT_RCL_${part}_2010.zip`, ({ request }) => {
        requests++;
        const tag = request.headers.get('if-none-match');
        conditionals.push(tag);
        if (mode === 'error' && part === 'POST')
          return new HttpResponse(null, { status: 503, headers: { 'Retry-After': '3600' } });
        if (mode === 'not-modified' && tag) return new HttpResponse(null, { status: 304 });
        return new HttpResponse(
          zipFixture(`FLAT_RCL_${part}_2010.txt`, recallLine({ 0: part === 'PRE' ? '1' : '2' })),
          { headers: { etag: '"' + part + '"' } },
        );
      }),
    ),
    http.get(
      'https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeIdYear/makeId/474/modelyear/2024/vehicletype/passenger%20car',
      () =>
        HttpResponse.json({
          Count: 1,
          Message: 'Results returned successfully',
          Results: [
            {
              Make_ID: 474,
              Make_Name: 'Synthetic Make',
              Model_ID: 1,
              Model_Name: 'Synthetic Model',
              VehicleTypeId: 2,
              VehicleTypeName: 'Passenger Car',
            },
          ],
        }),
    ),
  );
  refresh = createSourceRefresh({
    uow: f.ingestScope.unitOfWork,
    sources,
    adapter: createNhtsaAdapter(
      createSourceHttp(async () => {}),
      dictionaryDigest,
    ),
    imports: runtime.service,
  });
}, 30000);
afterAll(async () => {
  server.close();
  await runtime?.shutdown();
  await f?.cleanup();
  if (dir) await rm(dir, { recursive: true, force: true });
});
async function approved(spec: SourceSpec) {
  const def = {
      id: uid('source_connector'),
      providerId: f.provider,
      licenseId: f.license,
      spec,
      ...sourceLocation(spec),
    },
    approvalId = uid('audit_event');
  await f.owner.query(
    "INSERT INTO admin.audit_events(id,action,resource_kind,result,occurred_at,change_digest,field_names) VALUES($1,'source.register','source_connector','approved',now(),$2,'[]')",
    [approvalId, sourceApprovalDigest(def)],
  );
  return { ...def, actorId: f.staff, approvalId };
}
async function due(def: SourceDefinition) {
  await f.owner.query(
    "UPDATE app.feed_health SET next_check_at=clock_timestamp()-interval '1 second' WHERE provider_id=$1 AND kind=$2",
    [def.providerId, sourceKey(def.spec)],
  );
}
async function health(def: SourceDefinition) {
  return (
    await f.owner.query('SELECT * FROM app.feed_health WHERE provider_id=$1 AND kind=$2', [
      def.providerId,
      sourceKey(def.spec),
    ])
  ).rows[0];
}
it('registers only reviewed source scopes and keeps approval/rights writes unavailable to ingestion', async () => {
  const input = await approved({ type: 'nhtsa-tire-recalls' });
  recall = input;
  expect(
    await result(f.ingestScope.unitOfWork, (tx) =>
      sources.register(tx, { ...input, approvalId: uid('audit_event') }),
    ),
  ).toMatchObject({ error: { code: 'forbidden' } });
  expect((await runtime.registerSource(input)).ok).toBe(true);
  expect((await runtime.registerSource(input)).ok).toBe(true);
  expect(
    await result(f.ingestScope.unitOfWork, (tx) =>
      f.ingestScope.query(tx, 'UPDATE app.source_connectors SET id=$2 WHERE id=$1', [
        input.id,
        uid('source_connector'),
      ]),
    ),
  ).toMatchObject({ error: { code: 'integrity' } });
  for (const sql of [
    "UPDATE app.data_licenses SET rights='{}'::jsonb",
    "INSERT INTO admin.audit_events(action,resource_kind,result,occurred_at,field_names) VALUES('bad','source_connector','approved',now(),'[]')",
  ]) {
    expect(
      await result(f.ingestScope.unitOfWork, (tx) => f.ingestScope.query(tx, sql, [])),
    ).toMatchObject({ ok: false });
  }
});
it('fetches and validates both archives through the command/service path without publishing or claiming freshness', async () => {
  expect(
    (
      await runSourceCommand(['refresh', '--connector', recall.id], {
        ...runtime,
        sourceRefresh: refresh,
      })
    ).ok,
  ).toBe(true);
  const h = await health(recall);
  receipt = h.source_receipt;
  expect(h.error_code).toBeNull();
  expect(h.last_full_at).not.toBeNull();
  expect(h.last_run_id).toBe(receipt.runId);
  expect(
    (
      await f.owner.query('SELECT accepted_count,status FROM app.import_runs WHERE id=$1', [
        receipt.runId,
      ])
    ).rows[0],
  ).toMatchObject({ accepted_count: '3', status: 'validated' });
  expect(await runtime.sourceRefresh.requireRecall(receipt.datasetId)).toMatchObject({
    error: { code: 'unavailable' },
  });
  const bundleId = uid('bundle'),
    approvalId = uid('audit_event'),
    key = sourceKey(recall.spec);
  await f.owner.query(
    "INSERT INTO admin.audit_events(id,action,resource_kind,result,occurred_at,change_digest,field_names) VALUES($1,'import.publish','dataset_bundle','approved',now(),$2,'[]')",
    [approvalId, digest(['US', [[key, receipt.datasetId]]])],
  );
  expect(
    (
      await runtime.service.publish({
        runId: receipt.runId,
        bundleId,
        market: 'US',
        actorId: f.staff,
        approvalId,
        expectedHead: null,
        members: [{ key, datasetId: receipt.datasetId }],
        required: [{ key, kind: key }],
      })
    ).ok,
  ).toBe(true);
  bundle = bundleId;
  expect((await runtime.sourceRefresh.requireRecall(receipt.datasetId)).ok).toBe(true);
  const reader = f.adapter('tt_report_source_runtime'),
    reportRecall = createReportRecallRepository(reader);
  expect(
    await success(reader.unitOfWork, (tx) => reportRecall.checkedAt(tx, receipt.datasetId)),
  ).not.toBeNull();
  expect(
    await result(reader.unitOfWork, (tx) =>
      reader.query(tx, "UPDATE app.feed_health SET error_code='unapproved'"),
    ),
  ).toMatchObject({ ok: false });
  const page = pageRequest(10);
  if (!page.ok) throw Error('fixture');
  const targets = await success(f.readScope.unitOfWork, (tx) =>
    f.catalog.page(tx, {
      kind: 'recallSourceTargets',
      bundleId: bundle,
      market: 'US',
      filters: {},
      page: page.value,
    }),
  );
  expect(targets.items).toHaveLength(2);
  expect(targets.items[0]!.fact.doNotDrive).toBe(true);
  expect(targets.items[0]!.fact.parkOutside).toBeNull();
});
it('advances verified no-change success with unchanged immutable datasets and no stale recall clearance', async () => {
  const before = await health(recall);
  await due(recall);
  mode = 'not-modified';
  expect(await refresh.refresh(recall.id)).toMatchObject({
    ok: true,
    value: { state: 'unchanged', datasetId: receipt.datasetId },
  });
  const after = await health(recall);
  expect(after.source_receipt.datasetId).toBe(receipt.datasetId);
  expect(after.last_success_at.getTime()).toBeGreaterThan(before.last_success_at.getTime());
  expect(after.last_full_at).toEqual(before.last_full_at);
  expect(conditionals.slice(-2).every(Boolean)).toBe(true);
  expect((await runtime.sourceRefresh.requireRecall(receipt.datasetId)).ok).toBe(true);
});
it('records failures and alerts without advancing success or removing published warning facts', async () => {
  const before = await health(recall);
  await due(recall);
  mode = 'error';
  expect(await refresh.refresh(recall.id)).toMatchObject({ error: { code: 'unavailable' } });
  const after = await health(recall);
  expect(after.last_success_at).toEqual(before.last_success_at);
  expect(after.error_code).toBe('source_unavailable');
  expect(after.lease_token).toBeNull();
  expect(after.next_check_at.getTime()).toBeGreaterThan(Date.now());
  expect(await runtime.sourceRefresh.requireRecall(receipt.datasetId)).toMatchObject({
    error: { code: 'unavailable' },
  });
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int AS n FROM app.outbox WHERE aggregate_id=$1 AND event_type='source.refresh_failed'",
        [recall.id],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (await f.owner.query('SELECT count(*)::int AS n FROM app.catalog_recall_source_targets'))
      .rows[0].n,
  ).toBe(2);
});
it('requires full reconciliation after seven days and blocks checks older than 48 hours', async () => {
  await f.owner.query(
    "UPDATE app.feed_health SET last_success_at=clock_timestamp()-interval '49 hours',last_full_at=clock_timestamp()-interval '8 days',error_code=NULL,next_check_at=clock_timestamp()-interval '1 second' WHERE provider_id=$1 AND kind=$2",
    [recall.providerId, sourceKey(recall.spec)],
  );
  expect(await runtime.sourceRefresh.requireRecall(receipt.datasetId)).toMatchObject({
    error: { code: 'unavailable' },
  });
  mode = 'not-modified';
  expect((await refresh.refresh(recall.id)).ok).toBe(true);
  expect(conditionals.slice(-2)).toEqual([null, null]);
  expect((await runtime.sourceRefresh.requireRecall(receipt.datasetId)).ok).toBe(true);
});
it('fences late refresh completions and recovers expired leases', async () => {
  await due(recall);
  const old = await success(f.ingestScope.unitOfWork, (tx) => sources.claim(tx, recall.id));
  if (!old || 'denied' in old) throw Error('fixture');
  expect(await success(f.ingestScope.unitOfWork, (tx) => sources.claim(tx, recall.id))).toBeNull();
  await f.owner.query(
    "UPDATE app.feed_health SET lease_until=clock_timestamp()-interval '1 second' WHERE provider_id=$1 AND kind=$2",
    [recall.providerId, sourceKey(recall.spec)],
  );
  const current = await success(f.ingestScope.unitOfWork, (tx) => sources.claim(tx, recall.id));
  if (!current || 'denied' in current) throw Error('fixture');
  expect(current.fence).toBeGreaterThan(old.fence);
  expect(
    await result(f.ingestScope.unitOfWork, (tx) => sources.complete(tx, old, receipt, false)),
  ).toMatchObject({ error: { code: 'conflict' } });
  await success(f.ingestScope.unitOfWork, (tx) => sources.complete(tx, current, receipt, false));
  expect(
    (
      await f.owner.query(
        'SELECT last_success_at=last_attempt_at AS same_check FROM app.feed_health WHERE provider_id=$1 AND kind=$2',
        [recall.providerId, sourceKey(recall.spec)],
      )
    ).rows[0].same_check,
  ).toBe(true);
});
it('denies expired rights before HTTP and persists the failure without starving other due work', async () => {
  const before = requests;
  await f.owner.query(
    "UPDATE app.data_licenses SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [f.license],
  );
  await due(recall);
  try {
    expect(await refresh.refresh(recall.id)).toMatchObject({ error: { code: 'forbidden' } });
    expect(requests).toBe(before);
    expect((await health(recall)).error_code).toBe('source_rights');
    expect((await health(recall)).next_check_at.getTime()).toBeGreaterThan(Date.now());
  } finally {
    await f.owner.query('UPDATE app.data_licenses SET expires_at=NULL WHERE id=$1', [f.license]);
  }
});
it('reuses canonical registration times after a crash between validation and health completion', async () => {
  const input = await approved({
    type: 'vpic-models',
    makeId: 474,
    year: 2024,
    vehicleType: 'passenger car',
  });
  expect((await runtime.registerSource(input)).ok).toBe(true);
  let fail = true;
  const broken = {
    ...sources,
    complete: async (...args: Parameters<typeof sources.complete>) => {
      if (fail) {
        fail = false;
        throw Error('synthetic commit failure');
      }
      return sources.complete(...args);
    },
  };
  const service = createSourceRefresh({
    uow: f.ingestScope.unitOfWork,
    sources: broken,
    adapter: createNhtsaAdapter(createSourceHttp(async () => {})),
    imports: runtime.service,
  });
  expect((await service.refresh(input.id)).ok).toBe(false);
  const first = (
    await f.owner.query('SELECT d.id,d.fetched_at FROM app.dataset_versions d WHERE kind=$1', [
      sourceKey(input.spec),
    ])
  ).rows[0];
  expect(first).toBeDefined();
  await f.owner.query(
    "UPDATE app.feed_health SET lease_until=clock_timestamp()-interval '1 second' WHERE provider_id=$1 AND kind=$2",
    [input.providerId, sourceKey(input.spec)],
  );
  expect((await service.refresh(input.id)).ok).toBe(true);
  expect((await health(input)).source_receipt.datasetId).toBe(first.id);
  expect(
    (
      await f.owner.query('SELECT count(*)::int AS n FROM app.dataset_versions WHERE kind=$1', [
        sourceKey(input.spec),
      ])
    ).rows[0].n,
  ).toBe(1);
});
it('runs source registration and recall readiness through the standalone process CLI', async () => {
  const input = await approved({ type: 'vpic-plants', year: 2024, equipmentType: 16 }),
    plan = join(dir, 'source.json');
  await writeFile(
    plan,
    JSON.stringify({
      id: input.id,
      providerId: input.providerId,
      licenseId: input.licenseId,
      spec: input.spec,
      actorId: input.actorId,
      approvalId: input.approvalId,
    }),
  );
  const env = {
      ...process.env,
      INGEST_DATABASE_URL: f.connectionUrl('tt_ingest_runtime'),
      PUBLISH_DATABASE_URL: f.connectionUrl('tt_publish_runtime'),
    },
    exec = promisify(execFile);
  const out = await exec(
    process.execPath,
    ['--import', 'tsx', 'scripts/data/source.ts', 'register', '--plan', plan],
    { env, timeout: 15000 },
  );
  expect(JSON.parse(out.stdout)).toMatchObject({ ok: true, value: input.id });
  const checked = await exec(
    process.execPath,
    ['--import', 'tsx', 'scripts/data/source.ts', 'recall-ready', '--dataset', receipt.datasetId],
    { env, timeout: 15000 },
  ).catch((error) => ({ stdout: error.stdout }));
  expect(JSON.parse(checked.stdout)).toHaveProperty('ok');
  const dueList = await success(f.ingestScope.unitOfWork, (tx) => sources.due(tx));
  expect(dueList.length).toBeLessThanOrEqual(4);
});
