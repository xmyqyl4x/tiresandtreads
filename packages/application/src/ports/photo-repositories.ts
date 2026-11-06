import type { Id, Instant, Revision } from '../../../domain/src/values/core.ts';
import type {
  PhotoStatus,
  PhotoCandidate,
  PhotoConfirmation,
  PhotoExtraction,
} from '../../../domain/src/entities/photo.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { JobLease } from './jobs.ts';
import type { AssetRepository, AssetLocation } from './assets.ts';
import type { Page, PageRequest } from './pagination.ts';
export interface PhotoAssetRepository extends Omit<AssetRepository, 'register'> {
  register(
    tx: Tx,
    input: Readonly<{
      id: Id<'asset'>;
      kind: 'original' | 'sanitized';
      mime: 'image/jpeg' | 'image/png' | 'image/webp';
      sha256: string;
      size: number;
      expiresAt: Instant;
    }>,
  ): Promise<AssetLocation>;
}
export interface PhotoWorkerRepository {
  create(
    tx: Tx,
    input: Readonly<{
      id: Id<'photo_upload'>;
      ownerId: Id<'subject'>;
      batchId: Id<'photo_batch'>;
      scopeId: Id<'ai_scope'>;
      originalAssetId: Id<'asset'>;
      width: number;
      height: number;
      permissionRevision: Revision;
      subjectRevision: Revision;
      invalidationRevision: bigint;
      expiresAt: Instant;
    }>,
  ): Promise<void>;
  sanitized(
    tx: Tx,
    ownerId: Id<'subject'>,
    uploadId: Id<'photo_upload'>,
    assetId: Id<'asset'>,
  ): Promise<void>;
  extraction(
    tx: Tx,
    input: Readonly<{
      id: Id<'photo_extraction'>;
      ownerId: Id<'subject'>;
      uploadId: Id<'photo_upload'>;
      requestId: Id<'ai_request'>;
      jobId: Id<'job'>;
    }>,
  ): Promise<PhotoExtraction>;
  start(
    tx: Tx,
    ownerId: Id<'subject'>,
    extractionId: Id<'photo_extraction'>,
    lease: JobLease,
  ): Promise<PhotoExtraction>;
  complete(
    tx: Tx,
    input: Readonly<{
      ownerId: Id<'subject'>;
      extractionId: Id<'photo_extraction'>;
      lease: JobLease;
      artifactId: Id<'ai_artifact'>;
      candidates: readonly PhotoCandidate[];
    }>,
  ): Promise<PhotoExtraction>;
  cancel(tx: Tx, ownerId: Id<'subject'>, extractionId: Id<'photo_extraction'>): Promise<void>;
}
export interface PhotoOwnerRepository {
  status(tx: Tx, ownerId: Id<'subject'>, uploadId: Id<'photo_upload'>): Promise<PhotoStatus | null>;
  list(tx: Tx, ownerId: Id<'subject'>, page: PageRequest): Promise<Page<PhotoStatus>>;
  candidates(
    tx: Tx,
    ownerId: Id<'subject'>,
    uploadId: Id<'photo_upload'>,
  ): Promise<readonly PhotoCandidate[]>;
  confirmations(
    tx: Tx,
    ownerId: Id<'subject'>,
    uploadId: Id<'photo_upload'>,
  ): Promise<readonly PhotoConfirmation[]>;
  confirm(
    tx: Tx,
    ownerId: Id<'subject'>,
    input: Omit<PhotoConfirmation, 'confirmedAt'>,
  ): Promise<PhotoConfirmation>;
  save(
    tx: Tx,
    ownerId: Id<'subject'>,
    uploadId: Id<'photo_upload'>,
    input: Readonly<{ noticeVersion: string; evidenceHash: string; expiresAt: Instant }>,
  ): Promise<void>;
}
