import type { Id, Instant, Revision } from '../../../domain/src/values/index.ts';
import type { TransactionContext as Tx } from './transactions.ts';
export interface AnalyticsEvent {
  readonly id: Id<'event'>;
  readonly name:
    | 'public_page_view'
    | 'assessment_started'
    | 'report_viewed'
    | 'comparison_saved'
    | 'delivery_requested';
  readonly occurredAt: Instant;
  readonly sessionId: Id<'analytics_session'> | null;
  readonly market: string;
  readonly locale: string;
  readonly route:
    | '/'
    | '/assess'
    | '/reports/:report'
    | '/compare/:report'
    | '/learn/:slug'
    | '/guides/:slug'
    | '/glossary/:slug'
    | '/tires/models/:slug'
    | '/tires/sizes/:slug';
  readonly channel: 'web' | 'app' | 'mcp';
  readonly props: {
    readonly step?: 'start' | 'vehicle' | 'tires' | 'conditions' | 'results';
    readonly outcome?: 'success' | 'denied' | 'failed';
  };
  readonly bot: 'unknown' | 'internal' | 'suspected_bot' | 'not_flagged';
}
export interface AnalyticsContext {
  readonly subjectId: Id<'subject'>;
  readonly permission: Revision;
  readonly scope: string;
  readonly policy: string;
}
export interface Metric {
  readonly metric: 'events' | 'sessions';
  readonly market: string;
  readonly dimension: 'all' | 'web' | 'app' | 'mcp';
  readonly value: bigint;
}
export interface AnalyticsBuild {
  readonly day: string;
  readonly token: Id<'lease'>;
  readonly generation: Revision;
  readonly privacyRevision: bigint;
  readonly metrics: readonly Metric[];
}
export interface AnalyticsRepository {
  receive(
    tx: Tx,
    context: AnalyticsContext,
    events: readonly AnalyticsEvent[],
  ): Promise<{ readonly inserted: number }>;
  capture(tx: Tx, leaseSeconds: number): Promise<AnalyticsBuild | null>;
  publish(tx: Tx, build: AnalyticsBuild): Promise<void>;
  retry(tx: Tx, build: AnalyticsBuild): Promise<void>;
  purgeSubject(tx: Tx, subjectId: Id<'subject'>, limit: number): Promise<number>;
  cleanup(tx: Tx, limit: number): Promise<number>;
}
