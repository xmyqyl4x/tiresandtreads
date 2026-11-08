import type {
  PilotOffer,
  PilotPolicy,
  PilotContext,
} from '../../../application/src/ports/pilot-delivery.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { partnerOfferFromRow } from './partner-mappers.ts';
import { mapped, identifier } from './partner-support.ts';
import { obj, text } from './private-values.ts';
import { stop, type WriteScope } from './mutations.ts';
export async function pilotCandidates(
  s: WriteScope,
  tx: Tx,
  c: PilotContext,
  policy: PilotPolicy,
): Promise<readonly PilotOffer[]> {
  const rows = (
    await s.query(
      tx,
      `SELECT v.*,v.amount_minor::text,v.minimum_purchase_minor::text,p.id AS pool_id,p.mode,p.generated_prefix,
 EXISTS(SELECT 1 FROM partners.eligible_offer_versions e WHERE e.org_id=v.org_id AND e.offer_id=v.offer_id AND e.version=v.version)
 AND NOT partners.pilot_blocked($2,ARRAY['reseller:'||v.org_id::text]) AS live,
 (p.mode='generated' OR p.mode='shared' OR EXISTS(SELECT 1 FROM partners.coupon_codes code WHERE code.org_id=v.org_id AND code.pool_id=p.id AND code.state='available' AND code.expires_at>clock_timestamp())
 OR EXISTS(SELECT 1 FROM partners.coupon_reservations a WHERE a.send_id=$1 AND a.pool_id=p.id AND a.state='reserved')) AS stock
 FROM partners.offers o JOIN partners.offer_versions v ON v.org_id=o.org_id AND v.offer_id=o.id AND v.version=o.current_version
 JOIN LATERAL(SELECT pool.* FROM partners.coupon_pools pool WHERE pool.org_id=o.org_id AND pool.offer_id=o.id AND pool.offer_version=v.version AND pool.state='ready'
 ORDER BY EXISTS(SELECT 1 FROM partners.coupon_reservations a WHERE a.send_id=$1 AND a.pool_id=pool.id AND a.state='reserved') DESC,
 (pool.mode IN('shared','generated') OR EXISTS(SELECT 1 FROM partners.coupon_codes code WHERE code.pool_id=pool.id AND code.state='available' AND code.expires_at>clock_timestamp())) DESC,pool.id LIMIT 1) p ON true
 ORDER BY v.offer_id LIMIT 201`,
      [c.sendId, c.recipientId],
    )
  ).rows;
  if (rows.length > 200) return stop('unavailable');
  const keys = JSON.stringify(
    rows.map((r) => ({ org: r.org_id, offer: r.offer_id, version: r.version })),
  );
  // Three bounded queries for the whole candidate set, rather than queries per offer.
  const targetRows = (
    await s.query(
      tx,
      `SELECT t.*,t.rim_inches::text,t.radius_km::text,l.status AS location_status,l.approved_address,l.market AS location_market
  FROM jsonb_to_recordset($1::jsonb) k(org uuid,offer uuid,version integer)
  JOIN partners.offer_targets t ON t.org_id=k.org AND t.offer_id=k.offer AND t.offer_version=k.version
  LEFT JOIN partners.locations l ON l.org_id=t.org_id AND l.id=t.location_id ORDER BY t.offer_id,t.id LIMIT 2001`,
      [keys],
    )
  ).rows;
  const capRows = (
    await s.query(
      tx,
      `SELECT w.*,w.limit_units::text,w.consumed_units::text,
  coalesce((SELECT sum(cr.units) FROM partners.cap_reservations cr JOIN partners.coupon_reservations a ON a.org_id=cr.org_id AND a.id=cr.reservation_id WHERE a.send_id=$3 AND a.state='reserved' AND cr.org_id=w.org_id AND cr.cap_id=w.id AND cr.state='reserved'),0)::text AS own
  FROM jsonb_to_recordset($1::jsonb) k(org uuid,offer uuid,version integer)
  JOIN partners.offer_cap_windows w ON w.org_id=k.org AND w.offer_id=k.offer
  WHERE w.policy_version=$2 AND w.window_start<=clock_timestamp() AND w.window_end>clock_timestamp() ORDER BY w.offer_id,w.id LIMIT 801`,
      [keys, policy.version, c.sendId],
    )
  ).rows;
  if (targetRows.length > 2000 || capRows.length > 800) return stop('unavailable');
  const result: PilotOffer[] = [];
  for (const r of rows) {
    const offer = mapped(partnerOfferFromRow(r));
    const targets = targetRows.filter(
      (t) =>
        t.org_id === offer.organizationId &&
        t.offer_id === offer.offerId &&
        t.offer_version === offer.version,
    );
    if (targets.length > 100) return stop('integrity');
    const caps = capRows.filter(
      (w) => w.org_id === offer.organizationId && w.offer_id === offer.offerId,
    );
    const bounded =
      caps.length === 3 &&
      new Set(caps.map((x) => x.kind)).size === 3 &&
      caps.every(
        (x) =>
          ['total', 'day', 'budget'].includes(String(x.kind)) &&
          (x.kind !== 'budget' || x.currency_code === 'USD'),
      );
    const capList = caps.map((x) => ({
      id: identifier('offer_cap', x.id),
      kind: text(x.kind),
      units: x.kind === 'budget' ? policy.creditUnits : 1n,
    }));
    result.push({
      offer,
      poolId: identifier('coupon_pool', r.pool_id),
      mode: r.mode as PilotOffer['mode'],
      prefix: r.generated_prefix === null ? null : text(r.generated_prefix),
      available:
        !!r.live &&
        !!r.stock &&
        bounded &&
        caps.every(
          (x, n) =>
            BigInt(String(x.limit_units)) -
              BigInt(String(x.consumed_units)) +
              BigInt(String(x.own)) >=
            capList[n]!.units,
        ),
      caps: capList,
      targets: pilotTargetsFromRows(targets),
    });
  }
  return result;
}

export function pilotTargetsFromRows(
  rows: readonly Record<string, unknown>[],
): import('../../../domain/src/offer-matching.ts').PilotTarget[] {
  return rows.map((t) => {
    const address = t.approved_address === null ? {} : obj(t.approved_address);
    const coordinate = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      strategy: text(t.strategy),
      market: text(t.market),
      value: t.value_text === null ? null : text(t.value_text),
      skuId: t.sku_id === null ? null : text(t.sku_id),
      modelId: t.model_id === null ? null : text(t.model_id),
      brandId: t.brand_entity_id === null ? null : text(t.brand_entity_id),
      rim: t.rim_inches === null ? null : text(t.rim_inches),
      radiusKm: t.radius_km === null ? null : Number(t.radius_km),
      latitude: coordinate(address.latitude),
      longitude: coordinate(address.longitude),
      validLocation:
        t.location_id === null ||
        (t.location_status === 'approved' && t.location_market === t.market),
      rule: obj(t.rule),
    };
  });
}
