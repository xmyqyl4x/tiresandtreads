import { it, expect } from 'vitest';
import { evaluate } from '../../packages/engine/src/evaluate.ts';
import { normalizeAssessment, sizeCode } from '../../packages/engine/src/input.ts';
import {
  engineFixture,
  alternative,
  partial,
  uuid,
  type EngineFixture,
} from '../fixtures/engine/base.ts';
function run(f: EngineFixture) {
  const parsed = normalizeAssessment(f.request);
  if (!parsed.ok) throw Error('bad fixture');
  const result = evaluate(parsed.value, f.snapshot);
  if (!result.ok) throw Error('bad fixture snapshot');
  return result.value;
}
function json(x: unknown) {
  return JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}
function freeze(x: unknown) {
  if (x && typeof x === 'object') {
    for (const v of Object.values(x)) freeze(v);
    Object.freeze(x);
  }
}
it('preserves byte-equivalent results under 100 seeded permutations and commercial sidecars', () => {
  let seed = 0x1701;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  const f = engineFixture();
  alternative(f);
  const baseline = json(run(f));
  for (let i = 0; i < 100; i++) {
    const changed = structuredClone(f);
    if (next() % 2) changed.snapshot.plans.reverse();
    if (next() % 2) changed.snapshot.sources.reverse();
    for (const p of changed.snapshot.plans) {
      if (next() % 2) p.front.measurements.reverse();
      Object.assign(p, { affiliateRate: next(), offerBid: next(), sponsorId: uuid(next()) });
    }
    Object.assign(changed.snapshot, { adSlot: next(), commission: next() });
    expect(json(run(changed))).toBe(baseline);
  }
});
it('keeps eligibility monotone in load and speed requirements across 256 boundary values', () => {
  for (let n = 0; n < 128; n++)
    for (const field of ['loadIndex', 'speedRank'] as const) {
      const f = engineFixture();
      f.snapshot.plans[0]!.front[field] = n;
      const first = run(f).decisions[0]!;
      expect(first.status === 'eligible').toBe(n >= (field === 'loadIndex' ? 98 : 12));
    }
});
it('never lets any budget or price change a safety decision', () => {
  for (const ceiling of ['0', '1', '80000', '9007199254740993', '9223372036854775807']) {
    const f = engineFixture();
    alternative(f);
    f.snapshot.plans[0]!.front.loadIndex = 90;
    const baseline = run(f).decisions.map((d) => [d.id, d.status]);
    f.request.budget = { basis: 'installed', currency: 'USD', ceilingMinor: ceiling };
    expect(run(f).decisions.map((d) => [d.id, d.status])).toEqual(baseline);
    expect(run(f).picks).not.toContain(uuid(101));
  }
});
it('does not mutate frozen inputs and returns immutable versioned decisions', () => {
  const f = engineFixture(),
    before = json(f);
  freeze(f);
  const r = run(f);
  expect(json(f)).toBe(before);
  expect(Object.isFrozen(r)).toBe(true);
  expect(Object.isFrozen(r.decisions[0]!.reasons)).toBe(true);
  expect(r.versions.datasets).toEqual(f.snapshot.sources.map((s) => s.datasetId).sort());
  expect(r.issuanceAuthorized).toBe(false);
});
it('keeps exact budget comparisons beyond JavaScript safe integers and accepts a known zero price', () => {
  const f = engineFixture();
  f.request.budget = { basis: 'installed', currency: 'USD', ceilingMinor: '9007199254740993' };
  f.snapshot.plans[0]!.cost!.amountMinor = 9007199254740994n;
  expect(run(f).aboveBudget).toEqual([uuid(101)]);
  f.snapshot.plans[0]!.cost!.amountMinor = 9007199254740993n;
  expect(run(f).picks).toEqual([uuid(101)]);
  f.snapshot.plans[0]!.cost!.amountMinor = 0n;
  f.request.budget.ceilingMinor = '0';
  expect(run(f).picks).toEqual([uuid(101)]);
});
it('returns the actual supported count from zero to ten and caps each shortlist at five', () => {
  for (let count = 0; count <= 10; count++) {
    const f = engineFixture(),
      p = f.snapshot.plans[0]!;
    f.snapshot.plans = Array.from({ length: count }, (_, i) => ({ ...p, id: uuid(100 + i) }));
    const r = run(f);
    expect(r.picks).toHaveLength(Math.min(count, 5));
    expect(new Set(r.picks).size).toBe(r.picks.length);
  }
});
it('bounds candidate and evidence work and refuses invalid identities or scoring contracts', () => {
  const changes: ((s: EngineFixture['snapshot']) => void)[] = [
    (s) => {
      s.policy.id = 'bad';
    },
    (s) => {
      s.asOf = 'bad';
    },
    (s) => {
      s.bundleId = 'bad';
    },
    (s) => {
      s.plans.push(s.plans[0]!);
    },
    (s) => {
      s.plans[0]!.id = 'bad';
    },
    (s) => {
      s.sources.push(s.sources[0]!);
    },
    (s) => {
      s.sources[0]!.providerId = 'bad';
    },
    (s) => {
      s.policy.version = '';
    },
    (s) => {
      s.policy.scoringVersion = '';
    },
    (s) => {
      Object.assign(s.policy.weights, { bid: 1 });
    },
    (s) => {
      s.policy.weights.wet = -1;
    },
    (s) => {
      s.policy.weights.wet = 0.5;
    },
    (s) => {
      s.policy.weights.wet = 10001;
    },
    (s) => {
      s.policy.weights = {};
    },
    (s) => {
      s.plans = Array.from({ length: 1001 }, (_, i) => ({ ...s.plans[0]!, id: uuid(i + 1000) }));
    },
    (s) => {
      s.sources = Array.from({ length: 17 }, (_, i) => ({
        ...s.sources[0]!,
        datasetId: uuid(i + 1000),
      }));
    },
    (s) => {
      s.plans[0]!.front.id = 'bad';
    },
    (s) => {
      s.plans[0]!.front.modelId = 'bad';
    },
    (s) => {
      s.plans[0]!.front.measurements = Array(10).fill(s.plans[0]!.front.measurements[0]);
    },
    (s) => {
      s.plans[0]!.front.recall.targetRefs = Array(1001).fill(uuid(1));
    },
    (s) => {
      s.policy.seasonal = Array(13).fill(s.policy.seasonal[0]);
    },
    (s) => {
      s.fitment!.axles = Array(5).fill(s.fitment!.axles[0]);
    },
    (s) => {
      s.fitment!.replacement!.patterns = Array(16).fill(['rear_left']);
    },
    (s) => {
      s.fitment!.replacement!.permittedModelPairs = Array(101).fill({
        front: uuid(1),
        rear: uuid(2),
      });
    },
  ];
  for (const change of changes) {
    const f = engineFixture();
    change(f.snapshot);
    const input = normalizeAssessment(f.request);
    if (!input.ok) throw Error('fixture');
    expect(evaluate(input.value, f.snapshot).ok).toBe(false);
  }
  const f = engineFixture();
  partial(f);
  f.snapshot.plans[0]!.inspection!.wheels.push(f.snapshot.plans[0]!.inspection!.wheels[0]!);
  const input = normalizeAssessment(f.request);
  if (!input.ok) throw Error('fixture');
  expect(evaluate(input.value, f.snapshot).ok).toBe(false);
});
it('handles incomplete inputs and invalid evidence without inventing a safety pass or a metric', () => {
  const changes: ((f: EngineFixture) => void)[] = [
    (f) => {
      f.snapshot.policy.reviewedBy = null;
    },
    (f) => {
      f.snapshot.policy.reviewedBy = 'bad';
    },
    (f) => {
      f.snapshot.policy.reviewedAt = null;
    },
    (f) => {
      f.snapshot.policy.reviewedAt = '2099-01-01T00:00:00.000Z';
    },
    (f) => {
      f.snapshot.fitment = null;
    },
    (f) => {
      f.snapshot.fitment!.axles[0]!.minLoadIndex = 0;
    },
    (f) => {
      f.snapshot.plans[0]!.front.loadIndex = 1001;
    },
    (f) => {
      f.snapshot.plans[0]!.front.speedRank = NaN;
    },
    (f) => {
      f.snapshot.sources[1]!.fetchedAt = '2099-01-01T00:00:00.000Z';
    },
    (f) => {
      partial(f);
      f.snapshot.plans[0]!.inspection!.retainedCondition = 'unknown';
    },
  ];
  for (const change of changes) {
    const f = engineFixture();
    change(f);
    expect(run(f).decisions[0]!.status).toBe('unverified');
  }
  const f = engineFixture();
  partial(f);
  f.snapshot.plans[0]!.inspection!.retainedCondition = 'rejected';
  expect(run(f).decisions[0]!.reasons).toContain('RETAINED_TIRE_CONDITION');
  for (const patch of [
    { valueBp: -1 },
    { valueBp: 10001 },
    { valueBp: null },
    { valueBp: NaN },
    { validUntil: f.snapshot.asOf },
    { confidence: 'unknown' },
  ]) {
    const next = engineFixture();
    Object.assign(next.snapshot.plans[0]!.front.measurements[0]!, patch);
    expect(run(next).decisions[0]!.scoreBp).toBeNull();
  }
});
it('rejects malformed and extended driver inputs instead of coercing units, currencies or paid terms', () => {
  const r = engineFixture().request;
  const invalid: unknown[] = [
    null,
    [],
    0,
    {},
    { ...r, affiliateBid: 0 },
    { ...r, configurationId: 'bad' },
    { ...r, market: 'CA' },
    { ...r, regionKey: null },
    { ...r, regionKey: 'unknown region!' },
    { ...r, wheelPackage: '' },
    { ...r, wheelPackage: 1 },
    { ...r, wheelPackage: 'x'.repeat(201) },
    { ...r, strategy: [] },
    { ...r, strategy: 'winter' },
    { ...r, winterUse: [] },
    { ...r, winterUse: 'maybe' },
    ...[
      null,
      [],
      ['rear_left', 'rear_left'],
      ['rear_left', 'front_left', 'front_right'],
      ['axle'],
    ].map((replace) => ({ ...r, replace })),
    ...[null, ['wet', 'wet'], ['wet', 'dry', 'comfort', 'snow'], ['ad_revenue']].map(
      (priorities) => ({ ...r, priorities }),
    ),
    ...[0, {}, { front: '225/45R18', rear: 'bad size' }, { front: 4, rear: '255/40R18' }].map(
      (sizes) => ({ ...r, sizes }),
    ),
    ...[
      0,
      {},
      { basis: 'installed', currency: 'EUR', ceilingMinor: '1' },
      { basis: [], currency: 'USD', ceilingMinor: '1' },
      { basis: 'per_tire', currency: 'USD', ceilingMinor: '1' },
      { basis: 'installed', currency: 'USD', ceilingMinor: 1 },
      { basis: 'installed', currency: 'USD', ceilingMinor: '-1' },
    ].map((budget) => ({ ...r, budget })),
  ];
  for (const raw of invalid) expect(normalizeAssessment(raw).ok).toBe(false);
  expect(sizeCode(null)).toBeNull();
  expect(sizeCode('')).toBeNull();
});
it('scores zero-weight dimensions only when explicitly enabled and does not reuse model-level evidence', () => {
  const f = engineFixture();
  f.snapshot.policy.weights.dry = 0;
  f.request.priorities = ['dry'];
  expect(run(f).decisions[0]!.reasons).toContain('PRIORITY_UNSUPPORTED');
  f.snapshot.policy.comparisonKeys = {};
  expect(run(f).decisions[0]!.scoreBp).toBeNull();
  const fresh = engineFixture(),
    p = fresh.snapshot.plans[0]!;
  p.front.measurements.push({ ...p.front.measurements[0]! });
  expect(run(fresh).decisions[0]!.reasons).toContain('EVIDENCE_MISSING');
});
it('evaluates a bounded 1,000-plan synthetic portfolio with stable results', () => {
  const f = engineFixture(),
    p = f.snapshot.plans[0]!;
  f.snapshot.plans = Array.from({ length: 1000 }, (_, i) => ({ ...p, id: uuid(i + 1000) }));
  const started = performance.now(),
    result = run(f);
  expect(result.decisions).toHaveLength(1000);
  expect(result.picks).toHaveLength(5);
  console.log(
    'ENGINE_PORTFOLIO_EVIDENCE',
    JSON.stringify({
      plans: 1000,
      decisions: result.decisions.length,
      picks: result.picks.length,
      elapsedMs: Math.round(performance.now() - started),
      synthetic: true,
    }),
  );
});
