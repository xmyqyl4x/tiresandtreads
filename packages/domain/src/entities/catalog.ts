import type { Evidence, Id, Instant, Money, TireSize } from '../values/index.ts';
export interface Provenance {
  readonly datasetId: Id<'dataset'>;
  readonly providerId: Id<'provider'>;
  readonly licenseId: Id<'license'>;
  readonly sourceRecordKey: string;
  readonly fetchedAt: Instant;
  readonly validUntil: Evidence<Instant>;
}
export interface TireSku {
  readonly id: Id<'tire_sku'>;
  readonly modelId: Id<'tire_model'>;
  readonly size: TireSize;
  readonly status: 'unknown' | 'active' | 'discontinued';
  readonly loadIndex: Evidence<number>;
  readonly runFlat: Evidence<boolean>;
  readonly provenance: Provenance;
}
export interface PriceQuote {
  readonly provenance: Provenance;
  readonly id: Id<'price'>;
  readonly skuId: Id<'tire_sku'>;
  readonly retailerId: Id<'retailer'>;
  readonly amount: Money;
  readonly observedAt: Instant;
  readonly validUntil: Evidence<Instant>;
  readonly taxIncluded: Evidence<boolean>;
  readonly quantityBasis: 'per_tire' | 'per_axle' | 'per_set';
}
