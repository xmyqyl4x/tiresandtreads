import type { Evidence, Id, Instant, Result, Revision } from '../../../domain/src/values/index.ts';
import type { ReportHead, ReportVersionRef } from '../../../domain/src/entities/report.ts';
import type { ConsentProjection, ConsentPurpose } from '../../../domain/src/entities/consent.ts';
import type { ImportIdentity } from '../../../domain/src/entities/import.ts';
import type { ApplicationFailure, TransactionContext } from './transactions.ts';
export type { Page } from './pagination.ts';
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

export type { CatalogRepository } from './catalog.ts';
export type { IngestionRepository, PublicationRepository } from './ingestion.ts';
