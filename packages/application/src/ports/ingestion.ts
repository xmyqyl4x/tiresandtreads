import type { Id, Instant, Revision } from '../../../domain/src/values/index.ts';
import type { ImportIdentity, ImportRun } from '../../../domain/src/entities/import.ts';
import type { TransactionContext } from './transactions.ts';
import type { FactKind, FactRecords, JsonObject } from './catalog-records.ts';
import type { Page, PageRequest } from './pagination.ts';
export interface RunState {
  readonly id: Id<'import_run'>;
  readonly datasetId: Id<'dataset'>;
  readonly revision: Revision;
  readonly fence: bigint;
  readonly status: ImportRun['status'];
  readonly throughRow: bigint;
  readonly accepted: bigint;
  readonly rejected: bigint;
}
export interface Lease {
  readonly runId: Id<'import_run'>;
  readonly fence: bigint;
}
export interface StagingRow {
  readonly rowNumber: bigint;
  readonly sourceKey: string;
  readonly normalized: JsonObject;
  readonly status: 'accepted' | 'rejected' | 'duplicate';
}
export interface IngestionRepository {
  dataset(
    tx: TransactionContext,
    input: Readonly<{
      id: Id<'dataset'>;
      providerId: Id<'provider'>;
      licenseId: Id<'license'>;
      kind: string;
      externalVersion: string;
      checksum: string;
      effectiveAt: Instant;
      fetchedAt: Instant;
    }>,
  ): Promise<Id<'dataset'>>;
  register(
    tx: TransactionContext,
    input: Readonly<{
      identity: ImportIdentity;
      datasetId: Id<'dataset'>;
      mode: 'full' | 'incremental' | 'manual';
    }>,
  ): Promise<RunState>;
  lease(tx: TransactionContext, runId: Id<'import_run'>, seconds: number): Promise<RunState>;
  batch(
    tx: TransactionContext,
    lease: Lease,
    rows: readonly StagingRow[],
    expiresAt: Instant,
  ): Promise<RunState>;
  staged(
    tx: TransactionContext,
    lease: Lease,
    after: bigint,
    limit: number,
  ): Promise<readonly StagingRow[]>;
  append<K extends FactKind>(
    tx: TransactionContext,
    lease: Lease,
    kind: K,
    records: readonly Readonly<{ rowNumber: bigint; record: FactRecords[K] }>[],
  ): Promise<void>;
  entity(
    tx: TransactionContext,
    input: Readonly<{
      id: Id<'domain_entity'>;
      kind: 'company' | 'brand' | 'plant' | 'vehicle_make' | 'vehicle_model';
      stableKey: string;
    }>,
  ): Promise<void>;
}
export interface PublicationRepository {
  affectedBundles(
    tx: TransactionContext,
    datasetId: Id<'dataset'>,
    market: string,
    page: PageRequest,
  ): Promise<Page<Id<'bundle'>>>;
  validate(
    tx: TransactionContext,
    lease: Lease,
    expectedRows: bigint,
    complete: boolean,
  ): Promise<void>;
  bundle(
    tx: TransactionContext,
    input: Readonly<{
      id: Id<'bundle'>;
      market: string;
      members: readonly Readonly<{ key: string; datasetId: Id<'dataset'> }>[];
    }>,
  ): Promise<void>;
  publish(tx: TransactionContext, input: PublishInput): Promise<Id<'bundle'>>;
}
export interface PublishInput {
  readonly lease: Lease;
  readonly bundleId: Id<'bundle'>;
  readonly market: string;
  readonly expectedHead: Readonly<{ bundleId: Id<'bundle'>; revision: Revision }> | null;
  readonly required: readonly Readonly<{ key: string; kind: string }>[];
  readonly actorId: Id<'staff'>;
  readonly approvalId: Id<'audit_event'>;
}
