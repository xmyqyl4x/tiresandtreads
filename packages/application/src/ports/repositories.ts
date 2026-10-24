import type { Evidence, Id, Instant, Result } from '../../../domain/src/values/index.ts';
import type { ImportIdentity } from '../../../domain/src/entities/import.ts';
import type { ApplicationFailure } from './transactions.ts';
export type { Page } from './pagination.ts';
export type { OwnerRepository, ReportRepository, CapabilityRepository } from './owner-report.ts';
export type { PrivacyRepository } from './privacy.ts';
export type { DeliveryRepository } from './delivery.ts';
export type { ReliabilityRepository } from './reliability.ts';
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
