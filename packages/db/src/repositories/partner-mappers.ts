import type {
  PartnerOrganization,
  PartnerOfferVersion,
  CouponAssignment,
  OfferDiscount,
  PartnerMetricCell,
} from '../../../domain/src/entities/partner.ts';
import {
  id,
  instant,
  revision,
  integer,
  maxInt64,
  type Result,
} from '../../../domain/src/values/core.ts';
import type { IntegrityError, StorageRow } from '../mappers.ts';
import { boundedJson } from './bounds.ts';

class InvalidPartnerRow extends Error {}
const bad = (): never => {
  throw new InvalidPartnerRow();
};
function parsed<T>(value: Result<T>): T {
  return value.ok ? value.value : bad();
}
function word(value: unknown, max = 200): string {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !value.includes('\0')
    ? value
    : bad();
}
function choice<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  return typeof value === 'string' && values.includes(value) ? value : bad();
}
function count(value: unknown, min = 1, max = 2147483647): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : bad();
}
function bigint(value: unknown, min = 0n): bigint {
  return parsed(integer(typeof value === 'bigint' ? value.toString() : value, min, maxInt64));
}
function timestamp(value: unknown) {
  return parsed(
    instant(
      value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : value,
    ),
  );
}
function decode<T>(field: string, work: () => T): Result<T, IntegrityError> {
  try {
    return { ok: true, value: Object.freeze(work()) };
  } catch {
    return { ok: false, error: { code: 'invalid_stored_data', field } };
  }
}
function freeze(value: unknown): unknown {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function money(minor: unknown, currency: unknown, min = 0n) {
  return Object.freeze({
    minor: bigint(minor, min),
    currency: typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : bad(),
  });
}
export function partnerOrganizationFromRow(
  row: StorageRow,
): Result<PartnerOrganization, IntegrityError> {
  return decode('organization', () => {
    const status = choice(row.status, ['pending', 'active', 'suspended', 'closed']),
      verification = choice(row.verification_status, [
        'pending',
        'verified',
        'rejected',
        'expired',
      ]);
    if (status === 'active' && verification !== 'verified') bad();
    return {
      id: parsed(id('organization', row.id)),
      legalName: word(row.legal_name),
      market: word(row.market, 20),
      status,
      verification,
      revision: parsed(revision(row.revision)),
    };
  });
}
export function partnerOfferFromRow(r: StorageRow): Result<PartnerOfferVersion, IntegrityError> {
  return decode('offer_version', () => {
    const logoAssetId = r.logo_asset_id === null ? null : parsed(id('asset', r.logo_asset_id));
    if (typeof r.logo_rights_warranted !== 'boolean' || (logoAssetId && !r.logo_rights_warranted))
      bad();
    const kind = choice(r.discount_type, [
      'percent_off',
      'amount_off',
      'set_of_four_off',
      'buy_three_get_one',
      'free_service',
      'mail_in_rebate',
      'price_match',
    ]);
    const amount = ['amount_off', 'set_of_four_off', 'mail_in_rebate'].includes(kind);
    if (
      (kind === 'percent_off') !== (r.percent_basis_points !== null) ||
      amount !== (r.amount_minor !== null) ||
      amount !== (r.currency_code !== null) ||
      (kind === 'free_service') !== (r.service_code !== null)
    )
      bad();
    let discount: OfferDiscount;
    if (kind === 'percent_off')
      discount = { kind, basisPoints: count(r.percent_basis_points, 1, 10000) };
    else if (kind === 'amount_off' || kind === 'set_of_four_off' || kind === 'mail_in_rebate')
      discount = { kind, money: money(r.amount_minor, r.currency_code, 1n) };
    else if (kind === 'free_service')
      discount = { kind, service: choice(r.service_code, ['fitting', 'alignment', 'tpms']) };
    else discount = { kind };
    const version = count(r.version),
      supersedesVersion =
        r.supersedes_version === null ? null : count(r.supersedes_version, 1, version - 1);
    const minimumTires = count(r.minimum_tires, 1, 4);
    if ((kind === 'set_of_four_off' || kind === 'buy_three_get_one') && minimumTires !== 4) bad();
    if ((r.minimum_purchase_minor === null) !== (r.minimum_purchase_currency === null)) bad();
    const minimumPurchase =
      r.minimum_purchase_minor === null
        ? null
        : money(r.minimum_purchase_minor, r.minimum_purchase_currency);
    const validFrom = timestamp(r.valid_from),
      validUntil = timestamp(r.valid_until);
    if (Date.parse(validUntil) - Date.parse(validFrom) < 259200000) bad();
    const status = choice(r.status, [
      'draft',
      'pending_review',
      'reviewed',
      'published',
      'retired',
    ]);
    const partnerAuthor = r.partner_author == null ? null : word(r.partner_author),
      createdBy = r.created_by === null ? null : parsed(id('staff', r.created_by)),
      reviewedBy = r.reviewed_by === null ? null : parsed(id('staff', r.reviewed_by));
    if ((createdBy === null) === (partnerAuthor === null)) bad();
    if (
      ['reviewed', 'published', 'retired'].includes(status) &&
      (!reviewedBy || reviewedBy === createdBy)
    )
      bad();
    const redemptionMethod = choice(r.redemption_method, ['online_code', 'in_store_code', 'link']);
    if ((r.redemption_domain === null) !== (r.redemption_url === null)) bad();
    const redemptionDomain = r.redemption_domain === null ? null : word(r.redemption_domain, 253),
      redemptionUrl = r.redemption_url === null ? null : word(r.redemption_url, 2048);
    if (redemptionMethod === 'link' && !redemptionUrl) bad();
    if (redemptionUrl) {
      const u = new URL(redemptionUrl);
      if (
        u.protocol !== 'https:' ||
        u.hostname !== redemptionDomain ||
        u.username ||
        u.password ||
        u.port ||
        redemptionUrl.includes('\\')
      )
        bad();
    }
    if (!r.terms || typeof r.terms !== 'object' || Array.isArray(r.terms)) bad();
    const terms = freeze(JSON.parse(boundedJson(r.terms, 16384))) as Readonly<
      Record<string, unknown>
    >;
    return {
      logoAssetId,
      logoRightsWarranted: r.logo_rights_warranted === true,
      organizationId: parsed(id('organization', r.org_id)),
      offerId: parsed(id('partner_offer', r.offer_id)),
      version,
      supersedesVersion,
      title: word(r.title),
      description: word(r.description, 2000),
      terms,
      discount: Object.freeze(discount),
      minimumTires,
      minimumPurchase,
      redemptionMethod,
      redemptionDomain,
      redemptionUrl,
      validFrom,
      validUntil,
      status,
      createdBy,
      ...(partnerAuthor === null ? {} : { partnerAuthor }),
      reviewedBy,
    };
  });
}
export function couponAssignmentFromRow(r: StorageRow): Result<CouponAssignment, IntegrityError> {
  return decode('coupon_assignment', () => {
    const mode = choice(r.pool_mode, ['shared', 'unique', 'generated']);
    if ((mode === 'shared') !== (r.code_id === null)) bad();
    return {
      id: parsed(id('coupon_assignment', r.id)),
      organizationId: parsed(id('organization', r.org_id)),
      sendId: parsed(id('send', r.send_id)),
      subjectId: parsed(id('subject', r.owner_subject_id)),
      offerId: parsed(id('partner_offer', r.offer_id)),
      version: count(r.offer_version),
      poolId: parsed(id('coupon_pool', r.pool_id)),
      mode,
      codeId: r.code_id === null ? null : parsed(id('coupon_code', r.code_id)),
      slot: count(r.slot, 1, 3),
      policyVersion: word(r.policy_version, 100),
      state: choice(r.state, [
        'reserved',
        'issued',
        'uncertain',
        'quarantined',
        'redeemed',
        'released',
      ]),
      reservedAt: timestamp(r.reserved_at),
    };
  });
}
export function partnerMetricFromRow(r: StorageRow): Result<PartnerMetricCell, IntegrityError> {
  return decode('partner_metric', () => {
    const day = word(r.day, 10);
    parsed(instant(day + 'T00:00:00.000Z'));
    return {
      day,
      metric: choice(r.metric, [
        'included',
        'clicks',
        'codes_issued',
        'reported_redemptions',
        'complaints',
      ]),
      market: word(r.market, 20),
      count: bigint(r.total_count),
    };
  });
}
