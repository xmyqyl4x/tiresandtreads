import type { Id, Instant } from '../../../domain/src/values/index.ts';
import type { Result } from '../../../domain/src/values/core.ts';
import type { ApplicationFailure, TransactionContext } from './transactions.ts';
import type { ImportSnapshot, ImportFact, Registration } from './import-service.ts';

export type SourceSpec =
  | {
      readonly type: 'vpic-models';
      readonly makeId: number;
      readonly year: number;
      readonly vehicleType: 'passenger car' | 'truck';
    }
  | { readonly type: 'vpic-manufacturers' }
  | { readonly type: 'vpic-plants'; readonly year: number; readonly equipmentType: 1 | 16 }
  | { readonly type: 'nhtsa-tire-recalls' };
export interface SourceDefinition {
  readonly id: Id<'source_connector'>;
  readonly providerId: Id<'provider'>;
  readonly licenseId: Id<'license'>;
  readonly spec: SourceSpec;
  readonly origin: string;
  readonly path: string;
}
export interface SourceReceipt {
  readonly checksum: string;
  readonly datasetId: Id<'dataset'>;
  readonly runId: Id<'import_run'>;
  readonly validators: Readonly<
    Record<string, { readonly etag: string | null; readonly modified: string | null }>
  >;
}
export interface SourceLease extends SourceDefinition {
  readonly token: Id<'lease'>;
  readonly fence: bigint;
  readonly forceFull: boolean;
  readonly previous: SourceReceipt | null;
}
export interface SourceRepository {
  register(
    tx: TransactionContext,
    input: SourceDefinition & {
      readonly actorId: Id<'staff'>;
      readonly approvalId: Id<'audit_event'>;
    },
  ): Promise<void>;
  due(tx: TransactionContext): Promise<readonly Id<'source_connector'>[]>;
  claim(
    tx: TransactionContext,
    id: Id<'source_connector'>,
  ): Promise<SourceLease | { readonly denied: true } | null>;
  complete(
    tx: TransactionContext,
    lease: SourceLease,
    receipt: SourceReceipt,
    full: boolean,
  ): Promise<void>;
  failed(
    tx: TransactionContext,
    lease: SourceLease,
    code: 'source_unavailable' | 'source_contract' | 'source_rights',
  ): Promise<void>;
  canonical(tx: TransactionContext, registration: Registration): Promise<Registration>;
  recallReady(tx: TransactionContext, datasetId: Id<'dataset'>): Promise<boolean>;
}
export type SourcePull =
  | {
      readonly changed: false;
      readonly full: boolean;
      readonly validators: SourceReceipt['validators'];
    }
  | {
      readonly changed: true;
      readonly checksum: string;
      readonly snapshot: ImportSnapshot;
      readonly validators: SourceReceipt['validators'];
      readonly cleanup: () => Promise<void>;
    };
export interface SourceAdapter {
  pull(lease: SourceLease): Promise<Result<SourcePull, ApplicationFailure>>;
}
export interface SourceIdentity {
  record<K extends string>(kind: K, key: string): Id<K>;
  entity(key: string): Id<'domain_entity'>;
}
export type SourceNormalizer = (
  rows: AsyncIterable<unknown>,
  identity: SourceIdentity,
  at: Instant,
) => AsyncIterable<ImportFact>;
