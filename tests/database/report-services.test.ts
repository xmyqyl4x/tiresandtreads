import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { privateFixture, uid, time, key, success } from '../fixtures/private/database.ts';
import { engineFixture } from '../fixtures/engine/base.ts';
import { createReportServices } from '../../packages/application/src/services/reports.ts';
import {
  createReportAccessRepository,
  createReportPolicyRepository,
  createReportRecallRepository,
} from '../../packages/db/src/repositories/report-services.ts';
import { createCommandRepository } from '../../packages/db/src/repositories/jobs.ts';
import { createReportCrypto } from '../../packages/integrations/src/report-crypto.ts';
import { ok, fail, type Result } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import type {
  ReportEvidence,
  PreparedReport,
} from '../../packages/application/src/ports/report-services.ts';
import { canonical } from '../../packages/application/src/services/report-records.ts';
import { createReportRuntime } from '../../packages/integrations/src/report-runtime.ts';
let f: Awaited<ReturnType<typeof privateFixture>>;
beforeAll(async () => {
  f = await privateFixture();
}, 30000);
afterAll(async () => {
  await f?.cleanup();
});
function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value;
}
const command = () => uid('command');
function setup() {
  const crypto = createReportCrypto(
    'v1',
    { v1: new Uint8Array(32).fill(41) },
    new Uint8Array(32).fill(87),
  );
  const flags = { current: true, failPrepare: false, recalled: false },
    at = time();
  const prepared = vi.fn(async (_input: unknown, asOf: string) => {
    if (flags.failPrepare) return fail(failure('unavailable'));
    const e = engineFixture();
    e.snapshot.bundleId = f.bundleId;
    e.snapshot.policy.id = f.ruleId;
    e.snapshot.asOf = asOf;
    e.snapshot.recall.checkedAt = asOf;
    return ok({ snapshot: e.snapshot, prices: [], products: [] } satisfies PreparedReport);
  });
  const evidence: ReportEvidence = {
    prepare: prepared,
    current: async () => ok(flags.current),
    overlay: async (_v, asOf) =>
      ok({
        checkedAt: asOf,
        status: 'review_required',
        matched: flags.recalled ? ['synthetic-new-recall'] : [],
        unresolved: true,
      }),
  };
  const ciphertext = new Map<string, Uint8Array>();
  const encryption = {
    encrypt: vi.fn(async (b: Uint8Array, purpose: string, id: string) => {
      ciphertext.set(purpose + id, b);
      return { keyVersion: 'fixture-only', hex: 'c'.repeat(64) };
    }),
    decrypt: vi.fn(async (_value: unknown, purpose: string, id: string) =>
      ciphertext.get(purpose + id)!,
    ),
  };
  const deps = {
    uow: f.scope.unitOfWork,
    owners: f.owners,
    reports: f.reports,
    capabilities: f.caps,
    access: createReportAccessRepository(f.scope),
    commands: createCommandRepository(f.scope),
    evidence,
    crypto,
    encryption,
    now: () => at,
  };
  return { service: createReportServices(deps), deps, crypto, flags, prepared, encryption };
}
async function created() {
  const s = setup(),
    owner = await f.owner(),
    r = value(await s.service.create([owner.token], command(), engineFixture().request));
  return { ...s, owner, reportId: r.report_id!, receipt: r };
}
const quote = () => ({
  id: null,
  expectedRevision: null,
  skuId: null,
  productText: 'Unknown tire from private quote',
  shopName: 'Private Shop Name',
  currency: 'USD',
  totalMinor: '74900',
  quantity: 4,
  basis: 'installed_set',
  observedOn: time().slice(0, 10),
  taxContextConfirmed: false,
  taxIncluded: true,
  components: ['mounting', 'balancing', 'tpms_valve', 'disposal', 'tax'].map((kind) => ({
    kind,
    included: true,
    basis: 'per_order',
    minor: null,
  })),
});
it('DB01/DB08 commits one immutable report and one pinned receipt under concurrent duplicate create', async () => {
  const s = setup(),
    owner = await f.owner(),
    key = command(),
    body = engineFixture().request;
  const results = await Promise.all([
    s.service.create([owner.token], key, body),
    s.service.create([owner.token], key, body),
  ]);
  expect(results[0]).toEqual(results[1]);
  const r = value(results[0]!);
  const stored = await success(f.scope.unitOfWork, (tx) =>
    f.reports.version(tx, owner.identity, r.report_id!, 1),
  );
  expect(stored).toMatchObject({
    bundleId: f.bundleId,
    ruleVersionId: f.ruleId,
    engineVersion: '1.0.0',
    output: { issuanceAuthorized: false },
  });
  const count = await f.admin.query(
    'SELECT count(*)::int n FROM app.report_versions WHERE report_id=$1',
    [r.report_id],
  );
  expect(count.rows[0].n).toBe(1);
  expect(
    await s.service.create([owner.token], key, { ...body, priorities: ['noise'] }),
  ).toMatchObject({ error: { code: 'conflict' } });
  s.flags.failPrepare = true;
  expect(await s.service.create([owner.token], key, body)).toEqual(results[0]);
  const read = value(await s.service.readOwner([owner.token], r.report_id));
  expect(read.output).toHaveProperty('historical', true);
  const bad = await f.owner();
  expect(await s.service.readOwner([bad.token], r.report_id)).toMatchObject({
    error: { code: 'not_found' },
  });
  expect(await s.service.create([keyFixture()], command(), body)).toMatchObject({
    error: { code: 'forbidden' },
  });
});
function keyFixture() {
  return key();
}
it('UC03 saves drafts optimistically and reruns into a new version with an honest diff', async () => {
  const s = await created(),
    original = value(await s.service.readOwner([s.owner.token], s.reportId)),
    body = { ...engineFixture().request, priorities: ['noise'] };
  const d = value(
    await s.service.saveDraft([s.owner.token], s.reportId, command(), {
      baseVersion: 1,
      expectedRevision: null,
      input: body,
    }),
  );
  expect(
    await s.service.saveDraft([s.owner.token], s.reportId, command(), {
      baseVersion: 1,
      expectedRevision: null,
      input: body,
    }),
  ).toMatchObject({ error: { code: 'conflict' } });
  const changed = value(
    await s.service.saveDraft([s.owner.token], s.reportId, command(), {
      baseVersion: 1,
      expectedRevision: d.result_revision,
      input: body,
    }),
  );
  expect(
    await s.service.refine([s.owner.token], s.reportId, command(), {
      baseVersion: 1,
      draftRevision: d.result_revision,
      expectedRevision: original.revision,
    }),
  ).toMatchObject({ error: { code: 'conflict' } });
  const key = command(),
    request = {
      baseVersion: 1,
      draftRevision: changed.result_revision,
      expectedRevision: original.revision,
    };
  const next = value(await s.service.refine([s.owner.token], s.reportId, key, request));
  expect(next.report_version).toBe(2);
  expect(await s.service.refine([s.owner.token], s.reportId, key, request)).toEqual(ok(next));
  const latest = value(await s.service.readOwner([s.owner.token], s.reportId));
  expect(latest.diff).toMatchObject({
    answersChanged: true,
    dataChanged: false,
    rulesChanged: false,
    scoresComparable: true,
  });
  expect(value(await s.service.readOwner([s.owner.token], s.reportId, 1)).input).toEqual(
    original.input,
  );
  expect(
    await s.service.saveDraft([s.owner.token], s.reportId, command(), {
      baseVersion: 1,
      expectedRevision: null,
      input: body,
    }),
  ).toMatchObject({ error: { code: 'conflict' } });
  const raw = await success(f.scope.unitOfWork, (tx) =>
    f.reports.draft(tx, s.owner.identity, s.reportId),
  );
  expect(raw).toBeNull();
});
it('does not persist a report when current-source validation fails or preparation is unavailable', async () => {
  const s = setup(),
    owner = await f.owner(),
    body = engineFixture().request;
  s.flags.current = false;
  expect(await s.service.create([owner.token], command(), body)).toMatchObject({
    error: { code: 'conflict' },
  });
  s.flags.failPrepare = true;
  expect(await s.service.create([owner.token], command(), body)).toMatchObject({
    error: { code: 'unavailable' },
  });
  const n = await f.admin.query(
    'SELECT count(*)::int n FROM app.reports WHERE owner_subject_id=$1',
    [owner.identity.subjectId],
  );
  expect(n.rows[0].n).toBe(0);
});
it('UC05 shares a redacted fixed view, rechecks recalls and revokes reads, forks and derived downloads', async () => {
  const s = await created(),
    other = await f.owner(),
    shareKey = command(),
    r = value(
      await s.service.share([s.owner.token], s.reportId, shareKey, {
        version: 1,
        comparisonRevision: null,
      }),
    );
  expect('token' in r).toBe(true);
  if (!('token' in r)) throw Error('token');
  const keys = s.crypto.lookup('share', r.token);
  expect(
    await s.service.share([s.owner.token], s.reportId, shareKey, {
      version: 1,
      comparisonRevision: null,
    }),
  ).toEqual(ok(r));
  const shared = value(await s.service.readShared(keys));
  expect(shared.access).toBe('read_only');
  expect(shared.comparison).toBeNull();
  expect(shared).not.toHaveProperty('input');
  expect(JSON.stringify(shared)).not.toMatch(
    /reviewedBy|ownerId|sessionId|snapshot|rights|token|budget/,
  );
  s.flags.recalled = true;
  expect(value(await s.service.readShared(keys)).safety.matched).toEqual(['synthetic-new-recall']);
  expect(value(await s.service.readOwner([s.owner.token], s.reportId)).output).toEqual(
    value(await s.service.readOwner([s.owner.token], s.reportId)).output,
  );
  expect(
    await s.service.saveDraft(keys, s.reportId, command(), {
      baseVersion: 1,
      expectedRevision: null,
      input: engineFixture().request,
    }),
  ).toMatchObject({ error: { code: 'forbidden' } });
  const fork = value(await s.service.fork([other.token], command(), keys, engineFixture().request));
  expect(fork.report_id).not.toBe(s.reportId);
  const asset = await f.asset();
  await success(f.scope.unitOfWork, (tx) =>
    f.caps.asset(tx, s.owner.identity, {
      assetId: asset.id,
      reportId: s.reportId,
      version: 1,
      comparisonRevision: null,
      rendererVersion: 'fixture',
      locale: 'en-US',
      scope: 'shared',
      renderKey: uid('render'),
    }),
  );
  const grant = value(await s.service.sharedDownload(keys, command(), { assetId: asset.id }));
  if (!('token' in grant)) throw Error('token');
  const downloads = s.crypto.lookup('download', grant.token);
  expect(await success(f.scope.unitOfWork, (tx) => f.caps.download(tx, downloads))).not.toBeNull();
  expect(await s.service.revoke([other.token], s.reportId, command(), r.resource_id)).toMatchObject(
    { error: { code: 'not_found' } },
  );
  expect(
    await s.service.revoke([s.owner.token], s.reportId, command(), r.resource_id),
  ).toMatchObject({ ok: true });
  expect(await s.service.readShared(keys)).toMatchObject({ error: { code: 'not_found' } });
  expect(
    await s.service.fork([other.token], command(), keys, engineFixture().request),
  ).toMatchObject({ error: { code: 'not_found' } });
  expect(await s.service.sharedDownload(keys, command(), { assetId: asset.id })).toMatchObject({
    error: { code: 'forbidden' },
  });
  expect(await success(f.scope.unitOfWork, (tx) => f.caps.download(tx, downloads))).toBeNull();
  expect(
    await s.service.share([s.owner.token], s.reportId, shareKey, {
      version: 1,
      comparisonRevision: null,
    }),
  ).toMatchObject({ error: { code: 'forbidden' } });
});
it('UC04 persists bounded comparisons and encrypted unknown quotes without fabricated scores or public notes', async () => {
  const s = await created(),
    qkey = command(),
    q = value(await s.service.saveQuote([s.owner.token], s.reportId, qkey, quote()));
  expect(await s.service.saveQuote([s.owner.token], s.reportId, qkey, quote())).toEqual(ok(q));
  expect(s.encryption.encrypt).toHaveBeenCalledOnce();
  expect(s.encryption.encrypt.mock.calls[0]?.[1]).toBe('quote');
  const stored = await f.admin.query(
    'SELECT encrypted_notes,key_version FROM privacy.quote_private_data WHERE quote_id=$1',
    [q.resource_id],
  );
  expect(stored.rows[0].encrypted_notes.toString()).not.toContain('Private Shop');
  expect(
    value(await s.service.readQuote([s.owner.token], s.reportId, q.resource_id)),
  ).toMatchObject({
    private: { productText: 'Unknown tire from private quote', shopName: 'Private Shop Name' },
  });
  const key = command(),
    req = {
      version: 1,
      expectedRevision: null,
      items: [
        { kind: 'catalog', key: engineFixture().snapshot.plans[0]!.id },
        { kind: 'quote', key: q.resource_id },
      ],
    };
  const c = value(await s.service.compare([s.owner.token], s.reportId, key, req));
  expect(await s.service.compare([s.owner.token], s.reportId, key, req)).toEqual(ok(c));
  const saved = await success(f.scope.unitOfWork, (tx) =>
    f.reports.comparison(
      tx,
      s.owner.identity,
      s.reportId,
      1,
      BigInt(c.result_revision!) as import('../../packages/domain/src/values/core.ts').Revision,
    ),
  );
  expect(saved?.items[1]!.snapshot).toMatchObject({
    productKnown: false,
    fit: 'unverified',
    scoreBp: null,
  });
  expect(canonical(saved)).not.toMatch(/Unknown tire|Private Shop/);
  expect(
    await s.service.readComparison([s.owner.token], s.reportId, 1, c.result_revision),
  ).toMatchObject({ ok: true, value: { comparison: { revision: c.result_revision } } });
  expect(await s.service.compare([s.owner.token], s.reportId, command(), req)).toMatchObject({
    error: { code: 'conflict' },
  });
  expect(
    await s.service.compare([s.owner.token], s.reportId, command(), {
      ...req,
      expectedRevision: c.result_revision,
    }),
  ).toMatchObject({ ok: true, value: { result_revision: '2' } });
  const share = value(
    await s.service.share([s.owner.token], s.reportId, command(), {
      version: 1,
      comparisonRevision: c.result_revision,
    }),
  );
  if (!('token' in share)) throw Error('token');
  const keys = s.crypto.lookup('share', share.token);
  expect(value(await s.service.readShared(keys)).comparison).toMatchObject({
    revision: c.result_revision,
  });
  const plain = await f.asset();
  await success(f.scope.unitOfWork, (tx) =>
    f.caps.asset(tx, s.owner.identity, {
      assetId: plain.id,
      reportId: s.reportId,
      version: 1,
      comparisonRevision: null,
      rendererVersion: 'fixture',
      locale: 'en-US',
      scope: 'shared',
      renderKey: uid('render'),
    }),
  );
  expect(await s.service.sharedDownload(keys, command(), { assetId: plain.id })).toMatchObject({
    error: { code: 'forbidden' },
  });
  const own = await f.asset();
  await success(f.scope.unitOfWork, (tx) =>
    f.caps.asset(tx, s.owner.identity, {
      assetId: own.id,
      reportId: s.reportId,
      version: 1,
      comparisonRevision: null,
      rendererVersion: 'fixture',
      locale: 'en-US',
      scope: 'owner',
      renderKey: uid('render'),
    }),
  );
  const download = value(
    await s.service.ownerDownload([s.owner.token], s.reportId, command(), {
      version: 1,
      assetId: own.id,
    }),
  );
  expect(download).toHaveProperty('token');
  expect(await s.service.sharedDownload(keys, command(), { assetId: own.id })).toMatchObject({
    ok: false,
  });
});
it('explicit latest shares follow new versions while fixed views remain pinned', async () => {
  const s = await created(),
    fixed = value(
      await s.service.share([s.owner.token], s.reportId, command(), {
        version: 1,
        comparisonRevision: null,
      }),
    ),
    latest = value(
      await s.service.share([s.owner.token], s.reportId, command(), {
        version: null,
        comparisonRevision: null,
      }),
    );
  if (!('token' in fixed) || !('token' in latest)) throw Error('token');
  const h = value(await s.service.readOwner([s.owner.token], s.reportId)),
    d = value(
      await s.service.saveDraft([s.owner.token], s.reportId, command(), {
        baseVersion: 1,
        expectedRevision: null,
        input: engineFixture().request,
      }),
    );
  value(
    await s.service.refine([s.owner.token], s.reportId, command(), {
      baseVersion: 1,
      expectedRevision: h.revision,
      draftRevision: d.result_revision,
    }),
  );
  expect(value(await s.service.readShared(s.crypto.lookup('share', fixed.token))).version).toBe(1);
  expect(value(await s.service.readShared(s.crypto.lookup('share', latest.token))).version).toBe(2);
});
it('keeps the catalog role away from private notes and only exposes approved policy metadata', async () => {
  const scope = f.adapter('tt_catalog_runtime'),
    policies = createReportPolicyRepository(scope),
    recalls = createReportRecallRepository(f.ingestScope);
  expect(
    await success(scope.unitOfWork, (tx) => policies.published(tx, 'SYNTHETIC_US')),
  ).toBeNull();
  expect(
    await success(f.ingestScope.unitOfWork, (tx) => recalls.checkedAt(tx, uid('dataset'))),
  ).toBeNull();
  expect(
    await scope.unitOfWork.run(async (tx) =>
      ok(await scope.query(tx, 'SELECT * FROM privacy.quote_private_data')),
    ),
  ).toMatchObject({ ok: false });
});

it('composes the three real restricted roles and fails closed when the deferred source/policy contracts are absent', async () => {
  const s = setup(),
    who = await f.owner();
  const deps = {
    privateScope: f.scope,
    catalogScope: f.readScope,
    sourceScope: f.adapter('tt_report_source_runtime'),
    crypto: s.crypto,
    encryption: s.encryption,
    now: () => time(),
  };
  const service = await createReportRuntime(deps);
  expect(await service.create([who.token], command(), engineFixture().request)).toMatchObject({
    error: { code: 'unavailable' },
  });
  await expect(createReportRuntime({ ...deps, privateScope: f.readScope })).rejects.toThrow(
    'Invalid report runtime role',
  );
  const policyId = uid('rule'),
    document = { regionKey: 'SYNTHETIC_US', reviewDueAt: time(86400000) };
  await f.admin.query(
    "INSERT INTO app.rule_versions(id,kind,version,document,document_hash,status) VALUES($1,'recommendation',$2,$3,$4,'draft')",
    [policyId, uid('v'), JSON.stringify(document), key().digest],
  );
  await f.admin.query(
    "UPDATE app.rule_versions SET status='published',reviewed_by=$2,reviewed_at=now() WHERE id=$1",
    [policyId, f.staff],
  );
  await f.admin.query(
    "INSERT INTO app.report_policy_heads(market,region_key,rule_version_id) VALUES('US','SYNTHETIC_US',$1)",
    [policyId],
  );
  const policy = createReportPolicyRepository(f.readScope);
  expect(
    await success(f.readScope.unitOfWork, (tx) => policy.published(tx, 'SYNTHETIC_US')),
  ).toMatchObject({ id: policyId, document });
  expect(await success(f.readScope.unitOfWork, (tx) => policy.published(tx, 'OTHER'))).toBeNull();
  const next = uid('rule');
  await f.admin.query(
    "INSERT INTO app.rule_versions(id,kind,version,document,document_hash,status) VALUES($1,'recommendation',$2,$3,$4,'draft')",
    [next, uid('v'), JSON.stringify(document), key().digest],
  );
  await f.admin.query(
    "UPDATE app.rule_versions SET status='published',reviewed_by=$2,reviewed_at=now() WHERE id=$1",
    [next, f.staff],
  );
  await success(f.publishScope.unitOfWork, (tx) =>
    f.publishScope.query(
      tx,
      "UPDATE app.report_policy_heads SET rule_version_id=$1,revision=revision+1,updated_at=clock_timestamp() WHERE market='US' AND region_key='SYNTHETIC_US'",
      [next],
    ),
  );
  expect(
    await success(f.readScope.unitOfWork, (tx) => policy.published(tx, 'SYNTHETIC_US')),
  ).toMatchObject({ id: next });
  expect(
    (await f.admin.query('SELECT status,document FROM app.rule_versions WHERE id=$1', [policyId]))
      .rows[0],
  ).toMatchObject({ status: 'published', document });
  await f.admin.query('DELETE FROM app.report_policy_heads WHERE rule_version_id=$1', [next]);
  expect(
    await success(f.readScope.unitOfWork, (tx) => policy.published(tx, 'SYNTHETIC_US')),
  ).toBeNull();
});
it('batch-loads pinned licensed facts in one query and rejects invalid fields, excess identities and revoked source rights', async () => {
  const run = await f.run(),
    modelId = uid('tire_model');
  await f.stage(run, 'tireModels', [
    {
      id: modelId,
      brand: 'Synthetic Batch',
      model: 'test',
      category: 'test',
      seasonalClass: 'all_season',
      sourceRecordKey: 'batch-model',
    },
  ]);
  const candidate = await f.candidate(run, 1n);
  await success(f.publishScope.unitOfWork, (tx) => f.publish.publish(tx, candidate));
  const request = {
    kind: 'tireModels' as const,
    bundleId: candidate.bundleId,
    market: 'US',
    field: 'id' as const,
    ids: [modelId],
  };
  expect(await success(f.readScope.unitOfWork, (tx) => f.catalog.batch(tx, request))).toMatchObject(
    [{ fact: { id: modelId, brand: 'Synthetic Batch' } }],
  );
  expect(
    await success(f.readScope.unitOfWork, (tx) => f.catalog.batch(tx, { ...request, ids: [] })),
  ).toEqual([]);
  for (const change of [
    { ids: ['bad'] },
    { ids: [modelId, modelId] },
    { ids: Array.from({ length: 201 }, () => uid('tire_model')) },
    { field: 'private' },
    { field: 'skuId' },
  ])
    expect(
      await f.readScope.unitOfWork.run(async (tx) =>
        ok(await f.catalog.batch(tx, { ...request, ...change } as never)),
      ),
    ).toMatchObject({ ok: false });
  expect(
    await success(f.readScope.unitOfWork, (tx) =>
      f.catalog.batch(tx, { ...request, bundleId: uid('bundle') }),
    ),
  ).toEqual([]);
  await f.admin.query(
    'UPDATE app.data_licenses SET rights=rights||\'{"display":false}\'::jsonb WHERE id=$1',
    [f.license],
  );
  expect(await success(f.readScope.unitOfWork, (tx) => f.catalog.batch(tx, request))).toEqual([]);
});

it('rejects malformed workflow requests and unknown fixed resources before persisting effects', async () => {
  const s = await created(),
    keys = [s.owner.token],
    request = engineFixture().request;
  const invalid = [
    () => s.service.create(keys, command(), {}),
    () => s.service.create(keys, 'bad', request),
    () =>
      s.service.saveDraft(keys, s.reportId, command(), {
        baseVersion: 0,
        expectedRevision: null,
        input: request,
      }),
    () =>
      s.service.saveDraft(keys, s.reportId, command(), {
        baseVersion: 1,
        expectedRevision: 'bad',
        input: request,
      }),
    () =>
      s.service.refine(keys, s.reportId, command(), {
        baseVersion: 1,
        expectedRevision: '1',
        draftRevision: 'bad',
      }),
    () => s.service.readOwner(keys, 'bad'),
    () => s.service.readOwner(keys, s.reportId, 0),
    () => s.service.share(keys, s.reportId, command(), { version: null, comparisonRevision: '1' }),
    () =>
      s.service.compare(keys, s.reportId, command(), {
        version: 1,
        expectedRevision: null,
        items: [],
      }),
    () =>
      s.service.compare(keys, s.reportId, command(), {
        version: 1,
        expectedRevision: null,
        items: Array(5).fill({ kind: 'quote', key: uid('quote') }),
      }),
    () =>
      s.service.compare(keys, s.reportId, command(), {
        version: 1,
        expectedRevision: null,
        items: Array(2).fill({ kind: 'catalog', key: engineFixture().snapshot.plans[0]!.id }),
      }),
    () =>
      s.service.compare(keys, s.reportId, command(), {
        version: 1,
        expectedRevision: null,
        items: [{ kind: 'paid', key: uid('quote') }],
      }),
    () =>
      s.service.saveQuote(keys, s.reportId, command(), { ...quote(), observedOn: '2099-01-01' }),
    () =>
      s.service.ownerDownload(keys, s.reportId, command(), { version: 0, assetId: uid('asset') }),
  ];
  for (const action of invalid)
    expect(await action()).toMatchObject({ error: { code: 'invalid_input' } });
  const absent = [
    () => s.service.readOwner(keys, s.reportId, 99),
    () => s.service.readShared([key()]),
    () => s.service.share(keys, s.reportId, command(), { version: 99, comparisonRevision: null }),
    () => s.service.share(keys, s.reportId, command(), { version: 1, comparisonRevision: '99' }),
    () => s.service.readQuote(keys, s.reportId, uid('quote')),
    () => s.service.readComparison(keys, s.reportId, 1, '99'),
    () =>
      s.service.compare(keys, s.reportId, command(), {
        version: 1,
        expectedRevision: null,
        items: [{ kind: 'quote', key: uid('quote') }],
      }),
  ];
  for (const action of absent)
    expect(await action()).toMatchObject({ error: { code: 'not_found' } });
  expect(
    await s.service.refine(keys, s.reportId, command(), {
      baseVersion: 1,
      expectedRevision: '2',
      draftRevision: '1',
    }),
  ).toMatchObject({ error: { code: 'conflict' } });
});
it('rechecks owner and share authority after source or encryption I/O', async () => {
  const s = setup(),
    who = await f.owner(),
    original = s.deps.evidence.prepare;
  s.deps.evidence.prepare = async (...args) => {
    const result = await original(...args);
    await success(f.scope.unitOfWork, (tx) => f.owners.revoke(tx, who.identity));
    return result;
  };
  expect(await s.service.create([who.token], command(), engineFixture().request)).toMatchObject({
    error: { code: 'forbidden' },
  });
  const c = await created(),
    share = value(
      await c.service.share([c.owner.token], c.reportId, command(), {
        version: 1,
        comparisonRevision: null,
      }),
    );
  if (!('token' in share)) throw Error('token');
  const keys = c.crypto.lookup('share', share.token);
  const old = c.deps.evidence.overlay;
  c.deps.evidence.overlay = async (...args) => {
    const r = await old(...args);
    await success(f.scope.unitOfWork, (tx) =>
      f.caps.revokeShare(
        tx,
        c.owner.identity,
        c.reportId,
        share.resource_id as unknown as import('../../packages/domain/src/values/core.ts').Id<'report_capability'>,
      ),
    );
    return r;
  };
  expect(await c.service.readShared(keys)).toMatchObject({ error: { code: 'not_found' } });
  const q = await created(),
    saved = value(await q.service.saveQuote([q.owner.token], q.reportId, command(), quote()));
  const decrypt = q.encryption.decrypt.getMockImplementation()!;
  q.encryption.decrypt.mockImplementation(async (...args) => {
    const b = await decrypt(...args);
    await success(f.scope.unitOfWork, (tx) => f.owners.revoke(tx, q.owner.identity));
    return b;
  });
  expect(await q.service.readQuote([q.owner.token], q.reportId, saved.resource_id)).toMatchObject({
    error: { code: 'forbidden' },
  });
});
it('rolls back the report and idempotency claim if receipt persistence fails', async () => {
  const s = setup(),
    who = await f.owner();
  s.deps.commands.complete = async () => {
    throw Error('private receipt details');
  };
  expect(await s.service.create([who.token], command(), engineFixture().request)).toEqual(
    fail(failure('internal')),
  );
  const count = await f.admin.query(
    'SELECT count(*)::int n FROM app.reports WHERE owner_subject_id=$1',
    [who.identity.subjectId],
  );
  expect(count.rows[0].n).toBe(0);
  const receipts = await f.admin.query(
    "SELECT count(*)::int n FROM app.idempotency_requests WHERE actor_scope_hash=decode($1,'hex')",
    [s.crypto.hash('actor', who.identity.subjectId)],
  );
  expect(receipts.rows[0].n).toBe(0);
});
it('rejects a quote edit racing a comparison and never silently replaces its selected revision', async () => {
  const s = await created(),
    saved = value(await s.service.saveQuote([s.owner.token], s.reportId, command(), quote())),
    original = s.deps.evidence.current;
  s.deps.evidence.current = async (p) => {
    const r = await original(p);
    const body = {
      ...quote(),
      id: saved.resource_id,
      expectedRevision: saved.result_revision,
      totalMinor: '80000',
    };
    value(await s.service.saveQuote([s.owner.token], s.reportId, command(), body));
    return r;
  };
  expect(
    await s.service.compare([s.owner.token], s.reportId, command(), {
      version: 1,
      expectedRevision: null,
      items: [{ kind: 'quote', key: saved.resource_id }],
    }),
  ).toMatchObject({ error: { code: 'conflict' } });
  const count = await f.admin.query(
    'SELECT count(*)::int n FROM app.comparisons WHERE report_id=$1',
    [s.reportId],
  );
  expect(count.rows[0].n).toBe(0);
});
it('tracks owner activity with a twelve-month ceiling without renewing it on public share reads', async () => {
  const s = await created();
  await f.admin.query(
    "UPDATE app.reports SET created_at=clock_timestamp()-interval '11 months',expires_at=clock_timestamp()+interval '170 days' WHERE id=$1",
    [s.reportId],
  );
  const before = value(await s.service.readOwner([s.owner.token], s.reportId));
  const expiry = await f.admin.query(
    "SELECT expires_at<=created_at+interval '1 year' AS capped FROM app.reports WHERE id=$1",
    [s.reportId],
  );
  expect(expiry.rows[0].capped).toBe(true);
  const share = value(
    await s.service.share([s.owner.token], s.reportId, command(), {
      version: 1,
      comparisonRevision: null,
    }),
  );
  if (!('token' in share)) throw Error('token');
  const activity = (
    await f.admin.query('SELECT last_owner_activity_at FROM app.reports WHERE id=$1', [s.reportId])
  ).rows[0].last_owner_activity_at;
  value(await s.service.readShared(s.crypto.lookup('share', share.token)));
  expect(
    (
      await f.admin.query('SELECT last_owner_activity_at FROM app.reports WHERE id=$1', [
        s.reportId,
      ])
    ).rows[0].last_owner_activity_at,
  ).toEqual(activity);
  expect(value(await s.service.readOwner([s.owner.token], s.reportId)).revision).toBe(
    before.revision,
  );
});
