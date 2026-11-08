import { partnerApiInputs } from '../../../../../packages/contracts/src/phase2-partners.ts';
import { pilotAudienceInput } from '../../../../../packages/contracts/src/phase2-pilot.ts';
export const text = (f: FormData, key: string) => String(f.get(key) ?? '').trim();
export const optional = (f: FormData, key: string) => text(f, key) || null;
class InputFailure extends Error {
  readonly code = 'invalid_input';
}
export async function uploadBytes(f: FormData, maximum = 16777216) {
  const file = f.get('file');
  if (!(file instanceof File) || file.size < 1 || file.size > maximum)
    throw new InputFailure('Choose a supported file within the size limit.');
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new InputFailure('The local file could not be read.');
  }
}
export function dollars(raw: string) {
  if (!/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/.test(raw))
    throw new InputFailure('Enter a USD amount with at most two decimal places.');
  const [whole, cents = ''] = raw.split('.');
  return (BigInt(whole!) * 100n + BigInt(cents.padEnd(2, '0'))).toString();
}
export const utcDate = (f: FormData, key: string) => {
  const raw = text(f, key);
  if (!raw) throw new InputFailure('Choose a date.');
  const value = new Date(raw.endsWith('Z') ? raw : raw + ':00Z');
  if (!Number.isFinite(value.getTime())) throw new InputFailure('Choose a valid date.');
  return value.toISOString();
};
export function offerDraft(f: FormData, targetId: string) {
  const kind = text(f, 'kind'),
    amount = text(f, 'amount'),
    strategy = text(f, 'strategy');
  const discount = ['amount_off', 'set_of_four_off', 'mail_in_rebate'].includes(kind)
    ? { kind, money: { minor: dollars(amount), currency: 'USD' } }
    : kind === 'percent_off'
      ? { kind, basisPoints: Number(dollars(amount)) }
      : kind === 'free_service'
        ? { kind, service: text(f, 'service') }
        : { kind };
  return partnerApiInputs.draft.parse({
    version: Number(text(f, 'version')),
    body: {
      title: text(f, 'title'),
      description: text(f, 'description'),
      terms: {
        included: text(f, 'included')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
        conditions: text(f, 'terms'),
      },
      discount,
      minimumTires: Number(text(f, 'minimumTires')),
      minimumPurchase: text(f, 'minimumPurchase')
        ? { minor: dollars(text(f, 'minimumPurchase')), currency: 'USD' }
        : null,
      redemptionMethod: text(f, 'redemptionMethod') || 'in_store_code',
      redemptionDomain: optional(f, 'redemptionDomain'),
      redemptionUrl: optional(f, 'redemptionUrl'),
      logoAssetId: optional(f, 'logoAssetId'),
      logoRightsWarranted: f.get('logoRightsWarranted') === 'on',
      validFrom: utcDate(f, 'validFrom'),
      validUntil: utcDate(f, 'validUntil'),
    },
    targets: [
      {
        id: targetId,
        market: 'US',
        strategy,
        skuId: strategy === 'sku' ? optional(f, 'target') : null,
        modelId: strategy === 'model' ? optional(f, 'target') : null,
        brandId: strategy === 'brand' ? optional(f, 'target') : null,
        locationId: optional(f, 'location'),
        value: ['category', 'size', 'vehicle_type', 'tier', 'region', 'postal'].includes(strategy)
          ? optional(f, 'target')
          : null,
        rimInches: strategy === 'rim' ? optional(f, 'target') : null,
        radiusKm: strategy === 'radius' ? optional(f, 'target') : null,
        rule: {},
      },
    ],
  });
}
export function simulation(f: FormData) {
  const latitude = optional(f, 'latitude'),
    longitude = optional(f, 'longitude');
  if ((latitude === null) !== (longitude === null))
    throw new InputFailure('Enter both coordinates or leave both unknown.');
  return pilotAudienceInput.parse({
    market: 'US',
    currency: 'USD',
    quantity: Number(text(f, 'quantity')),
    subtotalMinor: text(f, 'subtotal') ? dollars(text(f, 'subtotal')) : null,
    region: optional(f, 'region'),
    postal: optional(f, 'postal'),
    latitude: latitude === null ? null : Number(latitude),
    longitude: longitude === null ? null : Number(longitude),
    products: [
      {
        skuId: text(f, 'skuId'),
        modelId: text(f, 'modelId'),
        brandId: optional(f, 'brandId'),
        size: text(f, 'size'),
        rim: text(f, 'rim'),
        category: text(f, 'category'),
        vehicleType: optional(f, 'vehicleType'),
        tier: optional(f, 'tier'),
      },
    ],
  });
}
