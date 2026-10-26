import { it, expect, vi } from 'vitest';
import { createRecommendationService } from '../../packages/application/src/services/recommendations.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import { engineFixture, asOf } from '../fixtures/engine/base.ts';
it('normalizes once and uses a trusted pinned resolver without authorizing issuance', async () => {
  const f = engineFixture(),
    load = vi.fn(async () => ok(f.snapshot));
  const result = await createRecommendationService({ now: () => asOf, evidence: { load } }).assess(
    f.request,
  );
  expect(result).toMatchObject({
    ok: true,
    value: {
      purpose: 'technical_evaluation',
      issuanceAuthorized: false,
      picks: [f.snapshot.plans[0]!.id],
    },
  });
  expect(load).toHaveBeenCalledOnce();
  expect(load.mock.calls[0]).toEqual([expect.objectContaining({ market: 'US' }), asOf]);
});
it('refuses invalid or commercially extended driver inputs before loading evidence', async () => {
  const load = vi.fn();
  const result = await createRecommendationService({ now: () => asOf, evidence: { load } }).assess({
    ...engineFixture().request,
    affiliateCommission: 1,
  });
  expect(result).toMatchObject({ error: { code: 'invalid_input' } });
  expect(load).not.toHaveBeenCalled();
});
it('propagates source and policy resolver failures and redacts unexpected exceptions', async () => {
  const f = engineFixture();
  for (const code of ['forbidden', 'unavailable'] as const)
    expect(
      await createRecommendationService({
        now: () => asOf,
        evidence: { load: async () => fail(failure(code)) },
      }).assess(f.request),
    ).toMatchObject({ error: { code } });
  expect(
    await createRecommendationService({
      now: () => asOf,
      evidence: {
        load: async () => {
          throw Error('private source details');
        },
      },
    }).assess(f.request),
  ).toEqual({ ok: false, error: failure('unavailable') });
});
it('rejects invalid clocks, inconsistent snapshot times and invalid policies', async () => {
  const f = engineFixture(),
    evidence = { load: async () => ok(f.snapshot) };
  expect(
    await createRecommendationService({ now: () => 'invalid', evidence }).assess(f.request),
  ).toMatchObject({ error: { code: 'internal' } });
  expect(
    await createRecommendationService({ now: () => '2026-10-25T13:00:00.000Z', evidence }).assess(
      f.request,
    ),
  ).toMatchObject({ error: { code: 'integrity' } });
  f.snapshot.policy.weights = {};
  expect(
    await createRecommendationService({ now: () => asOf, evidence }).assess(f.request),
  ).toMatchObject({ error: { code: 'integrity' } });
});
