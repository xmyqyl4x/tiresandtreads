import { z, p2Uuid as id, p2Revision as rev } from './phase2-wire.ts';
import type { EndpointContract } from './http.ts';
import { p2Operation, createP2Client } from './phase2-client.ts';
const text = z.string().max(2048),
  empty = z.strictObject({}),
  stamp = z.iso.datetime();
export const reviewQueueInput = z.strictObject({
  after: z.string().min(1).max(128).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(25).default(25),
});
export const reviewEvidenceInput = z.strictObject({
  purpose: z.enum(['agreement', 'verification']),
});
export const reviewApiContracts: readonly EndpointContract[] = [
  ['p2StaffSession', '/session'],
  ['p2BusinessQueue', '/businesses'],
  ['p2OfferQueue', '/offers'],
  ['p2BusinessReview', '/businesses/:org'],
  ['p2OfferReviewDetail', '/businesses/:org/offers/:offer/:version'],
  ['p2ReviewEvidence', '/businesses/:org/evidence/:asset'],
].map(([operationId, path]) => ({
  operationId: operationId!,
  path: '/api/v1/staff/review' + path!,
  method: 'GET',
  access: 'staff',
  command: false,
}));
const get = <Q extends z.ZodType, O extends z.ZodType>(name: string, query: Q, output: O) =>
  p2Operation(
    reviewApiContracts.find((c) => c.operationId === name)!,
    undefined,
    output,
    query,
    false,
  );
const queue = z.object({
  items: z
    .array(
      z.object({
        org: id,
        resource: id,
        version: z.number().int().min(1).nullable(),
        title: text,
        state: text,
        revision: rev.nullable(),
      }),
    )
    .max(25),
  next: z.string().max(128).nullable(),
});
export const reviewP2Operations = {
  p2StaffSession: get(
    'p2StaffSession',
    empty,
    z.object({ schemaVersion: z.literal(1), csrf: text, kind: z.literal('staff-session') }),
  ),
  p2BusinessQueue: get('p2BusinessQueue', reviewQueueInput, queue),
  p2OfferQueue: get('p2OfferQueue', reviewQueueInput, queue),
  p2BusinessReview: get(
    'p2BusinessReview',
    empty,
    z.object({
      organization: z.object({
        id,
        legalName: text,
        market: z.literal('US'),
        status: text,
        verification: text,
        revision: rev,
      }),
      profile: z.object({
        services: z.array(text).max(16),
        state: text,
        revision: rev,
        emailDomain: text,
      }),
      assets: z
        .array(
          z.object({
            id,
            purpose: z.enum(['agreement', 'verification']),
            state: text,
            expiresAt: stamp,
          }),
        )
        .max(50),
      agreements: z
        .array(z.object({ kind: text, version: text, status: text, expiresAt: stamp }))
        .max(50),
      locations: z.array(z.object({ id, key: text, region: text, status: text })).max(50),
      truncated: z.boolean(),
    }),
  ),
  p2OfferReviewDetail: get(
    'p2OfferReviewDetail',
    empty,
    z.object({
      org: id,
      offer: id,
      version: z.number().int().min(1),
      state: text,
      text: z.string().max(65536),
      targets: z
        .array(
          z.object({
            strategy: text,
            value: text.nullable(),
            sku: id.nullable(),
            model: id.nullable(),
            brand: id.nullable(),
            location: id.nullable(),
            rim: text.nullable(),
            radius: text.nullable(),
          }),
        )
        .max(32),
    }),
  ),
  p2ReviewEvidence: get(
    'p2ReviewEvidence',
    reviewEvidenceInput,
    z.object({ id, purpose: z.enum(['agreement', 'verification']), text: z.string().max(65536) }),
  ),
} as const;
export const createP2ReviewClient = (base: string, transport: typeof fetch = fetch) =>
  createP2Client(reviewP2Operations, base, transport);
