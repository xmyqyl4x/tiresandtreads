import { expect, it } from 'vitest';
import { aiRequestFromRow } from '../../packages/db/src/repositories/analysis-mappers.ts';
const uuid = '10000000-0000-4000-8000-000000000001';
const requestRow = {
  id: uuid,
  scope_id: uuid,
  policy_version_id: uuid,
  owner_subject_id: uuid,
  input_digest: 'a'.repeat(64),
  input_manifest: { parameters: { usage: 'commute' } },
  state: 'queued',
  expires_at: '2026-11-06T01:00:00.000Z',
  permission_revision: '9007199254740993',
  invalidation_revision: '0',
};
it('decodes exact stored request authority without rounding its int64 revision or exposing private extra columns', () => {
  const result = aiRequestFromRow({ ...requestRow, provider_request_id: 'private-extra' });
  expect(result).toMatchObject({
    ok: true,
    value: {
      id: uuid,
      permissionRevision: 9007199254740993n,
      invalidationRevision: 0n,
      manifest: { parameters: { usage: 'commute' } },
    },
  });
  if (result.ok) expect(Object.keys(result.value)).not.toContain('provider_request_id');
});

import {
  aiPolicyFromRow,
  aiScopeFromRow,
  aiAttemptFromRow,
  aiArtifactFromRow,
  aiBudgetFromRow,
  analysisProjectionFromRow,
} from '../../packages/db/src/repositories/analysis-mappers.ts';
import {
  photoStatusFromRow,
  photoCandidateFromRow,
  photoConfirmationFromRow,
  photoExtractionFromRow,
} from '../../packages/db/src/repositories/photo-mappers.ts';
import {
  csvTemplateFromRow,
  csvWorkflowFromRow,
  csvReviewFromRow,
} from '../../packages/db/src/repositories/csv-review-mappers.ts';
const at = '2026-11-06T01:00:00.000Z',
  later = '2026-11-06T02:00:00.000Z';
const policy = {
  id: uuid,
  task: 'report_analysis',
  canonical_version: 'jsonb-v1',
  validator_version: 'v1',
  shared_allowed: false,
  shared_parameter_allowlist: [],
  status: 'active',
};
const scope = {
  id: uuid,
  policy_version_id: uuid,
  kind: 'owner',
  owner_subject_id: uuid,
  subject_permission_revision: '1',
  permission_revision: '1',
  invalidation_revision: '0',
  state: 'active',
  processing_allowed: true,
  notice_version: 'v1',
};
const attempt = {
  id: uuid,
  request_id: uuid,
  attempt: 1,
  state: 'created',
  currency_code: 'USD',
  cost_minor: null,
  cost_status: 'unknown',
};
const artifact = {
  id: uuid,
  scope_id: uuid,
  request_id: uuid,
  input_digest: 'a'.repeat(64),
  output: { fields: ['synthetic'] },
  output_hash: 'b'.repeat(64),
  generated_at: at,
  valid_until: later,
  retain_until: later,
};
const budget = {
  id: uuid,
  budget_id: uuid,
  attempt_id: uuid,
  reserved_minor: '9007199254740993',
  settled_minor: null,
  state: 'reserved',
  currency_code: 'USD',
};
const projection = {
  report_id: uuid,
  report_version: 1,
  revision: '1',
  selection_kind: 'owner',
  output: { summary: 'synthetic' },
  generated_at: at,
  valid_until: later,
};
const photo = { id: uuid, state: 'ready', created_at: at, expires_at: later, saved_at: null };
const candidate = {
  id: uuid,
  upload_id: uuid,
  field_code: 'brand',
  ordinal: 0,
  raw_text: 'Synthetic',
  normalized_value: 'Synthetic',
  unknown_reason: null,
  quality: 'clear',
  region: { x: 0, y: 0, w: 1, h: 1 },
};
const confirmation = {
  upload_id: uuid,
  field_code: 'brand',
  revision: '1',
  candidate_id: null,
  origin: 'manual',
  confirmed_value: 'Synthetic',
  confirmed_at: at,
};
const extraction = {
  id: uuid,
  upload_id: uuid,
  request_id: uuid,
  job_id: uuid,
  state: 'queued',
  artifact_id: null,
  candidate_count: null,
};
const template = {
  id: uuid,
  template_key: 'synthetic',
  version: 1,
  source_kind: 'catalog',
  schema_version: 's1',
  mapping_version: 'm1',
  parser_revision: 'a'.repeat(40),
  definition_hash: 'b'.repeat(64),
  columns: [{ name: 'brand', type: 'text', required: true }],
  max_bytes: 20971520,
  max_rows: 100000,
  state: 'active',
};
const workflow = {
  id: uuid,
  run_id: uuid,
  template_id: uuid,
  status: 'registered',
  accepted_count: '9007199254740993',
  rejected_count: '0',
  validation_job_state: 'pending',
  expires_at: later,
  current: true,
};
const review = {
  id: uuid,
  intake_id: uuid,
  run_revision: '9007199254740993',
  run_fence: '0',
  expected_head_revision: '0',
  diff_artifact_id: uuid,
  validation_artifact_id: uuid,
  reviewer_id: uuid,
  reviewer_role_revision: '1',
  decision: 'approved',
  reason_code: 'synthetic',
};
const readers = [
  ['policy', aiPolicyFromRow, policy],
  ['scope', aiScopeFromRow, scope],
  ['attempt', aiAttemptFromRow, attempt],
  ['artifact', aiArtifactFromRow, artifact],
  ['budget', aiBudgetFromRow, budget],
  ['projection', analysisProjectionFromRow, projection],
  ['photo', photoStatusFromRow, photo],
  ['candidate', photoCandidateFromRow, candidate],
  ['confirmation', photoConfirmationFromRow, confirmation],
  ['extraction', photoExtractionFromRow, extraction],
  ['template', csvTemplateFromRow, template],
  ['workflow', csvWorkflowFromRow, workflow],
  ['review', csvReviewFromRow, review],
] as const;
it.each(readers)(
  'decodes the %s projection, freezes it and excludes unknown private fields',
  (_name, read, row) => {
    const r = read({ ...row, private_key: 'never expose' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.isFrozen(r.value)).toBe(true);
      expect(r.value).not.toHaveProperty('private_key');
    }
  },
);
const bad = [
  ['request precision', aiRequestFromRow, { ...requestRow, permission_revision: 9007199254740992 }],
  ['request hash', aiRequestFromRow, { ...requestRow, input_digest: 'x' }],
  [
    'request manifest',
    aiRequestFromRow,
    { ...requestRow, input_manifest: { parameters: {}, secret: 1 } },
  ],
  ['request state', aiRequestFromRow, { ...requestRow, state: 'done' }],
  ['policy task', aiPolicyFromRow, { ...policy, task: 'execute' }],
  ['policy allowlist', aiPolicyFromRow, { ...policy, shared_parameter_allowlist: 'usage' }],
  ['scope owner', aiScopeFromRow, { ...scope, owner_subject_id: null }],
  ['scope revision', aiScopeFromRow, { ...scope, subject_permission_revision: null }],
  ['scope notice', aiScopeFromRow, { ...scope, notice_version: null }],
  ['scope authority', aiScopeFromRow, { ...scope, state: 'withdrawn' }],
  ['attempt cost', aiAttemptFromRow, { ...attempt, cost_minor: '1' }],
  ['attempt currency', aiAttemptFromRow, { ...attempt, currency_code: 'usd' }],
  ['attempt ordinal', aiAttemptFromRow, { ...attempt, attempt: 4 }],
  ['artifact time', aiArtifactFromRow, { ...artifact, valid_until: at }],
  ['artifact retention', aiArtifactFromRow, { ...artifact, retain_until: at }],
  ['artifact output', aiArtifactFromRow, { ...artifact, output: [] }],
  ['budget settlement', aiBudgetFromRow, { ...budget, state: 'settled' }],
  [
    'budget overrun',
    aiBudgetFromRow,
    { ...budget, state: 'settled', settled_minor: '9007199254740994' },
  ],
  ['budget amount', aiBudgetFromRow, { ...budget, reserved_minor: '0' }],
  ['projection version', analysisProjectionFromRow, { ...projection, report_version: 0 }],
  ['photo date', photoStatusFromRow, { ...photo, expires_at: 'invalid' }],
  ['candidate unknown', photoCandidateFromRow, { ...candidate, quality: 'unknown' }],
  ['candidate null', photoCandidateFromRow, { ...candidate, normalized_value: null }],
  [
    'candidate bounds',
    photoCandidateFromRow,
    { ...candidate, region: { x: 0.9, y: 0, w: 0.2, h: 1 } },
  ],
  [
    'candidate extras',
    photoCandidateFromRow,
    { ...candidate, region: { x: 0, y: 0, w: 1, h: 1, rotation: 0 } },
  ],
  ['candidate ordinal', photoCandidateFromRow, { ...candidate, ordinal: 4 }],
  [
    'confirmation origin',
    photoConfirmationFromRow,
    { ...confirmation, origin: 'accepted_candidate' },
  ],
  ['extraction seal', photoExtractionFromRow, { ...extraction, state: 'complete' }],
  [
    'template executable',
    csvTemplateFromRow,
    { ...template, columns: [{ name: 'brand', type: 'text', required: true, script: 'exec' }] },
  ],
  [
    'template duplicate',
    csvTemplateFromRow,
    { ...template, columns: [...template.columns, ...template.columns] },
  ],
  ['template max', csvTemplateFromRow, { ...template, max_bytes: 20971521 }],
  ['template parser', csvTemplateFromRow, { ...template, parser_revision: 'branch' }],
  ['workflow precision', csvWorkflowFromRow, { ...workflow, accepted_count: 9007199254740992 }],
  ['review precision', csvReviewFromRow, { ...review, run_revision: '9223372036854775808' }],
] as const;
it.each(bad)('refuses invalid stored %s', (_name, read, row) =>
  expect(read(row)).toMatchObject({ ok: false, error: { code: 'invalid_stored_data' } }),
);
it('deep-freezes canonical request JSON without freezing caller-owned data', () => {
  const input = { ...requestRow, input_manifest: { parameters: { nested: ['a'] } } };
  const r = aiRequestFromRow(input);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(Object.isFrozen(r.value.manifest.parameters.nested)).toBe(true);
    expect(Object.isFrozen(input.input_manifest.parameters.nested)).toBe(false);
  }
});
