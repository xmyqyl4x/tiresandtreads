import type {
  PhotoStatus,
  PhotoCandidate,
  PhotoConfirmation,
  PhotoExtraction,
} from '../../../domain/src/entities/photo.ts';
import {
  decode,
  uid,
  at,
  revisionValue,
  word,
  choice,
  num,
  nullable,
  photoFields,
  type Row,
} from './analysis-values.ts';
import { reject } from './bounds.ts';
export const photoStatusFromRow = (r: Row) =>
  decode<PhotoStatus>('photo_status', () => ({
    id: uid('photo_upload', r.id),
    state: choice(r.state, [
      'pending',
      'quarantined',
      'ready',
      'processing',
      'complete',
      'rejected',
    ]),
    createdAt: at(r.created_at),
    expiresAt: at(r.expires_at),
    savedAt: nullable(r.saved_at, at),
  }));
export const photoCandidateFromRow = (r: Row) =>
  decode<PhotoCandidate>('photo_candidate', () => {
    const value = nullable(r.normalized_value, (v) => word(v, 512)),
      unknownReason = nullable(r.unknown_reason, (v) =>
        choice(v, ['unreadable', 'not_visible', 'ambiguous', 'unsupported']),
      ),
      quality = choice(r.quality, ['clear', 'uncertain', 'unknown']);
    if (
      (value === null) !== (unknownReason !== null) ||
      (quality === 'unknown') !== (unknownReason !== null)
    )
      return reject();
    let region: PhotoCandidate['region'] = null;
    if (r.region !== null) {
      if (!r.region || typeof r.region !== 'object' || Array.isArray(r.region)) return reject();
      const b = r.region as Record<string, unknown>,
        values = ['x', 'y', 'w', 'h'].map((k) => b[k]);
      if (
        Object.keys(b).sort().join(',') !== 'h,w,x,y' ||
        values.some((v) => typeof v !== 'number' || !Number.isFinite(v))
      )
        return reject();
      const [x, y, w, h] = values as [number, number, number, number];
      if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1) return reject();
      region = Object.freeze({ x, y, w, h });
    }
    return {
      id: uid('photo_candidate', r.id),
      uploadId: uid('photo_upload', r.upload_id),
      field: choice(r.field_code, photoFields),
      ordinal: num(r.ordinal, 0, 3),
      rawText: nullable(r.raw_text, (v) => word(v, 512)),
      value,
      unknownReason,
      quality,
      region,
    };
  });
export const photoConfirmationFromRow = (r: Row) =>
  decode<PhotoConfirmation>('photo_confirmation', () => {
    const candidateId = nullable(r.candidate_id, (v) => uid('photo_candidate', v)),
      origin = choice(r.origin, ['accepted_candidate', 'corrected_candidate', 'manual']);
    if ((origin === 'manual') !== (candidateId === null)) return reject();
    return {
      uploadId: uid('photo_upload', r.upload_id),
      field: choice(r.field_code, photoFields),
      revision: revisionValue(r.revision),
      candidateId,
      origin,
      value: word(r.confirmed_value, 512),
      confirmedAt: at(r.confirmed_at),
    };
  });
export const photoExtractionFromRow = (r: Row) =>
  decode<PhotoExtraction>('photo_extraction', () => {
    const state = choice(r.state, [
        'queued',
        'processing',
        'complete',
        'rejected',
        'failed',
        'cancelled',
      ]),
      artifactId = nullable(r.artifact_id, (v) => uid('ai_artifact', v)),
      candidateCount = nullable(r.candidate_count, (v) => num(v, 0, 40));
    if (
      (state === 'complete') !== (artifactId !== null) ||
      (state === 'complete') !== (candidateCount !== null)
    )
      return reject();
    return {
      id: uid('photo_extraction', r.id),
      uploadId: uid('photo_upload', r.upload_id),
      requestId: uid('ai_request', r.request_id),
      jobId: uid('job', r.job_id),
      state,
      artifactId,
      candidateCount,
    };
  });
