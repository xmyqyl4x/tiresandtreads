import type { QuoteEstimate, ScenarioEstimate } from './model.ts';
import { selectionKey } from './quote.ts';
export function priceComparable(
  a: QuoteEstimate,
  b: QuoteEstimate,
  basis: 'installed' | 'merchandise',
  sameProduct = true,
) {
  const quantities = (q: QuoteEstimate) =>
    q.selection
      .map((i) => `${i.axle}:${i.quantity}`)
      .sort()
      .join('|');
  return (
    a.freshness === 'fresh' &&
    b.freshness === 'fresh' &&
    a.productKnown &&
    b.productKnown &&
    a.asOf === b.asOf &&
    a.bundleId === b.bundleId &&
    a.currency === b.currency &&
    a.regionKey === b.regionKey &&
    a.taxContextId !== null &&
    b.taxContextId !== null &&
    a.taxContextId === b.taxContextId &&
    a.includeAlignment === b.includeAlignment &&
    a.quantity === b.quantity &&
    quantities(a) === quantities(b) &&
    a.assumptionVersion === b.assumptionVersion &&
    a[basis] !== null &&
    b[basis] !== null &&
    (!sameProduct || selectionKey(a.selection) === selectionKey(b.selection)) &&
    (basis !== 'merchandise' || (a.installed !== null && b.installed !== null))
  ); // Unknown tax/inclusions cannot win a merchandise comparison either.
}
export function compareShopQuote(
  observed: QuoteEstimate,
  quoted: QuoteEstimate,
  fit: 'eligible' | 'blocked' | 'unverified',
  climate: 'suitable' | 'unsuitable' | 'unknown',
  basis: 'installed' | 'merchandise',
) {
  const comparable =
    fit === 'eligible' && climate === 'suitable' && priceComparable(observed, quoted, basis);
  let relation:
    'not_comparable' | 'above_observed_range' | 'below_observed_range' | 'overlaps_observed_range' =
    'not_comparable';
  let delta: Readonly<{ lowMinor: bigint; highMinor: bigint; currency: 'USD' }> | null = null;
  if (comparable) {
    const a = observed[basis]!,
      b = quoted[basis]!;
    relation =
      b.low > a.high
        ? 'above_observed_range'
        : b.high < a.low
          ? 'below_observed_range'
          : 'overlaps_observed_range';
    delta = Object.freeze({ lowMinor: b.low - a.high, highMinor: b.high - a.low, currency: 'USD' });
  }
  return Object.freeze({
    fit,
    climate,
    relation,
    delta,
    evidenceMissing: !comparable,
    score: null,
    issuanceAuthorized: false as const,
  });
}
export function orderPriceOptions(
  options: readonly Readonly<{
    quote: QuoteEstimate;
    eligibility: 'eligible' | 'blocked' | 'unverified';
  }>[],
  basis: 'installed' | 'merchandise',
) {
  if (options.length > 100 || new Set(options.map((o) => o.quote.id)).size !== options.length)
    return Object.freeze({
      ordered: Object.freeze([] as string[]),
      best: Object.freeze([] as string[]),
      comparable: false,
    });
  const usable = options.filter(
    (o) =>
      o.eligibility === 'eligible' &&
      o.quote.freshness === 'fresh' &&
      o.quote.productKnown &&
      o.quote[basis] !== null,
  );
  const anchor = usable[0]?.quote;
  const sameContext =
    !!anchor && usable.every((o) => priceComparable(anchor, o.quote, basis, false));
  if (!sameContext)
    return Object.freeze({
      ordered: Object.freeze([] as string[]),
      best: Object.freeze([] as string[]),
      comparable: false,
    });
  const sorted = [...usable].sort((a, b) => {
    const av = a.quote[basis]!,
      bv = b.quote[basis]!,
      am = av.low + av.high,
      bm = bv.low + bv.high;
    return am < bm ? -1 : am > bm ? 1 : a.quote.id < b.quote.id ? -1 : 1;
  });
  const best =
    sorted.length < 2
      ? []
      : sorted
          .filter((a) =>
            sorted.every((b) => a === b || a.quote[basis]!.high <= b.quote[basis]!.low),
          )
          .map((o) => o.quote.id);
  return Object.freeze({
    ordered: Object.freeze(sorted.map((o) => o.quote.id)),
    best: Object.freeze(best),
    comparable: true,
  });
}
export function compareScenarios(a: ScenarioEstimate, b: ScenarioEstimate) {
  const comparable =
    a.state === 'modeled' &&
    b.state === 'modeled' &&
    a.asOf === b.asOf &&
    a.assumptionSetId === b.assumptionSetId &&
    a.years === b.years &&
    a.regionKey === b.regionKey &&
    a.currency === b.currency &&
    a.annualDistanceNm === b.annualDistanceNm &&
    a.winterShareBp === b.winterShareBp &&
    a.residualPolicy === b.residualPolicy;
  return Object.freeze({
    comparable,
    difference: comparable
      ? Object.freeze({
          lowMinor: b.total!.low - a.total!.high,
          highMinor: b.total!.high - a.total!.low,
          currency: a.currency,
        })
      : null,
  });
}
