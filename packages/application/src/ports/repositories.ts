import type {
  Evidence,
  Id,
  Instant,
  Result,
  Revision,
  TireSize,
} from '../../../domain/src/values/index.ts';
import type { TireSku, PriceQuote } from '../../../domain/src/entities/catalog.ts';
import type { ReportHead, ReportVersionRef } from '../../../domain/src/entities/report.ts';
import type { ConsentProjection, ConsentPurpose } from '../../../domain/src/entities/consent.ts';
import type { ImportIdentity, ImportRun } from '../../../domain/src/entities/import.ts';
import type { ApplicationFailure, TransactionContext } from './transactions.ts';
import type { PageRequest } from './pagination.ts';
export interface Page<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}
export interface CatalogQueries {
  candidates(
    tx: TransactionContext,
    query: Readonly<{ bundleId: Id<'bundle'>; size: TireSize; page: PageRequest }>,
  ): Promise<Page<TireSku>>;
  prices(
    tx: TransactionContext,
    query: Readonly<{ bundleId: Id<'bundle'>; skuIds: readonly Id<'tire_sku'>[]; at: Instant }>,
  ): Promise<readonly PriceQuote[]>;
}
export interface ReportRepository {
  lockOwned(
    tx: TransactionContext,
    reportId: Id<'report'>,
    ownerId: Id<'subject'>,
  ): Promise<ReportHead | null>;
  advance(
    tx: TransactionContext,
    command: Readonly<{
      ownerId: Id<'subject'>;
      expectedRevision: Revision;
      version: ReportVersionRef;
    }>,
  ): Promise<Result<ReportHead, ApplicationFailure>>;
}
export interface PermissionQueries {
  current(
    tx: TransactionContext,
    subjectId: Id<'subject'>,
    purpose: ConsentPurpose,
    scopeKey: string,
  ): Promise<ConsentProjection>;
}
export interface ImportRepository {
  claim(
    tx: TransactionContext,
    identity: ImportIdentity,
  ): Promise<Result<ImportRun, ApplicationFailure>>;
  publish(
    tx: TransactionContext,
    command: Readonly<{
      runId: Id<'import_run'>;
      expectedHead: Id<'bundle'> | null;
      bundleId: Id<'bundle'>;
      leaseGeneration: Revision;
    }>,
  ): Promise<Result<Id<'bundle'>, ApplicationFailure>>;
}
export interface SourceFetchPort {
  // Called outside UnitOfWork; implementation owns its bounded streaming parser, never the transaction.
  fetch(
    input: Readonly<{
      identity: ImportIdentity;
      cursor: string | null;
      deadline: Instant;
      maxBytes: number;
    }>,
  ): Promise<
    Result<
      Readonly<{ artifactId: Id<'asset'>; nextCursor: string | null; etag: Evidence<string> }>,
      ApplicationFailure
    >
  >;
}
export interface Clock {
  now(): Instant;
}
