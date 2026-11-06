import type { PartnerOfferVersion } from './entities/partner.ts';
export interface PilotProduct {
  readonly skuId: string;
  readonly modelId: string;
  readonly brandId: string | null;
  readonly size: string;
  readonly rim: string;
  readonly category: string;
  readonly vehicleType: string | null;
  readonly tier: string | null;
}
export interface PilotAudience {
  readonly market: string;
  readonly products: readonly PilotProduct[];
  readonly quantity: number;
  readonly subtotalMinor: string | null;
  readonly currency: string;
  readonly region: string | null;
  readonly postal: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}
export interface PilotTarget {
  readonly strategy: string;
  readonly value: string | null;
  readonly skuId: string | null;
  readonly modelId: string | null;
  readonly brandId: string | null;
  readonly rim: string | null;
  readonly radiusKm: number | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly validLocation: boolean;
  readonly market: string;
  readonly rule: Readonly<Record<string, unknown>>;
}
export interface PilotCandidate {
  readonly offer: PartnerOfferVersion;
  readonly targets: readonly PilotTarget[];
  readonly available: boolean;
}
export interface PilotDecision {
  readonly organizationId: string;
  readonly offerId: string;
  readonly version: number;
  readonly eligible: boolean;
  readonly score: number;
  readonly specificity: number;
  readonly savingBp: number;
  readonly proximityBp: number;
  readonly reasons: readonly string[];
  readonly selected: boolean;
}
const strategies = new Set([
  'store_wide',
  'sku',
  'model',
  'brand',
  'size',
  'rim',
  'category',
  'vehicle_type',
  'tier',
  'region',
  'postal',
  'radius',
]);
const geographic = new Set(['region', 'postal', 'radius']);
function distance(a: PilotAudience, t: PilotTarget): number | null {
  const values = [a.latitude, a.longitude, t.latitude, t.longitude];
  if (
    values.some((v) => v === null || !Number.isFinite(v)) ||
    Math.abs(a.latitude!) > 90 ||
    Math.abs(t.latitude!) > 90 ||
    Math.abs(a.longitude!) > 180 ||
    Math.abs(t.longitude!) > 180
  )
    return null;
  const rad = (n: number) => (n * Math.PI) / 180;
  const h =
    Math.sin(rad(t.latitude! - a.latitude!) / 2) ** 2 +
    Math.cos(rad(a.latitude!)) *
      Math.cos(rad(t.latitude!)) *
      Math.sin(rad(t.longitude! - a.longitude!) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function productMatch(p: PilotProduct, t: PilotTarget): number {
  switch (t.strategy) {
    case 'store_wide':
      return 2000;
    case 'sku':
      return p.skuId === t.skuId ? 10000 : 0;
    case 'model':
      return p.modelId === t.modelId ? 8000 : 0;
    case 'brand':
      return p.brandId !== null && p.brandId === t.brandId ? 6000 : 0;
    case 'size':
      return p.size === t.value ? 10000 : 0;
    case 'rim':
      return Number(p.rim) === Number(t.rim) ? 4000 : 0;
    case 'category':
      return p.category === t.value ? 4000 : 0;
    case 'vehicle_type':
      return p.vehicleType !== null && p.vehicleType === t.value ? 4000 : 0;
    case 'tier':
      return p.tier !== null && p.tier === t.value ? 4000 : 0;
    default:
      return 0;
  }
}
function saving(a: PilotAudience, o: PartnerOfferVersion) {
  if (a.subtotalMinor === null || !/^[1-9][0-9]{0,18}$/.test(a.subtotalMinor)) return 0;
  const total = BigInt(a.subtotalMinor),
    d = o.discount;
  if (d.kind === 'percent_off') return Math.max(0, Math.min(10000, d.basisPoints));
  if (d.kind === 'buy_three_get_one') return a.quantity === 4 ? 2500 : 0;
  if ((d.kind === 'amount_off' || d.kind === 'set_of_four_off') && d.money.currency === a.currency)
    return Number(
      (d.money.minor * 10000n) / total > 10000n ? 10000n : (d.money.minor * 10000n) / total,
    );
  return 0; // Conditional, deferred and noncash benefits are never fabricated as upfront savings.
}
export function matchPilotOffers(
  a: PilotAudience,
  candidates: readonly PilotCandidate[],
): readonly PilotDecision[] {
  if (candidates.length > 200 || candidates.some((c) => c.targets.length > 100))
    throw Error('Bounded pilot candidate set required');
  const decisions = candidates
    .map((c) => {
      const o = c.offer,
        targets = c.targets.filter(
          (t) => t.market === a.market && t.validLocation && Object.keys(t.rule).length === 0,
        ),
        products = targets.filter((t) => !geographic.has(t.strategy)),
        geo = targets.filter((t) => geographic.has(t.strategy));
      const reasons: string[] = [];
      if (o.status !== 'published') reasons.push('offer_unpublished');
      if (
        c.targets.some(
          (t) =>
            t.market === a.market &&
            (!strategies.has(t.strategy) || !t.validLocation || Object.keys(t.rule).length > 0),
        )
      )
        reasons.push('target_unavailable');
      if (!c.available) reasons.push('capacity_unavailable');
      if (
        a.market !== 'US' ||
        !Number.isInteger(a.quantity) ||
        a.quantity < o.minimumTires ||
        a.quantity > 4
      )
        reasons.push('market_or_quantity');
      if (!a.products.length || a.products.length > 2) reasons.push('product_unknown');
      if (
        o.minimumPurchase &&
        (a.subtotalMinor === null ||
          !/^[0-9]{1,19}$/.test(a.subtotalMinor) ||
          o.minimumPurchase.currency !== a.currency ||
          BigInt(a.subtotalMinor) < o.minimumPurchase.minor)
      )
        reasons.push('minimum_purchase_unknown_or_unmet');
      const specificity = !a.products.length
        ? 0
        : products.length
          ? Math.min(
              ...a.products.map((p) => Math.max(0, ...products.map((t) => productMatch(p, t)))),
            )
          : 2000;
      if ((!products.length && !geo.length) || specificity === 0)
        reasons.push('product_target_mismatch');
      const distances = geo
        .filter((t) => t.strategy === 'radius')
        .map((t) => ({ km: distance(a, t), limit: t.radiusKm }));
      const geoMatched = geo.some((t) =>
        t.strategy === 'region'
          ? a.region !== null && a.region === t.value
          : t.strategy === 'postal'
            ? a.postal !== null && a.postal === t.value
            : distance(a, t) !== null &&
              t.radiusKm !== null &&
              t.radiusKm > 0 &&
              distance(a, t)! <= t.radiusKm,
      );
      if (geo.length && !geoMatched) reasons.push('geographic_mismatch');
      // A rejected geographic constraint must not disappear when other target rows are valid.
      if (c.targets.some((t) => geographic.has(t.strategy)) && !geo.length)
        reasons.push('geographic_unavailable');
      const proximityBp = Math.max(
        5000,
        ...distances
          .filter((x) => x.km !== null && x.limit !== null && x.limit > 0 && x.km <= x.limit)
          .map((x) => Math.round((1 - x.km! / x.limit!) * 10000)),
      );
      const savingBp = saving(a, o),
        score = Math.floor((specificity * 40 + savingBp * 25 + proximityBp * 15 + 5000 * 10) / 90);
      return {
        organizationId: o.organizationId,
        offerId: o.offerId,
        version: o.version,
        eligible: reasons.length === 0,
        score,
        specificity,
        savingBp,
        proximityBp,
        reasons: reasons.length
          ? reasons
          : [
              'nonpaid_match',
              ...new Set(
                products
                  .filter((t) => a.products.some((p) => productMatch(p, t) > 0))
                  .map((t) => 'matched_' + t.strategy),
              ),
              ...(geo.length ? ['matched_geography'] : []),
            ],
        selected: false,
      };
    })
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        b.score - a.score ||
        b.specificity - a.specificity ||
        (a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0) ||
        b.version - a.version,
    );
  const sellers = new Set<string>();
  let slots = 0;
  return Object.freeze(
    decisions.map((d) => {
      const selected = d.eligible && slots < 3 && !sellers.has(d.organizationId);
      if (selected) {
        slots++;
        sellers.add(d.organizationId);
      }
      return Object.freeze({
        ...d,
        reasons: Object.freeze([
          ...d.reasons,
          ...(d.eligible && !selected
            ? [sellers.has(d.organizationId) ? 'seller_duplicate' : 'slot_limit']
            : []),
        ]),
        selected,
      });
    }),
  );
}
