import type { Id, Instant, Revision } from '../values/core.ts';

export type OrganizationId = Id<'organization'>;
export interface PartnerScope {
  readonly organizationId: OrganizationId;
  readonly actor: string;
}
export interface PartnerOrganization {
  readonly id: OrganizationId;
  readonly legalName: string;
  readonly market: string;
  readonly status: 'pending' | 'active' | 'suspended' | 'closed';
  readonly verification: 'pending' | 'verified' | 'rejected' | 'expired';
  readonly revision: Revision;
}
export type PartnerMoney = Readonly<{ minor: bigint; currency: string }>;
export type OfferDiscount =
  | Readonly<{ kind: 'percent_off'; basisPoints: number }>
  | Readonly<{ kind: 'amount_off' | 'set_of_four_off' | 'mail_in_rebate'; money: PartnerMoney }>
  | Readonly<{ kind: 'free_service'; service: 'fitting' | 'alignment' | 'tpms' }>
  | Readonly<{ kind: 'buy_three_get_one' | 'price_match' }>;
export interface PartnerOfferVersion {
  readonly logoAssetId: Id<'asset'> | null;
  readonly logoRightsWarranted: boolean;
  readonly organizationId: OrganizationId;
  readonly offerId: Id<'partner_offer'>;
  readonly version: number;
  readonly supersedesVersion: number | null;
  readonly title: string;
  readonly description: string;
  readonly terms: Readonly<Record<string, unknown>>;
  readonly discount: OfferDiscount;
  readonly minimumTires: number;
  readonly minimumPurchase: PartnerMoney | null;
  readonly redemptionMethod: 'online_code' | 'in_store_code' | 'link';
  readonly redemptionDomain: string | null;
  readonly redemptionUrl: string | null;
  readonly validFrom: Instant;
  readonly validUntil: Instant;
  readonly status: 'draft' | 'pending_review' | 'reviewed' | 'published' | 'retired';
  readonly createdBy: Id<'staff'> | null;
  // Present only for a partner-authored version; never a public wire field.
  readonly partnerAuthor?: string;
  readonly reviewedBy: Id<'staff'> | null;
}
export type CouponMode = 'shared' | 'generated' | 'unique';
// Internal persistence entity. Never a partner-facing or public wire DTO.
export interface CouponAssignment {
  readonly id: Id<'coupon_assignment'>;
  readonly organizationId: OrganizationId;
  readonly sendId: Id<'send'>;
  readonly subjectId: Id<'subject'>;
  readonly offerId: Id<'partner_offer'>;
  readonly version: number;
  readonly poolId: Id<'coupon_pool'>;
  readonly mode: CouponMode;
  readonly codeId: Id<'coupon_code'> | null;
  readonly slot: number;
  readonly policyVersion: string;
  readonly state: 'reserved' | 'issued' | 'uncertain' | 'quarantined' | 'redeemed' | 'released';
  readonly reservedAt: Instant;
}
export type PartnerMetric =
  'included' | 'clicks' | 'codes_issued' | 'reported_redemptions' | 'complaints';
export interface PartnerMetricCell {
  readonly day: string;
  readonly metric: PartnerMetric;
  readonly market: string;
  readonly count: bigint;
}
