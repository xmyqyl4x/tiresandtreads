import { fail, instant } from '../../../domain/src/values/core.ts';
import { normalizeAssessment } from '../../../engine/src/input.ts';
import { evaluate } from '../../../engine/src/evaluate.ts';
import type { RecommendationEvidence } from '../ports/recommendations.ts';
import { failure } from '../ports/transactions.ts';
export function createRecommendationService(deps: {
  readonly evidence: RecommendationEvidence;
  readonly now: () => string;
}) {
  return {
    async assess(raw: unknown) {
      const input = normalizeAssessment(raw);
      if (!input.ok) return fail(failure('invalid_input'));
      try {
        const asOf = deps.now();
        if (!instant(asOf).ok) return fail(failure('internal'));
        const loaded = await deps.evidence.load(input.value, asOf);
        if (!loaded.ok) return loaded;
        if (loaded.value.asOf !== asOf) return fail(failure('integrity'));
        const result = evaluate(input.value, loaded.value);
        return result.ok ? result : fail(failure('integrity'));
      } catch {
        return fail(failure('unavailable'));
      }
    },
  };
}
