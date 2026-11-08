import type { Id, Instant, Revision, Result } from '../../../domain/src/values/core.ts';
import type { PartnerPrincipal, PartnerDraft } from '../../../domain/src/partner-policy.ts';
import type {
  PartnerOrganization,
  PartnerOfferVersion,
  PartnerScope,
} from '../../../domain/src/entities/partner.ts';
import type { PartnerOfferTarget } from './partner-repositories.ts';
import type { TransactionContext as Tx, ApplicationFailure } from './transactions.ts';
import type { AssetLocation } from './assets.ts';
import type { JobLease } from './jobs.ts';
export interface PartnerAuthority {
  verify(handle: string): Promise<Result<PartnerPrincipal, ApplicationFailure>>;
}
export interface PartnerClock {
  now(): number;
}
export interface CodeSeal {
  readonly hash: string;
  readonly cipherHex: string;
  readonly keyVersion: string;
}
export interface PartnerCrypto {
  readonly currentKeyVersion: string;
  id<K extends string>(kind: K, key?: string): Id<K>;
  checksum(bytes: Uint8Array): string;
  digest(value: unknown): string;
  token(): string;
  tokenHash(raw: string): string;
  seal(org: Id<'organization'>, pool: Id<'coupon_pool'>, code: string, version: string): CodeSeal;
  open(org: Id<'organization'>, pool: Id<'coupon_pool'>, seal: CodeSeal): string;
}
export type PartnerAssetPurpose = 'agreement' | 'verification' | 'coupon_pool' | 'logo';
export interface PartnerFiles {
  inspect(purpose: PartnerAssetPurpose, mime: string, bytes: Uint8Array): Promise<Uint8Array>;
}
export interface PartnerServicePolicy {
  readonly version: string;
  readonly agreements: Readonly<
    Record<'pilot_terms' | 'privacy' | 'dpa', Readonly<{ version: string; sha256: string }>>
  >;
  readonly excludedEmailDomains: readonly string[];
  readonly assetBucket: string;
  readonly assetKeyVersion: string;
}
export interface PartnerProfile {
  readonly organizationId: Id<'organization'>;
  readonly emailDomain: string;
  readonly services: readonly string[];
  readonly state: 'draft' | 'submitted' | 'approved' | 'rejected';
  readonly revision: Revision;
  readonly emailOverride: boolean;
}
export interface PartnerMember {
  readonly role: 'owner' | 'manager' | 'analyst';
  readonly status: 'pending' | 'active' | 'revoked';
  readonly revision: Revision;
}
export interface PartnerAudit {
  readonly id: Id<'partner_audit'>;
  readonly action: string;
  readonly result: string;
  readonly occurredAt: Instant;
  readonly resource: string;
}
export interface PartnerOnboardingRepository {
  currentAgreements(tx: Tx, org: Id<'organization'>, policy: PartnerServicePolicy): Promise<void>;
  lock(
    tx: Tx,
    org: Id<'organization'>,
    subject: string,
  ): Promise<
    Readonly<{
      organization: PartnerOrganization;
      member: PartnerMember | null;
      profile: PartnerProfile | null;
    }>
  >;
  staff(
    tx: Tx,
    actor: PartnerPrincipal,
    permission: 'partner.verify' | 'partner.moderate',
  ): Promise<void>;
  register(
    tx: Tx,
    input: Readonly<{
      id: Id<'organization'>;
      legalName: string;
      market: string;
      subject: string;
      emailDomain: string;
      policyVersion: string;
    }>,
  ): Promise<PartnerOrganization>;
  profile(
    tx: Tx,
    org: Id<'organization'>,
    expected: Revision,
    services: readonly string[],
  ): Promise<PartnerProfile>;
  location(
    tx: Tx,
    org: Id<'organization'>,
    input: Readonly<{ key: string; region: string; address: Readonly<Record<string, string>> }>,
  ): Promise<Id<'partner_location'>>;
  agreement(
    tx: Tx,
    org: Id<'organization'>,
    actor: string,
    input: Readonly<{
      kind: 'pilot_terms' | 'privacy' | 'dpa';
      version: string;
      assetId: Id<'asset'>;
      sha256: string;
    }>,
  ): Promise<void>;
  submit(
    tx: Tx,
    org: Id<'organization'>,
    expected: Revision,
    policyVersion: string,
  ): Promise<PartnerProfile>;
  verification(
    tx: Tx,
    org: Id<'organization'>,
    input: Readonly<{
      kind: 'domain' | 'registry' | 'manual';
      assetId: Id<'asset'>;
      reviewer: Id<'staff'>;
      approved: boolean;
      expiresAt: Instant;
      domain: string | null;
    }>,
  ): Promise<void>;
  decide(
    tx: Tx,
    org: Id<'organization'>,
    expected: Revision,
    state: 'approved' | 'rejected',
    reason: string,
    emailOverride: boolean,
  ): Promise<PartnerProfile>;
  activate(tx: Tx, org: Id<'organization'>, expected: Revision): Promise<PartnerOrganization>;
  lifecycle(
    tx: Tx,
    org: Id<'organization'>,
    expected: Revision,
    state: 'suspended' | 'active' | 'closed' | 'expired',
  ): Promise<PartnerOrganization>;
  invite(
    tx: Tx,
    org: Id<'organization'>,
    input: Readonly<{
      id: Id<'partner_invite'>;
      issuer: string;
      target: string;
      role: 'manager' | 'analyst';
      tokenHash: string;
      expiresAt: Instant;
    }>,
  ): Promise<void>;
  acceptInvite(tx: Tx, org: Id<'organization'>, subject: string, hash: string): Promise<Revision>;
  member(
    tx: Tx,
    org: Id<'organization'>,
    subject: string,
    expected: Revision,
    role: 'owner' | 'manager' | 'analyst',
    status: 'active' | 'revoked',
  ): Promise<Revision>;
  audit(
    tx: Tx,
    org: Id<'organization'>,
    actor: string,
    action: string,
    resource: string,
    digest: string,
  ): Promise<void>;
  audits(
    tx: Tx,
    org: Id<'organization'>,
    after: string | null,
    limit: number,
  ): Promise<readonly PartnerAudit[]>;
}
export interface PartnerServiceAssets {
  register(
    tx: Tx,
    org: Id<'organization'>,
    purpose: PartnerAssetPurpose,
    id: Id<'asset'>,
    mime: string,
    size: number,
    sha: string,
    expires: Instant,
  ): Promise<AssetLocation>;
  get(
    tx: Tx,
    org: Id<'organization'>,
    id: Id<'asset'>,
    purpose: PartnerAssetPurpose,
  ): Promise<AssetLocation>;
  ready(tx: Tx, org: Id<'organization'>, asset: AssetLocation, version: string): Promise<void>;
}
export interface PartnerModerationRepository {
  simulationTargets(
    tx: Tx,
    scope: PartnerScope,
    id: Id<'partner_offer'>,
    version: number,
  ): Promise<readonly import('../../../domain/src/offer-matching.ts').PilotTarget[]>;
  draft(
    tx: Tx,
    scope: PartnerScope,
    id: Id<'partner_offer'>,
    version: number,
    body: PartnerDraft,
    targets: readonly PartnerOfferTarget[],
  ): Promise<PartnerOfferVersion>;
  version(
    tx: Tx,
    scope: PartnerScope,
    id: Id<'partner_offer'>,
    version: number,
  ): Promise<PartnerOfferVersion | null>;
  submit(
    tx: Tx,
    org: Id<'organization'>,
    offer: Id<'partner_offer'>,
    version: number,
    actor: string,
  ): Promise<void>;
  review(
    tx: Tx,
    org: Id<'organization'>,
    offer: Id<'partner_offer'>,
    version: number,
    actor: PartnerPrincipal,
    approved: boolean,
    reason: string,
  ): Promise<void>;
  publish(
    tx: Tx,
    org: Id<'organization'>,
    offer: Id<'partner_offer'>,
    version: number,
    expected: number | null,
  ): Promise<void>;
  pause(tx: Tx, org: Id<'organization'>, offer: Id<'partner_offer'>): Promise<void>;
  eligible(
    tx: Tx,
    org: Id<'organization'>,
    offer: Id<'partner_offer'>,
    version: number,
  ): Promise<boolean>;
}
export interface CouponImport {
  readonly id: Id<'coupon_import'>;
  readonly organizationId: Id<'organization'>;
  readonly poolId: Id<'coupon_pool'>;
  readonly assetId: Id<'asset'>;
  readonly jobId: Id<'job'>;
  readonly requester: string;
  readonly memberRevision: Revision;
  readonly authorizedUntil: Instant;
  readonly state: 'queued' | 'processing' | 'ready' | 'rejected';
  readonly through: number;
  readonly accepted: number;
  readonly duplicates: number;
  readonly rejected: number;
  readonly keyVersion: string;
  readonly expiresAt: Instant;
  readonly errors: readonly Readonly<{ row: number; reason: string }>[];
}
export interface PartnerCouponRepository {
  pool(
    tx: Tx,
    org: Id<'organization'>,
    input: Readonly<{
      id: Id<'coupon_pool'>;
      offerId: Id<'partner_offer'>;
      version: number;
      mode: 'shared' | 'generated' | 'unique';
      assetId: Id<'asset'> | null;
      prefix: string | null;
      shared: CodeSeal | null;
    }>,
  ): Promise<void>;
  queue(
    tx: Tx,
    org: Id<'organization'>,
    input: Readonly<{
      id: Id<'coupon_import'>;
      poolId: Id<'coupon_pool'>;
      assetId: Id<'asset'>;
      jobId: Id<'job'>;
      requester: string;
      memberRevision: Revision;
      authorizedUntil: Instant;
      keyVersion: string;
      expiresAt: Instant;
      bodyHash: string;
    }>,
  ): Promise<CouponImport>;
  get(tx: Tx, org: Id<'organization'>, id: Id<'coupon_import'>): Promise<CouponImport | null>;
  root(tx: Tx, id: Id<'coupon_import'>): Promise<CouponImport>;
  check(tx: Tx, input: CouponImport, lease: JobLease): Promise<CouponImport>;
  stage(
    tx: Tx,
    input: CouponImport,
    lease: JobLease,
    through: number,
    rows: readonly Readonly<{ row: number; seal: CodeSeal }>[],
    invalid: readonly Readonly<{ row: number; reason: string }>[],
  ): Promise<CouponImport>;
  finish(tx: Tx, input: CouponImport, lease: JobLease): Promise<CouponImport>;
  reveal(
    tx: Tx,
    org: Id<'organization'>,
    code: Id<'coupon_code'>,
  ): Promise<Readonly<{ poolId: Id<'coupon_pool'>; seal: CodeSeal; expiresAt: Instant }>>;
  shared(
    tx: Tx,
    org: Id<'organization'>,
    pool: Id<'coupon_pool'>,
  ): Promise<Readonly<{ poolId: Id<'coupon_pool'>; seal: CodeSeal; expiresAt: Instant }>>;
  statistics(
    tx: Tx,
    org: Id<'organization'>,
    pool: Id<'coupon_pool'>,
  ): Promise<Readonly<{ total: number; available: number; low: boolean }>>;
  reject(tx: Tx, input: CouponImport, lease: JobLease, reason: string): Promise<CouponImport>;
  reauthorize(
    tx: Tx,
    org: Id<'organization'>,
    id: Id<'coupon_import'>,
    jobId: Id<'job'>,
    memberRevision: Revision,
    until: Instant,
  ): Promise<CouponImport>;
}
export interface PartnerOfferPreview {
  render(
    input: Readonly<{ offer: PartnerOfferVersion; eligible: boolean }>,
  ): Promise<Readonly<{ html: string; text: string }>>;
}
export interface CouponCsvDecoder {
  rows(
    bytes: Uint8Array,
  ): Iterable<Readonly<{ row: number; code: string | null; reason: string | null }>>;
}
