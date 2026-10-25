import type { Reason } from '../../../packages/engine/src/model.ts';
import { alternative, partial, uuid, type EngineFixture } from './base.ts';
export interface GoldenScenario {
  readonly name: string;
  readonly change: (f: EngineFixture) => void;
  readonly status?: 'eligible' | 'blocked' | 'unverified';
  readonly reason?: Reason;
  readonly score?: number | null;
  readonly picks?: readonly string[];
}
const eachSku = (
  f: EngineFixture,
  update: (sku: EngineFixture['snapshot']['plans'][number]['front']) => void,
) => {
  for (const s of [f.snapshot.plans[0]!.front, f.snapshot.plans[0]!.rear]) update(s);
};
const front = (f: EngineFixture) => f.snapshot.plans[0]!.front;
const plan = (f: EngineFixture) => f.snapshot.plans[0]!;
const axle = (f: EngineFixture) => f.snapshot.fitment!.axles[0]!;
export const goldenScenarios: readonly GoldenScenario[] = [
  {
    name: 'Regional policy cannot be reused in another region',
    change: (f) => {
      f.request.regionKey = 'SYNTHETIC_OTHER';
    },
    status: 'unverified',
    reason: 'REGIONAL_POLICY_UNCONFIRMED',
  },
  {
    name: 'Missing climate provenance is not supplied by a driver preference',
    change: (f) => {
      f.snapshot.policy.climateSourceId = uuid(999);
    },
    status: 'unverified',
    reason: 'SOURCE_UNAVAILABLE',
  },
  {
    name: 'Expired regional guidance prevents verified eligibility',
    change: (f) => {
      f.snapshot.sources[4]!.validUntil = f.snapshot.asOf;
    },
    status: 'unverified',
    reason: 'SOURCE_UNAVAILABLE',
  },
  { name: 'Verified staggered full replacement', change: () => {} },
  {
    name: 'Ambiguous wheel package',
    change: (f) => {
      f.request.wheelPackage = null;
    },
    status: 'unverified',
    reason: 'WHEEL_PACKAGE_UNCONFIRMED',
  },
  {
    name: 'Size-only does not establish vehicle fitment',
    change: (f) => {
      f.request.configurationId = null;
      f.request.sizes = { front: '225/45R18', rear: '255/40R18' };
    },
    status: 'unverified',
    reason: 'FITMENT_UNCONFIRMED',
  },
  {
    name: 'Unreviewed fitment stays unverified',
    change: (f) => {
      f.snapshot.fitment!.verified = false;
    },
    status: 'unverified',
    reason: 'FITMENT_UNCONFIRMED',
  },
  {
    name: 'User size conflicts with resolved package',
    change: (f) => {
      f.request.sizes = { front: '245/45R18', rear: '255/40R18' };
    },
    status: 'unverified',
    reason: 'FITMENT_SIZE_CONFLICT',
  },
  {
    name: 'Wrong front axle size',
    change: (f) => {
      front(f).sizeCode = '255/40R18';
    },
    status: 'blocked',
    reason: 'SIZE_MISMATCH',
  },
  {
    name: 'Wrong rear axle size',
    change: (f) => {
      plan(f).rear.sizeCode = '225/45R18';
    },
    status: 'blocked',
    reason: 'SIZE_MISMATCH',
  },
  {
    name: 'Passenger prefix is not silently removed',
    change: (f) => {
      front(f).sizeCode = 'P225/45R18';
    },
    status: 'blocked',
    reason: 'SIZE_MISMATCH',
  },
  {
    name: 'Light truck prefix is not equated with passenger size',
    change: (f) => {
      front(f).sizeCode = 'LT225/45R18';
    },
    status: 'blocked',
    reason: 'SIZE_MISMATCH',
  },
  {
    name: 'Rim mismatch',
    change: (f) => {
      front(f).rimInches = '19';
    },
    status: 'blocked',
    reason: 'RIM_MISMATCH',
  },
  {
    name: 'Malformed rim cannot pass',
    change: (f) => {
      front(f).rimInches = 'unknown';
    },
    status: 'blocked',
    reason: 'RIM_MISMATCH',
  },
  {
    name: 'Construction mismatch',
    change: (f) => {
      front(f).construction = 'bias';
    },
    status: 'blocked',
    reason: 'CONSTRUCTION_MISMATCH',
  },
  {
    name: 'Insufficient load',
    change: (f) => {
      front(f).loadIndex = 97;
    },
    status: 'blocked',
    reason: 'INSUFFICIENT_LOAD',
  },
  {
    name: 'Insufficient speed',
    change: (f) => {
      front(f).speedRank = 11;
    },
    status: 'blocked',
    reason: 'INSUFFICIENT_SPEED',
  },
  {
    name: 'Unknown required load',
    change: (f) => {
      axle(f).minLoadIndex = null;
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Unknown SKU load',
    change: (f) => {
      front(f).loadIndex = null;
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Unknown required speed',
    change: (f) => {
      axle(f).minSpeedRank = null;
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Unknown SKU speed',
    change: (f) => {
      front(f).speedRank = null;
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Unknown XL requirement',
    change: (f) => {
      axle(f).xlRequired = null;
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Unknown run-flat requirement',
    change: (f) => {
      axle(f).runFlatRequired = null;
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Unknown load-range requirement',
    change: (f) => {
      axle(f).loadRange = null;
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Required XL missing',
    change: (f) => {
      axle(f).xlRequired = true;
    },
    status: 'blocked',
    reason: 'XL_REQUIRED',
  },
  {
    name: 'Required XL unknown',
    change: (f) => {
      axle(f).xlRequired = true;
      front(f).xl = null;
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Required run-flat missing',
    change: (f) => {
      axle(f).runFlatRequired = true;
    },
    status: 'blocked',
    reason: 'RUN_FLAT_REQUIRED',
  },
  {
    name: 'Required run-flat unknown',
    change: (f) => {
      axle(f).runFlatRequired = true;
      front(f).runFlat = null;
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Load ranges are exact constraints',
    change: (f) => {
      axle(f).loadRange = 'E';
      front(f).loadRange = 'D';
    },
    status: 'blocked',
    reason: 'LOAD_RANGE_MISMATCH',
  },
  {
    name: 'Required load range unknown on SKU',
    change: (f) => {
      axle(f).loadRange = 'E';
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Missing rear axle',
    change: (f) => {
      f.snapshot.fitment!.axles.pop();
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Unsupported wheel quantity',
    change: (f) => {
      axle(f).quantity = 4;
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Duplicate axle requirements',
    change: (f) => {
      f.snapshot.fitment!.axles.push(structuredClone(axle(f)));
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Unknown drivetrain',
    change: (f) => {
      f.snapshot.fitment!.drivetrain = null;
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Unresolved OE constraint',
    change: (f) => {
      axle(f).unknownConstraints = ['unresolved OE instruction'];
    },
    status: 'unverified',
    reason: 'FITMENT_CONSTRAINT_UNKNOWN',
  },
  {
    name: 'Winter-only cannot be a year-round pick',
    change: (f) => {
      eachSku(f, (s) => (s.season = 'winter'));
    },
    status: 'blocked',
    reason: 'SEASONAL_STRATEGY_MISMATCH',
  },
  {
    name: 'Winter-set request cannot use all-season label alone',
    change: (f) => {
      f.request.strategy = 'winter_set';
      f.request.winterUse = 'snow';
    },
    status: 'blocked',
    reason: 'SEASONAL_STRATEGY_MISMATCH',
  },
  {
    name: 'Reviewed winter-set scope',
    change: (f) => {
      f.request.strategy = 'winter_set';
      f.request.winterUse = 'snow';
      eachSku(f, (s) => {
        s.season = 'winter';
        s.threePmsf = true;
      });
    },
  },
  {
    name: 'Snow policy rejects unsupported all-season class',
    change: (f) => {
      f.request.winterUse = 'snow';
    },
    status: 'blocked',
    reason: 'SEASONAL_STRATEGY_MISMATCH',
  },
  {
    name: 'All-weather label does not establish snow marking',
    change: (f) => {
      f.request.winterUse = 'snow';
      eachSku(f, (s) => (s.season = 'all_weather'));
    },
    status: 'blocked',
    reason: 'WINTER_MARK_REQUIRED',
  },
  {
    name: 'Unknown snow marking',
    change: (f) => {
      f.request.winterUse = 'snow';
      eachSku(f, (s) => {
        s.season = 'all_weather';
        s.threePmsf = null;
      });
    },
    status: 'unverified',
    reason: 'WINTER_MARK_UNKNOWN',
  },
  {
    name: 'Reviewed all-weather snow scope with explicit marking',
    change: (f) => {
      f.request.winterUse = 'snow';
      eachSku(f, (s) => {
        s.season = 'all_weather';
        s.threePmsf = true;
      });
    },
  },
  {
    name: 'Unknown climate is not guessed from location',
    change: (f) => {
      f.request.winterUse = 'unknown';
    },
    status: 'unverified',
    reason: 'CLIMATE_UNKNOWN',
  },
  {
    name: 'Missing seasonal policy',
    change: (f) => {
      f.snapshot.policy.seasonal = [];
    },
    status: 'unverified',
    reason: 'SEASONAL_POLICY_UNKNOWN',
  },
  {
    name: 'Conflicting seasonal policies',
    change: (f) => {
      f.snapshot.policy.seasonal.push(structuredClone(f.snapshot.policy.seasonal[0]!));
    },
    status: 'unverified',
    reason: 'SEASONAL_POLICY_UNKNOWN',
  },
  {
    name: 'Unknown seasonal class',
    change: (f) => {
      front(f).season = null;
    },
    status: 'unverified',
    reason: 'SEASONAL_POLICY_UNKNOWN',
  },
  {
    name: 'Summer tire restricted to separate summer strategy',
    change: (f) => {
      f.request.strategy = 'summer_set';
      eachSku(f, (s) => (s.season = 'summer'));
    },
  },
  {
    name: 'Unknown availability',
    change: (f) => {
      front(f).available = null;
    },
    status: 'unverified',
    reason: 'AVAILABILITY_UNKNOWN',
  },
  {
    name: 'Known unavailable product',
    change: (f) => {
      front(f).available = false;
    },
    status: 'blocked',
    reason: 'MARKET_UNAVAILABLE',
  },
  {
    name: 'Expired availability observation',
    change: (f) => {
      front(f).availabilityUntil = f.snapshot.asOf;
    },
    status: 'unverified',
    reason: 'AVAILABILITY_UNKNOWN',
  },
  {
    name: 'Matched recall remains an exclusion with target reference',
    change: (f) => {
      front(f).recall.state = 'matched';
      front(f).recall.targetRefs = [uuid(70)];
    },
    status: 'blocked',
    reason: 'RECALL_MATCHED',
  },
  {
    name: 'Unresolved DOT mapping cannot clear the product',
    change: (f) => {
      front(f).recall.state = 'unresolved';
    },
    status: 'unverified',
    reason: 'RECALL_REVIEW_REQUIRED',
  },
  {
    name: 'Unknown recall status',
    change: (f) => {
      front(f).recall.state = 'unknown';
    },
    status: 'unverified',
    reason: 'RECALL_REVIEW_REQUIRED',
  },
  {
    name: 'Recall receipt bound to another dataset',
    change: (f) => {
      front(f).recall.sourceId = uuid(999);
    },
    status: 'unverified',
    reason: 'RECALL_REVIEW_REQUIRED',
  },
  {
    name: 'Exact 48-hour recall boundary is stale',
    change: (f) => {
      f.snapshot.recall.checkedAt = '2026-10-23T12:00:00.000Z';
    },
    status: 'unverified',
    reason: 'RECALL_STALE',
  },
  {
    name: 'Recall check immediately inside 48-hour limit',
    change: (f) => {
      f.snapshot.recall.checkedAt = '2026-10-23T12:00:00.001Z';
    },
  },
  {
    name: 'Future recall check cannot establish freshness',
    change: (f) => {
      f.snapshot.recall.checkedAt = '2026-10-26T12:00:00.000Z';
    },
    status: 'unverified',
    reason: 'RECALL_STALE',
  },
  {
    name: 'Incomplete recall scope',
    change: (f) => {
      f.snapshot.recall.complete = false;
    },
    status: 'unverified',
    reason: 'RECALL_STALE',
  },
  {
    name: 'Expired catalog license',
    change: (f) => {
      f.snapshot.sources[1]!.validUntil = f.snapshot.asOf;
    },
    status: 'unverified',
    reason: 'SOURCE_UNAVAILABLE',
  },
  {
    name: 'Derived-use rights absent',
    change: (f) => {
      f.snapshot.sources[1]!.rights.derived = false;
    },
    status: 'unverified',
    reason: 'SOURCE_UNAVAILABLE',
  },
  {
    name: 'Pending specialist policy review',
    change: (f) => {
      f.snapshot.policy.reviewed = false;
    },
    status: 'unverified',
    reason: 'POLICY_REVIEW_REQUIRED',
  },
  {
    name: 'Policy review expired',
    change: (f) => {
      f.snapshot.policy.reviewDueAt = f.snapshot.asOf;
    },
    status: 'unverified',
    reason: 'POLICY_REVIEW_REQUIRED',
  },
  {
    name: 'Missing fitment provenance',
    change: (f) => {
      f.snapshot.fitment!.sourceId = uuid(999);
    },
    status: 'unverified',
    reason: 'SOURCE_UNAVAILABLE',
  },
  {
    name: 'No replacement policy even for full set',
    change: (f) => {
      f.snapshot.fitment!.replacement = null;
    },
    status: 'unverified',
    reason: 'REPLACEMENT_POLICY_UNKNOWN',
  },
  {
    name: 'Partial replacement without inspection proof',
    change: (f) => {
      partial(f);
      plan(f).inspection = null;
    },
    status: 'unverified',
    reason: 'INSPECTION_REQUIRED',
  },
  { name: 'Explicit inspected rear-pair replacement', change: (f) => partial(f) },
  {
    name: 'AWD partial replacement has no generic tolerance',
    change: (f) => {
      partial(f);
      f.snapshot.fitment!.drivetrain = 'AWD';
      f.snapshot.fitment!.replacement!.maxCircumferenceDifferenceUm = null;
    },
    status: 'unverified',
    reason: 'REPLACEMENT_MEASUREMENTS_UNKNOWN',
  },
  {
    name: 'AWD tread tolerance exceeded',
    change: (f) => {
      partial(f);
      f.snapshot.fitment!.drivetrain = 'AWD';
      plan(f).inspection!.wheels[0]!.treadUm = 6000;
    },
    status: 'blocked',
    reason: 'TREAD_DIFFERENCE_EXCEEDED',
  },
  {
    name: 'AWD rolling circumference tolerance exceeded',
    change: (f) => {
      partial(f);
      f.snapshot.fitment!.drivetrain = 'AWD';
      plan(f).inspection!.wheels[0]!.circumferenceUm = 2001001;
    },
    status: 'blocked',
    reason: 'CIRCUMFERENCE_DIFFERENCE_EXCEEDED',
  },
  {
    name: 'AWD full matching replacement',
    change: (f) => {
      f.snapshot.fitment!.drivetrain = 'AWD';
    },
  },
  {
    name: 'Unapproved partial replacement pattern',
    change: (f) => {
      partial(f);
      f.snapshot.fitment!.replacement!.patterns = [
        ['front_left', 'front_right', 'rear_left', 'rear_right'],
      ];
    },
    status: 'blocked',
    reason: 'REPLACEMENT_PATTERN_UNAPPROVED',
  },
  {
    name: 'Unreviewed mixed front/rear models',
    change: (f) => {
      plan(f).rear.modelId = uuid(399);
    },
    status: 'blocked',
    reason: 'MODEL_MIX_UNAPPROVED',
  },
  {
    name: 'Explicitly reviewed model pair',
    change: (f) => {
      plan(f).rear.modelId = uuid(399);
      f.snapshot.fitment!.replacement!.permittedModelPairs = [
        { front: front(f).modelId, rear: uuid(399) },
      ];
    },
  },
  {
    name: 'Inspection proof expired',
    change: (f) => {
      partial(f);
      plan(f).inspection!.validUntil = f.snapshot.asOf;
    },
    status: 'unverified',
    reason: 'INSPECTION_REQUIRED',
  },
  {
    name: 'Inspection belongs to another plan',
    change: (f) => {
      partial(f);
      plan(f).inspection!.planId = uuid(999);
    },
    status: 'unverified',
    reason: 'INSPECTION_REQUIRED',
  },
  {
    name: 'Inspection names another fitted SKU',
    change: (f) => {
      partial(f);
      plan(f).inspection!.wheels[0]!.skuId = uuid(999);
    },
    status: 'unverified',
    reason: 'INSPECTION_REQUIRED',
  },
  {
    name: 'Inspection omits a retained wheel',
    change: (f) => {
      partial(f);
      plan(f).inspection!.wheels.pop();
    },
    status: 'unverified',
    reason: 'INSPECTION_REQUIRED',
  },
  {
    name: 'Missing measured tread remains unknown',
    change: (f) => {
      partial(f);
      plan(f).inspection!.wheels[0]!.treadUm = null;
    },
    status: 'unverified',
    reason: 'REPLACEMENT_MEASUREMENTS_UNKNOWN',
  },
  {
    name: 'Exact approved tread difference boundary',
    change: (f) => {
      partial(f);
      plan(f).inspection!.wheels[0]!.treadUm = 7000;
    },
  },
  {
    name: 'Exact approved circumference difference boundary',
    change: (f) => {
      partial(f);
      plan(f).inspection!.wheels[0]!.circumferenceUm = 2001000;
    },
  },
  {
    name: 'Single replacement needs explicitly approved pattern and inspection',
    change: (f) => partial(f, ['rear_right']),
  },
  {
    name: 'Missing performance metric does not become zero',
    change: (f) => {
      front(f).measurements.pop();
    },
    score: null,
    reason: 'EVIDENCE_MISSING',
  },
  {
    name: 'Incompatible evidence method suppresses numeric scores',
    change: (f) => {
      front(f).measurements[0]!.comparisonKey = 'unrelated-test';
    },
    score: null,
    reason: 'EVIDENCE_NOT_COMPARABLE',
  },
  {
    name: 'Model-family evidence cannot transfer to a SKU',
    change: (f) => {
      front(f).measurements[0]!.skuId = uuid(301);
    },
    score: null,
    reason: 'EVIDENCE_MISSING',
  },
  {
    name: 'Measured zero is known evidence',
    change: (f) => {
      eachSku(f, (s) => (s.measurements[0]!.valueBp = 0));
    },
    score: 3000,
  },
  {
    name: 'Wet priority multiplier is normalized exactly',
    change: (f) => {
      f.request.priorities = ['wet'];
    },
    score: 7333,
  },
  {
    name: 'Comfort priority multiplier is normalized exactly',
    change: (f) => {
      f.request.priorities = ['comfort'];
    },
    score: 6667,
  },
  {
    name: 'Sparse competitor suppresses numeric precision for entire cohort',
    change: (f) => {
      alternative(f).front.measurements.pop();
    },
    score: null,
    picks: [uuid(101), uuid(102)],
    reason: 'EVIDENCE_MISSING',
  },
  {
    name: 'Evidence confidence breaks equal scores',
    change: (f) => {
      alternative(f);
      eachSku(f, (s) => {
        for (const m of s.measurements) m.confidence = 'low';
      });
    },
    picks: [uuid(102), uuid(101)],
  },
  {
    name: 'Stable identifier breaks exact ties regardless of input order',
    change: (f) => {
      alternative(f);
      f.snapshot.plans.reverse();
    },
    picks: [uuid(101), uuid(102)],
  },
  {
    name: 'Comparable installed cost breaks equal evidence ties',
    change: (f) => {
      alternative(f).cost!.amountMinor = 70000n;
    },
    picks: [uuid(102), uuid(101)],
  },
  {
    name: 'Missing cost cannot beat a known comparable price',
    change: (f) => {
      alternative(f).cost = null;
    },
    picks: [uuid(101), uuid(102)],
  },
  {
    name: 'Above-budget eligible options are separate',
    change: (f) => {
      f.request.budget = { basis: 'installed', currency: 'USD', ceilingMinor: '70000' };
    },
    picks: [],
    reason: 'ABOVE_BUDGET',
  },
  {
    name: 'Missing installed cost cannot claim budget compliance',
    change: (f) => {
      f.request.budget = { basis: 'installed', currency: 'USD', ceilingMinor: '90000' };
      plan(f).cost = null;
    },
    picks: [],
    reason: 'BUDGET_UNVERIFIED',
  },
  {
    name: 'Merchandise cost cannot satisfy installed budget',
    change: (f) => {
      f.request.budget = { basis: 'installed', currency: 'USD', ceilingMinor: '90000' };
      plan(f).cost!.basis = 'merchandise';
    },
    picks: [],
    reason: 'BUDGET_UNVERIFIED',
  },
  {
    name: 'Different quantity cost is not comparable',
    change: (f) => {
      f.request.budget = { basis: 'installed', currency: 'USD', ceilingMinor: '90000' };
      plan(f).cost!.quantity = 2;
    },
    picks: [],
    reason: 'BUDGET_UNVERIFIED',
  },
  {
    name: 'Expired cost cannot satisfy budget',
    change: (f) => {
      f.request.budget = { basis: 'installed', currency: 'USD', ceilingMinor: '90000' };
      plan(f).cost!.validUntil = f.snapshot.asOf;
    },
    picks: [],
    reason: 'BUDGET_UNVERIFIED',
  },
  {
    name: 'Cheap below-spec item never fills a budget tier',
    change: (f) => {
      alternative(f).cost!.amountMinor = 100000n;
      front(f).loadIndex = 90;
      plan(f).cost!.amountMinor = 1n;
      f.request.budget = { basis: 'installed', currency: 'USD', ceilingMinor: '100' };
    },
    status: 'blocked',
    reason: 'INSUFFICIENT_LOAD',
    picks: [],
  },
];
