import type {
  PilotAudience,
  PilotCandidate,
  PilotTarget,
} from '../../../packages/domain/src/offer-matching.ts';
import type { PartnerOfferVersion } from '../../../packages/domain/src/entities/partner.ts';
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const audience: PilotAudience = {
  market: 'US',
  products: [
    {
      skuId: uuid(1),
      modelId: uuid(2),
      brandId: uuid(3),
      size: '225/55R17',
      rim: '17.0',
      category: 'touring',
      vehicleType: 'sedan',
      tier: 'value',
    },
  ],
  quantity: 4,
  subtotalMinor: '80000',
  currency: 'USD',
  region: 'CA',
  postal: '90001',
  latitude: 34,
  longitude: -118,
};
export function target(strategy = 'store_wide', value: string | null = null): PilotTarget {
  return {
    strategy,
    value,
    skuId: null,
    modelId: null,
    brandId: null,
    rim: null,
    radiusKm: null,
    latitude: null,
    longitude: null,
    validLocation: true,
    market: 'US',
    rule: {},
  };
}
export function candidate(n = 1, targets = [target()]): PilotCandidate {
  return {
    offer: {
      organizationId: uuid(n + 10),
      offerId: uuid(n + 100),
      version: 1,
      title: 'Synthetic',
      description: 'Local',
      terms: {},
      discount: { kind: 'amount_off', money: { minor: 2000n, currency: 'USD' } },
      minimumTires: 1,
      minimumPurchase: null,
      redemptionMethod: 'in_store_code',
      redemptionDomain: null,
      redemptionUrl: null,
      logoAssetId: null,
      logoRightsWarranted: false,
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2027-01-01T00:00:00.000Z',
      status: 'published',
      createdBy: null,
      reviewedBy: uuid(99),
    } as PartnerOfferVersion,
    targets,
    available: true,
  };
}
