import { id, instant, revision, type Id } from '../../../domain/src/values/core.ts';
import { stop, type WriteScope } from './mutations.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import type {
  PartnerProfile,
  PartnerMember,
  CouponImport,
} from '../../../application/src/ports/partner-services.ts';
import { partnerOrganizationFromRow } from './partner-mappers.ts';
import { mapped } from './partner-support.ts';
export const uid = <K extends string>(kind: K, v: unknown): Id<K> => {
  const r = id(kind, v);
  return r.ok ? r.value : stop('invalid_input');
};
export const word = (v: unknown, max = 200) => {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    v.length > max ||
    [...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    return stop('invalid_input');
  return v.trim();
};
export const integer = (v: unknown, min = 0, max = 100000) => {
  const n = typeof v === 'string' && /^(0|[1-9]\d*)$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || Number(n) < min || Number(n) > max) return stop('integrity');
  return n as number;
};
export const at = (v: unknown) => {
  const r = instant(v instanceof Date ? v.toISOString() : v);
  return r.ok ? r.value : stop('integrity');
};
export const rev = (v: unknown) => {
  const r = revision(typeof v === 'bigint' ? v.toString() : v);
  return r.ok ? r.value : stop('integrity');
};
export const sha = (v: unknown) => {
  if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) return stop('invalid_input');
  return v;
};
export function profile(r: Record<string, unknown>): PartnerProfile {
  if (
    !['draft', 'submitted', 'approved', 'rejected'].includes(String(r.state)) ||
    !Array.isArray(r.services) ||
    r.services.some((x) => typeof x !== 'string') ||
    typeof r.email_override !== 'boolean'
  )
    return stop('integrity');
  return Object.freeze({
    organizationId: uid('organization', r.org_id),
    emailDomain: word(r.email_domain, 253),
    services: Object.freeze([...r.services]) as readonly string[],
    state: r.state as PartnerProfile['state'],
    revision: rev(r.revision),
    emailOverride: r.email_override,
  });
}
export function member(r: Record<string, unknown>): PartnerMember {
  if (
    !['owner', 'manager', 'analyst'].includes(String(r.role)) ||
    !['pending', 'active', 'revoked'].includes(String(r.status))
  )
    return stop('integrity');
  return Object.freeze({
    role: r.role as PartnerMember['role'],
    status: r.status as PartnerMember['status'],
    revision: rev(r.revision),
  });
}
export async function root(
  s: WriteScope,
  tx: Tx,
  org: Id<'organization'>,
  actor: string,
  lock = true,
) {
  const r =
    (
      await s.query(
        tx,
        'SELECT id,legal_name,market,status,verification_status,revision::text FROM partners.organizations WHERE id=$1' +
          (lock ? ' FOR UPDATE' : ''),
        [uid('organization', org)],
      )
    ).rows[0] ?? stop('not_found');
  const m = (
      await s.query(
        tx,
        'SELECT role,status,revision::text FROM partners.memberships WHERE org_id=$1 AND provider_subject=$2' +
          (lock ? ' FOR UPDATE' : ''),
        [org, word(actor)],
      )
    ).rows[0],
    p = (
      await s.query(
        tx,
        'SELECT *,revision::text AS revision FROM partners.onboarding_profiles WHERE org_id=$1' +
          (lock ? ' FOR UPDATE' : ''),
        [org],
      )
    ).rows[0];
  return Object.freeze({
    organization: mapped(partnerOrganizationFromRow(r)),
    member: m ? member(m) : null,
    profile: p ? profile(p) : null,
  });
}
export function importRow(r: Record<string, unknown>): CouponImport {
  if (
    !['queued', 'processing', 'ready', 'rejected'].includes(String(r.state)) ||
    !Array.isArray(r.errors) ||
    r.errors.length > 1000
  )
    return stop('integrity');
  const errors = r.errors.map((v) => {
    if (!v || typeof v !== 'object') return stop('integrity');
    const x = v as Record<string, unknown>;
    if (!['invalid_code', 'malformed_csv', 'source_mismatch'].includes(String(x.reason)))
      return stop('integrity');
    return Object.freeze({ row: integer(x.row), reason: word(x.reason, 80) });
  });
  return Object.freeze({
    id: uid('coupon_import', r.id),
    organizationId: uid('organization', r.org_id),
    poolId: uid('coupon_pool', r.pool_id),
    assetId: uid('asset', r.asset_id),
    jobId: uid('job', r.job_id),
    requester: word(r.requester),
    memberRevision: rev(r.member_revision),
    authorizedUntil: at(r.authorized_until),
    state: r.state as CouponImport['state'],
    through: integer(r.through_row),
    accepted: integer(r.accepted),
    duplicates: integer(r.duplicates),
    rejected: integer(r.rejected),
    keyVersion: word(r.key_version, 100),
    expiresAt: at(r.expires_at),
    errors: Object.freeze(errors),
  });
}
