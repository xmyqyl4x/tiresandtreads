import type { Id, Instant, Evidence } from '../../../domain/src/values/index.ts';
import type { FactRecords, FactKind } from './catalog-records.ts';
import type { TransactionContext } from './transactions.ts';
import type { PageRequest } from './pagination.ts';
import type { Page } from './pagination.ts';

export type PublicFact<K extends FactKind> = Omit<
  FactRecords[K],
  'reviewedBy' | 'sourceDetails' | 'sourceNote'
>;
export interface SourceRights {
  readonly display: boolean;
  readonly api: boolean;
  readonly cache: boolean;
  readonly derived: boolean;
  readonly snapshot: boolean;
}
export interface CatalogSource {
  readonly datasetId: Id<'dataset'>;
  readonly providerId: Id<'provider'>;
  readonly licenseId: Id<'license'>;
  readonly kind: string;
  readonly fetchedAt: Instant;
  readonly expiresAt: Evidence<Instant>;
  readonly rights: SourceRights;
}
export interface CatalogPin {
  readonly bundleId: Id<'bundle'>;
  readonly market: string;
  readonly coverage: 'available' | 'partial' | 'unavailable';
  // Availability of licensed components is not a claim of source completeness or recall clearance.
  readonly components: readonly Readonly<{ key: string; source: CatalogSource }>[];
}
export type FactFilters<K extends FactKind> = Partial<
  Pick<
    PublicFact<K>,
    Extract<
      keyof PublicFact<K>,
      | 'id'
      | 'sourceRecordKey'
      | 'entityId'
      | 'locale'
      | 'normalizedAlias'
      | 'market'
      | 'modelYear'
      | 'makeEntityId'
      | 'vehicleId'
      | 'configurationId'
      | 'modelId'
      | 'skuId'
      | 'sizeCode'
      | 'system'
      | 'recallId'
      | 'sourceTargetId'
      | 'productType'
      | 'authority'
      | 'recallNumber'
      | 'topicKey'
    >
  >
>;
export interface CatalogRepository {
  pin(
    tx: TransactionContext,
    market: string,
    bundleId: Id<'bundle'> | null,
  ): Promise<CatalogPin | null>;
  page<K extends FactKind>(
    tx: TransactionContext,
    request: Readonly<{
      kind: K;
      bundleId: Id<'bundle'>;
      market: string;
      filters: FactFilters<K>;
      page: PageRequest;
    }>,
  ): Promise<Page<Readonly<{ fact: PublicFact<K>; source: CatalogSource }>>>;
}
