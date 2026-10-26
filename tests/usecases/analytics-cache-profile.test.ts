import { it, expect } from 'vitest';
import { createRecommendationService } from '../../packages/application/src/services/recommendations.ts';
import { engineFixture, asOf } from '../fixtures/engine/base.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
it('profiles repeated uncached technical evaluations with exact output parity; no optional cache is activated', async () => {
  const f = engineFixture(),
    service = createRecommendationService({
      now: () => asOf,
      evidence: { load: async () => ok(f.snapshot) },
    }),
    reference = await service.assess(f.request),
    times: number[] = [];
  for (let n = 0; n < 200; n++) {
    const start = performance.now();
    const result = await service.assess(f.request);
    times.push(performance.now() - start);
    expect(result).toEqual(reference);
  }
  times.sort((a, b) => a - b);
  console.log(
    'UNCACHED_PROFILE_EVIDENCE',
    JSON.stringify({
      syntheticEvaluations: 200,
      p50Ms: times[100],
      p95Ms: times[190],
      maxMs: times[199],
      equalOutputs: true,
      cache: 'absent',
      scope:
        'synthetic technical evaluation; fixture evidence resolver; no live issuance or SQL/provider latency',
    }),
  );
});
