import { it, expect, vi } from 'vitest';
import { createReportAnalysisServices } from '../../packages/application/src/analysis/report-analysis.ts';
import { ok, type Id, type Instant, type Revision } from '../../packages/domain/src/values/core.ts';
import type {
  TransactionContext,
  UnitOfWork,
} from '../../packages/application/src/ports/transactions.ts';
const owner = '11111111-1111-4111-8111-111111111111' as Id<'subject'>;
const report = '22222222-2222-4222-8222-222222222222' as Id<'report'>;
const policy = '33333333-3333-4333-8333-333333333333' as Id<'ai_policy'>;
const keys = [{ keyVersion: 'v1', digest: 'a'.repeat(64) }];
function fixture() {
  let active = 0;
  const deps = {
    uow: {
      async run(work) {
        active++;
        try {
          return await work({} as TransactionContext);
        } finally {
          active--;
        }
      },
    } as UnitOfWork,
    repository: {
      owner: vi.fn(async () => ({
        subjectId: owner,
        sessionId: report as string as Id<'owner_session'>,
      })),
      evidence: vi.fn(async () => ({
        market: 'US',
        locale: 'en-US',
        snapshotHash: 'a'.repeat(64),
        bundleId: report,
        ruleVersion: policy,
        engineVersion: '1.0.0',
        input: { strategy: 'year_round', winterUse: 'none', priorities: [] },
        output: { result: { picks: [], decisions: [] } },
        sources: [],
        subjectRevision: 1n as Revision,
        attachmentRevision: 0n,
      })),
      configuration: vi.fn(async () => null),
      scope: vi.fn(async () => null),
      subjectRevision: vi.fn(async () => 1n as Revision),
      enqueue: vi.fn(),
      work: vi.fn(async () => null),
      current: vi.fn(async () => true),
      output: vi.fn(async () => null),
      withdraw: vi.fn(),
    },
    scopes: {
      policy: vi.fn(),
      scope: vi.fn(),
      create: vi.fn(),
      choice: vi.fn(),
      invalidate: vi.fn(),
    },
    requests: {
      create: vi.fn(),
      get: vi.fn(),
      transition: vi.fn(),
      attempt: vi.fn(),
      start: vi.fn(),
      finish: vi.fn(),
    },
    artifacts: { publish: vi.fn(), current: vi.fn() },
    reuse: { claim: vi.fn(), publish: vi.fn(), current: vi.fn(), affectedScopes: vi.fn() },
    attachments: { append: vi.fn(), freeze: vi.fn(), report: vi.fn(), status: vi.fn() },
    budgets: { reserve: vi.fn(), reconcile: vi.fn() },
    admission: { plan: vi.fn() },
    jobs: {
      register: vi.fn(),
      lease: vi.fn(),
      fence: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      reconcile: vi.fn(),
    },
    provider: {
      analyze: vi.fn(async () => {
        expect(active).toBe(0);
        return {
          state: 'unavailable' as const,
          providerRequestId: null,
          inputTokens: null,
          outputTokens: null,
          costMinor: null,
        };
      }),
    },
    crypto: {
      id: <K extends string>(kind: K) => {
        void kind;
        return report as string as Id<K>;
      },
      hash: () => 'b'.repeat(64),
    },
    now: () => '2026-11-06T12:00:00.000Z' as Instant,
    noticeVersion: 'ai-processing-v1',
  };
  return { deps, service: createReportAnalysisServices(deps) };
}
const input = () => ({
  reportId: report,
  version: 1,
  policyId: policy,
  key: 'synthetic-command-0001',
  allowed: false,
  noticeVersion: 'ai-processing-v1',
});
it('keeps deterministic reports available when assistance is declined, without scope/job/model writes', async () => {
  const f = fixture();
  expect(await f.service.request(keys, input())).toEqual(
    ok({ id: null, state: 'not_requested', reportId: report, version: 1, output: null }),
  );
  expect(f.deps.scopes.create).not.toHaveBeenCalled();
  expect(f.deps.repository.enqueue).not.toHaveBeenCalled();
  expect(f.deps.provider.analyze).not.toHaveBeenCalled();
});
it('refuses unauthenticated assistance before report access', async () => {
  const f = fixture();
  f.deps.repository.owner.mockResolvedValue(null as never);
  expect((await f.service.request(keys, input())).ok).toBe(false);
  expect(f.deps.repository.evidence).not.toHaveBeenCalled();
});
it('refuses another owner or stale report version before processing choice', async () => {
  const f = fixture();
  f.deps.repository.evidence.mockResolvedValue(null as never);
  expect((await f.service.request(keys, input())).ok).toBe(false);
  expect(f.deps.scopes.create).not.toHaveBeenCalled();
});
it.each([
  { allowed: 'true' },
  { version: 0 },
  { reportId: 'bad' },
  { policyId: 'bad' },
  { key: 'short' },
  { noticeVersion: 'unreviewed' },
  { extra: true },
])('refuses malformed or changed-notice requests %#', async (change) => {
  const f = fixture();
  expect((await f.service.request(keys, { ...input(), ...change })).ok).toBe(false);
  expect(f.deps.repository.enqueue).not.toHaveBeenCalled();
});
it('returns assistance unavailable with no writes when no evaluated configuration exists', async () => {
  const f = fixture();
  expect(await f.service.request(keys, { ...input(), allowed: true })).toEqual(
    ok({ id: null, state: 'unavailable', reportId: report, version: 1, output: null }),
  );
  expect(f.deps.scopes.create).not.toHaveBeenCalled();
});
it('does not dispatch a missing job or expose provider internals', async () => {
  const f = fixture();
  expect((await f.service.execute(report)).ok).toBe(false);
  expect(f.deps.provider.analyze).not.toHaveBeenCalled();
});
it.each(['', null, {}, 'bad'])('refuses invalid request/status IDs %#', async (id) => {
  const f = fixture();
  expect((await f.service.execute(id)).ok).toBe(false);
  expect((await f.service.status(keys, id)).ok).toBe(false);
});
it('redacts unexpected storage errors', async () => {
  const f = fixture();
  f.deps.repository.owner.mockRejectedValue(Error('private credentials'));
  const r = await f.service.request(keys, input());
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain('credentials');
});

it('accepts the real deterministic engine result and retains its option ranks and numeric values', async () => {
  const { engineFixture, asOf } = await import('../fixtures/engine/base.ts');
  const { evaluate } = await import('../../packages/engine/src/evaluate.ts');
  const { buildAnalysisPacket } = await import('../../packages/domain/src/analysis-policy.ts');
  const { normalizeAssessment } = await import('../../packages/engine/src/input.ts');
  const f = engineFixture(),
    normalized = normalizeAssessment(f.request);
  if (!normalized.ok) throw Error('fixture');
  const result = evaluate(normalized.value, f.snapshot);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const r = buildAnalysisPacket(
    {
      market: 'US',
      locale: 'en-US',
      snapshotHash: 'a'.repeat(64),
      bundleId: f.snapshot.bundleId,
      ruleVersion: f.snapshot.policy.id,
      engineVersion: '1.0.0',
      input: f.request,
      output: { result: result.value },
      sources: f.snapshot.sources.map((s) => ({ id: s.datasetId, validUntil: s.validUntil })),
    },
    asOf,
  );
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.claims).toHaveLength(result.value.picks.length);
    expect(r.value.claims.map((c) => c.scoreBp)).toEqual(
      result.value.picks.map((id) => result.value.decisions.find((d) => d.id === id)!.scoreBp),
    );
  }
});
