import type { Id, Instant } from '../../../domain/src/values/index.ts';
import type { Result } from '../../../domain/src/values/core.ts';
import type { ApplicationFailure, TransactionContext } from './transactions.ts';
import type { FactKind, FactRecords } from './catalog-records.ts';
import type { IngestionRepository, PublishInput, RunState } from './ingestion.ts';

export type ImportFact = {
  [K in FactKind]: { readonly kind: K; readonly record: FactRecords[K] };
}[FactKind] & { readonly identities?: readonly Parameters<IngestionRepository['entity']>[1][] };
export type Registration = Parameters<IngestionRepository['dataset']>[1] & {
  readonly upstreamRunKey: string;
  readonly schemaVersion: '1';
  readonly mappingVersion: '1';
  readonly semantics: 'complete_snapshot';
  readonly expectedRows: number;
};
export interface ImportSnapshot {
  readonly registration: Registration;
  // The adapter emits end only after authenticating byte count and checksum.
  readonly frames: () => AsyncIterable<{ readonly row: unknown } | { readonly end: true }>;
}
export type FactDecoder = (input: unknown) => Result<ImportFact, ApplicationFailure>;
export type RollbackInput = Omit<PublishInput, 'lease' | 'required' | 'expectedHead'> & {
  readonly expectedHead: NonNullable<PublishInput['expectedHead']>;
};
export interface ImportOperations {
  status(tx: TransactionContext, runId: Id<'import_run'>): Promise<RunState>;
  release(tx: TransactionContext, runId: Id<'import_run'>, fence: bigint): Promise<void>;
  renew(tx: TransactionContext, runId: Id<'import_run'>, fence: bigint): Promise<void>;
  diff(
    tx: TransactionContext,
    runId: Id<'import_run'>,
    against: Id<'bundle'> | null,
  ): Promise<
    readonly {
      readonly kind: FactKind;
      readonly added: bigint;
      readonly changed: bigint;
      readonly removed: bigint;
    }[]
  >;
  rollback(tx: TransactionContext, input: RollbackInput): Promise<Id<'bundle'>>;
}
export interface ImportClock {
  now(): Instant;
  expires(): Instant;
}
