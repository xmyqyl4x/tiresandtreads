import { z, p2Uuid } from './phase2-wire.ts';
import type { EndpointContract } from './http.ts';
const short = z.string().trim().min(1).max(200);
export const pilotAudienceInput = z.strictObject({
  market: z.literal('US'),
  currency: z.literal('USD'),
  quantity: z.number().int().min(1).max(4),
  subtotalMinor: z
    .string()
    .regex(/^[0-9]{1,19}$/)
    .nullable(),
  region: short.nullable(),
  postal: short.nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  products: z
    .array(
      z.strictObject({
        skuId: p2Uuid,
        modelId: p2Uuid,
        brandId: p2Uuid.nullable(),
        size: short,
        rim: short,
        category: short,
        vehicleType: short.nullable(),
        tier: short.nullable(),
      }),
    )
    .max(2),
});
export const pilotRequestInput = z.strictObject({
  includeOffers: z.boolean(),
  itemKey: short,
  adult: z.boolean(),
  quantity: z.number().int().min(1).max(4),
  region: short.nullable(),
  postal: short.nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
});
export const pilotApiContracts: readonly EndpointContract[] = [
  {
    operationId: 'p2PilotRequest',
    path: '/api/v1/sends/:send/partner-offers',
    method: 'POST',
    access: 'owner',
    command: true,
  },
  {
    operationId: 'p2PilotCancel',
    path: '/api/v1/sends/:send/partner-offers/cancel',
    method: 'POST',
    access: 'owner',
    command: true,
  },
];
