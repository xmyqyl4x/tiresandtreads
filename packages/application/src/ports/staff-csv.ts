import type { Id, Instant, Revision } from '../../../domain/src/values/core.ts';
import type { CsvColumn, CsvTemplate, CsvReview } from '../../../domain/src/entities/csv-review.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { AssetLocation } from './assets.ts';
import type { Registration } from './import-service.ts';
import type { PublishInput } from './ingestion.ts';
export interface CsvMapping {
  readonly key: string;
  readonly sourceKind: string;
  readonly schemaVersion: '1';
  readonly mappingVersion: '1';
  readonly columns: readonly CsvColumn[];
  // Trusted installed mapping function. No caller program, expression, SQL or URL fetch.
  readonly map: (row: Readonly<Record<string, string | boolean | null>>) => unknown;
}
export interface CsvCommand {
  readonly id: Id<'csv_intake'>;
  readonly actorId: Id<'staff'>;
  readonly templateId: Id<'csv_template'>;
  readonly assetId: Id<'asset'>;
  readonly jobId: Id<'job'>;
  readonly providerId: Id<'provider'>;
  readonly licenseId: Id<'license'>;
  readonly market: string;
  readonly rawHash: string;
  readonly packetHash: string;
  readonly fingerprint: string;
  readonly registration: Registration;
  readonly expiresAt: Instant;
  readonly runId: Id<'import_run'> | null;
  readonly publicationBundleId: Id<'bundle'> | null;
  readonly phase: 'uploading' | 'registered' | 'prepared' | 'rejected' | 'cancelled' | 'published';
}
export type CsvCommandInput = Omit<
  CsvCommand,
  'runId' | 'phase' | 'actorId' | 'publicationBundleId'
> & {
  readonly commandHash: string;
};
export interface CsvPreview {
  readonly id: Id<'csv_preview'>;
  readonly intakeId: Id<'csv_intake'>;
  readonly runId: Id<'import_run'>;
  readonly runRevision: Revision;
  readonly fence: bigint;
  readonly head: PublishInput['expectedHead'];
  readonly diffId: Id<'import_artifact'>;
  readonly validationId: Id<'import_artifact'>;
  readonly diffAssetId: Id<'asset'>;
  readonly validationAssetId: Id<'asset'>;
  readonly members: readonly Readonly<{ key: string; kind: string; datasetId: Id<'dataset'> }>[];
  readonly expiresAt: Instant;
  readonly complete: boolean;
}
export interface CsvPublication {
  readonly runId: Id<'import_run'>;
  readonly bundleId: Id<'bundle'>;
  readonly market: string;
  readonly head: PublishInput['expectedHead'];
  readonly approvalId: Id<'audit_event'>;
  readonly members: CsvPreview['members'];
  readonly published: boolean;
}
export interface StaffCsvRepository {
  publicationReceipt(tx: Tx, actor: Id<'staff'>, intake: Id<'csv_intake'>): Promise<Id<'bundle'>>;
  rollbackMarket(tx: Tx, actor: Id<'staff'>, intake: Id<'csv_intake'>): Promise<string>;
  authorize(
    tx: Tx,
    actor: Id<'staff'>,
    permission: 'data.review' | 'data.publish',
  ): Promise<Revision>;
  reserve(tx: Tx, actor: Id<'staff'>, input: CsvCommandInput): Promise<CsvCommand>;
  command(tx: Tx, actor: Id<'staff'>, id: Id<'csv_intake'>): Promise<CsvCommand>;
  bind(tx: Tx, actor: Id<'staff'>, id: Id<'csv_intake'>, run: Id<'import_run'>): Promise<void>;
  prepared(tx: Tx, actor: Id<'staff'>, id: Id<'csv_intake'>): Promise<void>;
  cancel(tx: Tx, actor: Id<'staff'>, id: Id<'csv_intake'>, evidence: string): Promise<void>;
  preview(
    tx: Tx,
    actor: Id<'staff'>,
    id: Id<'csv_intake'>,
    commandHash: string,
    previewId: Id<'csv_preview'>,
  ): Promise<CsvPreview>;
  completePreview(
    tx: Tx,
    actor: Id<'staff'>,
    preview: CsvPreview,
    diffHash: string,
    validationHash: string,
  ): Promise<CsvPreview>;
  reviewReplay(tx: Tx, actor: Id<'staff'>, id: Id<'csv_review'>): Promise<CsvReview | null>;
  reviewBasis(
    tx: Tx,
    actor: Id<'staff'>,
    previewId: Id<'csv_preview'>,
  ): Promise<Omit<CsvReview, 'id' | 'reviewerId' | 'roleRevision' | 'decision' | 'reason'>>;
  publication(
    tx: Tx,
    actor: Id<'staff'>,
    intake: Id<'csv_intake'>,
    review: Id<'csv_review'>,
    commandHash: string,
    bundleId: Id<'bundle'>,
  ): Promise<CsvPublication>;
}
export interface CsvFiles {
  store(
    id: Id<'asset'>,
    purpose: 'import_source' | 'import_evidence',
    mime: 'text/csv' | 'application/json',
    bytes: Uint8Array,
    expiresAt: Instant,
  ): Promise<AssetLocation>;
  read(asset: Id<'asset'>): Promise<Uint8Array>;
}
export interface CsvRuntimeIdentity {
  id<K extends string>(kind: K, key: string): Id<K>;
  hash(purpose: string, value: string): string;
  sha256(bytes: Uint8Array): string;
}
export type CsvTemplateChoice = Readonly<{
  mapping: string;
  version: number;
  maxBytes: number;
  maxRows: number;
  state: Extract<CsvTemplate['state'], 'draft' | 'active'>;
}>;
