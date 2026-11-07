import type { Id, Instant, Revision } from '../../../domain/src/values/core.ts';
import type { PhotoReadings } from '../../../domain/src/photo-policy.ts';
import type {
  PhotoStatus,
  PhotoCandidate,
  PhotoConfirmation,
} from '../../../domain/src/entities/photo.ts';
import type { AIRequestState } from '../../../domain/src/entities/analysis.ts';
import type { JobLease } from './jobs.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { KeyDigest } from './private-records.ts';
import type { AssetLocation } from './assets.ts';
import type {
  AnalysisConfiguration,
  AnalysisProviderResult,
  StructuredAnalysisTransport,
} from './report-analysis.ts';
export interface PhotoIntent {
  readonly id: Id<'photo_upload'>;
  readonly ownerId: Id<'subject'>;
  readonly scopeId: Id<'ai_scope'>;
  readonly policyId: Id<'ai_policy'>;
  readonly batchId: Id<'photo_batch'>;
  readonly key: string;
  readonly fingerprint: string;
  readonly grantHash: string;
  readonly originalId: Id<'asset'>;
  readonly sanitizedId: Id<'asset'>;
  readonly mime: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly sha256: string;
  readonly size: number;
  readonly state: 'pending' | 'processing' | 'ready' | 'rejected' | 'deleting' | 'deleted';
  readonly grantUntil: Instant;
  readonly expiresAt: Instant;
  readonly lease: Id<'photo_lease'> | null;
  readonly leaseUntil: Instant | null;
}
export interface PhotoWork {
  readonly requestId: Id<'ai_request'>;
  readonly extractionId: Id<'photo_extraction'>;
  readonly jobId: Id<'job'>;
  readonly uploadId: Id<'photo_upload'>;
  readonly ownerId: Id<'subject'>;
  readonly scopeId: Id<'ai_scope'>;
  readonly expiresAt: Instant;
  readonly sanitized: AssetLocation;
  readonly configuration: AnalysisConfiguration;
}
export interface PhotoServiceRepository {
  capture(
    tx: Tx,
    owner: Id<'subject'>,
    id: Id<'photo_batch'>,
    policy: Id<'ai_policy'>,
    key: string,
  ): Promise<Id<'photo_batch'>>;

  owner(
    tx: Tx,
    keys: readonly KeyDigest[],
  ): Promise<Readonly<{ subjectId: Id<'subject'>; sessionId: Id<'owner_session'> }> | null>;
  subjectRevision(tx: Tx, owner: Id<'subject'>): Promise<Revision>;
  intent(tx: Tx, owner: Id<'subject'>, id: Id<'photo_upload'>): Promise<PhotoIntent | null>;
  create(
    tx: Tx,
    intent: Omit<PhotoIntent, 'state' | 'grantUntil' | 'expiresAt' | 'lease' | 'leaseUntil'>,
  ): Promise<PhotoIntent>;
  claim(
    tx: Tx,
    owner: Id<'subject'>,
    id: Id<'photo_upload'>,
    lease: Id<'photo_lease'>,
  ): Promise<PhotoIntent | null>;
  current(tx: Tx, intent: PhotoIntent, lease?: Id<'photo_lease'>): Promise<boolean>;
  finish(tx: Tx, intent: PhotoIntent, lease: Id<'photo_lease'>): Promise<void>;
  reject(tx: Tx, intent: PhotoIntent, lease: Id<'photo_lease'>): Promise<void>;
  enqueue(
    tx: Tx,
    owner: Id<'subject'>,
    upload: Id<'photo_upload'>,
    request: Id<'ai_request'>,
  ): Promise<PhotoWork>;
  reusable(
    tx: Tx,
    owner: Id<'subject'>,
    upload: Id<'photo_upload'>,
  ): Promise<Readonly<{ id: Id<'ai_request'>; state: AIRequestState }> | null>;
  failed(tx: Tx, request: Id<'ai_request'>, lease?: JobLease): Promise<void>;
  work(tx: Tx, request: Id<'ai_request'>): Promise<PhotoWork | null>;
  currentWork(tx: Tx, work: PhotoWork): Promise<boolean>;
  delete(tx: Tx, owner: Id<'subject'>, id: Id<'photo_upload'>): Promise<readonly Id<'asset'>[]>;
  deleted(tx: Tx, owner: Id<'subject'>, id: Id<'photo_upload'>): Promise<boolean>;
  expired(tx: Tx): Promise<readonly Readonly<{ id: Id<'photo_upload'>; ownerId: Id<'subject'> }>[]>;
}
export interface PhotoCodec {
  sanitize(
    bytes: Uint8Array,
    mime: PhotoIntent['mime'],
  ): Promise<
    Readonly<{
      bytes: Uint8Array;
      mime: 'image/jpeg';
      width: number;
      height: number;
      originalWidth: number;
      originalHeight: number;
    }>
  >;
}
export interface PhotoScanner {
  scan(bytes: Uint8Array): Promise<'clean' | 'unsafe' | 'unavailable'>;
}
export interface PhotoScanTransport {
  scan(bytes: Uint8Array, signal: AbortSignal): Promise<'clean' | 'unsafe' | 'unavailable'>;
}
export interface PhotoExtractionProvider {
  extract(
    input: Readonly<{
      bytes: Uint8Array;
      sha256: string;
      configuration: AnalysisConfiguration;
      attempt: Id<'ai_attempt'>;
      deadlineMs: number;
    }>,
  ): Promise<AnalysisProviderResult>;
}
export interface PhotoExtractionTransport {
  send(
    input: Readonly<{
      bytes: Uint8Array;
      mime: 'image/jpeg';
      configuration: AnalysisConfiguration;
      attempt: Id<'ai_attempt'>;
      signal: AbortSignal;
      strict: true;
      store: false;
      tools: readonly [];
      schema: Readonly<Record<string, unknown>>;
      maxInputTokens: 1048576;
      maxOutputTokens: 1024;
    }>,
  ): Promise<Awaited<ReturnType<StructuredAnalysisTransport['send']>>>;
}
export interface PhotoView {
  readonly id: Id<'photo_upload'>;
  readonly state: PhotoStatus['state'] | PhotoIntent['state'];
  readonly expiresAt: Instant;
  readonly dotStatus: PhotoReadings['dotStatus'];
  readonly candidates: readonly PhotoCandidate[];
  readonly confirmations: readonly PhotoConfirmation[];
  readonly limitations: PhotoReadings['limitations'];
}

export interface PhotoIntentView {
  readonly state: PhotoIntent['state'] | 'manual';
  readonly id: Id<'photo_upload'> | null;
  readonly grant: string | null;
  readonly grantUntil: Instant | null;
}
