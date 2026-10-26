import type { Id, Instant } from '../../../domain/src/values/core.ts';
import type { AnalyticsContext, AnalyticsEvent } from './analytics.ts';
import type { KeyDigest } from './private-records.ts';
import type { TransactionContext as Tx } from './transactions.ts';
export interface CollectionGrant extends AnalyticsContext {
  readonly sessionId: Id<'owner_session'>;
}
export interface CollectionContext extends AnalyticsContext {
  readonly sessionId: Id<'analytics_session'>;
  readonly market: 'US';
  readonly locale: 'en-US';
  readonly channel: AnalyticsEvent['channel'];
  readonly issuedAt: Instant;
  readonly expiresAt: Instant;
}
export interface CollectionCrypto {
  issue(grant: CollectionGrant, channel: AnalyticsEvent['channel'], at: Instant): string;
  parse(raw: string, at: Instant): CollectionContext | null;
}
export interface QuotaCrypto {
  readonly versions: readonly string[];
  keys(kind: 'ip' | 'email', value: string): readonly KeyDigest[];
}
export interface AnalyticsAuthority {
  grant(
    tx: Tx,
    keys: readonly KeyDigest[],
    policy: string,
    noticeId: Id<'notice'>,
  ): Promise<CollectionGrant | null>;
}
export interface AnalyticsMaintenance {
  purgeWithdrawn(tx: Tx, limit: number): Promise<number>;
  expireGenerations(tx: Tx, limit: number): Promise<number>;
}
export interface RuntimeHealth {
  readonly sampledAt: Instant;
  readonly analyticsPending: number;
  readonly sendsQueued: number;
  readonly sendsUncertain: number;
  readonly outboxPending: number;
  readonly quotaRows: number;
  readonly quotaCapacity: number;
  readonly capped: boolean;
}
export interface HealthRepository {
  snapshot(tx: Tx): Promise<RuntimeHealth>;
}
