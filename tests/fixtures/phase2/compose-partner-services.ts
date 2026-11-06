import { randomBytes, randomUUID } from 'node:crypto';
import {
  id,
  instant,
  revision,
  ok,
  fail,
  type Result,
  type Id,
} from '../../../packages/domain/src/values/core.ts';
import type { PartnerPrincipal } from '../../../packages/domain/src/partner-policy.ts';
import type { PrivateObjects } from '../../../packages/application/src/ports/assets.ts';
import { failure } from '../../../packages/application/src/ports/transactions.ts';
import { createPartnerOnboardingRepository } from '../../../packages/db/src/repositories/partner-onboarding.ts';
import { createPartnerModerationRepository } from '../../../packages/db/src/repositories/partner-moderation.ts';
import { createPartnerServiceAssets } from '../../../packages/db/src/repositories/partner-service-assets.ts';
import { createPartnerCouponRepository } from '../../../packages/db/src/repositories/partner-coupons.ts';
import { createJobRepository } from '../../../packages/db/src/repositories/jobs.ts';
import { createPartnerOnboardingServices } from '../../../packages/application/src/partners/partner-onboarding.ts';
import { createPartnerOfferServices } from '../../../packages/application/src/partners/partner-offers.ts';
import { createPartnerCouponServices } from '../../../packages/application/src/partners/partner-coupons.ts';
import { createPartnerCrypto } from '../../../packages/integrations/src/partner-crypto.ts';
import { createPartnerFiles } from '../../../packages/integrations/src/partner-files.ts';
import { couponCsv } from '../../../packages/integrations/src/partner-csv.ts';
import { partnerPreview } from '../../../packages/integrations/src/partner-preview.ts';
import type { partnerServiceFixture } from './partner-services.ts';
export function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw Error(JSON.stringify(r.error));
  return r.value;
}
export const uuid = <K extends string>(k: K) => value(id(k, randomUUID()));
export const rev = (n = 1) => value(revision(String(n)));
export const time = (delta = 86400000) =>
  value(instant(new Date(Date.now() + delta).toISOString()));
const enc = new TextEncoder();
export function offerBody() {
  return {
    title: 'Save on your next set',
    description: 'Synthetic local offer',
    terms: { included: ['Tires'], conditions: 'Subject to availability' },
    discount: { kind: 'amount_off', money: { minor: 2500n, currency: 'USD' } },
    minimumTires: 1,
    minimumPurchase: null,
    redemptionMethod: 'in_store_code',
    redemptionDomain: null,
    redemptionUrl: null,
    logoAssetId: null,
    logoRightsWarranted: false,
    validFrom: time(-1000),
    validUntil: time(7 * 86400000),
  };
}
export const target = () => ({
  id: uuid('offer_target'),
  market: 'US',
  strategy: 'store_wide' as const,
  skuId: null,
  modelId: null,
  brandId: null,
  locationId: null,
  value: null,
  rimInches: null,
  radiusKm: null,
  rule: {},
});
export async function composePartnerServices(f: Awaited<ReturnType<typeof partnerServiceFixture>>) {
  const crypto = createPartnerCrypto('v1', { v1: randomBytes(32) }, randomBytes(32)),
    sessions = new Map<string, PartnerPrincipal>(),
    bytes = new Map<string, Uint8Array>(),
    service = f.serviceAdapter('tt_p2_partner_service'),
    worker = f.serviceAdapter('tt_p2_coupon_worker');
  const hooks: {
    put?: () => Promise<void>;
    get?: () => Promise<void>;
    preview?: () => Promise<void>;
  } = {};
  const objects: PrivateObjects = {
    async put(a, b) {
      bytes.set(a.id, b.slice());
      await hooks.put?.();
      return 'synthetic-version-' + a.id;
    },
    async get(a) {
      await hooks.get?.();
      const b = bytes.get(a.id);
      if (!b) throw Error('Missing synthetic bytes');
      return b.slice();
    },
    async erase(a) {
      bytes.delete(a.id);
    },
  };
  const docs = {
    pilot_terms: enc.encode('{"agreement":"pilot","version":"v1","charging":false}'),
    privacy: enc.encode('{"agreement":"privacy","version":"v1"}'),
    dpa: enc.encode('{"agreement":"dpa","version":"v1"}'),
  };
  const policy = {
    version: 'p2-local-service-v1',
    agreements: Object.fromEntries(
      Object.entries(docs).map(([k, b]) => [k, { version: 'v1', sha256: crypto.checksum(b) }]),
    ) as Record<keyof typeof docs, { version: string; sha256: string }>,
    excludedEmailDomains: ['gmail.com', 'yahoo.com'],
    assetBucket: 'synthetic-partner-assets',
    assetKeyVersion: 'local-v1',
  };
  function session(
    subject = 'partner-' + randomUUID(),
    staffId: Id<'staff'> | null = null,
    domain = 'synthetic.example',
  ) {
    const h = 'session-' + randomUUID();
    sessions.set(h, {
      subject,
      staffId,
      emailVerified: true,
      emailDomain: domain,
      mfaAt: time(-1000),
      expiresAt: time(600000),
    });
    return h;
  }
  async function staff() {
    const staffId = uuid('staff'),
      subject = 'staff-' + randomUUID();
    await f.admin.query(
      "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$2,'active',clock_timestamp())",
      [staffId, subject],
    );
    await f.admin.query(
      "INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code IN('partner_verifier','partner_moderator')",
      [staffId],
    );
    return session(subject, staffId);
  }
  const verifier = await staff(),
    moderator = await staff();
  function dependencies(a: typeof service, workerMode = false) {
    return {
      uow: a.unitOfWork,
      onboarding: createPartnerOnboardingRepository(a),
      authority: {
        async verify(h: string) {
          const p = sessions.get(h);
          return p ? ok(p) : fail(failure('forbidden'));
        },
      },
      clock: { now: () => Date.now() },
      crypto,
      policy,
      assets: createPartnerServiceAssets(
        a,
        policy.assetBucket,
        policy.assetKeyVersion,
        !workerMode,
      ),
      objects,
      files: createPartnerFiles(),
      offers: createPartnerModerationRepository(a),
      preview: {
        async render(i: Parameters<typeof partnerPreview.render>[0]) {
          await hooks.preview?.();
          return partnerPreview.render(i);
        },
      },
      coupons: createPartnerCouponRepository(a),
      jobs: createJobRepository(a),
      csv: { rows: couponCsv },
    };
  }
  const d = dependencies(service),
    w = dependencies(worker, true),
    onboarding = createPartnerOnboardingServices(d),
    offers = createPartnerOfferServices(d),
    coupons = createPartnerCouponServices(d),
    consumer = createPartnerCouponServices(w);
  async function company(active = true, handle = session()) {
    const org = value(
      await onboarding.register(handle, {
        key: uuid('command'),
        legalName: 'Synthetic tire retailer',
        market: 'US',
      }),
    ).id;
    const p = value(await onboarding.profile(handle, org, rev(), ['sales', 'fitting']));
    await onboarding
      .location(handle, org, {
        key: 'main',
        region: 'CA',
        address: { line1: '1 Synthetic Way', country: 'US', city: 'Example', postal: '90001' },
      })
      .then(value);
    for (const k of ['pilot_terms', 'privacy', 'dpa'] as const) {
      const asset = value(
        await onboarding.upload(handle, org, 'agreement', 'application/json', docs[k]),
      );
      value(await onboarding.acceptAgreement(handle, org, k, asset.id));
    }
    const submitted = value(await onboarding.submit(handle, org, p.revision));
    if (active) {
      const evidence = value(
        await onboarding.upload(
          handle,
          org,
          'verification',
          'application/json',
          enc.encode('{"review":"synthetic only"}'),
        ),
      );
      value(
        await onboarding.verification(verifier, org, {
          kind: 'domain',
          assetId: evidence.id,
          approved: true,
          expiresAt: time(30 * 86400000),
          domain: sessions.get(handle)!.emailDomain,
        }),
      );
      value(await onboarding.decide(verifier, org, submitted.revision, true, 'synthetic_review'));
      value(await onboarding.activate(verifier, org, rev()));
    }
    return { org, handle, subject: sessions.get(handle)!.subject };
  }
  async function published(org: Id<'organization'>, handle: string) {
    const offer = uuid('partner_offer');
    value(await offers.draft(handle, org, offer, 1, offerBody(), [target()]));
    value(await offers.submit(handle, org, offer, 1));
    value(await offers.review(moderator, org, offer, 1, true, 'synthetic_review'));
    value(await offers.publish(moderator, org, offer, 1, null));
    return offer;
  }
  async function csvPool(
    org: Id<'organization'>,
    handle: string,
    offer: Id<'partner_offer'>,
    text = 'code\nSAVE1\nSAVE2',
  ) {
    const asset = value(
        await onboarding.upload(handle, org, 'coupon_pool', 'text/csv', enc.encode(text)),
      ),
      pool = uuid('coupon_pool');
    value(
      await coupons.pool(handle, org, {
        id: pool,
        offerId: offer,
        version: 1,
        mode: 'unique',
        assetId: asset.id,
        prefix: null,
        sharedCode: null,
      }),
    );
    const input = {
      key: uuid('command'),
      poolId: pool,
      assetId: asset.id,
      expiresAt: time(6 * 86400000),
    };
    const queued = value(await coupons.queue(handle, org, input));
    return { asset, pool, input, queued };
  }
  return {
    service,
    worker,
    d,
    w,
    crypto,
    sessions,
    session,
    hooks,
    objects,
    bytes,
    docs,
    policy,
    verifier,
    moderator,
    onboarding,
    offers,
    coupons,
    consumer,
    company,
    published,
    csvPool,
  };
}
