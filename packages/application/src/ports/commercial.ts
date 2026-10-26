import type {
  CommercialPolicy,
  AdReport,
  AdMetric,
} from '../../../domain/src/commercial-policy.ts';
import type { Id } from '../../../domain/src/values/core.ts';
import type { TransactionContext as Tx, ApplicationFailure } from './transactions.ts';
import type { Result } from '../../../domain/src/values/core.ts';
export type StaffPermission =
  | 'commercial.manage'
  | 'affiliate.manage'
  | 'revenue.import'
  | 'revenue.read'
  | 'mail.recover'
  | 'privacy.review'
  | 'data.review'
  | 'seo.publish';
export type StaffQueue = 'mail' | 'callbacks' | 'imports' | 'privacy' | 'seo';
export type RecoveryKind = 'mail_reconcile' | 'callback_replay' | 'privacy_retry';
export interface RecoveryCommand {
  readonly id: string;
  readonly actor: Id<'staff'>;
  readonly kind: RecoveryKind;
  readonly digest: string;
}
export interface StaffRepository {
  authorize(tx: Tx, actor: Id<'staff'>, permission: StaffPermission): Promise<void>;
  queue(
    tx: Tx,
    kind: StaffQueue,
    after: string | null,
    limit: number,
  ): Promise<
    readonly { readonly id: string; readonly state: string; readonly dueAt: string | null }[]
  >;
  claim(
    tx: Tx,
    command: RecoveryCommand,
  ): Promise<{ readonly created: boolean; readonly state: string }>;
  finish(
    tx: Tx,
    command: RecoveryCommand,
    state: 'succeeded' | 'failed' | 'unknown',
  ): Promise<void>;
}
export interface AffiliateInput {
  readonly key: string;
  readonly retailerId: string;
  readonly destination: string;
  readonly market: string;
}
export interface AffiliateCheck {
  readonly id: string;
  readonly destination: string;
  readonly revision: string;
}
export interface CommercialRepository {
  authorize: StaffRepository['authorize'];
  policy(tx: Tx): Promise<{
    readonly version: number;
    readonly policy: CommercialPolicy;
    readonly networkReady: boolean;
  } | null>;
  configure(
    tx: Tx,
    actor: Id<'staff'>,
    reviewer: Id<'staff'>,
    expectedVersion: number,
    policy: CommercialPolicy,
    digest: string,
  ): Promise<number>;
  page(tx: Tx, path: string, market: string): Promise<boolean>;
  blockedBrands(tx: Tx, market: string): Promise<readonly string[]>;
  blockBrand(
    tx: Tx,
    actor: Id<'staff'>,
    brand: string,
    market: string,
    reason: string,
    digest: string,
  ): Promise<void>;
  affiliate(
    tx: Tx,
    key: string,
    market: string,
  ): Promise<{
    readonly destination: string;
    readonly origin: string;
    readonly checkedAt: string;
  } | null>;
  setAffiliate(
    tx: Tx,
    actor: Id<'staff'>,
    reviewer: Id<'staff'>,
    input: AffiliateInput,
    expectedRevision: string,
    digest: string,
  ): Promise<string>;
  affiliateCheck(tx: Tx, key: string): Promise<AffiliateCheck>;
  checked(
    tx: Tx,
    actor: Id<'staff'>,
    check: AffiliateCheck,
    result: 'valid' | 'invalid' | 'unavailable',
    digest: string,
  ): Promise<void>;
  importReport(
    tx: Tx,
    actor: Id<'staff'>,
    report: AdReport,
    checksum: string,
  ): Promise<{ readonly id: string; readonly state: string }>;
  approveReport(
    tx: Tx,
    actor: Id<'staff'>,
    reviewer: Id<'staff'>,
    id: string,
    expectedGeneration: string,
    digest: string,
  ): Promise<void>;
  revenue(
    tx: Tx,
    account: string,
    day: string,
    dimension: string,
    currency: string,
  ): Promise<{
    readonly connected: boolean;
    readonly metric:
      | (AdMetric & {
          readonly sourceRevision: string;
          readonly sourceGeneration: string;
          readonly fetchedAt: string;
        })
      | null;
  }>;
}
export interface CommercialIdentity {
  checksum(value: unknown): string;
}
export interface StaffRecovery {
  execute(
    kind: RecoveryKind,
    actor: Id<'staff'>,
    target: string,
    evidence: string,
  ): Promise<Result<unknown, ApplicationFailure>>;
}
export interface AffiliateChecker {
  check(destination: string, signal?: AbortSignal): Promise<'valid' | 'invalid' | 'unavailable'>;
}
