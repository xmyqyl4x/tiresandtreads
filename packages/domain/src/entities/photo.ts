import type { Id, Instant, Revision } from '../values/core.ts';
export type PhotoField =
  | 'brand'
  | 'model'
  | 'tire_size'
  | 'load_index'
  | 'speed_rating'
  | 'dot_tin'
  | 'date_code'
  | 'seasonal_marking'
  | 'run_flat_marking';
export interface PhotoStatus {
  readonly id: Id<'photo_upload'>;
  readonly state: 'pending' | 'quarantined' | 'ready' | 'processing' | 'complete' | 'rejected';
  readonly createdAt: Instant;
  readonly expiresAt: Instant;
  readonly savedAt: Instant | null;
}
export interface PhotoCandidate {
  readonly id: Id<'photo_candidate'>;
  readonly uploadId: Id<'photo_upload'>;
  readonly field: PhotoField;
  readonly ordinal: number;
  readonly rawText: string | null;
  readonly value: string | null;
  readonly unknownReason: 'unreadable' | 'not_visible' | 'ambiguous' | 'unsupported' | null;
  readonly quality: 'clear' | 'uncertain' | 'unknown';
  readonly region: Readonly<{ x: number; y: number; w: number; h: number }> | null;
}
export interface PhotoConfirmation {
  readonly uploadId: Id<'photo_upload'>;
  readonly field: PhotoField;
  readonly revision: Revision;
  readonly candidateId: Id<'photo_candidate'> | null;
  readonly origin: 'accepted_candidate' | 'corrected_candidate' | 'manual';
  readonly value: string;
  readonly confirmedAt: Instant;
}
export interface PhotoExtraction {
  readonly id: Id<'photo_extraction'>;
  readonly uploadId: Id<'photo_upload'>;
  readonly requestId: Id<'ai_request'>;
  readonly jobId: Id<'job'>;
  readonly state: 'queued' | 'processing' | 'complete' | 'rejected' | 'failed' | 'cancelled';
  readonly artifactId: Id<'ai_artifact'> | null;
  readonly candidateCount: number | null;
}
