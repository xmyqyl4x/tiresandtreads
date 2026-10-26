import { id, instant, fail } from '../../../domain/src/values/core.ts';
import { estimateQuote } from '../../../engine/src/pricing/quote.ts';
import type { PricingEvidence, PricingRequest } from '../ports/pricing.ts';
import { failure } from '../ports/transactions.ts';
export function createPricingService(deps: {
  readonly now: () => string;
  readonly evidence: PricingEvidence;
}) {
  return {
    async estimate(raw: unknown) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return fail(failure('invalid_input'));
      const x = raw as Record<string, unknown>,
        quote = id('quote', x.quoteId),
        plan = x.planId === null ? null : id('plan', x.planId);
      if (
        Object.keys(x).sort().join(',') !== 'includeAlignment,planId,quoteId,regionKey' ||
        !quote.ok ||
        (plan && !plan.ok) ||
        typeof x.regionKey !== 'string' ||
        !/^[A-Z0-9_-]{1,80}$/.test(x.regionKey.trim().toUpperCase()) ||
        typeof x.includeAlignment !== 'boolean'
      )
        return fail(failure('invalid_input'));
      const request: PricingRequest = Object.freeze({
        quoteId: quote.value,
        planId: plan?.ok ? plan.value : null,
        regionKey: x.regionKey.trim().toUpperCase(),
        includeAlignment: x.includeAlignment,
      });
      try {
        const asOf = deps.now();
        if (!instant(asOf).ok) return fail(failure('internal'));
        const loaded = await deps.evidence.load(request, asOf);
        if (!loaded.ok) return loaded;
        const q = loaded.value;
        if (
          q.id !== request.quoteId ||
          q.planId !== request.planId ||
          q.regionKey !== request.regionKey ||
          q.includeAlignment !== request.includeAlignment ||
          q.asOf !== asOf
        )
          return fail(failure('integrity'));
        const result = estimateQuote(q);
        return result.ok ? result : fail(failure('integrity'));
      } catch {
        return fail(failure('unavailable'));
      }
    },
  };
}
