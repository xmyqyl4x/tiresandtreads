import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { analysisRepositoryFixture } from '../fixtures/phase2/analysis-repositories.ts';
import { createTransactions } from '../../packages/db/src/transactions.ts';
import { createAIScopeRepository } from '../../packages/db/src/repositories/analysis-scope.ts';
import { createAIRequestRepository } from '../../packages/db/src/repositories/analysis-requests.ts';
import { createAIReuseRepository } from '../../packages/db/src/repositories/analysis-reuse.ts';
import { createAIBudgetRepository } from '../../packages/db/src/repositories/analysis-budgets.ts';
import { createAnalysisPrivacyRepository } from '../../packages/db/src/repositories/analysis-privacy.ts';
import { createPrivacyServiceRepository } from '../../packages/db/src/repositories/privacy-services.ts';
import {
  id,
  revision,
  instant,
  ok,
  type Result,
  type Id,
} from '../../packages/domain/src/values/core.ts';
import type { TransactionContext as Tx } from '../../packages/application/src/ports/transactions.ts';
let f: Awaited<ReturnType<typeof analysisRepositoryFixture>>;
type Adapter = ReturnType<typeof f.analysisAdapter>;
let worker: Adapter, staff: Adapter, privacy: Adapter;
function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw Error(JSON.stringify(r.error));
  return r.value;
}
const uid = <K extends string>(kind: K) => value(id(kind, randomUUID()));
const rev = () => value(revision('1'));
const hash = () => randomBytes(32).toString('hex');
const at = () => value(instant(new Date(Date.now() + 86400000).toISOString()));
async function run<T>(a: Adapter, work: (tx: Tx) => Promise<T>) {
  return value(await a.unitOfWork.run(async (tx) => ok(await work(tx))));
}
beforeAll(async () => {
  f = await analysisRepositoryFixture();
  worker = f.analysisAdapter('tt_p2_ai_worker', 4);
  staff = f.analysisAdapter('tt_p2_ai_staff');
  privacy = f.privacyAdapter();
}, 60000);
afterAll(async () => {
  await f?.cleanup();
}, 60000);
async function policy() {
  const p = uid('ai_policy');
  await f.admin.query(
    "INSERT INTO app.ai_policy_versions(id,task,provider,model_id,prompt_version,schema_version,validator_version,canonical_version,configuration_hash,status,reviewed_by,reviewed_at) VALUES($1,'report_analysis','synthetic','no-model-call','p1','s1','v1','local-jsonb-v1',$2,'active',$3,clock_timestamp())",
    [p, hash(), f.staff],
  );
  return p;
}
async function scope(policyId?: Id<'ai_policy'>) {
  policyId ??= await policy();
  const owner = await f.owner();
  return run(staff, (tx) =>
    createAIScopeRepository(staff).create(tx, {
      id: uid('ai_scope'),
      policyId,
      ownerId: owner.identity.subjectId,
      key: randomUUID(),
      subjectRevision: rev(),
      noticeVersion: 'local-synthetic',
      evidenceHash: hash(),
    }),
  );
}
async function request(s: Awaited<ReturnType<typeof scope>>) {
  return run(worker, (tx) =>
    createAIRequestRepository(worker).create(tx, {
      id: uid('ai_request'),
      scopeId: s.id,
      key: randomUUID(),
      manifest: { parameters: { usage: 'commute' } },
      deadlineSeconds: 120,
    }),
  );
}
async function attempt(s: Awaited<ReturnType<typeof scope>>) {
  const r = await request(s);
  const a = await run(worker, (tx) =>
    createAIRequestRepository(worker).attempt(tx, {
      id: uid('ai_attempt'),
      requestId: r.id,
      ordinal: 1,
      currency: 'USD',
    }),
  );
  return { s, r, a };
}
async function rights(subjectId: Id<'subject'>) {
  const repo = createPrivacyServiceRepository(privacy, 'synthetic-private', ['synthetic-k1']),
    requestId = uid('privacy_request');
  await run(privacy, (tx) =>
    repo.create(tx, {
      id: requestId,
      subjectId,
      targetKind: 'subject',
      targetId: subjectId,
      kind: 'delete',
      jurisdiction: 'synthetic',
      policyVersion: 'local-s2',
      policy: { responseDays: 14, escalationDays: 2, proofMinutes: 30, maxAttempts: 3 },
      dueAt: at(),
      proofExpiresAt: at(),
      proof: { keyVersion: 'synthetic', digest: hash() },
      reply: null,
      verified: true,
      restoreRunId: null,
      ownerProof: null,
    }),
  );
  await run(privacy, (tx) => repo.journaled(tx, requestId, hash()));
  await f.admin.query(
    'UPDATE privacy.request_work SET barrier_until=clock_timestamp() WHERE request_id=$1',
    [requestId],
  );
  const l = await run(privacy, (tx) => repo.lease(tx, requestId));
  if (!l) throw Error('Synthetic lease required');
  return l;
}
it('preserves the P1 owner report before and after bounded local P2 writes', async () => {
  const person = await f.owner(),
    report = await f.report(person.identity);
  const before = await run(f.scope, (tx) =>
    f.reports.version(tx, person.identity, report.head.id, 1),
  );
  await request(await scope());
  expect(
    await run(f.scope, (tx) => f.reports.version(tx, person.identity, report.head.id, 1)),
  ).toEqual(before);
  expect(before?.output).toEqual(report.version.output);
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM migration_meta.applied')).rows[0]?.n,
  ).toBe(45);
});
it('commits scope and request operations through one checked-out restricted connection', async () => {
  const s = await scope(),
    pool = f.analysisPool('tt_p2_ai_worker', 1);
  let checkouts = 0;
  const a = createTransactions({
    async connect() {
      checkouts++;
      return pool.connect();
    },
  });
  await run(a, async (tx) => {
    const pid = (await a.query(tx, 'SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    expect((await createAIScopeRepository(a).scope(tx, s.id))?.id).toBe(s.id);
    await createAIRequestRepository(a).create(tx, {
      id: uid('ai_request'),
      scopeId: s.id,
      key: randomUUID(),
      manifest: { parameters: {} },
      deadlineSeconds: 120,
    });
    expect((await a.query(tx, 'SELECT pg_backend_pid() AS pid')).rows[0]!.pid).toBe(pid);
  });
  expect(checkouts).toBe(1);
});
it('rolls back a new request and reuse claim when a caught repository failure poisons the unit of work', async () => {
  const s = await scope(),
    requestId = uid('ai_request'),
    repo = createAIRequestRepository(worker);
  let digest = '';
  const r = await worker.unitOfWork.run(async (tx) => {
    const added = await repo.create(tx, {
      id: requestId,
      scopeId: s.id,
      key: randomUUID(),
      manifest: { parameters: {} },
      deadlineSeconds: 120,
    });
    digest = added.digest;
    expect(
      await createAIReuseRepository(worker).claim(tx, s.id, digest, uid('ai_holder'), 120),
    ).not.toBeNull();
    try {
      await repo.attempt(tx, { id: uid('ai_attempt'), requestId, ordinal: 0, currency: 'USD' });
    } catch {
      /* A caught failure must still roll back both repositories. */
    }
    return ok(true);
  });
  expect(r.ok).toBe(false);
  expect(await run(worker, (tx) => repo.get(tx, requestId))).toBeNull();
  expect(
    (
      await f.admin.query('SELECT 1 FROM app.ai_reuse_entries WHERE scope_id=$1 AND cache_key=$2', [
        s.id,
        digest,
      ])
    ).rowCount,
  ).toBe(0);
});
it('uses an indexed point read on ten thousand synthetic requests under the worker role', async () => {
  const s = await scope(),
    repo = createAIRequestRepository(worker),
    target = await request(s);
  await f.admin.query(
    `INSERT INTO app.ai_analysis_requests(scope_id,owner_subject_id,policy_version_id,input_digest,input_manifest,request_key,notice_version,permission_revision,subject_permission_revision,invalidation_revision,expires_at) SELECT s.id,s.owner_subject_id,s.policy_version_id,app.ai_input_digest(s.id,s.policy_version_id,'local-jsonb-v1','{"parameters":{}}'),' {"parameters":{}}',n::text,g.notice_version,g.permission_revision,g.subject_permission_revision,g.invalidation_revision,now()+interval '120 seconds' FROM app.ai_reuse_scopes s JOIN app.ai_scope_guards g ON g.scope_id=s.id CROSS JOIN generate_series(1,10000) n WHERE s.id=$1`,
    [s.id],
  );
  await f.admin.query('ANALYZE app.ai_analysis_requests');
  expect((await run(worker, (tx) => repo.get(tx, target.id)))?.id).toBe(target.id);
  const rows = await run(worker, (tx) =>
    worker.query(
      tx,
      'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM app.ai_analysis_requests WHERE id=$1',
      [target.id],
    ),
  );
  const plan = (rows.rows[0]!['QUERY PLAN'] as { Plan: Record<string, unknown> }[])[0]!.Plan;
  expect(plan['Node Type']).toMatch(/Index/);
  expect(plan['Actual Rows']).toBe(1);
  expect(Number(plan['Shared Hit Blocks']) + Number(plan['Shared Read Blocks'])).toBeLessThan(40);
});
it('conserves two shared windows across twelve concurrent owners and preserves uncertain charges through privacy refusal', async () => {
  const p = await policy(),
    contenders = [];
  for (let i = 0; i < 12; i++) contenders.push(await attempt(await scope(p)));
  const windows = [uid('ai_budget'), uid('ai_budget')].sort();
  for (const b of windows)
    await f.admin.query(
      "INSERT INTO app.ai_budget_windows(id,policy_key,policy_version_id,window_start,window_end,currency_code,limit_minor) VALUES($1,$1::uuid::text,$2,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','USD',300)",
      [b, p],
    );
  const repo = createAIBudgetRepository(worker);
  const results = await Promise.all(
    contenders.map((t) =>
      worker.unitOfWork.run(async (tx) =>
        ok(
          await repo.reserve(
            tx,
            t.a.id,
            windows.toReversed().map((id) => ({ id, amountMinor: 100n })),
          ),
        ),
      ),
    ),
  );
  const winners = contenders.filter((_, i) => results[i]!.ok);
  expect(winners).toHaveLength(3);
  expect(results.filter((r) => !r.ok)).toHaveLength(9);
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM app.ai_budget_reservations WHERE budget_id=ANY($1)',
        [windows],
      )
    ).rows[0]?.n,
  ).toBe(6);
  for (const t of winners.slice(0, 2)) {
    const requests = createAIRequestRepository(worker);
    await run(worker, (tx) => requests.transition(tx, t.r.id, 'queued', 'running'));
    await run(worker, (tx) => requests.start(tx, t.a.id));
    await run(worker, (tx) =>
      requests.finish(tx, {
        id: t.a.id,
        state: 'succeeded',
        providerRequestId: null,
        inputTokens: 1n,
        outputTokens: 1n,
        costMinor: 60n,
        costStatus: 'reconciled',
        error: null,
      }),
    );
    await run(worker, (tx) =>
      repo.reconcile(tx, t.a.id, {
        state: 'settled',
        costMinor: 60n,
        reason: null,
        evidenceId: null,
      }),
    );
  }
  const t = winners[2]!;
  await run(worker, (tx) =>
    createAIRequestRepository(worker).transition(tx, t.r.id, 'queued', 'running'),
  );
  await run(worker, (tx) => createAIRequestRepository(worker).start(tx, t.a.id));
  const lease = await rights(t.s.ownerId!),
    bridge = createAnalysisPrivacyRepository(privacy, 'synthetic-private', ['synthetic-k1']);
  await run(privacy, (tx) => bridge.restrict(tx, lease));
  expect(
    (await privacy.unitOfWork.run(async (tx) => ok(await bridge.erase(tx, lease, t.s.id)))).ok,
  ).toBe(false);
  const before = (
    await f.admin.query(
      'SELECT reserved_minor,spent_minor FROM app.ai_budget_windows WHERE id=ANY($1) ORDER BY id',
      [windows],
    )
  ).rows;
  expect(before).toEqual([
    { reserved_minor: '100', spent_minor: '120' },
    { reserved_minor: '100', spent_minor: '120' },
  ]);
  await run(worker, (tx) =>
    repo.reconcile(tx, t.a.id, {
      state: 'settled',
      costMinor: 60n,
      reason: null,
      evidenceId: null,
    }),
  );
  expect(await run(privacy, (tx) => bridge.erase(tx, lease, t.s.id))).toBe(true);
  expect(
    (
      await f.admin.query(
        'SELECT reserved_minor,spent_minor FROM app.ai_budget_windows WHERE id=ANY($1) ORDER BY id',
        [windows],
      )
    ).rows,
  ).toEqual([
    { reserved_minor: '0', spent_minor: '180' },
    { reserved_minor: '0', spent_minor: '180' },
  ]);
  expect(
    (await run(worker, (tx) => createAIRequestRepository(worker).get(tx, winners[0]!.r.id)))?.id,
  ).toBe(winners[0]!.r.id);
}, 30000);
it('retains an unexpired lease across actual connection closure then replaces its fence after SQL expiry', async () => {
  const s = await scope(),
    r = await request(s),
    pool = f.analysisPool('tt_p2_ai_worker', 1),
    a = createTransactions(pool),
    old = await run(a, (tx) =>
      createAIReuseRepository(a).claim(tx, s.id, r.digest, uid('ai_holder'), 5),
    );
  expect(old).not.toBeNull();
  const connection = await pool.connect(),
    pid = (await connection.query('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
  connection.release(true);
  expect(pool.totalCount).toBe(0);
  let remaining = 1;
  for (let i = 0; i < 20 && remaining; i++) {
    await f.admin.query('SELECT pg_sleep(0.01)');
    remaining =
      (await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE pid=$1', [pid])).rowCount ?? 0;
  }
  expect(remaining).toBe(0);
  const repo = createAIReuseRepository(worker);
  expect(await run(worker, (tx) => repo.claim(tx, s.id, r.digest, uid('ai_holder'), 5))).toBeNull();
  await f.admin.query('SELECT pg_sleep(5.1)');
  const next = await run(worker, (tx) => repo.claim(tx, s.id, r.digest, uid('ai_holder'), 120));
  expect(next!.fence).toBe(old!.fence + 1n);
  expect(await run(worker, (tx) => repo.publish(tx, old!, uid('ai_artifact')))).toBe(false);
});
it('emits the local S2 validation boundary with no acceptance or service activation', () => {
  console.log(
    'P2_DATA_ACCESS_GATE_EVIDENCE ' +
      JSON.stringify({
        actualPostgreSQL: true,
        migrations: 45,
        syntheticRequests: 10000,
        budgetContenders: 12,
        budgetWinners: 3,
        budgetWindows: 2,
        actualConnectionClosure: true,
        p1Regression: true,
        rollbackAndPrivacyRefusal: true,
        actualS1Approval: false,
        actualS2Approval: false,
        servicesStarted: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
});
