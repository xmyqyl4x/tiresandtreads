import { it, expect } from 'vitest';
import { roundHalfUp } from '../../packages/engine/src/pricing/arithmetic.ts';
import {
  amount,
  ceil,
  distance,
  per1000,
  rate,
} from '../../packages/engine/src/pricing/arithmetic.ts';
import { estimateQuote } from '../../packages/engine/src/pricing/quote.ts';
import { quoteFixture, usd, uuid } from '../fixtures/pricing/base.ts';
import type { QuoteInput, QuoteEstimate } from '../../packages/engine/src/pricing/model.ts';
import type { Mutable } from '../fixtures/engine/base.ts';
function result(q = quoteFixture()): QuoteEstimate {
  const r = estimateQuote(q);
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error(r.error.field);
  return r.value;
}
it('rounds explicit positive rational cents half up without binary floating-point loss', () => {
  expect(roundHalfUp(5n, 2n)).toBe(3n);
  expect(roundHalfUp(90071992547409931n, 10n)).toBe(9007199254740993n);
});
it('builds the approved arithmetic fixture: four times 150, 100 services and 49 tax', () => {
  const q = quoteFixture(),
    before = JSON.stringify(q, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    r = result(q);
  expect(r.merchandise).toEqual(usd(60000n));
  expect(r.installed).toEqual(usd(74900n));
  expect(r.currentPriceClaim).toBe(true);
  expect(JSON.stringify(q, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(before);
  expect(Object.isFrozen(r.charges)).toBe(true);
});
it('normalizes explicit axle and package prices without dividing partial packages', () => {
  const q = quoteFixture();
  q.lines.forEach((l) => {
    l.basis = 'per_axle';
    l.quotedQuantity = 2;
    l.value = usd(30000n);
  });
  expect(result(q).installed).toEqual(usd(74900n));
  const p = quoteFixture();
  p.lines = [
    { ...p.lines[0]!, items: p.selection, basis: 'per_set', quotedQuantity: 4, value: usd(60000n) },
  ];
  p.charges.forEach((c) => (c.appliesTo = [p.lines[0]!.id]));
  expect(result(p).installed).toEqual(usd(74900n));
});
it('counts order fees once, axle fees per affected axle, and optional alignment separately', () => {
  const q = quoteFixture();
  q.charges[0]!.amount = { kind: 'fixed', basis: 'per_order', value: usd(4000n) };
  q.charges[1]!.amount = { kind: 'fixed', basis: 'per_axle', value: usd(1000n) };
  q.charges.push({
    id: uuid(415),
    kind: 'alignment',
    appliesTo: q.lines.map((l) => l.id),
    included: false,
    amount: { kind: 'fixed', basis: 'per_order', value: usd(9000n) },
  });
  expect(result(q).installed).toEqual(usd(74900n));
  expect(result(q).optionalAlignment).toEqual(usd(9000n));
  q.includeAlignment = true;
  expect(result(q).installed).toEqual(usd(83900n));
});
it('retains included charges without charging them or their nominal amount twice', () => {
  const q = quoteFixture();
  q.charges.forEach((c) => (c.included = true));
  q.lines.forEach((l) => {
    l.taxIncluded = true;
    l.value = usd(18725n);
  });
  expect(result(q).installed).toEqual(usd(74900n));
  expect(result(q).charges.every((c) => c.additional?.high === 0n)).toBe(true);
});
it('handles low/high coherent source scenarios and fixed zero-price evidence', () => {
  const q = quoteFixture();
  q.lines.forEach((l) => (l.value = usd(10000n, 15000n)));
  expect(result(q).installed).toEqual(usd(53500n, 74900n));
  q.lines.forEach((l) => (l.value = usd(0n)));
  q.charges.forEach((c) => {
    c.amount = { kind: 'fixed', basis: 'per_order', value: usd(0n) };
  });
  expect(result(q).installed).toEqual(usd(0n));
});
it('distinguishes fresh, stale, seven-day-old, expired and future observations', () => {
  const q = quoteFixture();
  q.observedAt = '2026-10-23T12:00:00.001Z';
  expect(result(q).freshness).toBe('fresh');
  q.observedAt = '2026-10-23T12:00:00.000Z';
  expect(result(q).freshness).toBe('stale');
  expect(result(q).currentPriceClaim).toBe(false);
  expect(result(q).installed).not.toBeNull();
  q.observedAt = '2026-10-18T12:00:00.000Z';
  expect(result(q).installed).toBeNull();
  expect(result(q).reasons).toContain('PRICE_EXPIRED');
  q.observedAt = '2026-10-24T12:00:00.000Z';
  q.validUntil = q.asOf;
  expect(result(q).freshness).toBe('expired');
  q.observedAt = '2027-01-01T00:00:00.000Z';
  expect(estimateQuote(q).ok).toBe(false);
});
it('keeps missing prices, services and tax unknown, and suppresses revoked source values', () => {
  const q = quoteFixture();
  q.lines[0]!.value = null;
  expect(result(q).merchandise).toBeNull();
  expect(result(q).installed).toBeNull();
  expect(result(q).currentPriceClaim).toBe(false);
  const missing = quoteFixture();
  missing.charges.pop();
  expect(result(missing).installed).toBeNull();
  const tax = quoteFixture();
  tax.lines[0]!.taxIncluded = null;
  expect(result(tax).reasons).toContain('TAX_UNCONFIRMED');
  expect(result(tax).installed).toBeNull();
  const rights = quoteFixture();
  rights.source.rights.snapshot = false;
  expect(result(rights).freshness).toBe('unavailable');
  expect(result(rights).merchandise).toBeNull();
  const incomplete = quoteFixture();
  incomplete.lines.pop();
  incomplete.charges = [];
  expect(result(incomplete).reasons).toContain('PRICE_MISSING');
  const unknown = quoteFixture();
  unknown.charges[0]!.amount = null;
  expect(result(unknown).installed).toBeNull();
});
it('preserves unknown quote identity without making up scores or fitment', () => {
  const q = quoteFixture();
  q.productKnown = false;
  q.selection.forEach((i) => (i.skuId = null));
  q.lines.forEach((l) => l.items.forEach((i) => (i.skuId = null)));
  const r = result(q);
  expect(r.installed).toEqual(usd(74900n));
  expect(r.reasons).toContain('PRODUCT_UNVERIFIED');
});
it('honors an explicit percentage tax base and declared per-line or per-order rounding', () => {
  const q = quoteFixture();
  q.lines.forEach((l) => {
    l.value = usd(1n);
  });
  q.charges = q.charges.filter((c) => c.kind === 'tax');
  const tax = q.charges[0]!;
  tax.amount = {
    kind: 'percentage',
    basis: 'tire_subtotal',
    baseChargeIds: [],
    rate: '0.25',
    rounding: 'per_order',
  };
  expect(result(q).charges[0]!.additional).toEqual(usd(1n));
  tax.amount.rounding = 'per_line';
  expect(result(q).charges[0]!.additional).toEqual(usd(2n)); // 0.5 cent on each two-tire line.
});
const invalidCases: readonly [string, (q: Mutable<QuoteInput>) => void][] = [
  [
    'string price flag',
    (q) => {
      Object.assign(q, { productKnown: 'true' });
    },
  ],
  [
    'string owner authorization',
    (q) => {
      Object.assign(q, { ownerAuthorized: 'true' });
    },
  ],
  [
    'string optional flag',
    (q) => {
      Object.assign(q, { includeAlignment: 'false' });
    },
  ],
  [
    'string fee inclusion',
    (q) => {
      Object.assign(q.charges[0]!, { included: 'false' });
    },
  ],
  [
    'origin contradiction',
    (q) => {
      q.origin = 'owner_quote';
    },
  ],
  [
    'bad identity',
    (q) => {
      q.id = 'bad';
    },
  ],
  [
    'bad plan',
    (q) => {
      q.planId = 'bad';
    },
  ],
  [
    'currency mismatch',
    (q) => {
      Object.assign(q, { currency: 'EUR' });
    },
  ],
  [
    'region missing',
    (q) => {
      q.regionKey = '';
    },
  ],
  [
    'assumption version missing',
    (q) => {
      q.assumptionVersion = '';
    },
  ],
  [
    'invalid time',
    (q) => {
      q.asOf = 'bad';
    },
  ],
  [
    'bad expiry',
    (q) => {
      q.validUntil = 'bad';
    },
  ],
  [
    'expiry before observation',
    (q) => {
      q.validUntil = '2026-01-01T00:00:00.000Z';
    },
  ],
  [
    'no selection',
    (q) => {
      q.selection = [];
    },
  ],
  [
    'three tires',
    (q) => {
      q.selection[0]!.quantity = 1;
    },
  ],
  [
    'duplicate axles',
    (q) => {
      q.selection[1]!.axle = 'front';
    },
  ],
  [
    'bad SKU',
    (q) => {
      q.selection[0]!.skuId = 'bad';
    },
  ],
  [
    'too many lines',
    (q) => {
      q.lines = Array(5).fill(q.lines[0]);
    },
  ],
  [
    'too many charges',
    (q) => {
      q.charges = Array(33).fill(q.charges[0]);
    },
  ],
  [
    'duplicate prices',
    (q) => {
      q.lines[1]!.id = q.lines[0]!.id;
    },
  ],
  [
    'duplicate charge id',
    (q) => {
      q.charges[1]!.id = q.charges[0]!.id;
    },
  ],
  [
    'known product missing SKU',
    (q) => {
      q.selection[0]!.skuId = null;
    },
  ],
  [
    'bad price id',
    (q) => {
      q.lines[0]!.id = 'bad';
    },
  ],
  [
    'unrequested SKU',
    (q) => {
      q.lines[0]!.items[0]!.skuId = uuid(999);
    },
  ],
  [
    'fractional package quantity',
    (q) => {
      q.lines[0]!.quotedQuantity = 1.5;
    },
  ],
  [
    'invalid package basis',
    (q) => {
      q.lines[0]!.basis = 'per_set';
      q.lines[0]!.quotedQuantity = 4;
    },
  ],
  [
    'half axle',
    (q) => {
      q.selection[0]!.quantity = 1;
      q.selection[1]!.quantity = 1;
      q.lines.forEach((l) => {
        l.items[0]!.quantity = 1;
        l.basis = 'per_axle';
        l.quotedQuantity = 2;
      });
    },
  ],
  [
    'negative amount',
    (q) => {
      q.lines[0]!.value = usd(-1n);
    },
  ],
  [
    'reversed range',
    (q) => {
      q.lines[0]!.value = usd(2n, 1n);
    },
  ],
  [
    'money overflow',
    (q) => {
      q.lines[0]!.value = usd(9223372036854775807n);
    },
  ],
  [
    'mixed money currency',
    (q) => {
      Object.assign(q.lines[0]!.value!, { currency: 'EUR' });
    },
  ],
  [
    'duplicate quantity',
    (q) => {
      q.lines.push({ ...q.lines[0]!, id: uuid(499) });
    },
  ],
  [
    'bad component identity',
    (q) => {
      q.charges[0]!.id = 'bad';
    },
  ],
  [
    'unbound component',
    (q) => {
      q.charges[0]!.appliesTo = [uuid(999)];
    },
  ],
  [
    'duplicate fee coverage',
    (q) => {
      q.charges.push({ ...q.charges[0]!, id: uuid(499) });
    },
  ],
  [
    'tax inclusion contradiction',
    (q) => {
      q.lines[0]!.taxIncluded = true;
    },
  ],
  [
    'unknown component calculation kind',
    (q) => {
      Object.assign(q.charges[4]!.amount!, { kind: 'guessed_percentage' });
    },
  ],
  [
    'bad rate',
    (q) => {
      q.charges[4]!.amount = {
        kind: 'percentage',
        basis: 'tire_subtotal',
        rate: '0.0000001',
        baseChargeIds: [],
        rounding: 'per_order',
      };
    },
  ],
  [
    'self-tax cycle',
    (q) => {
      const c = q.charges[4]!;
      if (c.amount?.kind === 'percentage') c.amount.baseChargeIds = [c.id];
    },
  ],
  [
    'missing tax base',
    (q) => {
      const a = q.charges[4]!.amount!;
      if (a.kind === 'percentage') a.baseChargeIds = [uuid(999)];
    },
  ],
  [
    'unexpected tire-subtotal additions',
    (q) => {
      const a = q.charges[4]!.amount!;
      if (a.kind === 'percentage') a.basis = 'tire_subtotal';
    },
  ],
  [
    'ambiguous per-line aggregate tax',
    (q) => {
      const a = q.charges[4]!.amount!;
      if (a.kind === 'percentage') a.rounding = 'per_line';
    },
  ],
];
it.each(invalidCases)('rejects %s', (_name, change) => {
  const q = quoteFixture();
  change(q);
  expect(estimateQuote(q).ok).toBe(false);
});
it('preserves exact units/rates and rejects invalid precision, divisors and distance ordering', () => {
  expect(rate('1')).toBe(1000000n);
  expect(rate('0.0875')).toBe(87500n);
  expect(distance({ value: '1', unit: 'mile' })).toBe(distance({ value: '1.609344', unit: 'km' }));
  expect(
    per1000(
      amount(74900n),
      distance({ value: '50000', unit: 'mile' }),
      distance({ value: '50000', unit: 'mile' }),
      'mile',
    ),
  ).toEqual(usd(1498n));
  for (const bad of ['-1', '1.1', '0.1234567', 'NaN', '1e-2']) expect(() => rate(bad)).toThrow();
  expect(() => roundHalfUp(-1n, 1n)).toThrow();
  expect(() => ceil(1n, 0n)).toThrow();
  expect(() => distance({ value: '1e2', unit: 'km' })).toThrow();
  expect(() => per1000(usd(1n), 0n, 1n, 'km')).toThrow();
});
