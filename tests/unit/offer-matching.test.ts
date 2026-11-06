import { describe, it, expect } from 'vitest';
import { matchPilotOffers, type PilotCandidate } from '../../packages/domain/src/offer-matching.ts';
import type { PartnerOfferVersion } from '../../packages/domain/src/entities/partner.ts';
import { audience, candidate, target } from '../fixtures/phase2/matching.ts';
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const decision = (a = audience, c = candidate()) => matchPilotOffers(a, [c])[0]!;
describe('nonpaid deterministic pilot matching', () => {
  it('selects no more than three and one per seller without mutating input', () => {
    const a = [
      candidate(5),
      candidate(3),
      candidate(2),
      candidate(1),
      {
        ...candidate(4),
        offer: { ...candidate(4).offer, organizationId: candidate(1).offer.organizationId },
      },
    ];
    const before = structuredClone(a);
    const r = matchPilotOffers(audience, a);
    expect(r.filter((x) => x.selected)).toHaveLength(3);
    expect(new Set(r.filter((x) => x.selected).map((x) => x.organizationId)).size).toBe(3);
    expect(a).toEqual(before);
    expect(matchPilotOffers(audience, a.toReversed())).toEqual(r);
  });
  it.each([
    'sku',
    'model',
    'brand',
    'category',
    'rim',
    'size',
    'vehicle_type',
    'tier',
    'region',
    'postal',
    'radius',
  ])('matches exact %s targets and refuses unknowns', (strategy) => {
    const t = {
      ...target(strategy),
      ...{
        sku: { skuId: uuid(1) },
        model: { modelId: uuid(2) },
        brand: { brandId: uuid(3) },
        category: { value: 'touring' },
        rim: { rim: '17.0' },
        size: { value: '225/55R17' },
        vehicle_type: { value: 'sedan' },
        tier: { value: 'value' },
        region: { value: 'CA' },
        postal: { value: '90001' },
        radius: { radiusKm: 5, latitude: 34, longitude: -118 },
      }[strategy],
    };
    expect(decision(audience, candidate(1, [t])).eligible).toBe(true);
    const wrong = {
      ...t,
      value: 'not-matched',
      skuId: uuid(9),
      modelId: uuid(9),
      brandId: uuid(9),
      rim: '19',
      latitude: 0,
      longitude: 0,
    };
    expect(decision(audience, candidate(1, [wrong])).eligible).toBe(false);
  });
  it('requires both geographic and product groups', () => {
    expect(decision(audience, candidate(1, [target(), target('region', 'NY')])).eligible).toBe(
      false,
    );
  });
  it('requires every selected axle to match a product target', () => {
    expect(
      decision(
        {
          ...audience,
          products: [...audience.products, { ...audience.products[0]!, size: '245/45R18' }],
        },
        candidate(1, [target('size', '225/55R17')]),
      ).eligible,
    ).toBe(false);
  });
  it('prefers an exact SKU to a store-wide match when all other factors are equal', () => {
    const r = matchPilotOffers(audience, [
      candidate(1),
      candidate(2, [{ ...target('sku'), skuId: uuid(1) }]),
    ]);
    expect(r[0]!.offerId).toBe(candidate(2).offer.offerId);
  });
  it.each(['capacity', 'market', 'quantity', 'minimum', 'currency', 'rule', 'location', 'unknown'])(
    'refuses %s failures',
    (kind) => {
      let c = candidate();
      const a = { ...audience };
      if (kind === 'capacity') c = { ...c, available: false };
      if (kind === 'market') a.market = 'CA';
      if (kind === 'quantity') a.quantity = 0;
      if (kind === 'minimum')
        c = { ...c, offer: { ...c.offer, minimumPurchase: { minor: 90000n, currency: 'USD' } } };
      if (kind === 'currency')
        c = { ...c, offer: { ...c.offer, minimumPurchase: { minor: 1n, currency: 'EUR' } } };
      if (kind === 'rule') c = { ...c, targets: [{ ...target(), rule: { unknown: true } }] };
      if (kind === 'location') c = { ...c, targets: [{ ...target(), validLocation: false }] };
      if (kind === 'unknown') c = { ...c, targets: [target('unsupported')] };
      expect(decision(a, c).eligible).toBe(false);
    },
  );
  it('does not invent savings from an unknown price or deferred rebate', () => {
    expect(decision({ ...audience, subtotalMinor: null }).savingBp).toBe(0);
    const c = candidate();
    expect(
      decision(audience, {
        ...c,
        offer: {
          ...c.offer,
          discount: { kind: 'mail_in_rebate', money: { minor: 50000n, currency: 'USD' } },
        },
      }).savingBp,
    ).toBe(0);
  });
  it('ignores every paid setting and never changes core recommendations', () => {
    const c = candidate();
    const core = structuredClone(audience);
    expect(
      matchPilotOffers(audience, [{ ...c, bid: 1e20, paidWeight: 1 } as PilotCandidate]),
    ).toEqual(matchPilotOffers(audience, [c]));
    expect(audience).toEqual(core);
  });
  it('bounds exact bigint saving and all scores', () => {
    const c = candidate();
    const r = decision(
      { ...audience, subtotalMinor: '1' },
      {
        ...c,
        offer: {
          ...c.offer,
          discount: { kind: 'amount_off', money: { minor: 9223372036854775807n, currency: 'USD' } },
        },
      },
    );
    expect(r.savingBp).toBe(10000);
    expect(r.score).toBeLessThanOrEqual(10000);
  });
  it('returns no empty sponsored selection for missing candidates', () => {
    expect(matchPilotOffers(audience, [])).toEqual([]);
  });
  it.each(['rule', 'unknown', 'location'])(
    'does not discard a restrictive %s row beside a store-wide row',
    (kind) => {
      const t = {
        ...target('sku'),
        skuId: audience.products[0]!.skuId,
        ...(kind === 'rule'
          ? { rule: { unsupported: true } }
          : kind === 'unknown'
            ? { strategy: 'future_target' }
            : { validLocation: false }),
      };
      expect(decision(audience, candidate(1, [target(), t])).eligible).toBe(false);
    },
  );
  it('refuses unpublished offers and unbounded candidate/target sets', () => {
    const c = candidate();
    expect(decision(audience, { ...c, offer: { ...c.offer, status: 'draft' } }).eligible).toBe(
      false,
    );
    expect(() =>
      matchPilotOffers(
        audience,
        Array.from({ length: 201 }, () => c),
      ),
    ).toThrow();
    expect(() =>
      decision(
        audience,
        candidate(
          1,
          Array.from({ length: 101 }, () => target()),
        ),
      ),
    ).toThrow();
    expect(decision({ ...audience, products: [] }).eligible).toBe(false);
  });
  it.each([
    [{ kind: 'percent_off', basisPoints: 2000 }, 2000],
    [{ kind: 'set_of_four_off', money: { minor: 8000n, currency: 'USD' } }, 1000],
    [{ kind: 'buy_three_get_one' }, 2500],
    [{ kind: 'mail_in_rebate', money: { minor: 8000n, currency: 'USD' } }, 0],
    [{ kind: 'price_match' }, 0],
    [{ kind: 'free_service', service: 'alignment' }, 0],
    [{ kind: 'amount_off', money: { minor: 8000n, currency: 'EUR' } }, 0],
  ] as const)('uses conservative upfront savings for case %#', (discount, bp) => {
    const c = candidate();
    expect(
      decision(audience, {
        ...c,
        offer: { ...c.offer, discount: discount as PartnerOfferVersion['discount'] },
      }).savingBp,
    ).toBe(bp);
  });
  it('requires known valid geography and reports reproducible nonpaid reasons', () => {
    expect(
      decision(
        { ...audience, latitude: null, longitude: null },
        candidate(1, [{ ...target('radius'), radiusKm: 10, latitude: 34, longitude: -118 }]),
      ).eligible,
    ).toBe(false);
    expect(decision(audience).reasons).toEqual(['nonpaid_match', 'matched_store_wide']);
    expect(decision({ ...audience, subtotalMinor: 'bad' }).savingBp).toBe(0);
  });
});
