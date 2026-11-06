import type {
  AIRequest,
  AIPolicy,
  AIScope,
  AIAttempt,
  AIArtifact,
  AIBudgetHold,
  AnalysisProjection,
} from '../../../domain/src/entities/analysis.ts';
import {
  decode,
  uid,
  at,
  big,
  revisionValue,
  word,
  hash,
  choice,
  num,
  bool,
  object,
  nullable,
  requestStates,
  attemptStates,
  type Row,
} from './analysis-values.ts';
import { reject } from './bounds.ts';
import { manifestValue } from './analysis-input.ts';
export const aiRequestFromRow = (r: Row) =>
  decode<AIRequest>('ai_request', () => ({
    id: uid('ai_request', r.id),
    scopeId: uid('ai_scope', r.scope_id),
    policyId: uid('ai_policy', r.policy_version_id),
    ownerId: nullable(r.owner_subject_id, (v) => uid('subject', v)),
    digest: hash(r.input_digest),
    manifest: manifestValue(r.input_manifest),
    state: choice(r.state, requestStates),
    expiresAt: at(r.expires_at),
    permissionRevision: revisionValue(r.permission_revision),
    invalidationRevision: big(r.invalidation_revision),
  }));
export const aiPolicyFromRow = (r: Row) =>
  decode<AIPolicy>('ai_policy', () => {
    if (!Array.isArray(r.shared_parameter_allowlist)) return reject();
    const sharedParameters = Object.freeze(r.shared_parameter_allowlist.map((v) => word(v, 100)));
    return {
      id: uid('ai_policy', r.id),
      task: choice(r.task, ['report_analysis', 'generic_explanation', 'photo_extraction']),
      canonicalVersion: word(r.canonical_version, 100),
      validatorVersion: word(r.validator_version, 100),
      sharedAllowed: bool(r.shared_allowed),
      sharedParameters,
      status: choice(r.status, ['draft', 'active', 'retired', 'blocked']),
    };
  });
export const aiScopeFromRow = (r: Row) =>
  decode<AIScope>('ai_scope', () => {
    const kind = choice(r.kind, ['owner', 'shared']),
      ownerId = nullable(r.owner_subject_id, (v) => uid('subject', v)),
      subjectRevision = nullable(r.subject_permission_revision, revisionValue),
      state = choice(r.state, ['active', 'withdrawn', 'deleting']),
      allowed = bool(r.processing_allowed),
      noticeVersion = nullable(r.notice_version, (v) => word(v, 100));
    if (
      (kind === 'owner') !== (ownerId !== null) ||
      (kind === 'owner') !== (subjectRevision !== null) ||
      (allowed && (state !== 'active' || noticeVersion === null))
    )
      return reject();
    return {
      id: uid('ai_scope', r.id),
      policyId: uid('ai_policy', r.policy_version_id),
      kind,
      ownerId,
      subjectRevision,
      permissionRevision: revisionValue(r.permission_revision),
      invalidationRevision: big(r.invalidation_revision),
      state,
      processingAllowed: allowed,
      noticeVersion,
    };
  });
export const aiAttemptFromRow = (r: Row) =>
  decode<AIAttempt>('ai_attempt', () => {
    const costMinor = nullable(r.cost_minor, big),
      costStatus = choice(r.cost_status, ['unknown', 'estimated', 'reconciled']),
      currency = word(r.currency_code, 3);
    if ((costStatus === 'unknown') !== (costMinor === null) || !/^[A-Z]{3}$/.test(currency))
      return reject();
    return {
      id: uid('ai_attempt', r.id),
      requestId: uid('ai_request', r.request_id),
      ordinal: num(r.attempt, 1, 3),
      state: choice(r.state, attemptStates),
      currency,
      costMinor,
      costStatus,
    };
  });
export const aiArtifactFromRow = (r: Row) =>
  decode<AIArtifact>('ai_artifact', () => {
    const generatedAt = at(r.generated_at),
      validUntil = at(r.valid_until),
      retainUntil = at(r.retain_until);
    if (generatedAt >= validUntil || validUntil > retainUntil) return reject();
    return {
      id: uid('ai_artifact', r.id),
      scopeId: uid('ai_scope', r.scope_id),
      requestId: uid('ai_request', r.request_id),
      digest: hash(r.input_digest),
      output: object(r.output),
      outputHash: hash(r.output_hash),
      generatedAt,
      validUntil,
      retainUntil,
    };
  });
export const aiBudgetFromRow = (r: Row) =>
  decode<AIBudgetHold>('ai_budget_hold', () => {
    const state = choice(r.state, ['reserved', 'uncertain', 'settled', 'released']),
      amountMinor = big(r.reserved_minor, 1n),
      settledMinor = nullable(r.settled_minor, big),
      currency = word(r.currency_code, 3);
    if (
      (state === 'settled') !== (settledMinor !== null) ||
      (settledMinor !== null && settledMinor > amountMinor) ||
      !/^[A-Z]{3}$/.test(currency)
    )
      return reject();
    return {
      id: uid('ai_budget_hold', r.id),
      budgetId: uid('ai_budget', r.budget_id),
      attemptId: uid('ai_attempt', r.attempt_id),
      amountMinor,
      settledMinor,
      state,
      currency,
    };
  });
export const analysisProjectionFromRow = (r: Row) =>
  decode<AnalysisProjection>('analysis_projection', () => ({
    reportId: uid('report', r.report_id),
    version: num(r.report_version, 1),
    revision: revisionValue(r.revision),
    kind: choice(r.selection_kind, ['owner', 'shared']),
    output: object(r.output),
    generatedAt: at(r.generated_at),
    validUntil: at(r.valid_until),
  }));
