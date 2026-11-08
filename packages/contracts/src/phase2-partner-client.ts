import { z, p2Uuid as id, p2Revision as rev } from './phase2-wire.ts';
import {
  partnerApiContracts,
  partnerApiInputs as inputs,
  p2Page,
  p2Week,
} from './phase2-partners.ts';
import { pilotAudienceInput } from './phase2-pilot.ts';
import { p2Operation, createP2Client } from './phase2-client.ts';
const empty = z.strictObject({}),
  text = z.string().max(2048),
  stamp = z.iso.datetime(),
  count = z.string().regex(/^[0-9]{1,19}$/),
  integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const action = z.object({
  id: id.optional(),
  status: text.optional(),
  revision: rev.optional(),
  value: z.union([text, z.number(), z.boolean(), z.null()]).optional(),
});
const dispute = z.object({
  id,
  reason: text,
  state: z.enum(['open', 'reviewing', 'closed']),
  revision: integer,
  createdAt: stamp,
});
const imported = z.object({
  id,
  state: text,
  jobId: id,
  accepted: integer,
  duplicates: integer,
  rejected: integer,
  through: integer,
});
const release = {
  state: z.enum(['available', 'suppressed', 'blocked']),
  week: text,
  computedAt: stamp,
  cells: z.record(z.string().max(100), count).nullable(),
};
const contract = (name: string) => {
  const c = partnerApiContracts.find((x) => x.operationId === name);
  if (!c) throw Error('Unknown partner operation');
  return c;
};
const post = <I extends z.ZodType, O extends z.ZodType>(name: string, input: I, output: O) =>
  p2Operation(contract(name), input, output, empty, true);
const get = <Q extends z.ZodType, O extends z.ZodType>(name: string, query: Q, output: O) =>
  p2Operation(contract(name), undefined, output, query, false);
export const partnerP2Operations = {
  p2PartnerSession: get(
    'p2PartnerSession',
    empty,
    z.object({ schemaVersion: z.literal(1), csrf: text, kind: z.literal('partner-session') }),
  ),
  p2Register: post('p2Register', inputs.register, action),
  p2Organization: get(
    'p2Organization',
    empty,
    z.object({
      organization: z.object({
        id,
        market: z.literal('US'),
        status: text,
        verification: text,
        revision: rev,
      }),
      profile: z.object({
        services: z.array(text).max(16),
        revision: rev,
        state: z.enum(['draft', 'submitted', 'approved', 'rejected']),
      }),
      member: z.object({
        role: z.enum(['owner', 'manager', 'analyst']),
        status: text,
        revision: rev,
      }),
    }),
  ),
  p2Profile: post(
    'p2Profile',
    inputs.profile,
    z.object({ revision: rev, services: z.array(text).max(16) }),
  ),
  p2Location: post('p2Location', inputs.location, action),
  p2Agreement: post('p2Agreement', inputs.agreement, action),
  p2Submit: post('p2Submit', inputs.submit, action),
  p2Verification: post('p2Verification', inputs.verification, z.object({ approved: z.boolean() })),
  p2Decide: post('p2Decide', inputs.decide, action),
  p2Activate: post('p2Activate', inputs.activate, action),
  p2Lifecycle: post('p2Lifecycle', inputs.lifecycle, action),
  p2Invite: post('p2Invite', inputs.invite, z.object({ id, token: text, expiresAt: stamp })),
  p2AcceptInvite: post('p2AcceptInvite', inputs.acceptInvite, action),
  p2Member: post('p2Member', inputs.member, action),
  p2Upload: p2Operation(
    contract('p2Upload'),
    undefined,
    z.object({ id, mime: text, size: integer }),
    inputs.upload,
    true,
    true,
  ),
  p2OfferDraft: post(
    'p2OfferDraft',
    inputs.draft,
    z.object({ offerId: id, version: integer, status: text, title: text }),
  ),
  p2OfferSubmit: post('p2OfferSubmit', inputs.offerSubmit, z.object({ submitted: z.boolean() })),
  p2OfferReview: post('p2OfferReview', inputs.offerReview, z.object({ reviewed: z.boolean() })),
  p2OfferPublish: post('p2OfferPublish', inputs.offerPublish, z.object({ published: z.boolean() })),
  p2OfferPause: post('p2OfferPause', inputs.pause, z.object({ paused: z.boolean() })),
  p2OfferPreview: get(
    'p2OfferPreview',
    z.strictObject({ version: z.coerce.number().int().min(1).max(2147483647) }),
    z.object({ text: z.string().max(16384), html: z.string().max(32768) }),
  ),
  p2Simulate: post(
    'p2Simulate',
    z.strictObject({
      version: z.number().int().min(1).max(2147483647),
      audience: pilotAudienceInput,
    }),
    z.object({
      hypothetical: z.literal(true),
      capacityChecked: z.literal(false),
      decisions: z
        .array(
          z.object({
            organizationId: id,
            offerId: id,
            version: integer,
            eligible: z.boolean(),
            score: integer,
            specificity: integer,
            savingBp: integer,
            proximityBp: integer,
            reasons: z.array(text).max(64),
            selected: z.boolean(),
          }),
        )
        .max(100),
    }),
  ),
  p2Pool: post('p2Pool', inputs.pool, action),
  p2Queue: post('p2Queue', inputs.queue, imported),
  p2Reauthorize: post('p2Reauthorize', inputs.reauthorize, imported),
  p2ImportStatus: get('p2ImportStatus', empty, imported),
  p2ImportErrors: get(
    'p2ImportErrors',
    empty,
    z.object({ mime: z.literal('text/csv'), csv: z.string().max(1048576), truncated: z.boolean() }),
  ),
  p2PoolStats: get(
    'p2PoolStats',
    empty,
    z.object({ total: integer, available: integer, low: z.boolean() }),
  ),
  p2Report: get(
    'p2Report',
    p2Week,
    z.object({
      ...release,
      market: z.literal('US'),
      grain: text,
      attribution: text,
      pilot: z.literal('noncharging'),
      currency: z.null(),
      clicks: text,
    }),
  ),
  p2Disputes: get('p2Disputes', p2Page, z.object({ items: z.array(dispute).max(50) })),
  p2Redemption: post(
    'p2Redemption',
    inputs.redemption,
    z.object({ event: id, verifiedSale: z.literal(false), charging: z.literal(false) }),
  ),
  p2Dispute: post('p2Dispute', inputs.dispute, dispute),
  p2Visitors: get(
    'p2Visitors',
    z.strictObject({
      week: p2Week.shape.week,
      after: z.string().min(1).max(2048).nullable().default(null),
      limit: z.coerce.number().int().min(1).max(50).default(25),
    }),
    z.object({
      items: z
        .array(
          z.object({
            ref: text,
            lastSeen: stamp,
            sessions: count,
            events: count,
            routes: z.array(text).max(1000),
            channels: z.array(text).max(100),
            contact: z.literal('masked'),
          }),
        )
        .max(50),
      next: text.nullable(),
      coverage: text,
    }),
  ),
  p2Health: get(
    'p2Health',
    p2Week,
    z.object({
      accepted: count,
      uncertain: count,
      delivered: count,
      bounced: count,
      complained: count,
      suspectedHumanOpens: count,
      machineOpens: count,
      unknownOpens: count,
      suspectedHumanClicks: count,
      machineClicks: count,
      unknownClicks: count,
      week: text,
      grain: text,
      deliveryIsIndependentFact: z.literal(true),
      opensAreEstimates: z.literal(true),
      domainAttribution: text,
    }),
  ),
  p2Domains: get(
    'p2Domains',
    z.strictObject({ domain: z.string().min(1).max(253) }),
    z.object({
      domain: text,
      samples: z
        .array(
          z.object({
            sample: z.object({
              domain: text,
              source: z.enum(['google_postmaster', 'microsoft_snds']),
              day: text,
              status: z.enum(['available', 'unavailable']),
              reputation: z.enum(['high', 'medium', 'low', 'bad']).nullable(),
              spamBasisPoints: integer.nullable(),
              sampleSize: integer.nullable(),
            }),
            importedAt: stamp,
            fresh: z.boolean(),
          }),
        )
        .max(1000),
      missingSourceStatus: z.literal('unavailable'),
    }),
  ),
  p2Internal: get(
    'p2Internal',
    p2Week,
    z.object({ ...release, coverage: text, exportEnabled: z.literal(false) }),
  ),
} as const;
export const createP2PartnerClient = (base: string, transport: typeof fetch = fetch) =>
  createP2Client(partnerP2Operations, base, transport);
