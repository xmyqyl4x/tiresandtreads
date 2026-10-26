import type { Source } from '../model.ts';
export interface Amount {
  readonly low: bigint;
  readonly high: bigint;
  readonly currency: 'USD';
}
export interface Item {
  readonly skuId: string | null;
  readonly axle: 'front' | 'rear';
  readonly quantity: 1 | 2;
}
export type ChargeKind =
  'mounting' | 'balancing' | 'tpms_valve' | 'disposal' | 'tax' | 'alignment' | 'required_other';
export interface Charge {
  readonly id: string;
  readonly kind: ChargeKind;
  readonly appliesTo: readonly string[];
  readonly included: boolean;
  readonly amount:
    | Readonly<{ kind: 'fixed'; basis: 'per_tire' | 'per_axle' | 'per_order'; value: Amount }>
    | Readonly<{
        kind: 'percentage';
        basis: 'tire_subtotal' | 'taxable_subtotal' | 'order_subtotal';
        rate: string;
        baseChargeIds: readonly string[];
        rounding: 'per_line' | 'per_order';
      }>
    | null;
}
export interface QuoteInput {
  readonly id: string;
  readonly planId: string | null;
  readonly bundleId: string;
  readonly regionKey: string;
  readonly asOf: string;
  readonly retailerId: string | null;
  readonly taxContextId: string | null;
  readonly assumptionVersion: string;
  readonly origin: 'licensed_feed' | 'owner_quote';
  readonly ownerAuthorized: boolean;
  readonly source: Source | null;
  readonly currency: 'USD';
  readonly observedAt: string;
  readonly validUntil: string | null;
  readonly productKnown: boolean;
  readonly selection: readonly Item[];
  readonly includeAlignment: boolean;
  readonly lines: readonly Readonly<{
    id: string;
    items: readonly Item[];
    basis: 'per_tire' | 'per_axle' | 'per_set';
    quotedQuantity: number;
    value: Amount | null;
    taxIncluded: boolean | null;
  }>[];
  readonly charges: readonly Charge[];
}
export type PriceReason =
  | 'SOURCE_UNAVAILABLE'
  | 'PRICE_STALE'
  | 'PRICE_EXPIRED'
  | 'PRICE_MISSING'
  | 'REQUIRED_COST_UNKNOWN'
  | 'TAX_UNCONFIRMED'
  | 'PRODUCT_UNVERIFIED';
export interface QuoteEstimate {
  readonly mathVersion: '1.0.0';
  readonly issuanceAuthorized: false;
  readonly id: string;
  readonly planId: string | null;
  readonly bundleId: string;
  readonly regionKey: string;
  readonly asOf: string;
  readonly origin: 'licensed_feed' | 'owner_quote';
  readonly sourceId: string | null;
  readonly retailerId: string | null;
  readonly taxContextId: string | null;
  readonly assumptionVersion: string;
  readonly observedAt: string;
  readonly validUntil: string | null;
  readonly currency: 'USD';
  readonly productKnown: boolean;
  readonly selection: readonly Item[];
  readonly quantity: number;
  readonly includeAlignment: boolean;
  readonly freshness: 'fresh' | 'stale' | 'expired' | 'unavailable';
  readonly currentPriceClaim: boolean;
  readonly merchandise: Amount | null;
  readonly installed: Amount | null;
  readonly optionalAlignment: Amount | null;
  readonly reasons: readonly PriceReason[];
  readonly charges: readonly Readonly<{
    id: string;
    kind: ChargeKind;
    additional: Amount | null;
  }>[];
}
export interface Distance {
  readonly value: string;
  readonly unit: 'mile' | 'km';
}
export interface LifeModel {
  readonly id: string;
  readonly version: string;
  readonly kind: 'modeled_life' | 'warranty';
  readonly reviewed: boolean;
  readonly reviewedAt: string;
  readonly validUntil: string;
  readonly source: Source;
  readonly skuIds: readonly string[];
  readonly low: Distance;
  readonly high: Distance;
  readonly calendarYears: number | null;
}
export interface ScenarioInput {
  readonly id: string;
  readonly assumptionSetId: string;
  readonly regionKey: string;
  readonly asOf: string;
  readonly strategy: 'one_set' | 'two_set';
  readonly eligibility: 'eligible' | 'blocked' | 'unverified';
  readonly years: number;
  readonly annualDistance: Distance | null;
  readonly winterShareBp: number | null;
  readonly residualPolicy: 'zero' | 'reviewed_estimate' | null;
  readonly residual: Amount | null;
  readonly sets: readonly Readonly<{
    role: 'year_round' | 'summer' | 'winter';
    quote: QuoteEstimate;
    life: LifeModel | null;
    upfrontWheels: Amount | null;
  }>[];
  readonly additionalSwapEvents: number | null;
  readonly swapCost: Amount | null;
  readonly storagePerYear: Amount | null;
}
export interface ScenarioEstimate {
  readonly mathVersion: '1.0.0';
  readonly id: string;
  readonly assumptionSetId: string;
  readonly regionKey: string;
  readonly asOf: string;
  readonly currency: 'USD';
  readonly years: number;
  readonly annualDistanceNm: string | null;
  readonly winterShareBp: number | null;
  readonly residualPolicy: ScenarioInput['residualPolicy'];
  readonly state: 'modeled' | 'unavailable';
  readonly total: Amount | null;
  readonly costPer1000: Amount | null;
  readonly distanceUnit: 'mile' | 'km' | null;
  readonly distances: Readonly<{
    denominator: '10000';
    totalNumerator: string;
    summerNumerator: string;
    winterNumerator: string;
  }> | null;
  readonly purchases: readonly Readonly<{
    role: string;
    minimum: number;
    maximum: number;
    lifeModelId: string;
  }>[];
  readonly reasons: readonly string[];
  readonly assumptions: readonly string[];
  readonly issuanceAuthorized: false;
}
