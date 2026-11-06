import type { PartnerAllocationPlan } from '../../../application/src/ports/partner-repositories.ts';
import { maxInt64 } from '../../../domain/src/values/core.ts';
import { identifier } from './partner-support.ts';
import { text, integer } from './private-values.ts';
import { boundedJson, digest, reject } from './bounds.ts';
export function allocationInput(input: PartnerAllocationPlan) {
  const organizationId = identifier('organization', input.organizationId),
    offerId = identifier('partner_offer', input.offerId),
    subjectId = identifier('subject', input.subjectId),
    sendId = identifier('send', input.sendId),
    poolId = identifier('coupon_pool', input.poolId);
  const version = integer(input.version),
    slot = integer(input.slot);
  if (slot > 3) return reject();
  const requestKey = text(input.requestKey, 200),
    policyVersion = text(input.policyVersion, 100);
  if (
    !Array.isArray(input.frequencies) ||
    input.frequencies.length !== 2 ||
    !Array.isArray(input.caps) ||
    input.caps.length < 1 ||
    input.caps.length > 3 ||
    !Array.isArray(input.reasons) ||
    input.reasons.length > 32
  )
    return reject();
  const frequencies = input.frequencies
    .map((f) => {
      if (f.scope !== 'overall_marketing' && f.scope !== 'offer:' + offerId) return reject();
      if (
        f.scope === 'overall_marketing'
          ? f.kind !== 'calendar_month' || typeof f.timeZone !== 'string' || !f.timeZone.trim()
          : f.kind !== 'rolling_30_days' || f.timeZone !== null
      )
        return reject();
      if (f.timeZone !== null) {
        text(f.timeZone, 100);
        try {
          new Intl.DateTimeFormat('en', { timeZone: f.timeZone });
        } catch {
          return reject();
        }
      }
      const limit = integer(f.limit);
      if (limit > 10000) return reject();
      return {
        scope: f.scope,
        kind: f.kind,
        timeZone: f.timeZone,
        limit,
      };
    })
    .sort((a, b) => a.scope.localeCompare(b.scope));
  if (new Set(frequencies.map((f) => f.scope)).size !== 2) return reject();
  const caps = input.caps
    .map((c) => {
      if (typeof c.units !== 'bigint' || c.units < 1n || c.units > maxInt64) return reject();
      return { id: identifier('offer_cap', c.id), units: c.units.toString() };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(caps.map((c) => c.id)).size !== caps.length) return reject();
  const reasons = input.reasons.map((r) => text(r, 200));
  boundedJson(reasons, 8192);
  const plan = {
    organizationId,
    offerId,
    subjectId,
    sendId,
    poolId,
    version,
    slot,
    requestKey,
    policyVersion,
    frequencies,
    caps,
    reasons,
  };
  return { ...plan, sha256: digest({ formatVersion: 1, ...plan }) };
}
