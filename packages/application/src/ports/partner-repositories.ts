import type { Id, Instant, Revision } from '../../../domain/src/values/core.ts';
import type {
  PartnerScope,
  PartnerOrganization,
  PartnerOfferVersion,
  CouponAssignment,
  PartnerMetricCell,
  OrganizationId,
} from '../../../domain/src/entities/partner.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { Page, PageRequest } from './pagination.ts';

export interface PartnerTenantRepository {
  organization(tx: Tx, scope: PartnerScope): Promise<PartnerOrganization | null>;
  membership(
    tx: Tx,
    scope: PartnerScope,
  ): Promise<Readonly<{ role: 'owner' | 'manager' | 'analyst'; revision: Revision }> | null>;
  locations(
    tx: Tx,
    scope: PartnerScope,
    page: PageRequest,
  ): Promise<
    Page<
      Readonly<{
        id: Id<'partner_location'>;
        market: string;
        region: string | null;
        status: string;
      }>
    >
  >;
}
// Staff use cases authorize identity/verification decisions before calling this adapter.
export interface PartnerIdentityRepository {
  registerPending(
    tx: Tx,
    input: Readonly<{ id: OrganizationId; legalName: string; market: string; owner: string }>,
  ): Promise<PartnerOrganization>;
  reviseOrganization(
    tx: Tx,
    input: Readonly<{
      id: OrganizationId;
      expectedRevision: Revision;
      legalName: string;
      status: PartnerOrganization['status'];
      verification: PartnerOrganization['verification'];
    }>,
  ): Promise<PartnerOrganization>;
  reviseMembership(
    tx: Tx,
    input: Readonly<{
      organizationId: OrganizationId;
      actor: string;
      expectedRevision: Revision;
      role: 'owner' | 'manager' | 'analyst';
      status: 'pending' | 'active' | 'revoked';
    }>,
  ): Promise<Revision>;
}
export type OfferDraft = Omit<PartnerOfferVersion, 'status' | 'reviewedBy'>;
export interface PartnerOfferTarget {
  readonly id: Id<'offer_target'>;
  readonly market: string;
  readonly strategy:
    | 'store_wide'
    | 'sku'
    | 'model'
    | 'brand'
    | 'category'
    | 'rim'
    | 'size'
    | 'vehicle_type'
    | 'tier'
    | 'region'
    | 'postal'
    | 'radius';
  readonly skuId: Id<'sku'> | null;
  readonly modelId: Id<'tire_model'> | null;
  readonly brandId: Id<'domain_entity'> | null;
  readonly locationId: Id<'partner_location'> | null;
  readonly value: string | null;
  readonly rimInches: string | null;
  readonly radiusKm: string | null;
  readonly rule: Readonly<Record<string, unknown>>;
}
export interface PartnerOfferRepository {
  addTargets(
    tx: Tx,
    organizationId: OrganizationId,
    offerId: Id<'partner_offer'>,
    version: number,
    targets: readonly PartnerOfferTarget[],
  ): Promise<void>;
  version(
    tx: Tx,
    scope: PartnerScope,
    offerId: Id<'partner_offer'>,
    version: number,
  ): Promise<PartnerOfferVersion | null>;
  versions(
    tx: Tx,
    scope: PartnerScope,
    offerId: Id<'partner_offer'>,
    before: number | null,
    limit: number,
  ): Promise<readonly PartnerOfferVersion[]>;
  // Staff adapter: service must authorize the staff decision before calling these ports.
  appendDraft(tx: Tx, input: OfferDraft): Promise<PartnerOfferVersion>;
  recordReview(
    tx: Tx,
    organizationId: OrganizationId,
    offerId: Id<'partner_offer'>,
    version: number,
    reviewer: Id<'staff'>,
  ): Promise<void>;
  selectPublished(
    tx: Tx,
    organizationId: OrganizationId,
    offerId: Id<'partner_offer'>,
    version: number,
    expectedCurrent: number | null,
  ): Promise<void>;
}
export interface FrequencyAllocation {
  readonly scope: string;
  readonly kind: 'rolling_30_days' | 'calendar_month';
  readonly timeZone: string | null;
  readonly limit: number;
}
export interface PartnerAllocationPlan {
  readonly requestKey: string;
  readonly organizationId: OrganizationId;
  readonly sendId: Id<'send'>;
  readonly subjectId: Id<'subject'>;
  readonly offerId: Id<'partner_offer'>;
  readonly version: number;
  readonly poolId: Id<'coupon_pool'>;
  readonly slot: number;
  readonly policyVersion: string;
  readonly frequencies: readonly FrequencyAllocation[];
  readonly caps: readonly Readonly<{ id: Id<'offer_cap'>; units: bigint }>[];
  readonly reasons: readonly string[];
}
export interface PartnerAllocationRepository {
  reserve(tx: Tx, plan: PartnerAllocationPlan): Promise<CouponAssignment>;
  assignment(
    tx: Tx,
    organizationId: OrganizationId,
    id: Id<'coupon_assignment'>,
  ): Promise<CouponAssignment | null>;
  recordOutcome(
    tx: Tx,
    organizationId: OrganizationId,
    id: Id<'coupon_assignment'>,
    state: 'issued' | 'uncertain' | 'quarantined',
  ): Promise<CouponAssignment>;
  release(
    tx: Tx,
    organizationId: OrganizationId,
    id: Id<'coupon_assignment'>,
    reason: 'cancelled_before_dispatch' | 'definitively_not_sent' | 'expired_unstarted',
    evidence: Id<'audit_event'>,
  ): Promise<CouponAssignment>;
  appendRedemption(
    tx: Tx,
    input: Readonly<{
      organizationId: OrganizationId;
      assignmentId: Id<'coupon_assignment'>;
      eventKey: string;
      kind: 'reported' | 'correction' | 'reversal';
      quantity: number;
      previousId: Id<'redemption_event'> | null;
      occurredAt: Instant;
    }>,
  ): Promise<Id<'redemption_event'>>;
}
export interface PartnerReportingRepository {
  pilot(
    tx: Tx,
    scope: PartnerScope,
  ): Promise<Readonly<{
    organization: PartnerOrganization;
    approvedLocations: bigint;
    activeOffers: bigint;
    acceptedAgreements: bigint;
  }> | null>;
  metrics(
    tx: Tx,
    scope: PartnerScope,
    input: Readonly<{
      from: string;
      through: string;
      metric: PartnerMetricCell['metric'];
      after: string | null;
      limit: number;
    }>,
  ): Promise<Page<PartnerMetricCell>>;
  disputes(
    tx: Tx,
    scope: PartnerScope,
    page: PageRequest,
  ): Promise<
    Page<
      Readonly<{
        id: Id<'partner_dispute'>;
        reason: string;
        state: string;
        createdAt: Instant;
        closedAt: Instant | null;
      }>
    >
  >;
}
