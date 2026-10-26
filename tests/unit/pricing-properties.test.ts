import { it, expect } from 'vitest';
import { estimateQuote } from '../../packages/engine/src/pricing/quote.ts';
import { estimateScenario } from '../../packages/engine/src/pricing/scenario.ts';
import { compareShopQuote, orderPriceOptions } from '../../packages/engine/src/pricing/compare.ts';
import { quoteFixture, scenarioFixture, usd, uuid } from '../fixtures/pricing/base.ts';
import {
  boundary,
  rate,
  ceil,
  roundHalfUp,
  per1000,
  amount,
  distance,
} from '../../packages/engine/src/pricing/arithmetic.ts';
import type { QuoteInput } from '../../packages/engine/src/pricing/model.ts';
import type { Mutable } from '../fixtures/engine/base.ts';
const json = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
function quote(q: QuoteInput = quoteFixture()) {
  const r = estimateQuote(q);
  if (!r.ok) throw Error(r.error.field);
  return r.value;
}
function freeze(x: unknown) {
  if (x && typeof x === 'object') {
    for (const v of Object.values(x)) freeze(v);
    Object.freeze(x);
  }
}
it('preserves byte-equivalent quote results under 100 seeded permutations and commercial changes', () => {
  const base = quoteFixture(),
    expected = json(quote(base));
  let seed = 1801;
  for (let i = 0; i < 100; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const changed = structuredClone(base);
    if (seed % 2) changed.lines.reverse();
    if (seed % 3) changed.charges.reverse();
    if (seed % 5) changed.selection.reverse();
    for (const c of changed.charges) {
      c.appliesTo.reverse();
      if (c.amount?.kind === 'percentage') c.amount.baseChargeIds.reverse();
    }
    Object.assign(changed, { commission: seed, offerBid: seed * 2, adPlacement: 'changed' });
    expect(json(quote(changed))).toBe(expected);
  }
});
it('keeps totals monotone and exact across 128 source amounts with integer tax rounding', () => {
  let previous = 0n;
  for (let n = 0; n < 128; n++) {
    const q = quoteFixture();
    q.lines.forEach((l) => (l.value = usd(BigInt(n) * 123n)));
    const r = quote(q);
    expect(r.installed!.low).toBeGreaterThanOrEqual(previous);
    previous = r.installed!.low;
    expect(r.installed!.low).toBe(r.installed!.high);
  }
  const q = quoteFixture();
  q.charges.forEach((c) => (c.included = true));
  q.lines.forEach((l) => {
    l.taxIncluded = true;
    l.value = usd(9007199254740993n);
  });
  expect(quote(q).installed!.low).toBe(36028797018963972n);
});
it('accepts authorized private shop quotes without fabricating a feed license or public identity', () => {
  const q: Mutable<QuoteInput> = {
    ...quoteFixture(),
    origin: 'owner_quote',
    ownerAuthorized: true,
    source: null,
    retailerId: null,
    taxContextId: null,
    validUntil: null,
    productKnown: false,
  };
  q.selection.forEach((i) => (i.skuId = null));
  q.lines.forEach((l) => l.items.forEach((i) => (i.skuId = null)));
  const r = quote(q);
  expect(r.installed).toEqual(usd(74900n));
  expect(r.sourceId).toBeNull();
  expect(r.origin).toBe('owner_quote');
  expect(r.validUntil).toBeNull();
  expect(compareShopQuote(quote(), r, 'eligible', 'suitable', 'installed').relation).toBe(
    'not_comparable',
  );
  q.ownerAuthorized = false;
  expect(quote(q).installed).toBeNull();
});
it('keeps zero/lower costs from becoming winners when product identity or fit is unknown', () => {
  const q = quote(),
    unknown = structuredClone(q);
  Object.assign(unknown, { id: uuid(900), productKnown: false, installed: usd(0n) });
  const r = orderPriceOptions(
    [
      { quote: q, eligibility: 'eligible' },
      { quote: unknown, eligibility: 'eligible' },
    ],
    'installed',
  );
  expect(r.ordered).toEqual([q.id]);
  expect(r.best).toEqual([]);
  expect(
    orderPriceOptions(Array(101).fill({ quote: q, eligibility: 'eligible' }), 'installed')
      .comparable,
  ).toBe(false);
});
it('keeps scenario inputs immutable and allocation/purchase bounds valid over 101 winter shares', () => {
  const base = scenarioFixture(quote()),
    expected = json(base);
  freeze(base);
  expect(estimateScenario(base).ok).toBe(true);
  expect(json(base)).toBe(expected);
  for (let bp = 0; bp <= 10000; bp += 100) {
    const s = scenarioFixture(quote());
    s.winterShareBp = bp;
    const r = estimateScenario(s);
    if (!r.ok) throw Error('fixture');
    const d = r.value.distances!;
    expect(BigInt(d.summerNumerator) + BigInt(d.winterNumerator)).toBe(BigInt(d.totalNumerator));
    expect(r.value.total?.low).toBe(74900n);
  }
});
it('encloses exact cost-per-distance fractions with outward minor-unit bounds', () => {
  for (let n = 1; n <= 100; n++) {
    const cost = amount(BigInt(n)),
      d = BigInt(n + 1),
      r = per1000(cost, d, d, 'km'),
      factor = distance({ value: '1000', unit: 'km' });
    expect(r.low * d).toBeLessThanOrEqual(cost.low * factor);
    expect(r.high * d).toBeGreaterThanOrEqual(cost.high * factor);
    expect(r.high - r.low).toBeLessThanOrEqual(1n);
  }
  expect(
    boundary(() => {
      throw Error('private source');
    }),
  ).toEqual({ ok: false, error: { code: 'invalid_value', field: 'pricing' } });
  expect(() => rate('1.000001')).toThrow();
  expect(() => ceil(-1n, 1n)).toThrow();
  expect(() => roundHalfUp(1n, 0n)).toThrow();
});
