import {
  positions,
  type AssessmentInput,
  type EngineSnapshot,
  type Plan,
  type Position,
  type Sku,
} from '../../../packages/engine/src/model.ts';
export type Mutable<T> = T extends readonly (infer V)[]
  ? Mutable<V>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;
export const uuid = (n: number) => '10000000-0000-4000-8000-' + n.toString().padStart(12, '0');
export const asOf = '2026-10-25T12:00:00.000Z';
const from = '2026-10-24T00:00:00.000Z',
  until = '2026-11-01T00:00:00.000Z';
export function engineFixture() {
  const snapshot: Mutable<EngineSnapshot> = {
    bundleId: uuid(1),
    asOf,
    sources: (['fitment', 'catalog', 'recall', 'policy', 'climate', 'market_rules'] as const).map(
      (kind, i) => ({
        datasetId: uuid(i + 2),
        providerId: uuid(20 + i),
        licenseId: uuid(30 + i),
        market: 'US',
        kind,
        fetchedAt: from,
        validUntil: until,
        rights: { display: true, api: true, derived: true, cache: true, snapshot: true },
      }),
    ),
    policy: {
      regionKey: 'SYNTHETIC_US',
      climateSourceId: uuid(6),
      marketRulesSourceId: uuid(7),
      version: 'synthetic-rules-1',
      scoringVersion: 'synthetic-minimum-axle-1',
      sourceId: uuid(5),
      reviewed: true,
      reviewDueAt: until,
      weights: { wet: 50, comfort: 50 },
      comparisonKeys: {
        wet: 'synthetic-benchmark-wet-bp-v1',
        comfort: 'synthetic-benchmark-comfort-bp-v1',
      },
      seasonal: [
        {
          strategy: 'year_round',
          winterUse: 'none',
          classes: ['all_season', 'all_weather'],
          require3pmsf: false,
        },
        { strategy: 'year_round', winterUse: 'snow', classes: ['all_weather'], require3pmsf: true },
        {
          strategy: 'summer_set',
          winterUse: 'none',
          classes: ['summer', 'all_season', 'all_weather'],
          require3pmsf: false,
        },
        { strategy: 'winter_set', winterUse: 'snow', classes: ['winter'], require3pmsf: true },
        { strategy: 'winter_set', winterUse: 'ice', classes: ['winter'], require3pmsf: true },
      ],
    },
    fitment: {
      id: uuid(40),
      sourceId: uuid(2),
      wheelPackage: 'Synthetic staggered 18',
      verified: true,
      drivetrain: 'FWD',
      axles: (['front', 'rear'] as const).map((axle) => ({
        axle,
        quantity: 2,
        sizeCode: axle === 'front' ? '225/45R18' : '255/40R18',
        rimInches: '18',
        construction: 'radial',
        minLoadIndex: 98,
        minSpeedRank: 12,
        loadRange: 'not_required',
        xlRequired: false,
        runFlatRequired: false,
        unknownConstraints: [],
      })),
      replacement: {
        patterns: [[...positions]],
        maxTreadDifferenceUm: null,
        maxCircumferenceDifferenceUm: null,
        permittedModelPairs: [],
      },
    },
    recall: { datasetId: uuid(4), checkedAt: '2026-10-25T08:00:00.000Z', complete: true },
    plans: [],
  };
  function sku(id: number, size: string): Mutable<Sku> {
    return {
      id: uuid(id),
      sourceId: uuid(3),
      modelId: uuid(301),
      sizeCode: size,
      rimInches: '18',
      construction: 'radial',
      loadIndex: 100,
      speedRank: 14,
      loadRange: null,
      xl: false,
      runFlat: false,
      season: 'all_season',
      threePmsf: false,
      available: true,
      availabilityUntil: until,
      recall: { sourceId: uuid(4), state: 'clear', targetRefs: [] },
      measurements: (['wet', 'comfort'] as const).map((metric, i) => ({
        metric,
        skuId: uuid(id),
        sourceId: uuid(3),
        valueBp: i ? 6000 : 8000,
        comparisonKey: 'synthetic-benchmark-' + metric + '-bp-v1',
        reviewedAt: from,
        validUntil: until,
        confidence: 'high',
      })),
    };
  }
  snapshot.plans.push({
    id: uuid(101),
    front: sku(201, '225/45R18'),
    rear: sku(202, '255/40R18'),
    inspection: null,
    cost: {
      basis: 'installed',
      currency: 'USD',
      quantity: 4,
      amountMinor: 80000n,
      sourceId: uuid(3),
      validUntil: until,
    },
  });
  const request = {
    regionKey: 'SYNTHETIC_US',
    market: 'US',
    configurationId: uuid(40),
    wheelPackage: 'Synthetic staggered 18',
    sizes: null,
    strategy: 'year_round',
    winterUse: 'none',
    replace: [...positions],
    priorities: [],
    budget: null,
  } as {
    -readonly [K in keyof AssessmentInput]: K extends 'budget'
      ? { basis: 'installed' | 'merchandise'; currency: 'USD'; ceilingMinor: string } | null
      : Mutable<AssessmentInput[K]>;
  };
  return { snapshot, request };
}
export type EngineFixture = ReturnType<typeof engineFixture>;
export function alternative(f: EngineFixture) {
  const p = structuredClone(f.snapshot.plans[0]!) as Mutable<Plan>;
  p.id = uuid(102);
  p.front.id = uuid(203);
  p.rear.id = uuid(204);
  p.front.modelId = uuid(302);
  p.rear.modelId = uuid(302);
  for (const axle of ['front', 'rear'] as const)
    for (const m of p[axle].measurements) m.skuId = p[axle].id;
  f.snapshot.plans.push(p);
  return p;
}
export function partial(f: EngineFixture, replace: Position[] = ['rear_left', 'rear_right']) {
  f.request.replace = replace;
  const policy = f.snapshot.fitment!.replacement!;
  policy.patterns.push(replace);
  policy.maxTreadDifferenceUm = 1000;
  policy.maxCircumferenceDifferenceUm = 1000;
  const p = f.snapshot.plans[0]!;
  p.inspection = {
    retainedCondition: 'accepted',
    referenceId: uuid(50),
    configurationId: f.snapshot.fitment!.id,
    planId: p.id,
    replaced: [...replace],
    reviewedAt: from,
    validUntil: until,
    wheels: positions.map((position) => ({
      position,
      skuId: p[position.startsWith('front') ? 'front' : 'rear'].id,
      treadUm: 8000,
      circumferenceUm: 2000000,
    })),
  };
  p.cost!.quantity = replace.length;
}
