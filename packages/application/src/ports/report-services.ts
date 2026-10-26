import type { AssessmentInput, EngineSnapshot } from '../../../engine/src/model.ts';
import type { Id, Instant, Result } from '../../../domain/src/values/core.ts';
import type { QuoteEstimate } from '../../../engine/src/pricing/model.ts';
import type { JsonObject } from './catalog-records.ts';
import type { ApplicationFailure, TransactionContext as Tx } from './transactions.ts';
import type { KeyDigest, Envelope, Owner, Version, Comparison } from './private-records.ts';
export interface PreparedReport {
  readonly snapshot: EngineSnapshot;
  readonly prices: readonly QuoteEstimate[];
  readonly products: readonly JsonObject[];
}
export interface SafetyOverlay {
  readonly checkedAt: string;
  readonly status: 'current' | 'review_required' | 'unavailable';
  readonly matched: readonly string[];
  readonly unresolved: boolean;
}
export interface ReportEvidence {
  prepare(
    input: AssessmentInput,
    asOf: string,
  ): Promise<Result<PreparedReport, ApplicationFailure>>;
  current(prepared: PreparedReport): Promise<Result<boolean, ApplicationFailure>>;
  overlay(version: Version, asOf: string): Promise<Result<SafetyOverlay, ApplicationFailure>>;
}
export interface ReportPolicyRepository {
  published(
    tx: Tx,
    regionKey: string,
  ): Promise<Readonly<{
    id: Id<'rule'>;
    version: string;
    document: JsonObject;
    reviewedBy: string;
    reviewedAt: Instant;
  }> | null>;
}
export interface ReportRecallRepository {
  checkedAt(tx: Tx, dataset: Id<'dataset'>): Promise<Instant | null>;
}
export interface ReportAccessRepository {
  quoteNotes(
    tx: Tx,
    owner: Owner,
    reportId: Id<'report'>,
    quoteId: Id<'quote'>,
  ): Promise<Envelope | null>;
  shared(
    tx: Tx,
    keys: readonly KeyDigest[],
  ): Promise<Readonly<{ version: Version; comparison: Comparison | null }> | null>;
  quotePrivate(
    tx: Tx,
    owner: Owner,
    quoteId: Id<'quote'>,
    value: Envelope,
    expiresAt: Instant,
  ): Promise<void>;
}
export interface ReportCrypto {
  readonly keyVersion: string;
  id<K extends string>(kind: K, stableKey?: string): Id<K>;
  hash(purpose: string, value: string): string;
  token(
    purpose: 'share' | 'download',
    id: string,
    version: string,
  ): Readonly<{ token: string; key: KeyDigest }>;
}
export interface ReportEncryption {
  encrypt(bytes: Uint8Array, purpose: string, id: string): Promise<Envelope>;
  decrypt(value: Envelope, purpose: string, id: string): Promise<Uint8Array>;
}
