import type {
  QuoteInput,
  Amount,
  ScenarioInput,
  LifeModel,
  QuoteEstimate,
} from '../../../packages/engine/src/pricing/model.ts';
import type { Mutable } from '../engine/base.ts';
import type { Source } from '../../../packages/engine/src/model.ts';
export { uuid, asOf } from '../engine/base.ts';
import { uuid, asOf } from '../engine/base.ts';
export const usd = (low: bigint, high = low): Mutable<Amount> => ({ low, high, currency: 'USD' });
export function quoteFixture(): Mutable<QuoteInput> & { source: Mutable<Source> } {
  const ids = [uuid(401), uuid(402)];
  return {
    id: uuid(400),
    planId: uuid(101),
    bundleId: uuid(1),
    regionKey: 'SYNTHETIC_US',
    asOf,
    retailerId: uuid(420),
    taxContextId: uuid(421),
    assumptionVersion: 'synthetic-coherent-range-v1',
    currency: 'USD',
    observedAt: '2026-10-24T12:00:00.000Z',
    validUntil: '2026-11-01T00:00:00.000Z',
    productKnown: true,
    origin: 'licensed_feed',
    ownerAuthorized: false,
    includeAlignment: false,
    source: {
      datasetId: uuid(3),
      providerId: uuid(23),
      licenseId: uuid(33),
      kind: 'catalog',
      market: 'US',
      fetchedAt: '2026-10-24T00:00:00.000Z',
      validUntil: '2026-11-01T00:00:00.000Z',
      rights: { display: true, api: true, derived: true, cache: true, snapshot: true },
    },
    selection: [
      { skuId: uuid(201), axle: 'front', quantity: 2 },
      { skuId: uuid(202), axle: 'rear', quantity: 2 },
    ],
    lines: (['front', 'rear'] as const).map((axle, i) => ({
      id: ids[i]!,
      items: [{ skuId: uuid(201 + i), axle, quantity: 2 }],
      basis: 'per_tire',
      quotedQuantity: 1,
      value: usd(15000n),
      taxIncluded: false,
    })),
    charges: [
      ...(['mounting', 'balancing', 'tpms_valve', 'disposal'] as const).map((kind, i) => ({
        id: uuid(410 + i),
        kind,
        appliesTo: ids,
        included: false,
        amount: {
          kind: 'fixed' as const,
          basis: 'per_tire' as const,
          value: usd(i ? 500n : 1000n),
        },
      })),
      {
        id: uuid(414),
        kind: 'tax',
        appliesTo: ids,
        included: false,
        amount: {
          kind: 'percentage',
          basis: 'taxable_subtotal',
          rate: '0.07',
          baseChargeIds: [uuid(410), uuid(411), uuid(412), uuid(413)],
          rounding: 'per_order',
        },
      },
    ],
  };
}
export function lifeFixture(q: QuoteEstimate): Mutable<LifeModel> {
  return {
    id: uuid(500),
    version: 'synthetic-modeled-life-v1',
    kind: 'modeled_life',
    reviewed: true,
    reviewedAt: '2026-10-24T00:00:00.000Z',
    validUntil: '2026-11-01T00:00:00.000Z',
    source: quoteFixture().source,
    skuIds: q.selection.map((i) => i.skuId!),
    low: { value: '50000', unit: 'mile' },
    high: { value: '50000', unit: 'mile' },
    calendarYears: 5,
  };
}
export function scenarioFixture(q: QuoteEstimate): Mutable<ScenarioInput> {
  return {
    id: uuid(600),
    assumptionSetId: uuid(601),
    regionKey: q.regionKey,
    asOf: q.asOf,
    strategy: 'one_set',
    eligibility: 'eligible',
    years: 5,
    annualDistance: { value: '10000', unit: 'mile' },
    winterShareBp: 2000,
    residualPolicy: 'zero',
    residual: usd(0n),
    sets: [
      {
        role: 'year_round',
        quote: structuredClone(q) as Mutable<QuoteEstimate>,
        life: lifeFixture(q),
        upfrontWheels: usd(0n),
      },
    ],
    additionalSwapEvents: 0,
    swapCost: usd(0n),
    storagePerYear: usd(0n),
  };
}
