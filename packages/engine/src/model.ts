export const positions = ['front_left', 'front_right', 'rear_left', 'rear_right'] as const;
export const metrics = [
  'wet',
  'longevity',
  'comfort',
  'dry',
  'value',
  'noise',
  'efficiency',
  'snow',
  'ice',
] as const;
export type Position = (typeof positions)[number];
export type Metric = (typeof metrics)[number];
export type Axle = 'front' | 'rear';
export type Strategy = 'year_round' | 'summer_set' | 'winter_set';
export type WinterUse = 'none' | 'snow' | 'ice' | 'unknown';
export type Season = 'all_season' | 'all_weather' | 'summer' | 'winter';
export interface AssessmentInput {
  readonly regionKey: string;
  readonly market: 'US';
  readonly configurationId: string | null;
  readonly wheelPackage: string | null;
  readonly sizes: Readonly<Record<Axle, string>> | null;
  readonly strategy: Strategy;
  readonly winterUse: WinterUse;
  readonly replace: readonly Position[];
  readonly priorities: readonly Metric[];
  readonly budget: Readonly<{
    basis: 'installed' | 'merchandise';
    currency: 'USD';
    ceilingMinor: bigint;
  }> | null;
}
export interface Source {
  readonly datasetId: string;
  readonly providerId: string;
  readonly licenseId: string;
  readonly market: 'US';
  readonly kind: 'fitment' | 'catalog' | 'recall' | 'policy' | 'climate' | 'market_rules';
  readonly fetchedAt: string;
  readonly validUntil: string;
  readonly rights: Readonly<Record<'display' | 'api' | 'derived' | 'cache' | 'snapshot', boolean>>;
}
export interface AxleRequirement {
  readonly axle: Axle;
  readonly quantity: number;
  readonly sizeCode: string;
  readonly rimInches: string;
  readonly construction: string;
  readonly minLoadIndex: number | null;
  readonly minSpeedRank: number | null;
  readonly loadRange: string | null; // Explicit 'not_required' differs from unknown.
  readonly xlRequired: boolean | null;
  readonly runFlatRequired: boolean | null;
  readonly unknownConstraints: readonly string[];
}
export interface Fitment {
  readonly id: string;
  readonly sourceId: string;
  readonly wheelPackage: string;
  readonly verified: boolean;
  readonly drivetrain: 'FWD' | 'RWD' | 'AWD' | '4WD' | null;
  readonly axles: readonly AxleRequirement[];
  // Manufacturer-specific policies, never a universal AWD tolerance.
  readonly replacement: Readonly<{
    patterns: readonly (readonly Position[])[];
    maxTreadDifferenceUm: number | null;
    maxCircumferenceDifferenceUm: number | null;
    permittedModelPairs: readonly Readonly<{ front: string; rear: string }>[];
  }> | null;
}
export interface Measurement {
  readonly metric: Metric;
  readonly skuId: string; // Model-family scores cannot silently transfer to this SKU.
  readonly sourceId: string;
  readonly valueBp: number | null;
  readonly comparisonKey: string; // Reviewed method + scale + unit + normalization version.
  readonly reviewedAt: string;
  readonly validUntil: string;
  readonly confidence: 'high' | 'medium' | 'low';
}
export interface Sku {
  readonly id: string;
  readonly sourceId: string;
  readonly modelId: string;
  readonly sizeCode: string;
  readonly rimInches: string;
  readonly construction: string;
  readonly loadIndex: number | null;
  readonly speedRank: number | null;
  readonly loadRange: string | null;
  readonly xl: boolean | null;
  readonly runFlat: boolean | null;
  readonly season: Season | null;
  readonly threePmsf: boolean | null;
  readonly available: boolean | null;
  readonly availabilityUntil: string | null;
  readonly recall: Readonly<{
    sourceId: string;
    state: 'clear' | 'matched' | 'unresolved' | 'unknown';
    targetRefs: readonly string[];
  }>;
  readonly measurements: readonly Measurement[];
}
export interface Inspection {
  readonly retainedCondition: 'accepted' | 'rejected' | 'unknown';
  readonly referenceId: string;
  readonly configurationId: string;
  readonly planId: string;
  readonly replaced: readonly Position[];
  readonly reviewedAt: string;
  readonly validUntil: string;
  readonly wheels: readonly Readonly<{
    position: Position;
    skuId: string;
    treadUm: number | null;
    circumferenceUm: number | null;
  }>[];
}
export interface Plan {
  readonly id: string;
  readonly front: Sku;
  readonly rear: Sku;
  readonly inspection: Inspection | null;
  // Only the later pricing service may supply comparable installed totals; no estimate is invented here.
  readonly cost: Readonly<{
    basis: 'installed' | 'merchandise';
    currency: 'USD';
    quantity: number;
    amountMinor: bigint;
    sourceId: string;
    validUntil: string;
  }> | null;
}
export interface RulePolicy {
  readonly regionKey: string;
  readonly climateSourceId: string;
  readonly marketRulesSourceId: string;
  readonly version: string;
  readonly scoringVersion: string;
  readonly sourceId: string;
  readonly reviewed: boolean;
  readonly reviewDueAt: string;
  readonly seasonal: readonly Readonly<{
    strategy: Strategy;
    winterUse: Exclude<WinterUse, 'unknown'>;
    classes: readonly Season[];
    require3pmsf: boolean;
  }>[];
  readonly weights: Readonly<Partial<Record<Metric, number>>>;
  readonly comparisonKeys: Readonly<Partial<Record<Metric, string>>>;
}
export interface EngineSnapshot {
  readonly bundleId: string;
  readonly asOf: string;
  readonly sources: readonly Source[];
  readonly policy: RulePolicy;
  readonly fitment: Fitment | null;
  readonly recall: Readonly<{ datasetId: string; checkedAt: string; complete: boolean }>;
  readonly plans: readonly Plan[];
}
export type Reason =
  | 'FITMENT_VERIFIED'
  | 'FITMENT_UNCONFIRMED'
  | 'FITMENT_CONSTRAINT_UNKNOWN'
  | 'FITMENT_SIZE_CONFLICT'
  | 'WHEEL_PACKAGE_UNCONFIRMED'
  | 'SIZE_MISMATCH'
  | 'RIM_MISMATCH'
  | 'CONSTRUCTION_MISMATCH'
  | 'INSUFFICIENT_LOAD'
  | 'INSUFFICIENT_SPEED'
  | 'LOAD_RANGE_MISMATCH'
  | 'XL_REQUIRED'
  | 'RUN_FLAT_REQUIRED'
  | 'SOURCE_UNAVAILABLE'
  | 'POLICY_REVIEW_REQUIRED'
  | 'REGIONAL_POLICY_UNCONFIRMED'
  | 'CLIMATE_UNKNOWN'
  | 'SEASONAL_POLICY_UNKNOWN'
  | 'SEASONAL_STRATEGY_MISMATCH'
  | 'WINTER_MARK_REQUIRED'
  | 'WINTER_MARK_UNKNOWN'
  | 'MARKET_UNAVAILABLE'
  | 'AVAILABILITY_UNKNOWN'
  | 'RECALL_MATCHED'
  | 'RECALL_REVIEW_REQUIRED'
  | 'RECALL_STALE'
  | 'REPLACEMENT_POLICY_UNKNOWN'
  | 'REPLACEMENT_PATTERN_UNAPPROVED'
  | 'MODEL_MIX_UNAPPROVED'
  | 'INSPECTION_REQUIRED'
  | 'RETAINED_TIRE_CONDITION'
  | 'REPLACEMENT_MEASUREMENTS_UNKNOWN'
  | 'TREAD_DIFFERENCE_EXCEEDED'
  | 'CIRCUMFERENCE_DIFFERENCE_EXCEEDED'
  | 'EVIDENCE_MISSING'
  | 'EVIDENCE_NOT_COMPARABLE'
  | 'PREFERENCE_SCORE'
  | 'PRIORITY_UNSUPPORTED'
  | 'ABOVE_BUDGET'
  | 'BUDGET_UNVERIFIED';
export interface Decision {
  readonly id: string;
  readonly status: 'eligible' | 'blocked' | 'unverified';
  readonly reasons: readonly Reason[];
  readonly sourceIds: readonly string[];
  readonly recallReferences: readonly string[];
  readonly scoreBp: number | null;
  readonly suitability: 'comparable' | 'evidence_limited';
  readonly confidence: number;
  readonly budget: 'within' | 'above' | 'unknown' | 'not_requested';
}
export interface EngineResult {
  readonly purpose: 'technical_evaluation';
  readonly issuanceAuthorized: false;
  readonly versions: Readonly<{
    engine: '1.0.0';
    schema: 1;
    bundleId: string;
    policy: string;
    scoring: string;
    datasets: readonly string[];
  }>;
  readonly asOf: string;
  readonly decisions: readonly Decision[];
  readonly picks: readonly string[];
  readonly aboveBudget: readonly string[];
  readonly budgetUnknown: readonly string[];
  readonly exclusions: readonly string[];
}
