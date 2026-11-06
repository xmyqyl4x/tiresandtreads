import type { Id, Instant, Revision } from '../values/core.ts';
export type AITask = 'report_analysis' | 'generic_explanation' | 'photo_extraction';
export type AIRequestState =
  'queued' | 'running' | 'accepted' | 'rejected' | 'failed' | 'uncertain' | 'cancelled';
export type AIAttemptState =
  'created' | 'started' | 'succeeded' | 'failed' | 'uncertain' | 'cancelled';
export interface AIManifest {
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly bundle_id?: string;
  readonly authoritative_hash?: string;
  readonly rule_version?: string;
  readonly advice_revision?: string;
  readonly sanitized_sha256?: string;
}
export interface AIPolicy {
  readonly id: Id<'ai_policy'>;
  readonly task: AITask;
  readonly canonicalVersion: string;
  readonly validatorVersion: string;
  readonly sharedAllowed: boolean;
  readonly sharedParameters: readonly string[];
  readonly status: 'draft' | 'active' | 'retired' | 'blocked';
}
export interface AIScope {
  readonly id: Id<'ai_scope'>;
  readonly policyId: Id<'ai_policy'>;
  readonly ownerId: Id<'subject'> | null;
  readonly kind: 'owner' | 'shared';
  readonly permissionRevision: Revision;
  readonly subjectRevision: Revision | null;
  readonly invalidationRevision: bigint;
  readonly state: 'active' | 'withdrawn' | 'deleting';
  readonly processingAllowed: boolean;
  readonly noticeVersion: string | null;
}
export interface AIRequest {
  readonly id: Id<'ai_request'>;
  readonly scopeId: Id<'ai_scope'>;
  readonly policyId: Id<'ai_policy'>;
  readonly ownerId: Id<'subject'> | null;
  readonly digest: string;
  readonly manifest: AIManifest;
  readonly state: AIRequestState;
  readonly expiresAt: Instant;
  readonly permissionRevision: Revision;
  readonly invalidationRevision: bigint;
}
export interface AIAttempt {
  readonly id: Id<'ai_attempt'>;
  readonly requestId: Id<'ai_request'>;
  readonly ordinal: number;
  readonly state: AIAttemptState;
  readonly currency: string;
  readonly costMinor: bigint | null;
  readonly costStatus: 'unknown' | 'estimated' | 'reconciled';
}
export interface AIArtifact {
  readonly id: Id<'ai_artifact'>;
  readonly scopeId: Id<'ai_scope'>;
  readonly requestId: Id<'ai_request'>;
  readonly digest: string;
  readonly output: Readonly<Record<string, unknown>>;
  readonly outputHash: string;
  readonly generatedAt: Instant;
  readonly validUntil: Instant;
  readonly retainUntil: Instant;
}
export interface AILease {
  readonly scopeId: Id<'ai_scope'>;
  readonly digest: string;
  readonly holder: Id<'ai_holder'>;
  readonly fence: Revision;
}
export interface AIBudgetHold {
  readonly id: Id<'ai_budget_hold'>;
  readonly budgetId: Id<'ai_budget'>;
  readonly attemptId: Id<'ai_attempt'>;
  readonly amountMinor: bigint;
  readonly settledMinor: bigint | null;
  readonly state: 'reserved' | 'uncertain' | 'settled' | 'released';
  readonly currency: string;
}
export interface AnalysisProjection {
  readonly reportId: Id<'report'>;
  readonly version: number;
  readonly revision: Revision;
  readonly kind: 'owner' | 'shared';
  readonly output: Readonly<Record<string, unknown>>;
  readonly generatedAt: Instant;
  readonly validUntil: Instant;
}
