import { ok } from '../../../domain/src/values/core.ts';
import { pilotAudienceInput } from '../../../contracts/src/phase2-partners.ts';
import { z } from '../../../contracts/src/phase2-partners.ts';
import {
  partnerApiContracts,
  partnerApiInputs as inputs,
  p2Page,
  p2Week,
} from '../../../contracts/src/phase2-partners.ts';
import type { createPartnerOnboardingServices } from '../../../application/src/partners/partner-onboarding.ts';
import type { createPartnerOfferServices } from '../../../application/src/partners/partner-offers.ts';
import type { createPartnerCouponServices } from '../../../application/src/partners/partner-coupons.ts';
import type { createPartnerInsightsServices } from '../../../application/src/partners/partner-insights.ts';
import {
  p2Commands,
  p2Id,
  p2Rev,
  p2Parse,
  p2Query,
  p2Project,
  type P2HttpAdmission,
} from './phase2-common.ts';
import { HttpFailure, type HttpContext, type HttpRoute } from './core.ts';
export function partnerRoutes(
  d: Readonly<{
    onboarding: ReturnType<typeof createPartnerOnboardingServices>;
    offers: ReturnType<typeof createPartnerOfferServices>;
    coupons: ReturnType<typeof createPartnerCouponServices>;
    insights: ReturnType<typeof createPartnerInsightsServices>;
    admission: P2HttpAdmission;
    secret: Uint8Array;
  }>,
): readonly HttpRoute[] {
  const command = p2Commands(d.admission, d.secret),
    org = (c: HttpContext) => p2Id('organization', c.params.org),
    offer = (c: HttpContext) => p2Id('partner_offer', c.params.offer),
    handle = (c: HttpContext) => {
      if (!c.actor?.partner) throw new HttpFailure(401, 'unauthorized');
      return c.actor.partner.handle;
    };
  const routes: HttpRoute[] = [];
  routes.push({
    ...partnerApiContracts.find((x) => x.operationId === 'p2PartnerSession')!,
    handle: async (c) => {
      p2Query(c, z.strictObject({}));
      return ok({ schemaVersion: 1, csrf: c.actor!.csrf, kind: 'partner-session' });
    },
  });
  function post<T>(
    name: string,
    schema: z.ZodType<T>,
    work: (c: HttpContext, v: T) => ReturnType<HttpRoute['handle']>,
    fields: readonly string[] = ['id', 'status', 'revision'],
  ) {
    const contract = partnerApiContracts.find((x) => x.operationId === name);
    if (!contract) throw Error('Missing partner contract');
    routes.push({
      ...contract,
      handle: async (c) => {
        p2Query(c, z.strictObject({}));
        const v = p2Parse(schema, c.body);
        return command.execute(c, name, v, async () => p2Project(await work(c, v), fields));
      },
    });
  }
  function get<T>(
    name: string,
    schema: z.ZodType<T>,
    work: (c: HttpContext, v: T) => ReturnType<HttpRoute['handle']>,
    fields: readonly string[],
  ) {
    const contract = partnerApiContracts.find((x) => x.operationId === name);
    if (!contract) throw Error('Missing partner contract');
    routes.push({
      ...contract,
      handle: async (c) => p2Project(await work(c, p2Query(c, schema)), fields),
    });
  }
  post('p2Register', inputs.register, (c, v) =>
    d.onboarding.register(handle(c), { ...v, key: command.id(c) }),
  );
  get('p2Organization', z.strictObject({}), (c) => d.onboarding.status(handle(c), org(c)), [
    'organization.id',
    'organization.market',
    'organization.status',
    'organization.verification',
    'organization.revision',
    'profile.services',
    'profile.revision',
    'member.role',
    'member.status',
    'member.revision',
  ]);
  post(
    'p2Profile',
    inputs.profile,
    (c, v) => d.onboarding.profile(handle(c), org(c), p2Rev(v.expected), v.services),
    ['revision', 'services'],
  );
  post('p2Location', inputs.location, (c, v) => d.onboarding.location(handle(c), org(c), v));
  post('p2Agreement', inputs.agreement, (c, v) =>
    d.onboarding.acceptAgreement(handle(c), org(c), v.kind, p2Id('asset', v.assetId)),
  );
  post('p2Submit', inputs.submit, (c, v) =>
    d.onboarding.submit(handle(c), org(c), p2Rev(v.expected)),
  );
  post(
    'p2Verification',
    inputs.verification,
    (c, v) =>
      d.onboarding.verification(handle(c), org(c), { ...v, assetId: p2Id('asset', v.assetId) }),
    ['approved'],
  );
  post('p2Decide', inputs.decide, (c, v) =>
    d.onboarding.decide(
      handle(c),
      org(c),
      p2Rev(v.expected),
      v.approved,
      v.reason,
      v.emailOverride,
    ),
  );
  post('p2Activate', inputs.activate, (c, v) =>
    d.onboarding.activate(handle(c), org(c), p2Rev(v.expected)),
  );
  post('p2Lifecycle', inputs.lifecycle, (c, v) =>
    d.onboarding.lifecycle(handle(c), org(c), p2Rev(v.expected), v.state, v.reason),
  );
  post(
    'p2Invite',
    inputs.invite,
    (c, v) => d.onboarding.invite(handle(c), org(c), v.subject, v.role),
    ['id', 'token', 'expiresAt'],
  );
  post('p2AcceptInvite', inputs.acceptInvite, (c, v) =>
    d.onboarding.acceptInvite(handle(c), org(c), v.token),
  );
  post('p2Member', inputs.member, (c, v) =>
    d.onboarding.member(handle(c), org(c), v.subject, p2Rev(v.expected), v.role, v.status),
  );
  const upload = partnerApiContracts.find((x) => x.operationId === 'p2Upload')!;
  routes.push({
    ...upload,
    handle: async (c) => {
      const v = p2Query(c, inputs.upload);
      if (!(c.body instanceof Uint8Array)) throw new HttpFailure(400, 'invalid_input');
      return command.execute(c, upload.operationId, { v, bytes: c.body }, async () =>
        p2Project(
          await d.onboarding.upload(handle(c), org(c), v.purpose, v.mime, c.body as Uint8Array),
          ['id', 'mime', 'size', 'expiresAt'],
        ),
      );
    },
  });
  post(
    'p2OfferDraft',
    inputs.draft,
    (c, v) => {
      const body = {
        ...v.body,
        discount:
          'money' in v.body.discount
            ? {
                ...v.body.discount,
                money: { ...v.body.discount.money, minor: BigInt(v.body.discount.money.minor) },
              }
            : v.body.discount,
        minimumPurchase: v.body.minimumPurchase
          ? { ...v.body.minimumPurchase, minor: BigInt(v.body.minimumPurchase.minor) }
          : null,
      };
      return d.offers.draft(
        handle(c),
        org(c),
        offer(c),
        v.version,
        body,
        v.targets.map((t) => ({
          ...t,
          id: p2Id('offer_target', t.id),
          skuId: t.skuId ? p2Id('sku', t.skuId) : null,
          modelId: t.modelId ? p2Id('tire_model', t.modelId) : null,
          brandId: t.brandId ? p2Id('domain_entity', t.brandId) : null,
          locationId: t.locationId ? p2Id('partner_location', t.locationId) : null,
        })),
      );
    },
    ['offerId', 'version', 'status', 'title'],
  );
  post(
    'p2OfferSubmit',
    inputs.offerSubmit,
    (c, v) => d.offers.submit(handle(c), org(c), offer(c), v.version),
    ['submitted'],
  );
  post(
    'p2OfferReview',
    inputs.offerReview,
    (c, v) => d.offers.review(handle(c), org(c), offer(c), v.version, v.approved, v.reason),
    ['reviewed'],
  );
  post(
    'p2OfferPublish',
    inputs.offerPublish,
    (c, v) => d.offers.publish(handle(c), org(c), offer(c), v.version, v.expected),
    ['published'],
  );
  post('p2OfferPause', inputs.pause, (c) => d.offers.pause(handle(c), org(c), offer(c)), [
    'paused',
  ]);
  get(
    'p2OfferPreview',
    z.strictObject({ version: z.coerce.number().int().min(1).max(2147483647) }),
    (c, v) => d.offers.preview(handle(c), org(c), offer(c), v.version),
    ['text', 'html'],
  );
  post('p2Pool', inputs.pool, (c, v) =>
    d.coupons.pool(handle(c), org(c), {
      ...v,
      id: p2Id('coupon_pool', v.id),
      offerId: p2Id('partner_offer', v.offerId),
      assetId: v.assetId ? p2Id('asset', v.assetId) : null,
    }),
  );
  post(
    'p2Queue',
    inputs.queue,
    (c, v) =>
      d.coupons.queue(handle(c), org(c), {
        ...v,
        key: command.id(c),
        poolId: p2Id('coupon_pool', v.poolId),
        assetId: p2Id('asset', v.assetId),
      }),
    ['id', 'state', 'jobId', 'accepted', 'duplicates', 'rejected', 'through', 'expiresAt'],
  );
  post(
    'p2Reauthorize',
    inputs.reauthorize,
    (c) =>
      d.coupons.reauthorize(
        handle(c),
        org(c),
        p2Id('coupon_import', c.params.import),
        command.id(c),
      ),
    ['id', 'state', 'jobId', 'accepted', 'duplicates', 'rejected', 'through', 'expiresAt'],
  );
  get(
    'p2ImportStatus',
    z.strictObject({}),
    (c) => d.coupons.status(handle(c), org(c), p2Id('coupon_import', c.params.import)),
    ['id', 'state', 'jobId', 'accepted', 'duplicates', 'rejected', 'through', 'expiresAt'],
  );
  get(
    'p2ImportErrors',
    z.strictObject({}),
    (c) => d.coupons.errorReport(handle(c), org(c), p2Id('coupon_import', c.params.import)),
    ['filename', 'mime', 'csv', 'truncated'],
  );
  get(
    'p2PoolStats',
    z.strictObject({}),
    (c) => d.coupons.statistics(handle(c), org(c), p2Id('coupon_pool', c.params.pool)),
    ['total', 'available', 'low'],
  );
  get('p2Report', p2Week, (c, v) => d.insights.report(handle(c), org(c), v.week), [
    'state',
    'week',
    'computedAt',
    'cells',
    'market',
    'grain',
    'attribution',
    'pilot',
    'currency',
    'clicks',
  ]);
  get(
    'p2Disputes',
    p2Page,
    (c, v) =>
      d.insights.disputes(
        handle(c),
        org(c),
        v.after ? p2Id('partner_dispute', v.after) : null,
        v.limit,
      ),
    ['id', 'reason', 'state', 'revision', 'createdAt'],
  );
  post(
    'p2Redemption',
    inputs.redemption,
    (c, v) =>
      d.insights.redemption(handle(c), org(c), {
        ...v,
        key: p2Id('command', command.id(c)),
        assignment: p2Id('coupon_assignment', v.assignment),
        previous: v.previous ? p2Id('redemption_event', v.previous) : null,
        occurredAt: v.occurredAt as Parameters<typeof d.insights.redemption>[2]['occurredAt'],
      }),
    ['event', 'verifiedSale', 'charging'],
  );
  post(
    'p2Dispute',
    inputs.dispute,
    (c, v) =>
      d.insights.dispute(handle(c), org(c), {
        ...v,
        key: p2Id('command', command.id(c)),
        id: p2Id('partner_dispute', v.id),
        assignment: p2Id('coupon_assignment', v.assignment),
      }),
    ['id', 'reason', 'state', 'revision', 'createdAt'],
  );
  get(
    'p2Visitors',
    z.strictObject({
      week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      after: z.string().min(1).max(2048).nullable().default(null),
      limit: z.coerce.number().int().min(1).max(50).default(25),
    }),
    (c, v) => d.insights.visitors(handle(c), v.week, v.after, v.limit),
    ['items', 'next', 'coverage'],
  );
  get('p2Health', p2Week, (c, v) => d.insights.health(handle(c), v.week), [
    'accepted',
    'uncertain',
    'delivered',
    'bounced',
    'complained',
    'suspectedHumanOpens',
    'machineOpens',
    'unknownOpens',
    'suspectedHumanClicks',
    'machineClicks',
    'unknownClicks',
    'week',
    'grain',
    'deliveryIsIndependentFact',
    'opensAreEstimates',
    'domainAttribution',
  ]);
  get(
    'p2Domains',
    z.strictObject({ domain: z.string().min(1).max(253) }),
    (c, v) => d.insights.domains(handle(c), v.domain),
    ['domain', 'samples', 'missingSourceStatus'],
  );
  get('p2Internal', p2Week, (c, v) => d.insights.internal(handle(c), v.week), [
    'state',
    'week',
    'computedAt',
    'cells',
    'coverage',
    'exportEnabled',
  ]);
  post(
    'p2Simulate',
    z.strictObject({
      version: z.number().int().min(1).max(2147483647),
      audience: pilotAudienceInput,
    }),
    (c, v) => d.offers.simulate(handle(c), org(c), offer(c), v.version, v.audience),
    ['hypothetical', 'capacityChecked', 'decisions'],
  );
  return routes;
}
