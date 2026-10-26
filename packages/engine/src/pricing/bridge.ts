import { boundary, requirePrice } from './arithmetic.ts';
import { selectionKey } from './quote.ts';
import type { QuoteEstimate, Item } from './model.ts';
import type { AssessmentInput, EngineSnapshot } from '../model.ts';
// Point-only bridge for the existing engine cost contract. Ranges remain explicit
// in pricing/comparison; a midpoint must never establish a hard budget ceiling.
export function attachExactPrice(
  input: AssessmentInput,
  snapshot: EngineSnapshot,
  quote: QuoteEstimate,
) {
  return boundary(() => {
    requirePrice(
      quote.asOf === snapshot.asOf &&
        quote.bundleId === snapshot.bundleId &&
        quote.regionKey === input.regionKey,
      'price_binding',
    );
    const plan = snapshot.plans.find((p) => p.id === quote.planId);
    requirePrice(plan, 'price_binding');
    const expected: Item[] = (['front', 'rear'] as const).flatMap((axle) => {
      const n = input.replace.filter((p) => p.startsWith(axle)).length;
      return n ? [{ axle, skuId: plan[axle].id, quantity: n as 1 | 2 }] : [];
    });
    const known = quote.productKnown && selectionKey(expected) === selectionKey(quote.selection);
    const value = quote.installed;
    const cost =
      known &&
      quote.freshness === 'fresh' &&
      quote.currentPriceClaim &&
      quote.sourceId !== null &&
      quote.validUntil !== null &&
      value &&
      value.low === value.high
        ? Object.freeze({
            basis: 'installed' as const,
            currency: 'USD' as const,
            quantity: quote.quantity,
            amountMinor: value.low,
            sourceId: quote.sourceId,
            validUntil: quote.validUntil,
          })
        : null;
    return Object.freeze({
      ...snapshot,
      plans: Object.freeze(
        snapshot.plans.map((p) => (p.id === plan.id ? Object.freeze({ ...p, cost }) : p)),
      ),
    });
  });
}
