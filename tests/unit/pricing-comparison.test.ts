import { it, expect } from 'vitest';
import { estimateQuote } from '../../packages/engine/src/pricing/quote.ts';
import {
  compareShopQuote,
  orderPriceOptions,
  compareScenarios,
} from '../../packages/engine/src/pricing/compare.ts';
import { attachExactPrice } from '../../packages/engine/src/pricing/bridge.ts';
import { estimateScenario } from '../../packages/engine/src/pricing/scenario.ts';
import { normalizeAssessment } from '../../packages/engine/src/input.ts';
import { evaluate } from '../../packages/engine/src/evaluate.ts';
import { quoteFixture, scenarioFixture, usd, uuid } from '../fixtures/pricing/base.ts';
import { engineFixture } from '../fixtures/engine/base.ts';
import type { QuoteEstimate } from '../../packages/engine/src/pricing/model.ts';
import type { Mutable } from '../fixtures/engine/base.ts';
function quote(): Mutable<QuoteEstimate> {
  const r = estimateQuote(quoteFixture());
  if (!r.ok) throw Error('fixture');
  return structuredClone(r.value) as Mutable<QuoteEstimate>;
}
it('separates fit, strategy, price deltas and uncertainty without calling a price unfair', () => {
  const a = quote(),
    b = quote();
  b.id = uuid(800);
  b.installed = usd(82900n);
  expect(compareShopQuote(a, b, 'eligible', 'suitable', 'installed')).toMatchObject({
    fit: 'eligible',
    climate: 'suitable',
    relation: 'above_observed_range',
    delta: { lowMinor: 8000n, highMinor: 8000n },
    score: null,
  });
  b.installed = usd(60000n);
  expect(compareShopQuote(a, b, 'eligible', 'suitable', 'installed').relation).toBe(
    'below_observed_range',
  );
  b.installed = usd(70000n, 80000n);
  expect(compareShopQuote(a, b, 'eligible', 'suitable', 'installed').relation).toBe(
    'overlaps_observed_range',
  );
  expect(compareShopQuote(a, b, 'blocked', 'suitable', 'installed').relation).toBe(
    'not_comparable',
  );
  expect(compareShopQuote(a, b, 'eligible', 'unknown', 'installed').evidenceMissing).toBe(true);
});
it('refuses incompatible source contexts, inclusions, products, currencies and quantities', () => {
  const changes: ((q: Mutable<QuoteEstimate>) => void)[] = [
    (q) => {
      q.productKnown = false;
    },
    (q) => {
      q.freshness = 'stale';
    },
    (q) => {
      q.regionKey = 'OTHER';
    },
    (q) => {
      q.taxContextId = uuid(999);
    },
    (q) => {
      q.includeAlignment = true;
    },
    (q) => {
      q.quantity = 2;
    },
    (q) => {
      q.bundleId = uuid(999);
    },
    (q) => {
      q.installed = null;
    },
    (q) => {
      q.selection[0]!.skuId = uuid(999);
    },
    (q) => {
      Object.assign(q, { currency: 'EUR' });
    },
    (q) => {
      q.assumptionVersion = 'other-v1';
    },
    (q) => {
      q.asOf = '2026-10-25T13:00:00.000Z';
    },
  ];
  for (const change of changes) {
    const a = quote(),
      b = quote();
    change(b);
    expect(compareShopQuote(a, b, 'eligible', 'suitable', 'installed').relation).toBe(
      'not_comparable',
    );
  }
});
it('orders only comparable eligible prices and suppresses unsupported cheapest highlights', () => {
  const a = quote(),
    b = quote();
  b.id = uuid(800);
  b.installed = usd(60000n);
  const r = orderPriceOptions(
    [
      { quote: a, eligibility: 'eligible' },
      { quote: b, eligibility: 'eligible' },
    ],
    'installed',
  );
  expect(r.ordered).toEqual([b.id, a.id]);
  expect(r.best).toEqual([b.id]);
  a.installed = usd(50000n, 70000n);
  b.installed = usd(60000n, 80000n);
  expect(
    orderPriceOptions(
      [
        { quote: a, eligibility: 'eligible' },
        { quote: b, eligibility: 'eligible' },
      ],
      'installed',
    ).best,
  ).toEqual([]);
  expect(
    orderPriceOptions(
      [
        { quote: a, eligibility: 'blocked' },
        { quote: b, eligibility: 'unverified' },
      ],
      'installed',
    ).ordered,
  ).toEqual([]);
  expect(
    orderPriceOptions(
      [
        { quote: a, eligibility: 'eligible' },
        { quote: a, eligibility: 'eligible' },
      ],
      'installed',
    ).comparable,
  ).toBe(false);
  b.regionKey = 'OTHER';
  expect(
    orderPriceOptions(
      [
        { quote: a, eligibility: 'eligible' },
        { quote: b, eligibility: 'eligible' },
      ],
      'installed',
    ).comparable,
  ).toBe(false);
});
it('attaches only fresh exact installed totals to the existing engine and never uses a range midpoint as a budget fact', () => {
  const f = engineFixture(),
    input = normalizeAssessment(f.request);
  if (!input.ok) throw Error('fixture');
  const q = quote();
  const attached = attachExactPrice(input.value, f.snapshot, q);
  expect(attached.ok).toBe(true);
  if (!attached.ok) return;
  expect(attached.value.plans[0]!.cost?.amountMinor).toBe(74900n);
  expect(f.snapshot.plans[0]!.cost!.amountMinor).toBe(80000n);
  expect(evaluate(input.value, attached.value).ok).toBe(true);
  for (const change of [
    (x: Mutable<QuoteEstimate>) => {
      x.installed = usd(70000n, 80000n);
    },
    (x: Mutable<QuoteEstimate>) => {
      x.freshness = 'stale';
    },
    (x: Mutable<QuoteEstimate>) => {
      x.productKnown = false;
    },
  ]) {
    const changed = quote();
    change(changed);
    const r = attachExactPrice(input.value, f.snapshot, changed);
    expect(r.ok && r.value.plans[0]!.cost).toBeNull();
  }
  q.bundleId = uuid(999);
  expect(attachExactPrice(input.value, f.snapshot, q).ok).toBe(false);
  q.bundleId = f.snapshot.bundleId;
  q.planId = uuid(999);
  expect(attachExactPrice(input.value, f.snapshot, q).ok).toBe(false);
});
it('compares scenario outcomes only for matching explicit ownership and distance assumptions', () => {
  const a = estimateScenario(scenarioFixture(quote()));
  if (!a.ok) throw Error('fixture');
  const b = structuredClone(a.value);
  expect(compareScenarios(a.value, b).comparable).toBe(true);
  for (const change of [
    { years: 6 },
    { annualDistanceNm: '123' },
    { winterShareBp: 3000 },
    { residualPolicy: 'reviewed_estimate' },
    { state: 'unavailable' },
    { assumptionSetId: uuid(999) },
  ])
    expect(compareScenarios(a.value, Object.assign(structuredClone(b), change)).comparable).toBe(
      false,
    );
});
