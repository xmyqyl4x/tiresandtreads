import type { Id, Instant } from '../../../domain/src/values/core.ts';
import type {
  AIRequest,
  AIScope,
  AIPolicy,
  AILease,
} from '../../../domain/src/entities/analysis.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { AnalysisProviderResult } from './report-analysis.ts';
import type { AIManifest } from '../../../domain/src/entities/analysis.ts';
export interface AnalysisCommandCache {
  lookup(
    tx: Tx,
    input: Readonly<{
      scope: AIScope;
      policy: AIPolicy;
      key: string;
      manifest: AIManifest;
      reportId: Id<'report'>;
      version: number;
    }>,
  ): Promise<AIRequest | null>;
  remember(
    tx: Tx,
    input: Readonly<{
      scope: AIScope;
      key: string;
      request: AIRequest;
      reportId: Id<'report'>;
      version: number;
    }>,
  ): Promise<void>;
}
export interface AnalysisDispatch {
  readonly ordinal: number;
  readonly lease: AILease | null;
  readonly generation: bigint;
}
export interface AnalysisExecutionRuntime {
  next(tx: Tx, request: AIRequest, policy: AIPolicy): Promise<AnalysisDispatch | null>;
  begin(
    tx: Tx,
    input: Readonly<{
      request: AIRequest;
      attemptId: Id<'ai_attempt'>;
      dispatch: AnalysisDispatch;
      lease: AILease;
    }>,
  ): Promise<void>;
  finish(
    tx: Tx,
    input: Readonly<{
      request: AIRequest;
      attemptId: Id<'ai_attempt'>;
      response: AnalysisProviderResult;
      accepted: boolean;
      remainingMs: number;
    }>,
  ): Promise<boolean>;
}
export interface AnalysisArtifactSource {
  readonly key: string;
  readonly datasetId: Id<'dataset'> | null;
  readonly adviceId: Id<'advice_fact'> | null;
  readonly claimHash: string;
  readonly rightsUntil: Instant;
}
export interface AnalysisValidatedOutput {
  readonly output: Readonly<Record<string, unknown>>;
  readonly sources: readonly AnalysisArtifactSource[];
  readonly expiresAt: Instant;
}
