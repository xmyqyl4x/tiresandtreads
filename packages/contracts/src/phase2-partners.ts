import { z } from 'zod';
export { z } from 'zod';
import type { EndpointContract } from './http.ts';
export const p2Uuid = z.uuid();
export const p2Revision = z.string().regex(/^[1-9][0-9]{0,17}$/);
const short = z.string().trim().min(1).max(200),
  reason = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  version = z.number().int().min(1).max(2147483647),
  stamp = z.iso.datetime(),
  empty = z.strictObject({});
export const partnerApiInputs = {
  register: z.strictObject({ legalName: short, market: z.literal('US') }),
  profile: z.strictObject({
    expected: p2Revision,
    services: z
      .array(
        z.enum([
          'sales',
          'fitting',
          'alignment',
          'tpms',
          'repair',
          'rotation',
          'balancing',
          'mobile_service',
        ]),
      )
      .min(1)
      .max(16),
  }),
  location: z.strictObject({
    key: short,
    region: short,
    address: z.strictObject({ line1: short, country: z.literal('US'), city: short, postal: short }),
  }),
  upload: z.strictObject({
    purpose: z.enum(['agreement', 'verification', 'coupon_pool', 'logo']),
    mime: z.enum([
      'application/json',
      'text/csv',
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/pdf',
    ]),
  }),
  agreement: z.strictObject({ kind: z.enum(['pilot_terms', 'privacy', 'dpa']), assetId: p2Uuid }),
  submit: z.strictObject({ expected: p2Revision }),
  verification: z.strictObject({
    kind: z.enum(['domain', 'registry', 'manual']),
    assetId: p2Uuid,
    approved: z.boolean(),
    expiresAt: stamp,
    domain: short.nullable(),
  }),
  decide: z.strictObject({
    expected: p2Revision,
    approved: z.boolean(),
    reason,
    emailOverride: z.boolean().default(false),
  }),
  activate: z.strictObject({ expected: p2Revision }),
  lifecycle: z.strictObject({
    expected: p2Revision,
    state: z.enum(['suspended', 'active', 'closed', 'expired']),
    reason,
  }),
  invite: z.strictObject({ subject: short, role: z.enum(['manager', 'analyst']) }),
  acceptInvite: z.strictObject({ token: z.string().min(16).max(2048) }),
  member: z.strictObject({
    subject: short,
    expected: p2Revision,
    role: z.enum(['owner', 'manager', 'analyst']),
    status: z.enum(['active', 'revoked']),
  }),
  draft: z.strictObject({
    version,
    body: z.strictObject({
      title: short,
      description: z.string().max(2000),
      terms: z.strictObject({ included: z.array(short).max(32), conditions: z.string().max(2000) }),
      discount: z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.enum(['amount_off', 'set_of_four_off', 'mail_in_rebate']),
          money: z.strictObject({
            minor: z.string().regex(/^[0-9]{1,18}$/),
            currency: z.literal('USD'),
          }),
        }),
        z.strictObject({
          kind: z.literal('percent_off'),
          basisPoints: z.number().int().min(1).max(10000),
        }),
        z.strictObject({
          kind: z.literal('free_service'),
          service: z.enum(['fitting', 'alignment', 'tpms']),
        }),
        z.strictObject({ kind: z.enum(['buy_three_get_one', 'price_match']) }),
      ]),
      minimumTires: z.number().int().min(1).max(4),
      minimumPurchase: z
        .strictObject({ minor: z.string().regex(/^[0-9]{1,18}$/), currency: z.literal('USD') })
        .nullable(),
      redemptionMethod: z.enum(['in_store_code', 'online_code', 'link']),
      redemptionDomain: short.nullable(),
      redemptionUrl: z.string().url().max(2048).nullable(),
      logoAssetId: p2Uuid.nullable(),
      logoRightsWarranted: z.boolean(),
      validFrom: stamp,
      validUntil: stamp,
    }),
    targets: z
      .array(
        z.strictObject({
          id: p2Uuid,
          market: z.literal('US'),
          strategy: z.enum([
            'sku',
            'model',
            'brand',
            'category',
            'size',
            'vehicle_type',
            'tier',
            'region',
            'postal',
            'rim',
            'radius',
            'store_wide',
          ]),
          skuId: p2Uuid.nullable(),
          modelId: p2Uuid.nullable(),
          brandId: p2Uuid.nullable(),
          locationId: p2Uuid.nullable(),
          value: short.nullable(),
          rimInches: short.nullable(),
          radiusKm: short.nullable(),
          rule: empty,
        }),
      )
      .min(1)
      .max(32),
  }),
  offerSubmit: z.strictObject({ version }),
  offerReview: z.strictObject({ version, approved: z.boolean(), reason }),
  offerPublish: z.strictObject({ version, expected: version.nullable() }),
  pause: empty,
  pool: z.strictObject({
    id: p2Uuid,
    offerId: p2Uuid,
    version,
    mode: z.enum(['shared', 'generated', 'unique']),
    assetId: p2Uuid.nullable(),
    prefix: z.string().max(32).nullable(),
    sharedCode: z.string().max(128).nullable(),
  }),
  queue: z.strictObject({ poolId: p2Uuid, assetId: p2Uuid, expiresAt: stamp }),
  reauthorize: empty,
  redemption: z.strictObject({
    assignment: p2Uuid,
    kind: z.enum(['reported', 'correction', 'reversal']),
    quantity: z.number().int().min(-4).max(4),
    previous: p2Uuid.nullable(),
    occurredAt: stamp,
  }),
  dispute: z.strictObject({
    id: p2Uuid,
    assignment: p2Uuid,
    reason: z.enum(['terms', 'not_honored', 'redemption', 'error', 'other']),
    kind: z.enum(['opened', 'evidence', 'resolved', 'reopened']),
    expected: z.number().int().min(0).max(10000),
    details: z.string().min(1).max(2000),
  }),
} as const;
export const csvApiInputs = {
  template: z.strictObject({
    mapping: short,
    version,
    maxBytes: z.number().int().min(1).max(16777216),
    maxRows: z.number().int().min(1).max(100000),
    state: z.enum(['draft', 'active']),
  }),
  upload: z.strictObject({
    templateId: p2Uuid,
    providerId: p2Uuid,
    licenseId: p2Uuid,
    market: z.literal('US'),
    effectiveAt: stamp,
    externalVersion: short,
  }),
  empty,
  review: z.strictObject({ previewId: p2Uuid, decision: z.enum(['approved', 'rejected']), reason }),
  publish: z.strictObject({ reviewId: p2Uuid }),
  rollback: z.strictObject({
    bundleId: p2Uuid,
    expectedBundleId: p2Uuid,
    expected: p2Revision,
    approvalId: p2Uuid,
  }),
} as const;
export const p2Page = z.strictObject({
  after: p2Uuid.nullable().default(null),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export const p2Week = z.strictObject({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const partner = (
  operationId: string,
  path: string,
  method: EndpointContract['method'] = 'POST',
  upload = false,
): EndpointContract => ({
  operationId,
  path: '/api/v1/partners' + path,
  method,
  access: 'partner',
  command: method !== 'GET',
  ...(upload
    ? { bodyMode: 'bytes', bodyContentType: 'application/octet-stream', maxBodyBytes: 16777216 }
    : {}),
});
export const partnerApiContracts: readonly EndpointContract[] = [
  partner('p2PartnerSession', '/session', 'GET'),
  partner('p2Register', '/organizations'),
  partner('p2Organization', '/organizations/:org', 'GET'),
  ...[
    'profile',
    'location',
    'agreement',
    'submit',
    'verification',
    'decide',
    'activate',
    'lifecycle',
    'invite',
    'acceptInvite',
    'member',
  ].map((x) => partner('p2' + x[0]!.toUpperCase() + x.slice(1), '/organizations/:org/' + x)),
  partner('p2Upload', '/organizations/:org/assets', 'POST', true),
  ...['draft', 'submit', 'review', 'publish', 'pause'].map((x) =>
    partner('p2Offer' + x[0]!.toUpperCase() + x.slice(1), '/organizations/:org/offers/:offer/' + x),
  ),
  partner('p2OfferPreview', '/organizations/:org/offers/:offer/preview', 'GET'),
  partner('p2Simulate', '/organizations/:org/offers/:offer/simulate'),
  partner('p2Pool', '/organizations/:org/pools'),
  partner('p2Queue', '/organizations/:org/imports'),
  partner('p2Reauthorize', '/organizations/:org/imports/:import/reauthorize'),
  partner('p2ImportStatus', '/organizations/:org/imports/:import', 'GET'),
  partner('p2ImportErrors', '/organizations/:org/imports/:import/errors', 'GET'),
  partner('p2PoolStats', '/organizations/:org/pools/:pool', 'GET'),
  partner('p2Report', '/organizations/:org/reports', 'GET'),
  partner('p2Disputes', '/organizations/:org/disputes', 'GET'),
  partner('p2Redemption', '/organizations/:org/redemptions'),
  partner('p2Dispute', '/organizations/:org/disputes'),
  partner('p2Visitors', '/operations/visitors', 'GET'),
  partner('p2Health', '/operations/health', 'GET'),
  partner('p2Domains', '/operations/domains', 'GET'),
  partner('p2Internal', '/operations/reports', 'GET'),
];
export const csvApiContracts: readonly EndpointContract[] = [
  {
    operationId: 'p2CsvTemplate',
    method: 'POST',
    path: '/api/v1/staff/csv/templates',
    access: 'staff',
    command: true,
  },
  {
    operationId: 'p2CsvSchema',
    method: 'GET',
    path: '/api/v1/staff/csv/templates/:template',
    access: 'staff',
  },
  {
    operationId: 'p2CsvRetire',
    method: 'POST',
    path: '/api/v1/staff/csv/templates/:template/retire',
    access: 'staff',
    command: true,
  },
  {
    operationId: 'p2CsvUpload',
    method: 'POST',
    path: '/api/v1/staff/csv/uploads',
    access: 'staff',
    command: true,
    bodyMode: 'bytes',
    bodyContentType: 'application/octet-stream',
    maxBodyBytes: 16777216,
  },
  ...['status', 'errors', 'validate', 'preview', 'review', 'publish', 'cancel', 'rollback'].map(
    (x) => ({
      operationId: 'p2Csv' + x[0]!.toUpperCase() + x.slice(1),
      method: ['status', 'errors'].includes(x) ? ('GET' as const) : ('POST' as const),
      path: '/api/v1/staff/csv/uploads/:intake/' + x,
      access: 'staff' as const,
      command: !['status', 'errors'].includes(x),
    }),
  ),
];

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
