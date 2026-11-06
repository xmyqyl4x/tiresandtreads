import type { Id, Instant, Revision } from '../../../domain/src/values/core.ts';
import type {
  AIManifest,
  AIPolicy,
  AIScope,
  AIRequest,
  AIRequestState,
  AIAttempt,
  AIArtifact,
  AILease,
  AIBudgetHold,
  AnalysisProjection,
} from '../../../domain/src/entities/analysis.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { Page, PageRequest } from './pagination.ts';
export interface AIScopeRepository {
  policy(tx: Tx, id: Id<'ai_policy'>): Promise<AIPolicy | null>;
  scope(tx: Tx, id: Id<'ai_scope'>): Promise<AIScope | null>;
  create(
    tx: Tx,
    input: Readonly<{
      id: Id<'ai_scope'>;
      policyId: Id<'ai_policy'>;
      ownerId: Id<'subject'> | null;
      key: string;
      subjectRevision: Revision | null;
      noticeVersion: string;
      evidenceHash: string;
    }>,
  ): Promise<AIScope>;
  choice(
    tx: Tx,
    input: Readonly<{
      scopeId: Id<'ai_scope'>;
      expectedRevision: Revision;
      subjectRevision: Revision | null;
      allowed: boolean;
      noticeVersion: string;
      evidenceHash: string;
    }>,
  ): Promise<AIScope>;
  invalidate(tx: Tx, scopeId: Id<'ai_scope'>, expected: bigint): Promise<AIScope>;
}
export interface AIRequestRepository {
  create(
    tx: Tx,
    input: Readonly<{
      id: Id<'ai_request'>;
      scopeId: Id<'ai_scope'>;
      key: string;
      manifest: AIManifest;
      deadlineSeconds: number;
    }>,
  ): Promise<AIRequest>;
  get(tx: Tx, id: Id<'ai_request'>): Promise<AIRequest | null>;
  transition(
    tx: Tx,
    id: Id<'ai_request'>,
    expected: AIRequestState,
    next: AIRequestState,
  ): Promise<AIRequest>;
  attempt(
    tx: Tx,
    input: Readonly<{
      id: Id<'ai_attempt'>;
      requestId: Id<'ai_request'>;
      ordinal: number;
      currency: string;
    }>,
  ): Promise<AIAttempt>;
  start(tx: Tx, id: Id<'ai_attempt'>): Promise<AIAttempt>;
  finish(
    tx: Tx,
    input: Readonly<{
      id: Id<'ai_attempt'>;
      state: 'succeeded' | 'failed' | 'uncertain';
      providerRequestId: string | null;
      inputTokens: bigint | null;
      outputTokens: bigint | null;
      costMinor: bigint | null;
      costStatus: AIAttempt['costStatus'];
      error:
        | 'timeout'
        | 'refused'
        | 'invalid_output'
        | 'provider_unavailable'
        | 'cancelled'
        | 'unknown_charge'
        | null;
    }>,
  ): Promise<AIAttempt>;
}
export interface AIReuseRepository {
  claim(
    tx: Tx,
    scopeId: Id<'ai_scope'>,
    digest: string,
    holder: Id<'ai_holder'>,
    seconds: number,
  ): Promise<AILease | null>;
  publish(tx: Tx, lease: AILease, artifactId: Id<'ai_artifact'>): Promise<boolean>;
  current(
    tx: Tx,
    scopeId: Id<'ai_scope'>,
    digest: string,
  ): Promise<Readonly<{
    artifactId: Id<'ai_artifact'>;
    output: Readonly<Record<string, unknown>>;
    validUntil: Instant;
    fence: Revision;
  }> | null>;
  affectedScopes(
    tx: Tx,
    source: Readonly<{ kind: 'dataset' | 'advice'; id: string }>,
    page: PageRequest,
  ): Promise<Page<Id<'ai_scope'>>>;
}
export interface AIArtifactRepository {
  publish(
    tx: Tx,
    input: Readonly<{
      id: Id<'ai_artifact'>;
      requestId: Id<'ai_request'>;
      attemptId: Id<'ai_attempt'>;
      lease: AILease;
      output: Readonly<Record<string, unknown>>;
      validSeconds: number;
      retainSeconds: number;
      sources: readonly Readonly<{
        key: string;
        datasetId: Id<'dataset'> | null;
        adviceId: Id<'advice_fact'> | null;
        claimHash: string;
        rightsUntil: Instant;
      }>[];
    }>,
  ): Promise<AIArtifact>;
  current(tx: Tx, id: Id<'ai_artifact'>): Promise<AIArtifact | null>;
}
export interface AIBudgetRepository {
  reserve(
    tx: Tx,
    attemptId: Id<'ai_attempt'>,
    windows: readonly Readonly<{ id: Id<'ai_budget'>; amountMinor: bigint }>[],
  ): Promise<readonly AIBudgetHold[]>;
  reconcile(
    tx: Tx,
    attemptId: Id<'ai_attempt'>,
    input: Readonly<{
      state: 'uncertain' | 'settled' | 'released';
      costMinor: bigint | null;
      reason: 'not_dispatched' | 'confirmed_not_charged' | null;
      evidenceId: Id<'audit_event'> | null;
    }>,
  ): Promise<readonly AIBudgetHold[]>;
}
export interface AIAttachmentRepository {
  append(
    tx: Tx,
    input: Readonly<{
      reportId: Id<'report'>;
      version: number;
      expectedRevision: bigint;
      artifactId: Id<'ai_artifact'>;
      scopeId: Id<'ai_scope'>;
      ownerId: Id<'subject'>;
      kind: 'owner' | 'shared';
      authorizationScopeId: Id<'ai_scope'>;
      permissionRevision: Revision;
      subjectRevision: Revision;
    }>,
  ): Promise<Revision>;
  freeze(
    tx: Tx,
    input: Readonly<{
      sendId: Id<'send'>;
      ownerId: Id<'subject'>;
      reportId: Id<'report'>;
      version: number;
      attachmentRevision: Revision | null;
      fallback: 'not_requested' | 'unavailable' | 'declined' | 'expired' | null;
    }>,
  ): Promise<void>;
  report(
    tx: Tx,
    ownerId: Id<'subject'>,
    reportId: Id<'report'>,
    version: number,
  ): Promise<AnalysisProjection | null>;
  status(
    tx: Tx,
    ownerId: Id<'subject'>,
    requestId: Id<'ai_request'>,
  ): Promise<Readonly<{
    id: Id<'ai_request'>;
    state: AIRequestState;
    createdAt: Instant;
    expiresAt: Instant;
  }> | null>;
}
