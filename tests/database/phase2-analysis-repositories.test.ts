import { beforeAll, afterAll, it, expect } from 'vitest';
import { createJobRepository } from '../../packages/db/src/repositories/jobs.ts';
import { createTransactions } from '../../packages/db/src/transactions.ts';
import { randomUUID, randomBytes } from 'node:crypto';
import {
  analysisRoles,
  analysisRepositoryFixture,
  analysisRepositorySources,
} from '../fixtures/phase2/analysis-repositories.ts';
import { migrateApplication } from '../../scripts/database/migrate.ts';
import { createAIScopeRepository } from '../../packages/db/src/repositories/analysis-scope.ts';
import { createAIRequestRepository } from '../../packages/db/src/repositories/analysis-requests.ts';
import { createAIReuseRepository } from '../../packages/db/src/repositories/analysis-reuse.ts';
import { createAIBudgetRepository } from '../../packages/db/src/repositories/analysis-budgets.ts';
import { createAIArtifactRepository } from '../../packages/db/src/repositories/analysis-artifacts.ts';
import { createAIAttachmentRepository } from '../../packages/db/src/repositories/analysis-attachments.ts';
import { createPhotoAssetRepository } from '../../packages/db/src/repositories/photo-assets.ts';
import { createPhotoWorkerRepository } from '../../packages/db/src/repositories/photo-worker.ts';
import { createPhotoOwnerRepository } from '../../packages/db/src/repositories/photo-owners.ts';
import { createCsvReviewRepository } from '../../packages/db/src/repositories/csv-reviews.ts';
import { createAnalysisPrivacyRepository } from '../../packages/db/src/repositories/analysis-privacy.ts';
import { createPrivacyServiceRepository } from '../../packages/db/src/repositories/privacy-services.ts';
import {
  id,
  instant,
  revision,
  ok,
  type Id,
  type Result,
} from '../../packages/domain/src/values/core.ts';
import type { TransactionContext as Tx } from '../../packages/application/src/ports/transactions.ts';
import { pageRequest } from '../../packages/application/src/ports/pagination.ts';
let f: Awaited<ReturnType<typeof analysisRepositoryFixture>>;
type Adapter = ReturnType<typeof f.analysisAdapter>;
let staff: Adapter,
  worker: Adapter,
  photoWorker: Adapter,
  owner: Adapter,
  reader: Adapter,
  csv: Adapter,
  assets: Adapter,
  privacy: Adapter;
const hash = () => randomBytes(32).toString('hex');
const uuid = <K extends string>(kind: K, value = randomUUID()) => valueOf(id(kind, value));
function valueOf<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw Error(JSON.stringify(result.error));
  return result.value;
}
const time = (delta = 3600000) => valueOf(instant(new Date(Date.now() + delta).toISOString()));
const rev = (n = 1n) => valueOf(revision(n.toString()));
const page = (n = 2, after: string | null = null) => valueOf(pageRequest(n, after));
async function run<T>(a: Adapter, work: (tx: Tx) => Promise<T>) {
  return valueOf(await a.unitOfWork.run(async (tx) => ok(await work(tx))));
}
async function denied(a: Adapter, work: (tx: Tx) => Promise<unknown>) {
  const r = await a.unitOfWork.run(async (tx) => ok(await work(tx)));
  expect(r.ok).toBe(false);
  return r;
}
beforeAll(async () => {
  f = await analysisRepositoryFixture();
  staff = f.analysisAdapter('tt_p2_ai_staff');
  worker = f.analysisAdapter('tt_p2_ai_worker', 4);
  photoWorker = f.analysisAdapter('tt_p2_photo_processor');
  owner = f.analysisAdapter('tt_p2_photo_runtime');
  reader = f.analysisAdapter('tt_p2_ai_runtime');
  csv = f.analysisAdapter('tt_p2_csv_staff');
  assets = f.analysisAdapter('tt_p2_photo_assets');
  privacy = f.privacyAdapter();
}, 60000);
afterAll(async () => {
  await f?.cleanup();
}, 60000);
it('installs only the checksum-pinned opt-in repository extension and replays without DDL', async () => {
  expect(f.analysisApplied).toBe(1);
  expect(await migrateApplication(f.target, analysisRepositorySources().sources)).toBe(0);
  expect(
    (await f.admin.query('SELECT count(*)::int AS n FROM migration_meta.applied')).rows[0]?.n,
  ).toBe(45);
});
async function scope(options: { shared?: boolean; photo?: boolean; owner?: Id<'subject'> } = {}) {
  const person = options.shared ? null : (options.owner ?? (await f.owner()).identity.subjectId),
    policy = uuid('ai_policy');
  await f.admin.query(
    `INSERT INTO app.ai_policy_versions(id,task,provider,model_id,prompt_version,schema_version,validator_version,canonical_version,configuration_hash,status,shared_allowed,shared_parameter_allowlist,template_key,reviewed_by,reviewed_at) VALUES($1,$2,'synthetic','no-provider-call','p1','s1','v1','local-jsonb-v1',$3,'active',$4,$5,$6,$7,clock_timestamp())`,
    [
      policy,
      options.photo
        ? 'photo_extraction'
        : options.shared
          ? 'generic_explanation'
          : 'report_analysis',
      hash(),
      options.shared ?? false,
      JSON.stringify(options.shared ? ['usage', 'climate_category'] : []),
      options.shared ? 'reviewed-synthetic-template' : null,
      f.staff,
    ],
  );
  const subject = person
    ? rev(
        BigInt(
          (
            await f.admin.query('SELECT permission_revision FROM app.subjects WHERE id=$1', [
              person,
            ])
          ).rows[0]!.permission_revision,
        ),
      )
    : null;
  const r = createAIScopeRepository(staff),
    s = await run(staff, (tx) =>
      r.create(tx, {
        id: uuid('ai_scope'),
        policyId: policy,
        ownerId: person,
        key: randomUUID(),
        subjectRevision: subject,
        noticeVersion: 'synthetic-v1',
        evidenceHash: hash(),
      }),
    );
  return s;
}
async function request(
  s: Awaited<ReturnType<typeof scope>>,
  manifest = { parameters: { usage: 'commute' } },
) {
  const r = createAIRequestRepository(worker);
  return run(worker, (tx) =>
    r.create(tx, {
      id: uuid('ai_request'),
      scopeId: s.id,
      key: randomUUID(),
      manifest,
      deadlineSeconds: 120,
    }),
  );
}
async function attempt(s: Awaited<ReturnType<typeof scope>>) {
  const r = await request(s),
    a = await run(worker, (tx) =>
      createAIRequestRepository(worker).attempt(tx, {
        id: uuid('ai_attempt'),
        requestId: r.id,
        ordinal: 1,
        currency: 'USD',
      }),
    );
  return { r, a, s };
}
async function budget(s: Awaited<ReturnType<typeof scope>>, limit = 1000, seconds = 3600) {
  const id = uuid('ai_budget');
  await f.admin.query(
    `INSERT INTO app.ai_budget_windows(id,policy_key,policy_version_id,window_start,window_end,currency_code,limit_minor) VALUES($1,$1::uuid::text,$2,clock_timestamp()-interval '1 minute',clock_timestamp()+make_interval(secs=>$3),'USD',$4)`,
    [id, s.policyId, seconds, limit],
  );
  return id;
}
it('refuses dispatch after a previously reserved budget window expires', async () => {
  const t = await attempt(await scope()),
    b = await budget(t.s, 1000, 2);
  await run(worker, (tx) =>
    createAIBudgetRepository(worker).reserve(tx, t.a.id, [{ id: b, amountMinor: 100n }]),
  );
  await f.admin.query('SELECT pg_sleep(2.1)');
  await run(worker, (tx) =>
    createAIRequestRepository(worker).transition(tx, t.r.id, 'queued', 'running'),
  );
  await denied(worker, (tx) => createAIRequestRepository(worker).start(tx, t.a.id));
});

it('creates captured authority and idempotent request keys using PostgreSQL JSONB digests', async () => {
  const s = await scope(),
    repo = createAIRequestRepository(worker),
    key = randomUUID(),
    input = {
      id: uuid('ai_request'),
      scopeId: s.id,
      key,
      manifest: { parameters: { z: 2, a: 1 } },
      deadlineSeconds: 120,
    };
  const a = await run(worker, (tx) => repo.create(tx, input)),
    b = await run(worker, (tx) =>
      repo.create(tx, {
        ...input,
        id: uuid('ai_request'),
        manifest: { parameters: { a: 1, z: 2 } },
      }),
    );
  expect(b).toEqual(a);
  expect(await run(worker, (tx) => repo.get(tx, a.id))).toEqual(a);
  await denied(worker, (tx) =>
    repo.create(tx, { ...input, manifest: { parameters: { z: 3, a: 1 } } }),
  );
});
it('rejects an idempotency key with a changed dispatch deadline', async () => {
  const s = await scope(),
    r = createAIRequestRepository(worker),
    input = {
      id: uuid('ai_request'),
      scopeId: s.id,
      key: randomUUID(),
      manifest: { parameters: {} },
      deadlineSeconds: 120,
    };
  await run(worker, (tx) => r.create(tx, input));
  await denied(worker, (tx) => r.create(tx, { ...input, deadlineSeconds: 60 }));
});
it('applies scope choice and invalidation with separate optimistic revisions', async () => {
  const s = await scope(),
    r = createAIScopeRepository(staff);
  expect((await run(staff, (tx) => r.invalidate(tx, s.id, 0n))).invalidationRevision).toBe(1n);
  await denied(staff, (tx) => r.invalidate(tx, s.id, 0n));
  const withdrawn = await run(staff, (tx) =>
    r.choice(tx, {
      scopeId: s.id,
      expectedRevision: s.permissionRevision,
      subjectRevision: s.subjectRevision,
      allowed: false,
      noticeVersion: 'v1',
      evidenceHash: hash(),
    }),
  );
  expect(withdrawn.processingAllowed).toBe(false);
  await denied(worker, (tx) =>
    createAIRequestRepository(worker).create(tx, {
      id: uuid('ai_request'),
      scopeId: s.id,
      key: randomUUID(),
      manifest: { parameters: {} },
      deadlineSeconds: 120,
    }),
  );
});
it('admits reviewed shared parameters and refuses owner text in shared scopes', async () => {
  const s = await scope({ shared: true });
  expect((await request(s)).ownerId).toBeNull();
  await denied(worker, (tx) =>
    createAIRequestRepository(worker).create(tx, {
      id: uuid('ai_request'),
      scopeId: s.id,
      key: randomUUID(),
      manifest: { parameters: { email: 'synthetic@example.invalid' } },
      deadlineSeconds: 120,
    }),
  );
});
it('serializes two claims for one exact key without granting both holders a lease', async () => {
  const s = await scope(),
    r = await request(s),
    repo = createAIReuseRepository(worker),
    result = await Promise.all([
      run(worker, (tx) => repo.claim(tx, s.id, r.digest, uuid('ai_holder'), 120)),
      run(worker, (tx) => repo.claim(tx, s.id, r.digest, uuid('ai_holder'), 120)),
    ]);
  expect(result.filter(Boolean)).toHaveLength(1);
  expect(result.find(Boolean)?.fence).toBe(1n);
});
it('increments a replacement fence and rejects stale publication after lease expiry', async () => {
  const s = await scope(),
    r = await request(s),
    repo = createAIReuseRepository(worker),
    first = await run(worker, (tx) => repo.claim(tx, s.id, r.digest, uuid('ai_holder'), 1));
  expect(first).not.toBeNull();
  await f.admin.query('SELECT pg_sleep(1.05)');
  const next = await run(worker, (tx) => repo.claim(tx, s.id, r.digest, uuid('ai_holder'), 120));
  expect(next?.fence).toBe(2n);
  expect(await run(worker, (tx) => repo.publish(tx, first!, uuid('ai_artifact')))).toBe(false);
});
it('atomically reserves a sorted multi-window budget and treats exact retries once', async () => {
  const t = await attempt(await scope()),
    a = await budget(t.s),
    b = await budget(t.s),
    repo = createAIBudgetRepository(worker),
    input = [
      { id: b, amountMinor: 100n },
      { id: a, amountMinor: 100n },
    ],
    first = await run(worker, (tx) => repo.reserve(tx, t.a.id, input));
  expect(await run(worker, (tx) => repo.reserve(tx, t.a.id, input.toReversed()))).toEqual(first);
  expect(
    (
      await f.admin.query(
        'SELECT reserved_minor FROM app.ai_budget_windows WHERE id=ANY($1) ORDER BY id',
        [[a, b]],
      )
    ).rows.map((r) => r.reserved_minor),
  ).toEqual(['100', '100']);
  await denied(worker, (tx) =>
    repo.reserve(tx, t.a.id, [
      { id: a, amountMinor: 99n },
      { id: b, amountMinor: 100n },
    ]),
  );
});
it('rolls back every earlier budget reservation if a later window cannot fund it', async () => {
  const t = await attempt(await scope()),
    a = await budget(t.s, 100),
    b = await budget(t.s, 0);
  await denied(worker, (tx) =>
    createAIBudgetRepository(worker).reserve(tx, t.a.id, [
      { id: a, amountMinor: 100n },
      { id: b, amountMinor: 100n },
    ]),
  );
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM app.ai_budget_reservations WHERE attempt_id=$1',
        [t.a.id],
      )
    ).rows[0]?.n,
  ).toBe(0);
  expect(
    (await f.admin.query('SELECT reserved_minor FROM app.ai_budget_windows WHERE id=$1', [a]))
      .rows[0]?.reserved_minor,
  ).toBe('0');
});
it('conserves a shared window under concurrent attempts', async () => {
  const s = await scope(),
    a = await attempt(s),
    b = await attempt(s),
    window = await budget(s, 100),
    repo = createAIBudgetRepository(worker);
  const r = await Promise.all(
    [a, b].map((t) =>
      worker.unitOfWork.run(async (tx) =>
        ok(await repo.reserve(tx, t.a.id, [{ id: window, amountMinor: 100n }])),
      ),
    ),
  );
  expect(r.filter((x) => x.ok)).toHaveLength(1);
});
async function started(options: { shared?: boolean } = {}) {
  const t = await attempt(await scope(options)),
    b = await budget(t.s),
    repo = createAIRequestRepository(worker);
  await run(worker, (tx) =>
    createAIBudgetRepository(worker).reserve(tx, t.a.id, [{ id: b, amountMinor: 100n }]),
  );
  await run(worker, (tx) => repo.transition(tx, t.r.id, 'queued', 'running'));
  await run(worker, (tx) => repo.start(tx, t.a.id));
  return { ...t, b };
}
const finish = (a: Id<'ai_attempt'>, cost: bigint | null = null) => ({
  id: a,
  state: 'succeeded' as const,
  providerRequestId: null,
  inputTokens: 1n,
  outputTokens: 2n,
  costMinor: cost,
  costStatus: cost === null ? ('unknown' as const) : ('reconciled' as const),
  error: null,
});
it('allows terminal cost metadata to progress from unknown to reconciled and settle once', async () => {
  const t = await started(),
    r = createAIRequestRepository(worker),
    b = createAIBudgetRepository(worker);
  await run(worker, (tx) => r.finish(tx, finish(t.a.id)));
  expect((await run(worker, (tx) => r.finish(tx, finish(t.a.id, 60n)))).costMinor).toBe(60n);
  await run(worker, (tx) =>
    b.reconcile(tx, t.a.id, { state: 'settled', costMinor: 60n, reason: null, evidenceId: null }),
  );
  await run(worker, (tx) =>
    b.reconcile(tx, t.a.id, { state: 'settled', costMinor: 60n, reason: null, evidenceId: null }),
  );
  expect(
    (
      await f.admin.query(
        'SELECT reserved_minor,spent_minor FROM app.ai_budget_windows WHERE id=$1',
        [t.b],
      )
    ).rows[0],
  ).toEqual({ reserved_minor: '0', spent_minor: '60' });
});
it('keeps uncertain charges reserved and refuses unsupported release evidence', async () => {
  const t = await started(),
    b = createAIBudgetRepository(worker);
  await run(worker, (tx) =>
    b.reconcile(tx, t.a.id, {
      state: 'uncertain',
      costMinor: null,
      reason: null,
      evidenceId: null,
    }),
  );
  await denied(worker, (tx) =>
    b.reconcile(tx, t.a.id, {
      state: 'released',
      costMinor: null,
      reason: 'not_dispatched',
      evidenceId: null,
    }),
  );
  expect(
    (await f.admin.query('SELECT reserved_minor FROM app.ai_budget_windows WHERE id=$1', [t.b]))
      .rows[0]?.reserved_minor,
  ).toBe('100');
});
it('does not start an attempt without its pre-dispatch reservation', async () => {
  const t = await attempt(await scope());
  await run(worker, (tx) =>
    createAIRequestRepository(worker).transition(tx, t.r.id, 'queued', 'running'),
  );
  await denied(worker, (tx) => createAIRequestRepository(worker).start(tx, t.a.id));
});
async function source(advice = false) {
  const provider = uuid('provider'),
    license = uuid('license'),
    dataset = uuid('dataset');
  await f.admin.query(
    "INSERT INTO app.data_providers(id,code,name,status) VALUES($1,$1::uuid::text,'Synthetic analysis source','active')",
    [provider],
  );
  await f.admin.query(
    `INSERT INTO app.data_licenses(id,provider_id,market,rights,effective_at,reviewed_at) VALUES($1,$2,'US','{"display":true,"cache":true,"derived":true,"snapshot":true,"api":true,"ai_processing":true}',clock_timestamp()-interval '1 day',clock_timestamp())`,
    [license, provider],
  );
  await f.admin.query(
    "INSERT INTO app.dataset_versions(id,provider_id,license_id,kind,external_version,checksum,status,effective_at,fetched_at,row_count) VALUES($1,$2,$3,'synthetic_ai','v1',$4,'staging',now(),now(),0)",
    [dataset, provider, license, hash()],
  );
  const fact = advice ? uuid('advice_fact') : null;
  if (fact)
    await f.admin.query(
      `INSERT INTO app.advice_facts(id,topic_key,market,locale,claim,applicability,reviewed_by,reviewed_at,review_due_at,status,dataset_version_id,source_record_key) VALUES($1,'synthetic','US','en-US','Synthetic source only','{}',$2,now(),now()+interval '1 day','reviewed',$3,'synthetic')`,
      [fact, f.staff, dataset],
    );
  await f.admin.query(
    "UPDATE app.dataset_versions SET status='published',published_at=clock_timestamp() WHERE id=$1",
    [dataset],
  );
  return { provider, license, dataset, fact };
}
async function published(options: { shared?: boolean; advice?: boolean } = {}) {
  const t = await started(options),
    r = createAIRequestRepository(worker),
    src = await source(options.advice);
  await run(worker, (tx) => r.finish(tx, finish(t.a.id, 60n)));
  await run(worker, (tx) => r.transition(tx, t.r.id, 'running', 'accepted'));
  const lease = await run(worker, (tx) =>
    createAIReuseRepository(worker).claim(tx, t.s.id, t.r.digest, uuid('ai_holder'), 120),
  );
  const artifact = await run(worker, (tx) =>
    createAIArtifactRepository(worker).publish(tx, {
      id: uuid('ai_artifact'),
      requestId: t.r.id,
      attemptId: t.a.id,
      lease: lease!,
      output: { summary: 'Synthetic only', claims: [] },
      validSeconds: 3600,
      retainSeconds: 7200,
      sources: [
        {
          key: 'synthetic',
          datasetId: src.fact === null ? src.dataset : null,
          adviceId: src.fact,
          claimHash: hash(),
          rightsUntil: time(7200000),
        },
      ],
    }),
  );
  return { ...t, src, artifact, lease: lease! };
}
it('publishes a sealed artifact and returns only current exact-key output', async () => {
  const t = await published(),
    r = createAIReuseRepository(worker);
  expect((await run(worker, (tx) => r.current(tx, t.s.id, t.r.digest)))?.artifactId).toBe(
    t.artifact.id,
  );
  expect(
    await run(worker, (tx) => createAIArtifactRepository(worker).current(tx, t.artifact.id)),
  ).toEqual(t.artifact);
  expect(
    (
      await run(worker, (tx) =>
        r.affectedScopes(tx, { kind: 'dataset', id: t.src.dataset }, page()),
      )
    ).items,
  ).toEqual([t.s.id]);
});
it('invalidates reuse immediately when captured scope authority advances', async () => {
  const t = await published();
  await run(staff, (tx) => createAIScopeRepository(staff).invalidate(tx, t.s.id, 0n));
  expect(
    await run(worker, (tx) => createAIReuseRepository(worker).current(tx, t.s.id, t.r.digest)),
  ).toBeNull();
  expect(
    await run(worker, (tx) => createAIArtifactRepository(worker).current(tx, t.artifact.id)),
  ).toBeNull();
});
it('invalidates artifact reuse when source rights expire', async () => {
  const t = await published();
  await f.admin.query('UPDATE app.data_licenses SET expires_at=clock_timestamp() WHERE id=$1', [
    t.src.license,
  ]);
  expect(
    await run(worker, (tx) => createAIArtifactRepository(worker).current(tx, t.artifact.id)),
  ).toBeNull();
});
it('isolates runtime request status by an explicit owner on pooled connections', async () => {
  const s = await scope(),
    r = await request(s),
    other = (await f.owner()).identity.subjectId,
    repo = createAIAttachmentRepository(reader);
  expect((await run(reader, (tx) => repo.status(tx, s.ownerId!, r.id)))?.state).toBe('queued');
  expect(await run(reader, (tx) => repo.status(tx, other, r.id))).toBeNull();
  expect((await run(reader, (tx) => repo.status(tx, s.ownerId!, r.id)))?.id).toBe(r.id);
});
it('poisons a caught validation failure and rolls back earlier writes in the same transaction', async () => {
  const s = await scope(),
    r = createAIRequestRepository(worker),
    id = uuid('ai_request');
  await denied(worker, async (tx) => {
    await r.create(tx, {
      id,
      scopeId: s.id,
      key: randomUUID(),
      manifest: { parameters: {} },
      deadlineSeconds: 120,
    });
    try {
      await r.create(tx, {
        id: uuid('ai_request'),
        scopeId: s.id,
        key: randomUUID(),
        manifest: { parameters: {} },
        deadlineSeconds: 121,
      });
    } catch {
      /* caller cannot recover a poisoned transaction */
    }
    return true;
  });
  expect(
    (await f.admin.query('SELECT id FROM app.ai_analysis_requests WHERE id=$1', [id])).rowCount,
  ).toBe(0);
});

async function photo() {
  const s = await scope({ photo: true }),
    r = createPhotoAssetRepository(assets, 'synthetic-private', 'synthetic-k1');
  const originalInput = {
      id: uuid('asset'),
      kind: 'original' as const,
      mime: 'image/jpeg' as const,
      sha256: hash(),
      size: 1024,
      expiresAt: time(31 * 86400000),
    },
    sanitizedInput = {
      ...originalInput,
      id: uuid('asset'),
      kind: 'sanitized' as const,
      sha256: hash(),
    };
  const original = await run(assets, (tx) => r.register(tx, originalInput)),
    sanitized = await run(assets, (tx) => r.register(tx, sanitizedInput));
  await run(assets, (tx) => r.ready(tx, original, 'v1'));
  await run(assets, (tx) => r.ready(tx, sanitized, 'v1'));
  const id = uuid('photo_upload'),
    workerRepo = createPhotoWorkerRepository(photoWorker);
  await run(photoWorker, (tx) =>
    workerRepo.create(tx, {
      id,
      ownerId: s.ownerId!,
      scopeId: s.id,
      batchId: uuid('photo_batch'),
      originalAssetId: original.id,
      width: 100,
      height: 100,
      permissionRevision: s.permissionRevision,
      subjectRevision: s.subjectRevision!,
      invalidationRevision: s.invalidationRevision,
      expiresAt: time(23 * 3600000),
    }),
  );
  return { id, s, original, sanitized, originalInput, sanitizedInput };
}
async function readyPhoto() {
  const p = await photo();
  await run(photoWorker, (tx) =>
    createPhotoWorkerRepository(photoWorker).sanitized(tx, p.s.ownerId!, p.id, p.sanitized.id),
  );
  return p;
}
async function extracting() {
  const p = await readyPhoto(),
    requestRepo = createAIRequestRepository(photoWorker),
    r = await run(photoWorker, (tx) =>
      requestRepo.create(tx, {
        id: uuid('ai_request'),
        scopeId: p.s.id,
        key: randomUUID(),
        manifest: { parameters: {}, sanitized_sha256: p.sanitized.sha256 },
        deadlineSeconds: 120,
      }),
    ),
    job = uuid('job'),
    id = uuid('photo_extraction');
  await f.admin.query(
    "INSERT INTO app.job_runs(id,job_type,business_key,schema_version,resource_id,deadline_at) VALUES($1,'p2.photo.extract',$2::uuid::text,1,$2,clock_timestamp()+interval '100 seconds')",
    [job, id],
  );
  const e = await run(photoWorker, (tx) =>
    createPhotoWorkerRepository(photoWorker).extraction(tx, {
      id,
      ownerId: p.s.ownerId!,
      uploadId: p.id,
      requestId: r.id,
      jobId: job,
    }),
  );
  return { ...p, r, e, job };
}
async function photoStarted() {
  const p = await extracting(),
    lease = await run(f.scope, (tx) => createJobRepository(f.scope).lease(tx, p.job));
  if (!lease) throw Error('Current P1 photo job lease');
  await run(photoWorker, (tx) =>
    createPhotoWorkerRepository(photoWorker).start(tx, p.s.ownerId!, p.e.id, lease),
  );
  return { ...p, lease };
}
async function photoComplete() {
  const p = await photoStarted(),
    r = createAIRequestRepository(photoWorker),
    a = await run(photoWorker, (tx) =>
      r.attempt(tx, { id: uuid('ai_attempt'), requestId: p.r.id, ordinal: 1, currency: 'USD' }),
    ),
    b = await budget(p.s);
  await run(photoWorker, (tx) =>
    createAIBudgetRepository(photoWorker).reserve(tx, a.id, [{ id: b, amountMinor: 100n }]),
  );
  await run(photoWorker, (tx) => r.transition(tx, p.r.id, 'queued', 'running'));
  await run(photoWorker, (tx) => r.start(tx, a.id));
  await run(photoWorker, (tx) => r.finish(tx, finish(a.id, 50n)));
  await run(photoWorker, (tx) => r.transition(tx, p.r.id, 'running', 'accepted'));
  const reuse = createAIReuseRepository(photoWorker),
    lease = await run(photoWorker, (tx) =>
      reuse.claim(tx, p.s.id, p.r.digest, uuid('ai_holder'), 120),
    ),
    candidate = {
      id: uuid('photo_candidate'),
      uploadId: p.id,
      field: 'brand' as const,
      ordinal: 0,
      rawText: 'Synthetic Brand',
      value: 'Synthetic Brand',
      unknownReason: null,
      quality: 'clear' as const,
      region: null,
    };
  const result = await run(photoWorker, async (tx) => {
    const artifact = await createAIArtifactRepository(photoWorker).publish(tx, {
      id: uuid('ai_artifact'),
      requestId: p.r.id,
      attemptId: a.id,
      lease: lease!,
      output: { fields: ['synthetic-brand'] },
      validSeconds: 3600,
      retainSeconds: 7200,
      sources: [],
    });
    const extraction = await createPhotoWorkerRepository(photoWorker).complete(tx, {
      ownerId: p.s.ownerId!,
      extractionId: p.e.id,
      artifactId: artifact.id,
      lease: p.lease,
      candidates: [candidate],
    });
    return { artifact, extraction };
  });
  return { ...p, ...result, candidate, a, b };
}
it('registers private image metadata through the P1 asset lifecycle and exact retries', async () => {
  const p = await photo(),
    r = createPhotoAssetRepository(assets, 'synthetic-private', 'synthetic-k1');
  expect((await run(assets, (tx) => r.register(tx, p.originalInput))).state).toBe('ready');
  expect((await run(assets, (tx) => r.get(tx, p.original.id)))?.sha256).toBe(p.original.sha256);
  await denied(assets, (tx) => r.register(tx, { ...p.originalInput, sha256: hash() }));
});
it('moves a photo to sanitized ready state and supports an exact ready retry', async () => {
  const p = await readyPhoto(),
    r = createPhotoWorkerRepository(photoWorker);
  await run(photoWorker, (tx) => r.sanitized(tx, p.s.ownerId!, p.id, p.sanitized.id));
  expect(
    (await run(owner, (tx) => createPhotoOwnerRepository(owner).status(tx, p.s.ownerId!, p.id)))
      ?.state,
  ).toBe('ready');
});
it('exposes owner status without object keys and clears pooled owner context', async () => {
  const p = await readyPhoto(),
    other = (await f.owner()).identity.subjectId,
    r = createPhotoOwnerRepository(owner);
  const status = await run(owner, (tx) => r.status(tx, p.s.ownerId!, p.id));
  expect(status).not.toHaveProperty('key');
  expect(status).not.toHaveProperty('scopeId');
  expect(await run(owner, (tx) => r.status(tx, other, p.id))).toBeNull();
  expect(
    (await run(owner, (tx) => r.list(tx, p.s.ownerId!, page()))).items.map((x) => x.id),
  ).toEqual([p.id]);
});
it('refuses a photo from a different owner when sanitizing', async () => {
  const p = await photo(),
    other = (await f.owner()).identity.subjectId;
  await denied(photoWorker, (tx) =>
    createPhotoWorkerRepository(photoWorker).sanitized(tx, other, p.id, p.sanitized.id),
  );
});
it('refuses out of bound dimensions before creating photo claims', async () => {
  const p = await photo();
  await denied(photoWorker, (tx) =>
    createPhotoWorkerRepository(photoWorker).create(tx, {
      id: uuid('photo_upload'),
      ownerId: p.s.ownerId!,
      scopeId: p.s.id,
      batchId: uuid('photo_batch'),
      originalAssetId: p.original.id,
      width: 40000001,
      height: 1,
      permissionRevision: p.s.permissionRevision,
      subjectRevision: p.s.subjectRevision!,
      invalidationRevision: 0n,
      expiresAt: time(),
    }),
  );
});
it('refuses an extraction start with a stale P1 job token', async () => {
  const p = await photoStarted();
  await denied(photoWorker, (tx) =>
    createPhotoWorkerRepository(photoWorker).start(tx, p.s.ownerId!, p.e.id, {
      ...p.lease,
      token: uuid('lease'),
    }),
  );
});
it('atomically seals AI photo output, candidates and extraction under one leased transaction', async () => {
  const p = await photoComplete(),
    r = createPhotoOwnerRepository(owner);
  expect(p.extraction.state).toBe('complete');
  expect((await run(owner, (tx) => r.candidates(tx, p.s.ownerId!, p.id))).map((x) => x.id)).toEqual(
    [p.candidate.id],
  );
  expect((await run(owner, (tx) => r.status(tx, p.s.ownerId!, p.id)))?.state).toBe('complete');
});
it('persists accepted and corrected photo fields as append-only owner revisions', async () => {
  const p = await photoComplete(),
    r = createPhotoOwnerRepository(owner),
    input = {
      uploadId: p.id,
      field: 'brand' as const,
      revision: rev(),
      candidateId: p.candidate.id,
      origin: 'accepted_candidate' as const,
      value: p.candidate.value,
    };
  expect((await run(owner, (tx) => r.confirm(tx, p.s.ownerId!, input))).origin).toBe(
    'accepted_candidate',
  );
  expect(
    (
      await run(owner, (tx) =>
        r.confirm(tx, p.s.ownerId!, {
          ...input,
          revision: rev(2n),
          origin: 'corrected_candidate',
          value: 'Corrected Brand',
        }),
      )
    ).revision,
  ).toBe(2n);
  expect(
    (await run(owner, (tx) => r.confirmations(tx, p.s.ownerId!, p.id))).map((x) => x.value),
  ).toEqual(['Corrected Brand']);
  await denied(owner, (tx) => r.confirm(tx, p.s.ownerId!, input));
});
it('refuses a foreign photo candidate and supports explicit manual origin', async () => {
  const p = await photoComplete(),
    other = await photoComplete(),
    r = createPhotoOwnerRepository(owner);
  await denied(owner, (tx) =>
    r.confirm(tx, p.s.ownerId!, {
      uploadId: p.id,
      field: 'brand',
      revision: rev(),
      candidateId: other.candidate.id,
      origin: 'accepted_candidate',
      value: 'Synthetic Brand',
    }),
  );
  expect(
    (
      await run(owner, (tx) =>
        r.confirm(tx, p.s.ownerId!, {
          uploadId: p.id,
          field: 'brand',
          revision: rev(),
          candidateId: null,
          origin: 'manual',
          value: 'User supplied',
        }),
      )
    ).candidateId,
  ).toBeNull();
});
it('supports one explicit saved retention choice and refuses a second extension', async () => {
  const p = await readyPhoto(),
    r = createPhotoOwnerRepository(owner),
    input = { noticeVersion: 'save-v1', evidenceHash: hash(), expiresAt: time(7 * 86400000) };
  await run(owner, (tx) => r.save(tx, p.s.ownerId!, p.id, input));
  expect((await run(owner, (tx) => r.status(tx, p.s.ownerId!, p.id)))?.savedAt).not.toBeNull();
  await denied(owner, (tx) => r.save(tx, p.s.ownerId!, p.id, input));
});
it('cancels a queued photo extraction, its request and owned job without dispatch', async () => {
  const p = await extracting(),
    r = createPhotoWorkerRepository(photoWorker);
  await run(photoWorker, (tx) => r.cancel(tx, p.s.ownerId!, p.e.id));
  await run(photoWorker, (tx) => r.cancel(tx, p.s.ownerId!, p.e.id));
  expect(
    (await f.admin.query('SELECT state FROM app.photo_extractions WHERE id=$1', [p.e.id])).rows[0]
      ?.state,
  ).toBe('cancelled');
  expect(
    (await f.admin.query('SELECT state FROM app.ai_analysis_requests WHERE id=$1', [p.r.id]))
      .rows[0]?.state,
  ).toBe('cancelled');
});
it('withdraws candidates immediately when the private asset is erased', async () => {
  const p = await photoComplete();
  await run(assets, (tx) =>
    createPhotoAssetRepository(assets, 'synthetic-private', 'synthetic-k1').deleting(
      tx,
      p.sanitized.id,
    ),
  );
  expect(
    await run(owner, (tx) => createPhotoOwnerRepository(owner).candidates(tx, p.s.ownerId!, p.id)),
  ).toEqual([]);
});

async function attached() {
  const t = await published({ shared: true }),
    identity = (await f.owner()).identity,
    report = await f.report(identity),
    auth = await scope({ owner: identity.subjectId }),
    input = {
      reportId: report.head.id,
      version: 1,
      expectedRevision: 0n,
      artifactId: t.artifact.id,
      scopeId: t.s.id,
      ownerId: identity.subjectId,
      kind: 'shared' as const,
      authorizationScopeId: auth.id,
      permissionRevision: auth.permissionRevision,
      subjectRevision: auth.subjectRevision!,
    },
    r = createAIAttachmentRepository(worker);
  const revision = await run(worker, (tx) => r.append(tx, input));
  return { ...t, identity, report, auth, input, revision };
}
async function send(t: Awaited<ReturnType<typeof attached>>) {
  const id = uuid('send'),
    contact = await f.contact(),
    template = await f.template();
  await f.admin.query(
    `INSERT INTO email.email_sends(id,kind,recipient_contact_id,owner_subject_id,report_id,report_version,template_id,send_after,cancel_deadline,provider_key,provider,requested_purposes,dispatch_policy_version,authorized_consent_revision) VALUES($1,'report',$2,$3,$4,1,$5,now()+interval '120 seconds',now()+interval '120 seconds',$1::uuid::text,'synthetic','["report"]','synthetic-v1',1)`,
    [id, contact.value.id, t.identity.subjectId, t.report.head.id, template],
  );
  return id;
}
it('attaches shared generic output with separate owner authorization and optimistic report revisions', async () => {
  const t = await attached(),
    r = createAIAttachmentRepository(reader);
  expect(
    (await run(reader, (tx) => r.report(tx, t.identity.subjectId, t.report.head.id, 1)))?.revision,
  ).toBe(1n);
  const other = (await f.owner()).identity.subjectId;
  expect(await run(reader, (tx) => r.report(tx, other, t.report.head.id, 1))).toBeNull();
  await denied(worker, (tx) => createAIAttachmentRepository(worker).append(tx, t.input));
});
it('freezes one immutable artifact or explicit fallback on a matching scheduled send', async () => {
  const t = await attached(),
    id = await send(t),
    r = createAIAttachmentRepository(worker),
    input = {
      sendId: id,
      ownerId: t.identity.subjectId,
      reportId: t.report.head.id,
      version: 1,
      attachmentRevision: t.revision,
      fallback: null,
    };
  await run(worker, (tx) => r.freeze(tx, input));
  await run(worker, (tx) => r.freeze(tx, input));
  await denied(worker, (tx) =>
    r.freeze(tx, { ...input, attachmentRevision: null, fallback: 'unavailable' }),
  );
  const fallback = await send(t);
  await run(worker, (tx) =>
    r.freeze(tx, {
      ...input,
      sendId: fallback,
      attachmentRevision: null,
      fallback: 'not_requested',
    }),
  );
});
it('refuses a frozen selection with a mismatching send report version', async () => {
  const t = await attached(),
    id = await send(t);
  await denied(worker, (tx) =>
    createAIAttachmentRepository(worker).freeze(tx, {
      sendId: id,
      ownerId: t.identity.subjectId,
      reportId: t.report.head.id,
      version: 2,
      attachmentRevision: null,
      fallback: 'unavailable',
    }),
  );
});
async function operator() {
  const id = uuid('staff');
  await f.admin.query(
    "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$1::uuid::text,'active',now())",
    [id],
  );
  await f.admin.query(
    "INSERT INTO admin.staff_role_assignments(staff_id,role_id,granted_at) SELECT $1,id,now() FROM admin.roles WHERE code='data_operator'",
    [id],
  );
  return id;
}
async function template() {
  const person = await operator(),
    repo = createCsvReviewRepository(csv),
    input = {
      id: uuid('csv_template'),
      key: 'synthetic_' + randomUUID().replaceAll('-', ''),
      version: 1,
      sourceKind: 'synthetic_ai',
      schemaVersion: 's1',
      mappingVersion: 'm1',
      parserRevision: 'a'.repeat(40),
      definitionHash: hash(),
      columns: [{ name: 'brand', type: 'text' as const, required: true }],
      maxBytes: 20971520,
      maxRows: 100000,
      state: 'active' as const,
    },
    t = await run(csv, (tx) => repo.createTemplate(tx, person, input));
  return { person, t, input };
}
async function csvAsset(purpose = 'import_source') {
  const id = uuid('asset'),
    digest = hash();
  await f.admin.query(
    `INSERT INTO app.object_assets(id,purpose,bucket,object_key,mime_type,state,sha256,size_bytes,object_version,key_version,expires_at) VALUES($1,$2,'synthetic-private','assets/'||$1::uuid::text,'text/csv','ready',$3,1024,'v1','synthetic-k1',now()+interval '31 days')`,
    [id, purpose, digest],
  );
  return { id, hash: digest };
}
async function intake() {
  const { person, t } = await template(),
    reviewer = await operator(),
    src = await source(),
    asset = await csvAsset(),
    id = uuid('csv_intake'),
    runId = uuid('import_run'),
    job = uuid('job'),
    dataset = (
      await f.admin.query('SELECT checksum FROM app.dataset_versions WHERE id=$1', [src.dataset])
    ).rows[0]!,
    head = BigInt(
      (await f.admin.query("SELECT revision FROM app.market_dataset_heads WHERE market='US'"))
        .rows[0]?.revision ?? 0,
    );
  await f.admin.query(
    `INSERT INTO app.import_runs(id,provider_id,asset_id,status,started_at,upstream_run_key,mode,mapping_version,content_hash,schema_version,requested_by,expected_head_revision,dataset_version_id) VALUES($1,$2,$3,'registered',now(),$1::uuid::text,'manual','m1',$4,'s1',$5,$6,$7)`,
    [runId, src.provider, asset.id, dataset.checksum, person, head.toString(), src.dataset],
  );
  await f.admin.query(
    "INSERT INTO app.job_runs(id,job_type,business_key,schema_version,resource_id,deadline_at) VALUES($1,'p2.csv.validate',$2::uuid::text,1,$2,clock_timestamp()+interval '1 hour')",
    [job, id],
  );
  const input = {
    id,
    templateId: t.id,
    runId,
    jobId: job,
    providerId: src.provider,
    licenseId: src.license,
    market: 'US',
    assetId: asset.id,
    rawHash: asset.hash,
    packetHash: String(dataset.checksum),
    expiresAt: time(29 * 86400000),
  };
  await run(csv, (tx) => createCsvReviewRepository(csv).intake(tx, person, input));
  return { person, reviewer, t, src, asset, id, runId, job, head, input };
}
async function preview() {
  const t = await intake();
  await f.admin.query("UPDATE app.import_runs SET status='validated' WHERE id=$1", [t.runId]);
  const ids: Id<'import_artifact'>[] = [];
  for (const kind of ['diff', 'validation']) {
    const a = await csvAsset('import_evidence'),
      id = uuid('import_artifact');
    await f.admin.query(
      "INSERT INTO app.import_artifacts(id,run_id,kind,asset_id,checksum,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 day')",
      [id, t.runId, kind, a.id, a.hash],
    );
    ids.push(id);
  }
  const row = (
      await f.admin.query('SELECT revision,fence FROM app.import_runs WHERE id=$1', [t.runId])
    ).rows[0]!,
    role = (
      await f.admin.query('SELECT role_revision FROM admin.staff_identities WHERE id=$1', [
        t.reviewer,
      ])
    ).rows[0]!,
    input = {
      id: uuid('csv_review'),
      intakeId: t.id,
      runRevision: rev(BigInt(row.revision)),
      fence: BigInt(row.fence),
      expectedHead: t.head,
      diffId: ids[0]!,
      validationId: ids[1]!,
      reviewerId: t.reviewer,
      roleRevision: rev(BigInt(role.role_revision)),
      decision: 'approved' as const,
      reason: 'synthetic_review',
    };
  return { ...t, input };
}
it('persists declarative templates and enforces operator authority', async () => {
  const t = await template(),
    r = createCsvReviewRepository(csv);
  expect(await run(csv, (tx) => r.template(tx, t.person, t.t.id))).toEqual(t.t);
  await denied(csv, (tx) => r.template(tx, uuid('staff'), t.t.id));
  await run(csv, (tx) => r.retire(tx, t.person, t.t.id));
  expect((await run(csv, (tx) => r.template(tx, t.person, t.t.id)))?.state).toBe('retired');
});
it('admits a CSV by linking existing private run/job/source metadata and exposes workflow counts', async () => {
  const t = await intake(),
    result = await run(csv, (tx) =>
      createCsvReviewRepository(csv).workflows(tx, t.person, page(100)),
    );
  expect(result.items.find((x) => x.id === t.id)).toMatchObject({
    status: 'registered',
    jobState: 'pending',
    accepted: 0n,
    rejected: 0n,
    current: true,
  });
});
it('returns private diff/validation asset projections for use by the existing objects port', async () => {
  const t = await preview(),
    e = await run(csv, (tx) => createCsvReviewRepository(csv).evidence(tx, t.reviewer, t.id));
  expect(e.map((x) => x.kind)).toEqual(['diff', 'validation']);
  expect(e.every((x) => x.asset.state === 'ready' && x.asset.sha256.length === 64)).toBe(true);
});
it('records independent review against current run/head and invalidates approval on role revision', async () => {
  const t = await preview(),
    r = createCsvReviewRepository(csv);
  expect(await run(csv, (tx) => r.review(tx, t.reviewer, t.input))).toEqual(t.input);
  expect((await run(csv, (tx) => r.approval(tx, t.person, t.id)))?.id).toBe(t.input.id);
  await f.admin.query(
    'UPDATE admin.staff_identities SET role_revision=role_revision+1 WHERE id=$1',
    [t.reviewer],
  );
  expect(await run(csv, (tx) => r.approval(tx, t.person, t.id))).toBeNull();
});
it('refuses self-review and a stale import revision', async () => {
  const t = await preview(),
    r = createCsvReviewRepository(csv);
  await denied(csv, (tx) => r.review(tx, t.person, { ...t.input, reviewerId: t.person }));
  await denied(csv, (tx) =>
    r.review(tx, t.reviewer, { ...t.input, runRevision: rev(t.input.runRevision + 1n) }),
  );
});
it('removes expired private evidence from current review projections', async () => {
  const t = await preview(),
    r = createCsvReviewRepository(csv),
    e = await run(csv, (tx) => r.evidence(tx, t.reviewer, t.id));
  await f.admin.query("UPDATE app.object_assets SET state='deleting' WHERE id=$1", [
    e[0]!.asset.id,
  ]);
  expect((await run(csv, (tx) => r.evidence(tx, t.reviewer, t.id))).map((x) => x.kind)).toEqual([
    'validation',
  ]);
  await denied(csv, (tx) => r.review(tx, t.reviewer, t.input));
});
async function rights(person: Id<'subject'>, kind: 'delete' | 'restrict' = 'delete') {
  const id = uuid('privacy_request'),
    repo = createPrivacyServiceRepository(privacy, 'synthetic-private', ['synthetic-k1']);
  await run(privacy, (tx) =>
    repo.create(tx, {
      id,
      subjectId: person,
      targetKind: 'subject',
      targetId: person,
      kind,
      jurisdiction: 'synthetic',
      policyVersion: 'p2-local',
      policy: { responseDays: 14, escalationDays: 2, proofMinutes: 30, maxAttempts: 3 },
      dueAt: time(14 * 86400000),
      proofExpiresAt: time(),
      proof: { keyVersion: 'synthetic', digest: hash() },
      reply: null,
      verified: true,
      restoreRunId: null,
      ownerProof: null,
    }),
  );
  await run(privacy, (tx) => repo.journaled(tx, id, hash()));
  await f.admin.query(
    'UPDATE privacy.request_work SET barrier_until=clock_timestamp() WHERE request_id=$1',
    [id],
  );
  const lease = await run(privacy, (tx) => repo.lease(tx, id));
  if (!lease) throw Error('Owned synthetic lease');
  return lease;
}
const privacyRepo = () =>
  createAnalysisPrivacyRepository(privacy, 'synthetic-private', ['synthetic-k1']);
it('restricts photo authority and enumerates bounded P1 object locations under a verified journaled rights lease', async () => {
  const p = await readyPhoto(),
    l = await rights(p.s.ownerId!),
    r = privacyRepo();
  await run(privacy, (tx) => r.restrict(tx, l));
  const a = await run(privacy, (tx) => r.assets(tx, l, page(1)));
  expect(a.items).toHaveLength(1);
  expect(a.next).not.toBeNull();
  expect((await run(privacy, (tx) => r.assets(tx, l, page(1, a.next)))).items).toHaveLength(1);
  expect(
    await run(owner, (tx) => createPhotoOwnerRepository(owner).status(tx, p.s.ownerId!, p.id)),
  ).toBeNull();
});
it('refuses SQL photo erasure until P1 object receipts exist, then purges only the owning scope', async () => {
  const p = await readyPhoto(),
    other = await readyPhoto(),
    l = await rights(p.s.ownerId!),
    r = privacyRepo(),
    p1 = createPrivacyServiceRepository(privacy, 'synthetic-private', ['synthetic-k1']);
  await run(privacy, (tx) => r.restrict(tx, l));
  await denied(privacy, (tx) => r.erase(tx, l, p.s.id));
  const a = await run(privacy, (tx) => r.assets(tx, l, page(100)));
  for (const asset of a.items)
    await run(privacy, (tx) => p1.receipt(tx, l, 'objects', asset.id, hash()));
  expect(await run(privacy, (tx) => r.erase(tx, l, p.s.id))).toBe(true);
  expect(await run(privacy, (tx) => r.erase(tx, l, p.s.id))).toBe(true);
  expect(
    (
      await run(owner, (tx) =>
        createPhotoOwnerRepository(owner).status(tx, other.s.ownerId!, other.id),
      )
    )?.state,
  ).toBe('ready');
});
it('refuses a stale rights token, missing journal evidence and expired leases', async () => {
  const p = await readyPhoto(),
    l = await rights(p.s.ownerId!),
    r = privacyRepo();
  await denied(privacy, (tx) => r.restrict(tx, { ...l, token: uuid('lease') }));
  await f.admin.query(
    "UPDATE privacy.fulfillment_steps SET status='pending' WHERE request_id=$1 AND store='journal'",
    [l.id],
  );
  await denied(privacy, (tx) => r.restrict(tx, l));
  await f.admin.query(
    "UPDATE privacy.fulfillment_steps SET status='completed' WHERE request_id=$1 AND store='journal'",
    [l.id],
  );
  await f.admin.query(
    "UPDATE privacy.request_work SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=$1",
    [l.id],
  );
  await denied(privacy, (tx) => r.restrict(tx, l));
});
it('preserves uncertain costs and refuses SQL purge until definitive reconciliation', async () => {
  const t = await started(),
    l = await rights(t.s.ownerId!),
    r = privacyRepo();
  await run(privacy, (tx) => r.restrict(tx, l));
  await denied(privacy, (tx) => r.erase(tx, l, t.s.id));
  expect(
    (
      await f.admin.query(
        'SELECT state,reserved_minor FROM app.ai_budget_reservations WHERE attempt_id=$1',
        [t.a.id],
      )
    ).rows[0],
  ).toEqual({ state: 'uncertain', reserved_minor: '100' });
});
it('preserves historical spent totals while removing a settled owner graph and retaining shared data', async () => {
  const t = await published(),
    shared = await published({ shared: true }),
    l = await rights(t.s.ownerId!),
    r = privacyRepo();
  await run(worker, (tx) =>
    createAIBudgetRepository(worker).reconcile(tx, t.a.id, {
      state: 'settled',
      costMinor: 60n,
      reason: null,
      evidenceId: null,
    }),
  );
  await run(privacy, (tx) => r.restrict(tx, l));
  expect(await run(privacy, (tx) => r.erase(tx, l, t.s.id))).toBe(true);
  expect(
    (
      await f.admin.query(
        'SELECT spent_minor,reserved_minor FROM app.ai_budget_windows WHERE id=$1',
        [t.b],
      )
    ).rows[0],
  ).toEqual({ spent_minor: '60', reserved_minor: '0' });
  expect(
    (await run(worker, (tx) => createAIArtifactRepository(worker).current(tx, shared.artifact.id)))
      ?.id,
  ).toBe(shared.artifact.id);
  await denied(privacy, (tx) => r.erase(tx, l, shared.s.id));
});
it('respects legal retention holds before returning objects or purging SQL', async () => {
  const p = await readyPhoto(),
    l = await rights(p.s.ownerId!),
    r = privacyRepo();
  await run(privacy, (tx) => r.restrict(tx, l));
  await f.admin.query(
    "INSERT INTO privacy.legal_holds(subject_id,resource_kind,reason_code,approved_by,review_after) VALUES($1,'subject','synthetic_hold',$2,now()+interval '1 day')",
    [p.s.ownerId, f.staff],
  );
  await denied(privacy, (tx) => r.assets(tx, l, page()));
  await denied(privacy, (tx) => r.erase(tx, l, p.s.id));
});
it('allows a restriction-only request to withdraw AI while refusing destructive object/SQL stages', async () => {
  const s = await scope(),
    l = await rights(s.ownerId!, 'restrict'),
    r = privacyRepo();
  await run(privacy, (tx) => r.restrict(tx, l));
  await denied(privacy, (tx) => r.assets(tx, l, page()));
  await denied(privacy, (tx) => r.erase(tx, l, s.id));
});
it('rejects swapped-owner scope erasure and private asset bucket mismatch', async () => {
  const p = await readyPhoto(),
    other = await scope(),
    l = await rights(p.s.ownerId!),
    r = privacyRepo();
  await run(privacy, (tx) => r.restrict(tx, l));
  await denied(privacy, (tx) => r.erase(tx, l, other.id));
  await denied(privacy, (tx) =>
    createAnalysisPrivacyRepository(privacy, 'wrong-bucket', ['synthetic-k1']).assets(
      tx,
      l,
      page(),
    ),
  );
});

it('keeps composed repository operations on exactly one checked-out connection', async () => {
  const s = await scope(),
    r = await request(s),
    pool = f.analysisPool('tt_p2_ai_worker', 1);
  let checkouts = 0;
  const a = createTransactions({
      async connect() {
        checkouts++;
        return pool.connect();
      },
    }),
    repo = createAIRequestRepository(a);
  await run(a, async (tx) => {
    const before = (await a.query(tx, 'SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    expect((await repo.get(tx, r.id))?.id).toBe(r.id);
    await createAIReuseRepository(a).claim(tx, s.id, r.digest, uuid('ai_holder'), 120);
    expect((await a.query(tx, 'SELECT pg_backend_pid() AS pid')).rows[0]!.pid).toBe(before);
  });
  expect(checkouts).toBe(1);
  expect(pool.totalCount).toBe(1);
});
it('refuses expired and foreign transaction capabilities', async () => {
  const s = await scope(),
    r = await request(s),
    repo = createAIRequestRepository(worker);
  let expired: Tx | undefined;
  await run(worker, async (tx) => {
    expired = tx;
    return true;
  });
  await expect(repo.get(expired!, r.id)).rejects.toMatchObject({
    failure: { code: 'transaction_context' },
  });
  await denied(reader, (tx) => repo.get(tx, r.id));
});
it('retains restricted roles and emits local repository evidence without activation claims', async () => {
  const roles = (
    await f.admin.query(
      'SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1)',
      [analysisRoles],
    )
  ).rows;
  expect(roles).toHaveLength(analysisRoles.length);
  for (const r of roles)
    expect([r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  console.log(
    'P2_ANALYSIS_REPOSITORY_EVIDENCE ' +
      JSON.stringify({
        actualPostgreSQL: true,
        migrations: 45,
        newTables: 0,
        oneConnectionPerTransaction: true,
        photoSealAndCandidatesSameTransaction: true,
        p1PrivacyLeaseAndReceipts: true,
        actualS1Approval: false,
        actualS2Approval: false,
        productionWiring: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
});

it('projects the existing fetching and staging import statuses through the typed workflow', async () => {
  const t = await intake(),
    r = createCsvReviewRepository(csv);
  for (const state of ['fetching', 'staging']) {
    await f.admin.query('UPDATE app.import_runs SET status=$2 WHERE id=$1', [t.runId, state]);
    expect(
      (await run(csv, (tx) => r.workflows(tx, t.person, page(100)))).items.find(
        (x) => x.id === t.id,
      )?.status,
    ).toBe(state);
  }
});
it('requires exact immutable release reason and evidence on a repeated budget reconciliation', async () => {
  const t = await attempt(await scope()),
    b = await budget(t.s),
    repo = createAIBudgetRepository(worker);
  await run(worker, (tx) => repo.reserve(tx, t.a.id, [{ id: b, amountMinor: 100n }]));
  const evidence = uuid('audit_event'),
    other = uuid('audit_event');
  for (const id of [evidence, other])
    await f.admin.query(
      "INSERT INTO admin.audit_events(id,action,resource_kind,result,occurred_at,field_names) VALUES($1,'synthetic_release','ai_attempt','succeeded',clock_timestamp(),'[]')",
      [id],
    );
  const input = {
    state: 'released' as const,
    costMinor: null,
    reason: 'not_dispatched' as const,
    evidenceId: evidence,
  };
  await run(worker, (tx) => repo.reconcile(tx, t.a.id, input));
  await run(worker, (tx) => repo.reconcile(tx, t.a.id, input));
  await denied(worker, (tx) => repo.reconcile(tx, t.a.id, { ...input, evidenceId: other }));
});
it('refuses a graph above the documented restriction bound without partial authority mutation', async () => {
  const s = await scope(),
    l = await rights(s.ownerId!);
  await f.admin.query(
    `INSERT INTO app.ai_analysis_requests(scope_id,owner_subject_id,policy_version_id,input_digest,input_manifest,request_key,notice_version,permission_revision,subject_permission_revision,invalidation_revision,expires_at) SELECT s.id,s.owner_subject_id,s.policy_version_id,app.ai_input_digest(s.id,s.policy_version_id,'local-jsonb-v1','{"parameters":{}}'),' {"parameters":{}}',n::text,g.notice_version,g.permission_revision,g.subject_permission_revision,g.invalidation_revision,now()+interval '120 seconds' FROM app.ai_reuse_scopes s JOIN app.ai_scope_guards g ON g.scope_id=s.id CROSS JOIN generate_series(1,1001) n WHERE s.id=$1`,
    [s.id],
  );
  await denied(privacy, (tx) => privacyRepo().restrict(tx, l));
  expect(
    (
      await f.admin.query('SELECT processing_allowed FROM app.ai_scope_guards WHERE scope_id=$1', [
        s.id,
      ])
    ).rows[0]?.processing_allowed,
  ).toBe(true);
});

it('finds source-affected scopes through an advice fact as well as its backing dataset', async () => {
  const t = await published({ advice: true }),
    r = createAIReuseRepository(worker);
  expect(t.src.fact).not.toBeNull();
  expect(
    (await run(worker, (tx) => r.affectedScopes(tx, { kind: 'advice', id: t.src.fact! }, page())))
      .items,
  ).toEqual([t.s.id]);
  expect(
    (
      await run(worker, (tx) =>
        r.affectedScopes(tx, { kind: 'dataset', id: t.src.dataset }, page()),
      )
    ).items,
  ).toEqual([t.s.id]);
});
it('purges owner authorization and frozen links to shared output while retaining the shared artifact', async () => {
  const t = await attached(),
    sendId = await send(t),
    r = createAIAttachmentRepository(worker);
  await run(worker, (tx) =>
    r.freeze(tx, {
      sendId,
      ownerId: t.identity.subjectId,
      reportId: t.report.head.id,
      version: 1,
      attachmentRevision: t.revision,
      fallback: null,
    }),
  );
  const l = await rights(t.identity.subjectId);
  await run(privacy, (tx) => privacyRepo().restrict(tx, l));
  expect(await run(privacy, (tx) => privacyRepo().erase(tx, l, t.auth.id))).toBe(true);
  expect(
    (await run(worker, (tx) => createAIArtifactRepository(worker).current(tx, t.artifact.id)))?.id,
  ).toBe(t.artifact.id);
  expect(
    (
      await f.admin.query('SELECT send_id FROM email.analysis_selections WHERE send_id=$1', [
        sendId,
      ])
    ).rowCount,
  ).toBe(0);
});

it('serializes opposite-order multi-window privacy withdrawal through common sorted budget locks', async () => {
  const first = await attempt(await scope()),
    person = (await f.owner()).identity.subjectId,
    secondScope = await run(staff, (tx) =>
      createAIScopeRepository(staff).create(tx, {
        id: uuid('ai_scope'),
        policyId: first.s.policyId,
        ownerId: person,
        key: randomUUID(),
        subjectRevision: rev(),
        noticeVersion: 'v1',
        evidenceHash: hash(),
      }),
    ),
    second = await attempt(secondScope),
    windows = [await budget(first.s), await budget(first.s)].sort(),
    requests = createAIRequestRepository(worker);
  // Opposite physical reservation order plus a bounded pause exposes the former unordered UPDATE deadlock.
  for (const [index, t] of [first, second].entries()) {
    for (const b of index === 0 ? windows : windows.toReversed())
      await f.admin.query(
        "INSERT INTO app.ai_budget_reservations(budget_id,attempt_id,policy_version_id,currency_code,reserved_minor) VALUES($1,$2,$3,'USD',100)",
        [b, t.a.id, t.s.policyId],
      );
    await run(worker, (tx) => requests.transition(tx, t.r.id, 'queued', 'running'));
    await run(worker, (tx) => requests.start(tx, t.a.id));
  }
  const leases = await Promise.all([first, second].map((t) => rights(t.s.ownerId!))),
    r = privacyRepo();
  await f.admin.query(
    `CREATE FUNCTION app.analysis_fixture_budget_pause() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.id IN('${windows[0]}','${windows[1]}') THEN PERFORM pg_sleep(0.08); END IF; RETURN NEW;END $$;CREATE TRIGGER zz_analysis_fixture_budget_pause BEFORE UPDATE ON app.ai_budget_windows FOR EACH ROW EXECUTE FUNCTION app.analysis_fixture_budget_pause()`,
  );
  try {
    await Promise.all(
      leases.map((l) =>
        run(privacy, async (tx) => {
          await privacy.query(tx, 'SET LOCAL enable_indexscan=off');
          await privacy.query(tx, 'SET LOCAL enable_bitmapscan=off');
          await r.restrict(tx, l);
        }),
      ),
    );
    expect(
      (
        await f.admin.query(
          'SELECT state FROM app.ai_budget_reservations WHERE attempt_id=ANY($1)',
          [[first.a.id, second.a.id]],
        )
      ).rows.map((x) => x.state),
    ).toEqual(['uncertain', 'uncertain', 'uncertain', 'uncertain']);
    expect(
      (
        await f.admin.query('SELECT reserved_minor FROM app.ai_budget_windows WHERE id=ANY($1)', [
          windows,
        ])
      ).rows.map((x) => x.reserved_minor),
    ).toEqual(['200', '200']);
  } finally {
    await f.admin.query(
      'DROP TRIGGER zz_analysis_fixture_budget_pause ON app.ai_budget_windows;DROP FUNCTION app.analysis_fixture_budget_pause()',
    );
  }
});
it('cancels an in-flight photo attempt while preserving every unresolved budget hold', async () => {
  const p = await photoStarted(),
    r = createAIRequestRepository(photoWorker),
    a = await run(photoWorker, (tx) =>
      r.attempt(tx, { id: uuid('ai_attempt'), requestId: p.r.id, ordinal: 1, currency: 'USD' }),
    ),
    windows = [await budget(p.s), await budget(p.s)];
  await run(photoWorker, (tx) =>
    createAIBudgetRepository(photoWorker).reserve(
      tx,
      a.id,
      windows.map((id) => ({ id, amountMinor: 100n })),
    ),
  );
  await run(photoWorker, (tx) => r.transition(tx, p.r.id, 'queued', 'running'));
  await run(photoWorker, (tx) => r.start(tx, a.id));
  await run(photoWorker, (tx) =>
    createPhotoWorkerRepository(photoWorker).cancel(tx, p.s.ownerId!, p.e.id),
  );
  expect(
    (
      await f.admin.query('SELECT state FROM app.ai_budget_reservations WHERE attempt_id=$1', [
        a.id,
      ])
    ).rows.map((x) => x.state),
  ).toEqual(['uncertain', 'uncertain']);
  expect(
    (await f.admin.query('SELECT state FROM app.ai_analysis_requests WHERE id=$1', [p.r.id]))
      .rows[0]?.state,
  ).toBe('uncertain');
});
