import { id } from '../../../domain/src/values/core.ts';
import { estimateQuote } from '../../../engine/src/pricing/quote.ts';
import type { QuoteInput, Charge, Item } from '../../../engine/src/pricing/model.ts';
import type { AssessmentInput, EngineSnapshot, Plan } from '../../../engine/src/model.ts';
import type { CatalogSource, PublicFact } from '../ports/catalog.ts';
import type { ReportCrypto } from '../ports/report-services.ts';
type Row<K extends 'prices' | 'priceComponents'> = Readonly<{
  fact: PublicFact<K>;
  source: CatalogSource;
}>;
// This compiler only uses representations that have an unambiguous existing storage contract.
export function compileCatalogPrice(x: {
  input: AssessmentInput;
  snapshot: EngineSnapshot;
  plan: Plan;
  prices: readonly Row<'prices'>[];
  charges: readonly Row<'priceComponents'>[];
  crypto: Pick<ReportCrypto, 'id'>;
  taxContextId: unknown;
}) {
  const { input, snapshot, plan } = x,
    selection: Item[] = (['front', 'rear'] as const).flatMap((axle) => {
      const n = input.replace.filter((p) => p.startsWith(axle)).length;
      return n ? [{ axle, quantity: n as 1 | 2, skuId: plan[axle].id }] : [];
    });
  const matching = x.prices.filter(
    (r) =>
      selection.some((i) => i.skuId === r.fact.skuId) &&
      r.fact.market === 'US' &&
      r.fact.currency === 'USD' &&
      r.fact.observedAt <= snapshot.asOf &&
      r.fact.quantityBasis === 'per_tire',
  );
  // An explicitly selected coherent offer is required. Multiple retailers/dates are not blended.
  if (selection.some((i) => matching.filter((r) => r.fact.skuId === i.skuId).length !== 1))
    return null;
  const chosen = [...new Map(matching.map((r) => [r.fact.id, r])).values()],
    anchor = chosen[0];
  if (
    !anchor ||
    chosen.some(
      (r) =>
        r.fact.retailerId !== anchor.fact.retailerId ||
        r.fact.observedAt !== anchor.fact.observedAt ||
        r.source.datasetId !== anchor.source.datasetId,
    )
  )
    return null;
  const source = snapshot.sources.find(
    (s) => s.datasetId === anchor.source.datasetId && s.kind === 'catalog',
  );
  if (!source) return null;
  const lines = chosen.map((r) => ({
    id: r.fact.id,
    items: selection.filter((i) => i.skuId === r.fact.skuId),
    basis: 'per_tire' as const,
    quotedQuantity: 1,
    value: { low: r.fact.unitPriceMinor, high: r.fact.unitPriceMinor, currency: 'USD' as const },
    taxIncluded: r.fact.taxIncluded,
  }));
  const charges: Charge[] = x.charges
    .filter(
      (r) =>
        chosen.some((p) => p.fact.id === r.fact.priceId) &&
        r.source.datasetId === anchor.source.datasetId,
    )
    .map(({ fact: c }) => {
      const supportedKind = [
        'mounting',
        'balancing',
        'tpms_valve',
        'disposal',
        'tax',
        'alignment',
        'required_other',
      ].includes(c.kind);
      let amount: Charge['amount'] = null;
      if (
        c.amountKind === 'fixed' &&
        c.lowMinor !== null &&
        c.highMinor !== null &&
        ['per_tire', 'per_axle', 'per_order'].includes(c.basis) &&
        !(chosen.length > 1 && c.basis === 'per_order')
      )
        amount = {
          kind: 'fixed',
          basis: c.basis as 'per_tire' | 'per_axle' | 'per_order',
          value: { low: c.lowMinor, high: c.highMinor, currency: 'USD' },
        };
      if (c.amountKind === 'percentage' && c.rate !== null && c.basis === 'tire_subtotal')
        amount = {
          kind: 'percentage',
          basis: 'tire_subtotal',
          rate: c.rate,
          baseChargeIds: [],
          rounding: 'per_line',
        };
      return {
        id: c.id,
        kind: supportedKind ? (c.kind as Charge['kind']) : 'required_other',
        appliesTo: [c.priceId],
        included: c.included,
        amount,
      };
    });
  const expiry =
    chosen
      .map((r) => r.fact.validUntil)
      .filter((s): s is string => s !== null)
      .sort()[0] ?? null;
  const q: QuoteInput = {
    id: x.crypto.id('quote', plan.id),
    planId: plan.id,
    bundleId: snapshot.bundleId,
    regionKey: input.regionKey,
    asOf: snapshot.asOf,
    retailerId: anchor.fact.retailerId,
    taxContextId: id('tax', x.taxContextId).ok ? String(x.taxContextId) : null,
    assumptionVersion: snapshot.policy.version,
    origin: 'licensed_feed',
    ownerAuthorized: false,
    source,
    currency: 'USD',
    observedAt: anchor.fact.observedAt,
    validUntil: expiry,
    productKnown: true,
    selection,
    includeAlignment: false,
    lines,
    charges,
  };
  const estimated = estimateQuote(q);
  return estimated.ok ? estimated.value : null;
}
