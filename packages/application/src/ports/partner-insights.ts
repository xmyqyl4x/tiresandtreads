import type { Id, Instant } from '../../../domain/src/values/core.ts';
import type { PartnerPrincipal } from '../../../domain/src/partner-policy.ts';
import type { DomainSample } from '../../../domain/src/partner-insights-policy.ts';
import type { Envelope } from './private-records.ts';
import type { TransactionContext as Tx } from './transactions.ts';
export type InsightsPermission =
  | 'partner.disputes'
  | 'operations.email'
  | 'operations.visitors'
  | 'operations.insights'
  | 'operations.reveal'
  | 'operations.events'
  | 'operations.privacy';
export interface InsightsTokens {
  issue(
    actor: string,
    purpose: 'visitor' | 'page',
    data: Readonly<{ subject: string; week: string }>,
    now: number,
  ): string;
  parse(
    actor: string,
    purpose: 'visitor' | 'page',
    token: string,
    now: number,
  ): Readonly<{ subject: Id<'subject'>; week: string }> | null;
}
export interface InsightRelease {
  readonly state: 'available' | 'suppressed' | 'blocked';
  readonly week: string;
  readonly computedAt: Instant;
  readonly cells: Readonly<Record<string, string>> | null;
}
export interface VisitorRow {
  readonly subject: Id<'subject'>;
  readonly lastSeen: Instant;
  readonly sessions: string;
  readonly events: string;
  readonly routes: readonly string[];
  readonly channels: readonly string[];
}
export interface DisputeSummary {
  readonly id: Id<'partner_dispute'>;
  readonly reason: string;
  readonly state: 'open' | 'reviewing' | 'closed';
  readonly revision: number;
  readonly createdAt: Instant;
}
export interface RedemptionCommand {
  readonly key: Id<'command'>;
  readonly assignment: Id<'coupon_assignment'>;
  readonly kind: 'reported' | 'correction' | 'reversal';
  readonly quantity: number;
  readonly previous: Id<'redemption_event'> | null;
  readonly occurredAt: Instant;
}
export interface DisputeCommand {
  readonly key: Id<'command'>;
  readonly id: Id<'partner_dispute'>;
  readonly assignment: Id<'coupon_assignment'>;
  readonly reason: 'terms' | 'not_honored' | 'redemption' | 'error' | 'other';
  readonly kind: 'opened' | 'evidence' | 'resolved' | 'reopened';
  readonly expected: number;
  readonly details: string;
}
export interface OfferClick {
  readonly key: Id<'command'>;
  readonly organization: Id<'organization'>;
  readonly assignment: Id<'coupon_assignment'>;
  readonly method: 'GET' | 'HEAD';
  readonly classification: 'machine' | 'unknown' | 'suspected_human';
  readonly occurredAt: Instant;
}
export interface DeliveryHealth {
  readonly accepted: string;
  readonly uncertain: string;
  readonly delivered: string;
  readonly bounced: string;
  readonly complained: string;
  readonly suspectedHumanOpens: string;
  readonly machineOpens: string;
  readonly unknownOpens: string;
  readonly suspectedHumanClicks: string;
  readonly machineClicks: string;
  readonly unknownClicks: string;
}
export interface PartnerInsightsRepository {
  member(
    tx: Tx,
    principal: PartnerPrincipal,
    organization: Id<'organization'>,
    write: boolean,
  ): Promise<void>;
  staff(tx: Tx, principal: PartnerPrincipal, permission: InsightsPermission): Promise<void>;
  release(tx: Tx, organization: Id<'organization'> | null, week: string): Promise<InsightRelease>;
  redemption(
    tx: Tx,
    organization: Id<'organization'>,
    actor: string,
    input: RedemptionCommand,
    digest: string,
  ): Promise<Id<'redemption_event'>>;
  dispute(
    tx: Tx,
    organization: Id<'organization'>,
    actor: PartnerPrincipal,
    input: Omit<DisputeCommand, 'details'>,
    details: Envelope,
    digest: string,
  ): Promise<DisputeSummary>;
  disputes(
    tx: Tx,
    organization: Id<'organization'>,
    after: Id<'partner_dispute'> | null,
    limit: number,
  ): Promise<readonly DisputeSummary[]>;
  click(tx: Tx, actor: string, input: OfferClick, digest: string): Promise<void>;
  health(tx: Tx, week: string): Promise<DeliveryHealth>;
  importDomain(
    tx: Tx,
    key: Id<'command'>,
    actor: string,
    sample: DomainSample,
    digest: string,
  ): Promise<void>;
  domains(
    tx: Tx,
    domain: string,
  ): Promise<readonly Readonly<{ sample: DomainSample; importedAt: Instant; fresh: boolean }>[]>;
  visitors(
    tx: Tx,
    week: string,
    after: Id<'subject'> | null,
    limit: number,
  ): Promise<readonly VisitorRow[]>;
  reveal(
    tx: Tx,
    actor: PartnerPrincipal,
    subject: Id<'subject'>,
    week: string,
    reason: 'support_request' | 'privacy_request',
    caseId: Id<'case'>,
  ): Promise<Readonly<{ id: Id<'contact'>; revision: string; envelope: Envelope }> | null>;
  purge(tx: Tx, subject: Id<'subject'>, actor: string): Promise<void>;
  maintenance(tx: Tx, limit: number): Promise<number>;
}
