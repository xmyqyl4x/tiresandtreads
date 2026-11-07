import type { Id, Revision } from '../../../domain/src/values/core.ts';
import type { Envelope, KeyDigest } from './private-records.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { AssetLocation } from './assets.ts';
import type { FrozenAnalysis, AnalysisFallback } from '../../../domain/src/analysis-delivery.ts';
import type { SignedPrivacyRecord } from './privacy-services.ts';
export interface ErasureMark {
  readonly hash: string;
  readonly revision: string;
  readonly permanent: boolean;
}
export interface AnalysisErasureLease {
  readonly id: Id<'analysis_erasure'>;
  readonly token: Id<'lease'>;
  readonly generation: Revision;
  readonly phase: 'journal' | 'prepare' | 'objects' | 'providers' | 'sql';
}
export interface ErasureProviderObject {
  readonly id: Id<'erasure_resource'>;
  readonly provider: string;
  readonly kind: 'file' | 'response' | 'email';
  readonly reference: Envelope;
}
export interface AnalysisErasureRepository {
  beginRequest(tx: Tx, request: Id<'privacy_request'>): Promise<Id<'analysis_erasure'> | null>;
  beginScope(
    tx: Tx,
    keys: readonly KeyDigest[],
    scope: Id<'ai_scope'>,
    command: string,
  ): Promise<Id<'analysis_erasure'>>;
  acquire(tx: Tx, id: Id<'analysis_erasure'>): Promise<AnalysisErasureLease | null>;
  marks(tx: Tx, lease: AnalysisErasureLease): Promise<readonly ErasureMark[]>;
  journaled(tx: Tx, lease: AnalysisErasureLease, digest: string): Promise<void>;
  journal(
    tx: Tx,
    lease: AnalysisErasureLease,
    record: SignedPrivacyRecord,
  ): Promise<SignedPrivacyRecord>;
  prepare(tx: Tx, lease: AnalysisErasureLease): Promise<void>;
  object(
    tx: Tx,
    lease: AnalysisErasureLease,
  ): Promise<Readonly<{ wait: boolean; asset: AssetLocation | null }>>;
  provider(tx: Tx, lease: AnalysisErasureLease): Promise<ErasureProviderObject | null>;
  receipt(
    tx: Tx,
    lease: AnalysisErasureLease,
    kind: 'objects' | 'providers',
    id: string,
    digest: string,
  ): Promise<void>;
  purge(tx: Tx, lease: AnalysisErasureLease): Promise<'pending' | 'complete' | 'charges'>;
  finish(tx: Tx, lease: AnalysisErasureLease): Promise<void>;
  release(tx: Tx, lease: AnalysisErasureLease, blocked: boolean, failed?: boolean): Promise<void>;
  status(tx: Tx, id: Id<'analysis_erasure'>): Promise<'pending' | 'complete' | 'blocked'>;
  pending(tx: Tx): Promise<readonly Id<'analysis_erasure'>[]>;
  operatorRetry(
    tx: Tx,
    job: Id<'analysis_erasure'>,
    actor: Id<'staff'>,
    evidence: string,
  ): Promise<void>;
  retryRequest(tx: Tx, request: Id<'privacy_request'>): Promise<void>;
  replay(tx: Tx, marks: readonly ErasureMark[], receipt: string): Promise<void>;
  freshScope(tx: Tx, scope: Id<'ai_scope'>): Promise<boolean>;
  save(
    tx: Tx,
    keys: readonly KeyDigest[],
    upload: Id<'photo_upload'>,
    notice: string,
    evidence: string,
  ): Promise<string>;
  expired(tx: Tx): Promise<readonly Id<'ai_scope'>[]>;
  beginExpired(tx: Tx, scope: Id<'ai_scope'>): Promise<Id<'analysis_erasure'>>;
  registerProvider(
    tx: Tx,
    input: Readonly<{
      id: Id<'erasure_resource'>;
      scopeId: Id<'ai_scope'>;
      attemptId: Id<'ai_attempt'>;
      referenceKeys: readonly KeyDigest[];
      provider: string;
      kind: 'file' | 'response';
      reference: Envelope;
    }>,
  ): Promise<void>;
}
export interface AnalysisDeliveryRepository {
  capture(
    tx: Tx,
    input: Readonly<{
      sendId: Id<'send'>;
      ownerId: Id<'subject'>;
      reportId: Id<'report'>;
      version: number;
      revision: string | null;
      fallback: AnalysisFallback | null;
    }>,
  ): Promise<FrozenAnalysis>;
  selection(tx: Tx, sendId: Id<'send'>): Promise<FrozenAnalysis>;
  permitted(tx: Tx, sendId: Id<'send'>): Promise<boolean>;
}
