import type { Id, Instant } from '../../../domain/src/values/core.ts';
import type { TransactionContext as Tx } from './transactions.ts';
export type AnalysisOperationsPermission = 'ai.observe' | 'ai.control' | 'photo.observe';
export type AnalysisTask = 'report_analysis' | 'generic_explanation' | 'photo_extraction';
export type OperationState = 'executing' | 'succeeded' | 'refused' | 'unknown';
export interface OperationsReceipt {
  readonly id: Id<'ai_operation'>;
  readonly operation: 'disable' | 'resume';
  readonly target: Id<'ai_target'>;
  readonly state: OperationState;
  readonly createdAt: Instant;
  readonly finishedAt: Instant | null;
}
export interface AnalysisOperationsSnapshot {
  readonly ai: null | Readonly<{
    sampleLimit: 5000;
    requestsSampled: number;
    requestsTruncated: boolean;
    requestStates: Readonly<Record<string, number>>;
    attemptsSampled: number;
    attemptsTruncated: boolean;
    attemptStates: Readonly<Record<string, number>>;
    rejectionCodes: Readonly<Record<string, number>>;
    usdReconciledMinor: string;
    usdEstimatedMinor: string;
    unknownCostAttempts: number;
    otherCurrencyAttempts: number;
    reuseSampled: number;
    reuseTruncated: boolean;
    reuseStates: Readonly<Record<string, number>>;
    expiredStoredReady: number;
    guardsSampled: number;
    guardsTruncated: boolean;
    invalidatedGuards: number;
    guardStates: Readonly<Record<string, number>>;
    policies: readonly Readonly<{
      id: Id<'ai_policy'>;
      task: AnalysisTask;
      status: 'draft' | 'active' | 'retired' | 'blocked';
      fingerprint: string;
    }>[];
    policiesTruncated: boolean;
    queue: readonly Readonly<{
      id: Id<'ai_request'>;
      task: AnalysisTask;
      state: string;
      recordedWork: boolean;
      createdAt: Instant;
      expiresAt: Instant;
    }>[];
  }>;
  readonly photo: null | Readonly<{
    sampleLimit: 5000;
    confirmationsSampled: number;
    confirmationsTruncated: boolean;
    confirmationOrigins: Readonly<Record<string, number>>;
    purgesSampled: number;
    purgesTruncated: boolean;
    purgePhases: Readonly<Record<string, number>>;
    oldestPendingUpdatedAt: Instant | null;
  }>;
}
export interface AnalysisOperationsRepository {
  authorize(
    tx: Tx,
    actor: Id<'staff'>,
    subject: string,
    permission: AnalysisOperationsPermission,
  ): Promise<boolean>;
  snapshot(
    tx: Tx,
    from: Instant,
    until: Instant,
    include: Readonly<{ ai: boolean; photo: boolean }>,
  ): Promise<AnalysisOperationsSnapshot>;
  claim(
    tx: Tx,
    input: Readonly<{
      id: Id<'ai_operation'>;
      actor: Id<'staff'>;
      operation: 'disable' | 'resume';
      target: Id<'ai_target'>;
      digest: string;
    }>,
  ): Promise<{ created: boolean; receipt: OperationsReceipt }>;
  finish(
    tx: Tx,
    id: Id<'ai_operation'>,
    actor: Id<'staff'>,
    state: Exclude<OperationState, 'executing'>,
  ): Promise<OperationsReceipt>;
  receipt(tx: Tx, id: Id<'ai_operation'>, actor: Id<'staff'>): Promise<OperationsReceipt | null>;
  disable(tx: Tx, policy: Id<'ai_policy'>, fingerprint: string): Promise<boolean>;
  work(tx: Tx, id: Id<'ai_request'>): Promise<AnalysisTask | null>;
}
