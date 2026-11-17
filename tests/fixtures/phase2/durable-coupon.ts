import type { durablePhase2Fixture } from './durable-fixture.ts';
import type { openDurableHost } from './durable-host.ts';
import { value, uuid, rev, time, offerBody, target } from './compose-partner-services.ts';
export async function seedDurableCouponImport(
  fixture: Awaited<ReturnType<typeof durablePhase2Fixture>>,
  host: Awaited<ReturnType<typeof openDurableHost>>,
) {
  const { p, save } = fixture;
  const h = p.session();
  await save();
  const org = value(
    await host.services.onboarding.register(h, {
      key: uuid('command'),
      legalName: 'Local retained retailer',
      market: 'US',
    }),
  ).id;
  const profile = value(
    await host.services.onboarding.profile(h, org, rev(), ['sales', 'fitting']),
  );
  value(
    await host.services.onboarding.location(h, org, {
      key: 'main',
      region: 'CA',
      address: { line1: '1 Local Way', city: 'Example', country: 'US', postal: '90001' },
    }),
  );
  for (const kind of ['pilot_terms', 'privacy', 'dpa'] as const) {
    const a = value(
      await host.services.onboarding.upload(h, org, 'agreement', 'application/json', p.docs[kind]),
    );
    value(await host.services.onboarding.acceptAgreement(h, org, kind, a.id));
  }
  const submitted = value(await host.services.onboarding.submit(h, org, profile.revision)),
    evidence = value(
      await host.services.onboarding.upload(
        h,
        org,
        'verification',
        'application/json',
        new TextEncoder().encode('{"local":true}'),
      ),
    );
  value(
    await host.services.onboarding.verification(p.verifier, org, {
      kind: 'domain',
      assetId: evidence.id,
      approved: true,
      expiresAt: time(86400000),
      domain: 'synthetic.example',
    }),
  );
  value(
    await host.services.onboarding.decide(
      p.verifier,
      org,
      submitted.revision,
      true,
      'synthetic_review',
    ),
  );
  value(await host.services.onboarding.activate(p.verifier, org, rev()));
  const offer = uuid('partner_offer');
  value(await host.services.offers.draft(h, org, offer, 1, offerBody(), [target()]));
  value(await host.services.offers.submit(h, org, offer, 1));
  value(await host.services.offers.review(p.moderator, org, offer, 1, true, 'synthetic_review'));
  value(await host.services.offers.publish(p.moderator, org, offer, 1, null));
  const source = value(
      await host.services.onboarding.upload(
        h,
        org,
        'coupon_pool',
        'text/csv',
        new TextEncoder().encode('code\nRETAINED1\nRETAINED2\nRETAINED1'),
      ),
    ),
    pool = uuid('coupon_pool');
  value(
    await host.services.coupons.pool(h, org, {
      id: pool,
      offerId: offer,
      version: 1,
      mode: 'unique',
      assetId: source.id,
      prefix: null,
      sharedCode: null,
    }),
  );
  const input = {
      key: uuid('command'),
      poolId: pool,
      assetId: source.id,
      expiresAt: time(86400000),
    },
    queued = value(await host.services.coupons.queue(h, org, input));
  return { h, org, offer, source, pool, input, queued };
}
