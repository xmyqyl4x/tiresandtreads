import { it, expect } from 'vitest';
import { estimateQuote } from '../../packages/engine/src/pricing/quote.ts';
import {
  estimateScenario,
  modeledCostPer1000,
} from '../../packages/engine/src/pricing/scenario.ts';
import { quoteFixture, scenarioFixture, usd, uuid } from '../fixtures/pricing/base.ts';
import type { ScenarioInput, ScenarioEstimate } from '../../packages/engine/src/pricing/model.ts';
import type { Mutable } from '../fixtures/engine/base.ts';
function base() {
  const q = estimateQuote(quoteFixture());
  if (!q.ok) throw Error('quote fixture');
  return scenarioFixture(q.value);
}
function result(s = base()): ScenarioEstimate {
  const r = estimateScenario(s);
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error(r.error.field);
  return r.value;
}
it('models the declared ownership horizon and 14.98 per 1,000 miles without a warranty shortcut', () => {
  const s = base(),
    r = result(s);
  expect(r.total).toEqual(usd(74900n));
  expect(r.costPer1000).toEqual(usd(1498n));
  expect(r.purchases[0]).toMatchObject({ minimum: 1, maximum: 1 });
  expect(r.issuanceAuthorized).toBe(false);
  const life = s.sets[0]!.life!;
  expect(modeledCostPer1000(s.sets[0]!.quote, life, 'mile')).toEqual({
    ok: true,
    value: usd(1498n),
  });
  life.kind = 'warranty';
  expect(result(s).total).toBeNull();
  expect(modeledCostPer1000(s.sets[0]!.quote, life, 'mile')).toEqual({ ok: true, value: null });
});
it('allocates two-set distances once and includes wheels, swaps and storage explicitly', () => {
  const s = base(),
    winter = structuredClone(s.sets[0]!);
  winter.role = 'winter';
  winter.quote.id = uuid(700);
  winter.upfrontWheels = usd(40000n);
  s.sets[0]!.role = 'summer';
  s.sets.push(winter);
  s.strategy = 'two_set';
  s.additionalSwapEvents = 10;
  s.swapCost = usd(5000n);
  s.storagePerYear = usd(10000n);
  const r = result(s);
  expect(r.total).toEqual(usd(289800n));
  expect(r.purchases).toHaveLength(2);
  const d = r.distances!;
  expect(BigInt(d.summerNumerator) + BigInt(d.winterNumerator)).toBe(BigInt(d.totalNumerator));
  expect(BigInt(d.winterNumerator) * 5n).toBe(BigInt(d.totalNumerator));
});
it('avoids an endpoint replacement and includes a purchase just beyond modeled life', () => {
  const s = base();
  s.years = 1;
  s.annualDistance = { value: '50000', unit: 'mile' };
  expect(result(s).purchases[0]!.maximum).toBe(1);
  s.annualDistance.value = '50000.000001';
  expect(result(s).purchases[0]!.maximum).toBe(2);
  s.annualDistance.value = '1';
  s.years = 6;
  expect(result(s).purchases[0]!.maximum).toBe(2);
});
it('uses shorter/longer modeled life consistently for cost bounds and converts distance exactly', () => {
  const s = base();
  s.sets[0]!.life!.low.value = '25000';
  s.sets[0]!.life!.high.value = '50000';
  expect(result(s).total).toEqual(usd(74900n, 149800n));
  s.annualDistance = { value: '16093.44', unit: 'km' };
  const km = result(s);
  expect(km.total).toEqual(usd(74900n, 149800n));
  expect(km.annualDistanceNm).toBe(result(base()).annualDistanceNm);
});
it('keeps fractional-unit seasonal allocation exact, including zero and full winter share', () => {
  const s = base();
  s.annualDistance = { value: '0.000001', unit: 'mile' };
  s.winterShareBp = 1;
  const r = result(s),
    d = r.distances!;
  expect(BigInt(d.summerNumerator) + BigInt(d.winterNumerator)).toBe(BigInt(d.totalNumerator));
  s.winterShareBp = 0;
  expect(result(s).distances!.winterNumerator).toBe('0');
  s.winterShareBp = 10000;
  expect(result(s).distances!.summerNumerator).toBe('0');
  s.annualDistance.value = '0';
  expect(result(s).costPer1000).toBeNull();
  expect(result(s).total).not.toBeNull();
});
it('subtracts explicit residual bounds without negative totals or default inflation', () => {
  const s = base();
  s.residualPolicy = 'reviewed_estimate';
  s.residual = usd(1000n, 2000n);
  expect(result(s).total).toEqual(usd(72900n, 73900n));
  expect(result(s).assumptions).toContain('NO_INFLATION');
});
const missing: readonly [string, (s: Mutable<ScenarioInput>) => void, string][] = [
  [
    'unsafe',
    (s) => {
      s.eligibility = 'blocked';
    },
    'SAFETY_UNVERIFIED',
  ],
  [
    'unverified fit',
    (s) => {
      s.eligibility = 'unverified';
    },
    'SAFETY_UNVERIFIED',
  ],
  [
    'annual mileage',
    (s) => {
      s.annualDistance = null;
    },
    'ANNUAL_DISTANCE_MISSING',
  ],
  [
    'winter share',
    (s) => {
      s.winterShareBp = null;
    },
    'WINTER_SHARE_MISSING',
  ],
  [
    'residual policy',
    (s) => {
      s.residualPolicy = null;
    },
    'RESIDUAL_ASSUMPTION_MISSING',
  ],
  [
    'residual value',
    (s) => {
      s.residual = null;
    },
    'RESIDUAL_ASSUMPTION_MISSING',
  ],
  [
    'swap count',
    (s) => {
      s.additionalSwapEvents = null;
    },
    'OPERATING_COST_MISSING',
  ],
  [
    'swap cost',
    (s) => {
      s.swapCost = null;
    },
    'OPERATING_COST_MISSING',
  ],
  [
    'storage',
    (s) => {
      s.storagePerYear = null;
    },
    'OPERATING_COST_MISSING',
  ],
  [
    'wheels',
    (s) => {
      s.sets[0]!.upfrontWheels = null;
    },
    'WHEEL_COST_MISSING',
  ],
  [
    'life model',
    (s) => {
      s.sets[0]!.life = null;
    },
    'MODELED_LIFE_MISSING',
  ],
  [
    'unreviewed life',
    (s) => {
      s.sets[0]!.life!.reviewed = false;
    },
    'MODELED_LIFE_MISSING',
  ],
  [
    'SKU applicability',
    (s) => {
      s.sets[0]!.life!.skuIds = [uuid(999)];
    },
    'MODELED_LIFE_MISSING',
  ],
  [
    'expired model',
    (s) => {
      s.sets[0]!.life!.validUntil = s.asOf;
    },
    'MODELED_LIFE_MISSING',
  ],
  [
    'age model',
    (s) => {
      s.sets[0]!.life!.calendarYears = null;
    },
    'CALENDAR_MODEL_MISSING',
  ],
  [
    'stale price',
    (s) => {
      s.sets[0]!.quote.freshness = 'stale';
    },
    'CURRENT_INSTALLED_COST_MISSING',
  ],
  [
    'partial-set life',
    (s) => {
      s.sets[0]!.quote.quantity = 2;
    },
    'PARTIAL_LIFE_MODEL_UNSUPPORTED',
  ],
];
it.each(missing)(
  'qualifies missing %s instead of inventing a forecast',
  (_name, change, reason) => {
    const s = base();
    change(s);
    const r = result(s);
    expect(r.state).toBe('unavailable');
    expect(r.total).toBeNull();
    expect(r.reasons).toContain(reason);
  },
);
const invalid: readonly [string, (s: Mutable<ScenarioInput>) => void][] = [
  [
    'id',
    (s) => {
      s.id = 'bad';
    },
  ],
  [
    'zero years',
    (s) => {
      s.years = 0;
    },
  ],
  [
    'fractional years',
    (s) => {
      s.years = 1.5;
    },
  ],
  [
    'long horizon',
    (s) => {
      s.years = 21;
    },
  ],
  [
    'duplicate sets',
    (s) => {
      s.sets.push(s.sets[0]!);
    },
  ],
  [
    'wrong one-set role',
    (s) => {
      s.sets[0]!.role = 'winter';
    },
  ],
  [
    'winter percent',
    (s) => {
      s.winterShareBp = 10001;
    },
  ],
  [
    'negative share',
    (s) => {
      s.winterShareBp = -1;
    },
  ],
  [
    'fractional share',
    (s) => {
      s.winterShareBp = 1.1;
    },
  ],
  [
    'zero residual contradiction',
    (s) => {
      s.residual = usd(1n);
    },
  ],
  [
    'too many swaps',
    (s) => {
      s.additionalSwapEvents = 201;
    },
  ],
  [
    'quote region',
    (s) => {
      s.sets[0]!.quote.regionKey = 'OTHER';
    },
  ],
  [
    'quote time',
    (s) => {
      s.sets[0]!.quote.asOf = '2026-10-25T13:00:00.000Z';
    },
  ],
  [
    'reversed life interval',
    (s) => {
      s.sets[0]!.life!.high.value = '1';
    },
  ],
  [
    'zero modeled life',
    (s) => {
      s.sets[0]!.life!.low.value = '0';
    },
  ],
  [
    'zero calendar',
    (s) => {
      s.sets[0]!.life!.calendarYears = 0;
    },
  ],
  [
    'excessive purchases',
    (s) => {
      s.sets[0]!.life!.low.value = '0.000001';
    },
  ],
  [
    'residual exceeds cost',
    (s) => {
      s.residualPolicy = 'reviewed_estimate';
      s.residual = usd(999999n);
    },
  ],
];
it.each(invalid)('rejects invalid scenario %s', (_name, change) => {
  const s = base();
  change(s);
  expect(estimateScenario(s).ok).toBe(false);
});
