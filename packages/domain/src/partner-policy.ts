import { instantMilliseconds } from './values/time.ts';
import { id, instant, invalid, ok, type Id, type Instant, type Result } from './values/core.ts';
import type { OfferDiscount, PartnerMoney } from './entities/partner.ts';
export interface PartnerPrincipal {
  readonly subject: string;
  readonly emailVerified: true;
  readonly emailDomain: string;
  readonly mfaAt: Instant;
  readonly expiresAt: Instant;
  readonly staffId: Id<'staff'> | null;
}
export interface PartnerDraft {
  readonly title: string;
  readonly description: string;
  readonly terms: Readonly<Record<string, unknown>>;
  readonly discount: OfferDiscount;
  readonly minimumTires: number;
  readonly minimumPurchase: PartnerMoney | null;
  readonly redemptionMethod: 'online_code' | 'in_store_code' | 'link';
  readonly redemptionDomain: string | null;
  readonly redemptionUrl: string | null;
  readonly logoAssetId: Id<'asset'> | null;
  readonly logoRightsWarranted: boolean;
  readonly validFrom: Instant;
  readonly validUntil: Instant;
}
const epoch = (v: Instant) => instantMilliseconds(v) - 62135596800000;
const reject = () => {
  throw Error('invalid');
};
function object(v: unknown): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v))
  )
    return reject();
  return v as Record<string, unknown>;
}
function text(v: unknown, max = 200): string {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    v.length > max ||
    /[<>]/.test(v) ||
    [...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    return reject();
  return v.trim();
}
function at(v: unknown): Instant {
  const r = instant(v);
  return r.ok ? r.value : reject();
}
function uuid<K extends string>(k: K, v: unknown): Id<K> {
  const r = id(k, v);
  return r.ok ? r.value : reject();
}
function integer(v: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > max) return reject();
  return v as number;
}
export function partnerDomain(v: unknown): Result<string> {
  try {
    const d = text(v, 253).toLowerCase();
    if (
      !d.includes('.') ||
      /^\d+(\.\d+){3}$/.test(d) ||
      d.split('.').some((p) => !/^([a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/.test(p)) ||
      /\.(local|localhost|internal)$/.test(d)
    )
      reject();
    return ok(d);
  } catch {
    return invalid('domain');
  }
}
export function partnerPrincipal(
  v: unknown,
  now: number,
  maxAge = 300000,
): Result<PartnerPrincipal> {
  try {
    const r = object(v),
      d = partnerDomain(r.emailDomain),
      mfa = at(r.mfaAt),
      until = at(r.expiresAt);
    if (
      !Number.isFinite(now) ||
      maxAge < 1 ||
      maxAge > 900000 ||
      !d.ok ||
      r.emailVerified !== true ||
      epoch(mfa) > now ||
      now - epoch(mfa) > maxAge ||
      epoch(until) <= now ||
      epoch(until) > now + 3600000
    )
      reject();
    return ok(
      Object.freeze({
        subject: text(r.subject),
        emailVerified: true as const,
        emailDomain: d.ok ? d.value : reject(),
        mfaAt: mfa,
        expiresAt: until,
        staffId: r.staffId === null ? null : uuid('staff', r.staffId),
      }),
    );
  } catch {
    return invalid('principal');
  }
}
function money(v: unknown, minimum = 0n): PartnerMoney {
  const r = object(v);
  if (
    typeof r.minor !== 'bigint' ||
    r.minor < minimum ||
    r.minor > 9223372036854775807n ||
    typeof r.currency !== 'string' ||
    !/^USD$/.test(r.currency)
  )
    reject();
  return Object.freeze({ minor: r.minor as bigint, currency: r.currency as string });
}
function terms(v: unknown): Readonly<Record<string, unknown>> {
  const r = object(v),
    allowed = [
      'included',
      'excluded',
      'eligibility',
      'conditions',
      'rebateDetails',
      'priceMatchDetails',
      'serviceDetails',
    ];
  if (Object.keys(r).length > allowed.length || Object.keys(r).some((k) => !allowed.includes(k)))
    reject();
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(r)) {
    out[k] = Array.isArray(value)
      ? Object.freeze(value.map((x) => text(x, 1000)))
      : text(value, 2000);
    if (Array.isArray(value) && value.length > 32) reject();
  }
  if (!Object.hasOwn(out, 'included') || JSON.stringify(out).length > 12000) reject();
  return Object.freeze(out);
}
export function partnerDraft(v: unknown, now: number): Result<PartnerDraft> {
  try {
    const r = object(v),
      d = object(r.discount),
      kind = text(d.kind, 40);
    let discount: OfferDiscount;
    switch (kind) {
      case 'percent_off':
        discount = { kind, basisPoints: integer(d.basisPoints, 1, 10000) };
        break;
      case 'amount_off':
      case 'set_of_four_off':
      case 'mail_in_rebate':
        discount = { kind, money: money(d.money, 1n) };
        break;
      case 'free_service':
        if (!['fitting', 'alignment', 'tpms'].includes(String(d.service))) reject();
        discount = { kind, service: d.service as 'fitting' | 'alignment' | 'tpms' };
        break;
      case 'buy_three_get_one':
      case 'price_match':
        discount = { kind };
        break;
      default:
        return reject();
    }
    const title = text(r.title),
      description = text(r.description, 2000);
    if (
      /\b(guaranteed|safest|approved fitment|nhtsa approved|no risk|roadworthy)\b/i.test(
        title + ' ' + description,
      )
    )
      reject();
    const from = at(r.validFrom),
      until = at(r.validUntil);
    if (
      !Number.isFinite(now) ||
      epoch(until) <= now ||
      epoch(until) - epoch(from) < 259200000 ||
      epoch(until) - epoch(from) > 366 * 86400000
    )
      reject();
    const minimum = integer(r.minimumTires, 1, 4);
    if (['set_of_four_off', 'buy_three_get_one'].includes(kind) && minimum !== 4) reject();
    if (!['online_code', 'in_store_code', 'link'].includes(String(r.redemptionMethod))) reject();
    let domain: string | null = null,
      url: string | null = null;
    if ((r.redemptionDomain === null) !== (r.redemptionUrl === null)) reject();
    if (r.redemptionUrl !== null) {
      const parsed = partnerDomain(r.redemptionDomain);
      if (!parsed.ok) reject();
      domain = parsed.ok ? parsed.value : reject();
      url = text(r.redemptionUrl, 2048);
      const u = new URL(url);
      if (
        u.protocol !== 'https:' ||
        u.hostname !== domain ||
        u.port ||
        u.username ||
        u.password ||
        u.hash ||
        /[\\\s]/.test(url) ||
        /%(0[0-9a-f]|1[0-9a-f]|7f|5c|40|2f)/i.test(url) ||
        u.hostname.includes('%')
      )
        reject();
    }
    if (r.redemptionMethod === 'link' && !url) reject();
    if (
      typeof r.logoRightsWarranted !== 'boolean' ||
      (r.logoAssetId !== null && !r.logoRightsWarranted)
    )
      reject();
    return ok(
      Object.freeze({
        title,
        description,
        terms: terms(r.terms),
        discount: Object.freeze(discount),
        minimumTires: minimum,
        minimumPurchase: r.minimumPurchase === null ? null : money(r.minimumPurchase),
        redemptionMethod: r.redemptionMethod as PartnerDraft['redemptionMethod'],
        redemptionDomain: domain,
        redemptionUrl: url,
        logoAssetId: r.logoAssetId === null ? null : uuid('asset', r.logoAssetId),
        logoRightsWarranted: r.logoRightsWarranted as boolean,
        validFrom: from,
        validUntil: until,
      }),
    );
  } catch {
    return invalid('offer');
  }
}
export function couponCode(v: unknown): Result<string> {
  if (typeof v !== 'string') return invalid('coupon');
  const code = v.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(code) ? ok(code) : invalid('coupon');
}
