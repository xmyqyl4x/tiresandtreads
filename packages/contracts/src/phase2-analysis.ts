import { z, p2Uuid, p2Revision } from './phase2-partners.ts';
import type { EndpointContract } from './http.ts';
const notice = z.string().min(1).max(100),
  empty = z.strictObject({});
export const analysisApiInputs = {
  request: z.strictObject({ policyId: p2Uuid, allowed: z.boolean(), noticeVersion: notice }),
  choice: z.strictObject({
    allowed: z.boolean(),
    expectedRevision: p2Revision,
    noticeVersion: notice,
  }),
  attachment: z.strictObject({}),
} as const;
export const photoFieldInput = z.enum([
  'brand',
  'model',
  'tire_size',
  'load_index',
  'speed_rating',
  'dot_tin',
  'date_code',
  'seasonal_marking',
  'run_flat_marking',
]);
export const photoApiInputs = {
  capture: z.strictObject({ policyId: p2Uuid }),
  intent: z.strictObject({
    allowed: z.boolean(),
    batchId: p2Uuid,
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    noticeVersion: notice,
    policyId: p2Uuid,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().min(1).max(10485760),
  }),
  confirm: z.strictObject({
    candidateId: p2Uuid.nullable(),
    field: photoFieldInput,
    revision: p2Revision,
    value: z.string().min(1).max(160),
  }),
  finalize: z.string().regex(/^[a-f0-9]{64}$/),
  extract: empty,
  remove: empty,
  save: z.strictObject({ noticeVersion: notice }),
} as const;
export const analysisApiContracts: readonly EndpointContract[] = [
  {
    operationId: 'p2AnalysisRequest',
    path: '/api/v1/reports/:report/versions/:version/analysis',
    method: 'POST',
    access: 'owner',
    command: true,
  },
  {
    operationId: 'p2AnalysisStatus',
    path: '/api/v1/analysis/:request',
    method: 'GET',
    access: 'owner',
  },
  {
    operationId: 'p2AnalysisAttachment',
    path: '/api/v1/reports/:report/versions/:version/analysis/attachment',
    method: 'GET',
    access: 'owner',
  },
  {
    operationId: 'p2AnalysisChoice',
    path: '/api/v1/analysis/scopes/:scope/choice',
    method: 'POST',
    access: 'owner',
    command: true,
  },
  {
    operationId: 'p2PhotoCapture',
    path: '/api/v1/photo-batches',
    method: 'POST',
    access: 'owner',
    command: true,
  },
  {
    operationId: 'p2PhotoIntent',
    path: '/api/v1/photos',
    method: 'POST',
    access: 'owner',
    command: true,
  },
  {
    operationId: 'p2PhotoFinalize',
    path: '/api/v1/photos/:upload/finalize',
    method: 'POST',
    access: 'owner',
    command: true,
    bodyMode: 'bytes',
    bodyContentType: 'application/octet-stream',
    maxBodyBytes: 10485760,
  },
  {
    operationId: 'p2PhotoExtract',
    path: '/api/v1/photos/:upload/extract',
    method: 'POST',
    access: 'owner',
    command: true,
  },
  { operationId: 'p2PhotoStatus', path: '/api/v1/photos/:upload', method: 'GET', access: 'owner' },
  {
    operationId: 'p2PhotoConfirm',
    path: '/api/v1/photos/:upload/confirm',
    method: 'POST',
    access: 'owner',
    command: true,
  },
  {
    operationId: 'p2PhotoDelete',
    path: '/api/v1/photos/:upload',
    method: 'DELETE',
    access: 'owner',
    command: true,
    successStatuses: [202],
  },
  {
    operationId: 'p2PhotoSave',
    path: '/api/v1/photos/:upload/save',
    method: 'POST',
    access: 'owner',
    command: true,
  },
];
const text = z.string().max(2000),
  codes = z.array(z.string().min(1).max(160)).max(64),
  stamp = z.iso.datetime();
export const photoCandidateView = z.object({
  id: p2Uuid,
  uploadId: p2Uuid,
  field: photoFieldInput,
  ordinal: z.number().int().min(0).max(100),
  rawText: z.string().max(160).nullable(),
  value: z.string().max(160).nullable(),
  unknownReason: z.enum(['unreadable', 'not_visible', 'ambiguous', 'unsupported']).nullable(),
  quality: z.enum(['clear', 'uncertain', 'unknown']),
  region: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().min(0).max(1),
      h: z.number().min(0).max(1),
    })
    .nullable(),
});
export const photoConfirmationView = z.object({
  uploadId: p2Uuid,
  field: photoFieldInput,
  revision: p2Revision,
  candidateId: p2Uuid.nullable(),
  origin: z.enum(['accepted_candidate', 'corrected_candidate', 'manual']),
  value: z.string().min(1).max(160),
  confirmedAt: stamp,
});
export const photoStatusView = z.object({
  id: p2Uuid,
  state: z.enum([
    'pending',
    'processing',
    'ready',
    'quarantined',
    'complete',
    'rejected',
    'deleting',
    'deleted',
  ]),
  expiresAt: stamp,
  dotStatus: z.enum(['unverified_full', 'partial', 'not_visible']),
  candidates: z.array(photoCandidateView).max(100),
  confirmations: z.array(photoConfirmationView).max(100),
  limitations: codes,
});
export const renderedAnalysisView = z.discriminatedUnion('kind', [
  z.object({
    schema: z.literal(1),
    kind: z.literal('ai_assisted_selection'),
    summary: text,
    claims: z
      .array(
        z.object({
          rank: z.number().int().min(1).max(5),
          status: z.enum(['eligible', 'blocked', 'unverified']),
          reasonCodes: codes,
          citations: codes,
          scoreBasisPoints: z.number().int().min(0).max(10000).nullable(),
          budget: z.enum(['within', 'above', 'unknown', 'not_requested']),
        }),
      )
      .max(5),
    limitations: codes,
    questions: codes,
  }),
  z.object({
    schema: z.literal(1),
    kind: z.literal('reviewed_generic_explanation'),
    claims: z
      .array(z.object({ text, adviceId: p2Uuid, sourceId: p2Uuid }))
      .min(1)
      .max(1),
    limitations: codes,
    questions: codes,
  }),
]);

const processingView = z.object({
  scopeId: p2Uuid,
  permissionRevision: p2Revision,
  allowed: z.boolean(),
});
const reportVersionView = { reportId: p2Uuid, version: z.number().int().min(1).max(2147483647) };
export const analysisStatusView = z.discriminatedUnion('state', [
  z.object({
    ...reportVersionView,
    id: p2Uuid,
    state: z.literal('available'),
    output: renderedAnalysisView,
    processing: processingView.optional(),
  }),
  z.object({
    ...reportVersionView,
    id: p2Uuid.nullable(),
    state: z.enum(['not_requested', 'pending', 'unavailable', 'expired']),
    output: z.null(),
    processing: processingView.optional(),
  }),
]);
export const analysisAttachmentView = z.discriminatedUnion('state', [
  z.object({
    ...reportVersionView,
    state: z.literal('available'),
    attachment: z.object({
      revision: p2Revision,
      kind: z.enum(['owner', 'shared']),
      output: renderedAnalysisView,
      generatedAt: stamp,
      validUntil: stamp,
    }),
  }),
  z.object({ ...reportVersionView, state: z.literal('unavailable'), attachment: z.null() }),
]);
