import { createPartnerCouponServices } from '../../packages/application/src/partners/partner-coupons.ts';
import { beforeAll, afterAll, it, expect } from 'vitest';
import {
  partnerServiceFixture,
  partnerServiceSources,
} from '../fixtures/phase2/partner-services.ts';
import { migrateApplication } from '../../scripts/database/migrate.ts';
import {
  composePartnerServices,
  value,
  uuid,
  rev,
  time,
  offerBody,
  target,
} from '../fixtures/phase2/compose-partner-services.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
let f: Awaited<ReturnType<typeof partnerServiceFixture>>;
let s: Awaited<ReturnType<typeof composePartnerServices>>;
beforeAll(async () => {
  f = await partnerServiceFixture();
  s = await composePartnerServices(f);
}, 60000);
afterAll(async () => {
  await f?.cleanup();
  console.log(
    'PARTNER_SERVICE_NATIVE_EVIDENCE ' +
      JSON.stringify({
        actualPostgreSQL: true,
        optInMigrations: 46,
        optInTables: 191,
        nativeCases: 47,
        maxImportedCodes: 100000,
        overflowRowRefused: 100001,
        privateObjects: 'in-memory-byte-double',
        syntheticAuthority: true,
        actualAuthenticationAccepted: false,
        actualS1Approval: false,
        actualS2Approval: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}, 60000);
it('installs 46 opt-in migrations without changing the default manifest and replays without DDL', async () => {
  expect(f.serviceApplied).toBe(1);
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int n FROM pg_tables WHERE schemaname NOT IN('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_%'",
      )
    ).rows[0]?.n,
  ).toBe(191);
  expect(await migrateApplication(f.target, partnerServiceSources().sources)).toBe(0);
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM migration_meta.applied')).rows[0]?.n,
  ).toBe(46);
});
it('onboards only with current three agreements, independent evidence, approved location and fresh MFA', async () => {
  const c = await s.company();
  const state = value(await s.onboarding.status(c.handle, c.org));
  expect(state.organization.status).toBe('active');
  expect(state.organization.verification).toBe('verified');
  expect(state.member?.status).toBe('active');
  expect(state.profile?.state).toBe('approved');
  const audit = value(await s.onboarding.audit(c.handle, c.org));
  expect(audit.length).toBeGreaterThan(10);
  expect(JSON.stringify(audit)).not.toContain(c.subject);
  expect(Object.keys(audit[0]!)).toEqual(['id', 'action', 'resource', 'result', 'occurredAt']);
});
it('denies activation and serving for pending organizations', async () => {
  const c = await s.company(false);
  expect((await s.onboarding.activate(s.verifier, c.org, rev())).ok).toBe(false);
  const offer = uuid('partner_offer');
  value(await s.offers.draft(c.handle, c.org, offer, 1, offerBody(), [target()]));
  expect(value(await s.offers.preview(c.handle, c.org, offer, 1)).text).toContain(
    'unavailable for serving',
  );
  expect((await s.offers.submit(c.handle, c.org, offer, 1)).ok).toBe(false);
});
it('replays registration only with the same command body and owner', async () => {
  const h = s.session(),
    input = { key: uuid('command'), legalName: 'Synthetic replay', market: 'US' as const },
    a = value(await s.onboarding.register(h, input));
  expect(value(await s.onboarding.register(h, input)).id).toBe(a.id);
  expect((await s.onboarding.register(h, { ...input, legalName: 'Changed' })).ok).toBe(false);
});
it.each(['unknown', 'expired', 'old_mfa', 'unverified'])(
  'denies %s authentication before a write',
  async (kind) => {
    const h = s.session(),
      p = s.sessions.get(h)!;
    if (kind === 'unknown') s.sessions.delete(h);
    else
      s.sessions.set(h, {
        ...p,
        ...(kind === 'expired'
          ? { expiresAt: time(-1000) }
          : kind === 'old_mfa'
            ? { mfaAt: time(-600000) }
            : { emailVerified: false as never }),
      });
    expect(
      (await s.onboarding.register(h, { key: uuid('command'), legalName: 'Denied', market: 'US' }))
        .ok,
    ).toBe(false);
  },
);
it('does not accept arbitrary self-authored agreement bytes', async () => {
  const c = await s.company(false),
    a = value(
      await s.onboarding.upload(
        c.handle,
        c.org,
        'agreement',
        'application/json',
        new TextEncoder().encode('{"not":"terms"}'),
      ),
    );
  expect((await s.onboarding.acceptAgreement(c.handle, c.org, 'pilot_terms', a.id)).ok).toBe(false);
});
it('rejects incomplete and stale onboarding submissions atomically', async () => {
  const h = s.session(),
    org = value(
      await s.onboarding.register(h, {
        key: uuid('command'),
        legalName: 'Incomplete',
        market: 'US',
      }),
    ).id;
  expect((await s.onboarding.submit(h, org, rev())).ok).toBe(false);
  expect(value(await s.onboarding.status(h, org)).profile?.state).toBe('draft');
  const c = await s.company(false);
  expect((await s.onboarding.decide(s.verifier, c.org, rev(), true, 'synthetic_review')).ok).toBe(
    false,
  );
});
it('requires current staff permissions and a reviewer independent from the organization', async () => {
  const c = await s.company(false),
    p = s.sessions.get(c.handle)!;
  s.sessions.set(c.handle, { ...p, staffId: s.sessions.get(s.verifier)!.staffId });
  expect((await s.onboarding.decide(c.handle, c.org, rev(3), true, 'synthetic_review')).ok).toBe(
    false,
  );
  const inv = value(
    await s.onboarding.invite(c.handle, c.org, s.sessions.get(s.verifier)!.subject, 'manager'),
  );
  value(await s.onboarding.acceptInvite(s.verifier, c.org, inv.token));
  expect((await s.onboarding.decide(s.verifier, c.org, rev(3), true, 'synthetic_review')).ok).toBe(
    false,
  );
});
it('requires an explicit reviewed public-email override', async () => {
  const h = s.session(undefined, null, 'gmail.com'),
    c = await s.company(false, h);
  expect((await s.onboarding.decide(s.verifier, c.org, rev(3), true, 'manual_review')).ok).toBe(
    false,
  );
  value(await s.onboarding.decide(s.verifier, c.org, rev(3), true, 'manual_review', true));
  const a = value(
    await s.onboarding.upload(
      h,
      c.org,
      'verification',
      'application/json',
      new TextEncoder().encode('{"review":"manual"}'),
    ),
  );
  value(
    await s.onboarding.verification(s.verifier, c.org, {
      kind: 'manual',
      assetId: a.id,
      approved: true,
      expiresAt: time(86400000),
      domain: 'retailer.example',
    }),
  );
  expect(value(await s.onboarding.activate(s.verifier, c.org, rev())).status).toBe('active');
  const offer = await s.published(c.org, h);
  expect(value(await s.offers.preview(h, c.org, offer, 1)).text).toContain('Offer preview');
  await f.admin.query("UPDATE partners.organization_domains SET status='revoked' WHERE org_id=$1", [
    c.org,
  ]);
  expect(value(await s.offers.preview(h, c.org, offer, 1)).text).toContain(
    'unavailable for serving',
  );
});
it('binds invitations to the target identity, expiry and a single use without sending email', async () => {
  const c = await s.company(),
    h = s.session(),
    p = s.sessions.get(h)!,
    inv = value(await s.onboarding.invite(c.handle, c.org, p.subject, 'manager'));
  expect((await s.onboarding.acceptInvite(s.session(), c.org, inv.token)).ok).toBe(false);
  value(await s.onboarding.acceptInvite(h, c.org, inv.token));
  expect((await s.onboarding.acceptInvite(h, c.org, inv.token)).ok).toBe(false);
  expect((await s.onboarding.invite(h, c.org, 'other', 'analyst')).ok).toBe(false);
  expect(
    (
      await f.admin.query('SELECT token_hash FROM partners.membership_invites WHERE id=$1', [
        inv.id,
      ])
    ).rows[0]?.token_hash,
  ).not.toBe(inv.token);
  expect(value(await s.onboarding.status(h, c.org)).member?.role).toBe('manager');
});
it('denies expired invites and preserves the final owner', async () => {
  const c = await s.company(),
    h = s.session(),
    inv = value(await s.onboarding.invite(c.handle, c.org, s.sessions.get(h)!.subject, 'analyst'));
  await f.admin.query(
    "UPDATE partners.membership_invites SET expires_at=created_at+interval '1 millisecond',created_at=clock_timestamp()-interval '1 day' WHERE id=$1",
    [inv.id],
  );
  expect((await s.onboarding.acceptInvite(h, c.org, inv.token)).ok).toBe(false);
  expect(
    (await s.onboarding.member(c.handle, c.org, c.subject, rev(2), 'analyst', 'active')).ok,
  ).toBe(false);
});
it('keeps tenant, analyst, manager and revoked privileges separate', async () => {
  const a = await s.company(),
    b = await s.company(),
    h = s.session();
  expect((await s.onboarding.status(a.handle, b.org)).ok).toBe(false);
  const inv = value(
    await s.onboarding.invite(a.handle, a.org, s.sessions.get(h)!.subject, 'analyst'),
  );
  value(await s.onboarding.acceptInvite(h, a.org, inv.token));
  expect(
    (await s.offers.draft(h, a.org, uuid('partner_offer'), 1, offerBody(), [target()])).ok,
  ).toBe(false);
  expect((await s.onboarding.audit(h, a.org)).ok).toBe(false);
  value(
    await s.onboarding.member(
      a.handle,
      a.org,
      s.sessions.get(h)!.subject,
      rev(),
      'manager',
      'active',
    ),
  );
  value(await s.offers.draft(h, a.org, uuid('partner_offer'), 1, offerBody(), [target()]));
  value(
    await s.onboarding.member(
      a.handle,
      a.org,
      s.sessions.get(h)!.subject,
      rev(2),
      'manager',
      'revoked',
    ),
  );
  expect((await s.onboarding.status(h, a.org)).ok).toBe(false);
});
it('publishes independently reviewed versions and preserves live v1 while v2 is drafted', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle);
  expect(
    (
      await f.admin.query(
        'SELECT version FROM partners.eligible_offer_versions WHERE offer_id=$1',
        [offer],
      )
    ).rows[0]?.version,
  ).toBe(1);
  value(
    await s.offers.draft(c.handle, c.org, offer, 2, { ...offerBody(), title: 'Revised terms' }, [
      target(),
    ]),
  );
  expect(
    (
      await f.admin.query(
        'SELECT version FROM partners.eligible_offer_versions WHERE offer_id=$1',
        [offer],
      )
    ).rows[0]?.version,
  ).toBe(1);
  value(await s.offers.submit(c.handle, c.org, offer, 2));
  value(await s.offers.review(s.moderator, c.org, offer, 2, true, 'synthetic_review'));
  expect((await s.offers.publish(s.moderator, c.org, offer, 2, null)).ok).toBe(false);
  value(await s.offers.publish(s.moderator, c.org, offer, 2, 1));
  expect(
    (
      await f.admin.query(
        'SELECT version FROM partners.eligible_offer_versions WHERE offer_id=$1',
        [offer],
      )
    ).rows[0]?.version,
  ).toBe(2);
});
it('rejects self review, unverified redirect domains and cross-organization target locations', async () => {
  const c = await s.company(),
    b = await s.company(),
    offer = uuid('partner_offer');
  expect(
    (
      await s.offers.draft(
        c.handle,
        c.org,
        offer,
        1,
        {
          ...offerBody(),
          redemptionMethod: 'link',
          redemptionDomain: 'unverified.example',
          redemptionUrl: 'https://unverified.example/deal',
        },
        [target()],
      )
    ).ok,
  ).toBe(false);
  value(await s.offers.draft(c.handle, c.org, offer, 1, offerBody(), [target()]));
  value(await s.offers.submit(c.handle, c.org, offer, 1));
  expect((await s.offers.review(c.handle, c.org, offer, 1, true, 'self_review')).ok).toBe(false);
  const location = (
    await f.admin.query('SELECT id FROM partners.locations WHERE org_id=$1', [b.org])
  ).rows[0]!.id;
  expect(
    (
      await s.offers.draft(c.handle, c.org, uuid('partner_offer'), 1, offerBody(), [
        { ...target(), locationId: location },
      ])
    ).ok,
  ).toBe(false);
});
it('returns rejected moderation to draft without overwriting immutable versions', async () => {
  const c = await s.company(),
    offer = uuid('partner_offer');
  value(await s.offers.draft(c.handle, c.org, offer, 1, offerBody(), [target()]));
  value(await s.offers.submit(c.handle, c.org, offer, 1));
  value(await s.offers.review(s.moderator, c.org, offer, 1, false, 'needs_review'));
  expect(
    (await f.admin.query('SELECT status FROM partners.offer_versions WHERE offer_id=$1', [offer]))
      .rows[0]?.status,
  ).toBe('draft');
  expect((await s.offers.draft(c.handle, c.org, offer, 1, offerBody(), [target()])).ok).toBe(false);
});
it('stops serving immediately on suspension, expiry, pause and closure', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle);
  value(await s.onboarding.lifecycle(s.verifier, c.org, rev(2), 'suspended', 'review'));
  expect(
    (
      await f.admin.query('SELECT 1 FROM partners.eligible_offer_versions WHERE offer_id=$1', [
        offer,
      ])
    ).rowCount,
  ).toBe(0);
  expect((await s.offers.draft(c.handle, c.org, offer, 2, offerBody(), [target()])).ok).toBe(false);
  value(await s.onboarding.lifecycle(s.verifier, c.org, rev(3), 'active', 'review'));
  value(await s.offers.pause(c.handle, c.org, offer));
  expect(
    (
      await f.admin.query('SELECT 1 FROM partners.eligible_offer_versions WHERE offer_id=$1', [
        offer,
      ])
    ).rowCount,
  ).toBe(0);
  value(await s.onboarding.lifecycle(c.handle, c.org, rev(4), 'closed', 'owner_request'));
  expect((await s.onboarding.invite(c.handle, c.org, 'next', 'manager')).ok).toBe(false);
});
it('reauthorizes after preview rendering and private upload I/O', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle);
  s.hooks.preview = async () => {
    await f.admin.query(
      "UPDATE partners.memberships SET status='revoked',revision=revision+1 WHERE org_id=$1",
      [c.org],
    );
  };
  try {
    expect((await s.offers.preview(c.handle, c.org, offer, 1)).ok).toBe(false);
  } finally {
    delete s.hooks.preview;
  }
  const b = await s.company();
  s.hooks.put = async () => {
    await f.admin.query(
      "UPDATE partners.organizations SET status='closed',revision=revision+1 WHERE id=$1",
      [b.org],
    );
  };
  try {
    expect(
      (
        await s.onboarding.upload(
          b.handle,
          b.org,
          'coupon_pool',
          'text/csv',
          new TextEncoder().encode('code\nA'),
        )
      ).ok,
    ).toBe(false);
  } finally {
    delete s.hooks.put;
  }
  expect(
    (
      await f.admin.query(
        "SELECT 1 FROM partners.organization_assets WHERE org_id=$1 AND purpose='coupon_pool' AND state='ready'",
        [b.org],
      )
    ).rowCount,
  ).toBe(0);
});
it('imports, deduplicates, encrypts, atomically publishes and restricts coupon reveal', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    q = await s.csvPool(c.org, c.handle, offer, 'code\nSAVE1\nSAVE1\nSave2'),
    lease = value(await s.consumer.lease(q.queued.jobId));
  expect(lease).not.toBeNull();
  expect(
    (await f.admin.query('SELECT 1 FROM partners.coupon_codes WHERE pool_id=$1', [q.pool]))
      .rowCount,
  ).toBe(0);
  const r = value(await s.consumer.process(lease!));
  expect(r).toMatchObject({ state: 'ready', through: 3, accepted: 2, duplicates: 1, rejected: 0 });
  expect(value(await s.coupons.queue(c.handle, c.org, q.input)).id).toBe(r.id);
  expect((await s.coupons.queue(c.handle, c.org, { ...q.input, expiresAt: time() })).ok).toBe(
    false,
  );
  const codes = (
    await f.admin.query(
      "SELECT id,encode(encrypted_code,'hex') AS cipher FROM partners.coupon_codes WHERE pool_id=$1 ORDER BY id",
      [q.pool],
    )
  ).rows;
  expect(codes).toHaveLength(2);
  expect(codes[0]!.cipher).not.toContain(Buffer.from('SAVE1').toString('hex'));
  expect(['SAVE1', 'Save2']).toContain(
    value(await s.coupons.reveal(c.handle, c.org, codes[0]!.id)).code,
  );
  expect(value(await s.coupons.statistics(c.handle, c.org, q.pool))).toEqual({
    total: 2,
    available: 2,
    low: false,
  });
  expect(
    (await f.admin.query('SELECT 1 FROM partners.coupon_import_rows WHERE import_id=$1', [r.id]))
      .rowCount,
  ).toBe(0);
  expect(await s.consumer.lease(q.queued.jobId)).toEqual(ok(null));
});
it('rejects the whole coupon pool for invalid rows without leaking raw values', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    q = await s.csvPool(c.org, c.handle, offer, 'code\nVALID\n=SUM(A1)\n"unclosed');
  const r = value(await s.consumer.process(value(await s.consumer.lease(q.queued.jobId))!));
  expect(r).toMatchObject({ state: 'rejected', accepted: 1, rejected: 2 });
  expect(JSON.stringify(r.errors)).not.toContain('SUM');
  expect(
    (await f.admin.query('SELECT 1 FROM partners.coupon_codes WHERE pool_id=$1', [q.pool]))
      .rowCount,
  ).toBe(0);
  expect(value(await s.coupons.status(c.handle, c.org, q.queued.id)).state).toBe('rejected');
  const report = value(await s.coupons.errorReport(c.handle, c.org, q.queued.id));
  expect(report.csv).toContain('invalid_code');
  expect(report.csv).not.toContain('SUM');
});
it.each(['bad_header', 'checksum', 'missing_source'])(
  'fails closed for %s coupon sources',
  async (kind) => {
    const c = await s.company(),
      offer = await s.published(c.org, c.handle),
      q = await s.csvPool(c.org, c.handle, offer, kind === 'bad_header' ? 'other\nA' : 'code\nA');
    if (kind === 'checksum') s.bytes.set(q.asset.id, new TextEncoder().encode('code\nB'));
    if (kind === 'missing_source') s.bytes.delete(q.asset.id);
    const result = await s.consumer.process(value(await s.consumer.lease(q.queued.jobId))!);
    expect(
      kind === 'missing_source'
        ? result.ok === false
        : result.ok && result.value.state === 'rejected',
    ).toBe(true);
    expect(
      (await f.admin.query('SELECT 1 FROM partners.coupon_codes WHERE pool_id=$1', [q.pool]))
        .rowCount,
    ).toBe(0);
  },
);
it('denies suspended/revoked import authority and permits only a fresh fenced restart', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    q = await s.csvPool(c.org, c.handle, offer);
  const old = value(await s.consumer.lease(q.queued.jobId))!;
  await f.admin.query('UPDATE partners.memberships SET revision=revision+1 WHERE org_id=$1', [
    c.org,
  ]);
  expect((await s.consumer.process(old)).ok).toBe(false);
  expect((await s.coupons.reauthorize(c.handle, c.org, q.queued.id, uuid('command'))).ok).toBe(
    false,
  );
  await f.admin.query(
    "UPDATE app.job_runs SET state='failed',lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp() WHERE id=$1",
    [old.id],
  );
  const resumed = value(await s.coupons.reauthorize(c.handle, c.org, q.queued.id, uuid('command')));
  expect(resumed.jobId).not.toBe(old.id);
  expect((await s.consumer.process(old)).ok).toBe(false);
  expect(value(await s.consumer.process(value(await s.consumer.lease(resumed.jobId))!)).state).toBe(
    'ready',
  );
});
it('denies coupon reads to analysts and other tenants and rechecks after decryption', async () => {
  const c = await s.company(),
    other = await s.company(),
    offer = await s.published(c.org, c.handle),
    q = await s.csvPool(c.org, c.handle, offer);
  value(await s.consumer.process(value(await s.consumer.lease(q.queued.jobId))!));
  const code = (
      await f.admin.query('SELECT id FROM partners.coupon_codes WHERE pool_id=$1 LIMIT 1', [q.pool])
    ).rows[0]!.id,
    h = s.session(),
    inv = value(await s.onboarding.invite(c.handle, c.org, s.sessions.get(h)!.subject, 'analyst'));
  value(await s.onboarding.acceptInvite(h, c.org, inv.token));
  expect((await s.coupons.reveal(h, c.org, code)).ok).toBe(false);
  expect((await s.coupons.status(h, c.org, q.queued.id)).ok).toBe(false);
  expect((await s.coupons.reveal(other.handle, other.org, code)).ok).toBe(false);
  expect(value(await s.coupons.statistics(h, c.org, q.pool)).total).toBe(2);
});
it('bounds private uploads, denies file polyglots and reports low pools without notifications', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    q = await s.csvPool(c.org, c.handle, offer, 'code\nA');
  value(await s.consumer.process(value(await s.consumer.lease(q.queued.jobId))!));
  await f.admin.query("UPDATE partners.coupon_codes SET state='issued' WHERE pool_id=$1", [q.pool]);
  expect(value(await s.coupons.statistics(c.handle, c.org, q.pool)).low).toBe(true);
  expect(
    (
      await s.onboarding.upload(
        c.handle,
        c.org,
        'logo',
        'image/svg+xml',
        new TextEncoder().encode('<svg/>'),
      )
    ).ok,
  ).toBe(false);
  expect(
    (await s.onboarding.upload(c.handle, c.org, 'agreement', 'application/json', new Uint8Array()))
      .ok,
  ).toBe(false);
});
it('imports the full 100000-code boundary off the request path', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    q = await s.csvPool(
      c.org,
      c.handle,
      offer,
      'code\n' + Array.from({ length: 100000 }, (_, i) => 'BOUNDARY' + i).join('\n'),
    );
  expect(q.queued.through).toBe(0);
  const r = value(await s.consumer.process(value(await s.consumer.lease(q.queued.jobId))!));
  expect(r).toMatchObject({ state: 'ready', accepted: 100000, through: 100000 });
  expect(
    (
      await f.admin.query('SELECT count(*)::int n FROM partners.coupon_codes WHERE pool_id=$1', [
        q.pool,
      ])
    ).rows[0]?.n,
  ).toBe(100000);
}, 120000);

it('preserves a committed checkpoint across a failed batch and dedupes across restart boundaries', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    q = await s.csvPool(
      c.org,
      c.handle,
      offer,
      'code\n' + Array.from({ length: 500 }, (_, i) => 'RESUME' + i).join('\n') + '\nRESUME0',
    ),
    lease = value(await s.consumer.lease(q.queued.jobId))!;
  let batches = 0;
  const broken = createPartnerCouponServices({
    ...s.w,
    coupons: {
      ...s.w.coupons,
      async stage(...args) {
        const r = await s.w.coupons.stage(...args);
        if (++batches === 2) throw Error('Synthetic interrupted transaction');
        return r;
      },
    },
  });
  expect((await broken.process(lease)).ok).toBe(false);
  expect(value(await s.coupons.status(c.handle, c.org, q.queued.id))).toMatchObject({
    through: 500,
    accepted: 500,
    state: 'processing',
  });
  expect(
    (await f.admin.query('SELECT 1 FROM partners.coupon_codes WHERE pool_id=$1', [q.pool]))
      .rowCount,
  ).toBe(0);
  await f.admin.query(
    "UPDATE app.job_runs SET state='failed',lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp() WHERE id=$1",
    [lease.id],
  );
  const resumed = value(await s.coupons.reauthorize(c.handle, c.org, q.queued.id, uuid('command')));
  expect(
    value(await s.consumer.process(value(await s.consumer.lease(resumed.jobId))!)),
  ).toMatchObject({ state: 'ready', through: 501, accepted: 500, duplicates: 1 });
});
it('does not misclassify a missing encryption key as a malformed CSV', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    q = await s.csvPool(c.org, c.handle, offer),
    lease = value(await s.consumer.lease(q.queued.jobId))!,
    broken = createPartnerCouponServices({
      ...s.w,
      crypto: {
        ...s.crypto,
        seal() {
          throw Error('Synthetic missing retained key');
        },
      },
    });
  expect((await broken.process(lease)).ok).toBe(false);
  expect(value(await s.coupons.status(c.handle, c.org, q.queued.id))).toMatchObject({
    state: 'queued',
    through: 0,
    errors: [],
  });
});
it('rechecks organization authority after source reads before any staged/final publication', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    q = await s.csvPool(c.org, c.handle, offer),
    lease = value(await s.consumer.lease(q.queued.jobId))!;
  s.hooks.get = async () => {
    await f.admin.query(
      "UPDATE partners.organizations SET status='suspended',revision=revision+1 WHERE id=$1",
      [c.org],
    );
  };
  try {
    expect((await s.consumer.process(lease)).ok).toBe(false);
  } finally {
    delete s.hooks.get;
  }
  expect(
    (await f.admin.query('SELECT 1 FROM partners.coupon_codes WHERE pool_id=$1', [q.pool]))
      .rowCount,
  ).toBe(0);
});
it('withholds decrypted plaintext when fresh authentication is revoked', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    q = await s.csvPool(c.org, c.handle, offer);
  value(await s.consumer.process(value(await s.consumer.lease(q.queued.jobId))!));
  const code = (
    await f.admin.query('SELECT id FROM partners.coupon_codes WHERE pool_id=$1 LIMIT 1', [q.pool])
  ).rows[0]!.id;
  const denied = createPartnerCouponServices({
    ...s.d,
    crypto: {
      ...s.crypto,
      open(...args) {
        const r = s.crypto.open(...args);
        s.sessions.delete(c.handle);
        return r;
      },
    },
  });
  const r = await denied.reveal(c.handle, c.org, code);
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain('SAVE1');
  expect(
    (
      await f.admin.query(
        "SELECT 1 FROM partners.organization_audit WHERE org_id=$1 AND action='coupon.reveal'",
        [c.org],
      )
    ).rowCount,
  ).toBe(0);
});
it('supports shared and generated pool admission without exposing encrypted material or triggering delivery', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle);
  for (const mode of ['shared', 'generated'] as const) {
    const id = uuid('coupon_pool');
    expect(
      value(
        await s.coupons.pool(c.handle, c.org, {
          id,
          offerId: offer,
          version: 1,
          mode,
          assetId: null,
          prefix: mode === 'generated' ? 'LOCAL' : null,
          sharedCode: mode === 'shared' ? 'SHARED-SECRET' : null,
        }),
      ),
    ).toEqual({ id });
    const r = (
      await f.admin.query(
        "SELECT state,encode(encrypted_shared_code,'hex') AS box FROM partners.coupon_pools WHERE id=$1",
        [id],
      )
    ).rows[0]!;
    expect(r.state).toBe('ready');
    if (mode === 'shared') {
      expect(r.box).not.toContain(Buffer.from('SHARED-SECRET').toString('hex'));
      expect(value(await s.coupons.revealShared(c.handle, c.org, id)).code).toBe('SHARED-SECRET');
    }
  }
});
it('honors rejected verification and expired evidence without serving older approved records', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    a = value(
      await s.onboarding.upload(
        c.handle,
        c.org,
        'verification',
        'application/json',
        new TextEncoder().encode('{"review":"rejected"}'),
      ),
    );
  value(
    await s.onboarding.verification(s.verifier, c.org, {
      kind: 'manual',
      assetId: a.id,
      approved: false,
      expiresAt: time(),
      domain: null,
    }),
  );
  expect(
    (
      await f.admin.query('SELECT 1 FROM partners.eligible_offer_versions WHERE offer_id=$1', [
        offer,
      ])
    ).rowCount,
  ).toBe(0);
  expect(value(await s.onboarding.status(c.handle, c.org)).organization).toMatchObject({
    status: 'suspended',
    verification: 'rejected',
  });
});
it('denies mutation/secret read privileges outside the fixed service and worker capabilities', async () => {
  const worker = f.servicePool('tt_p2_coupon_worker'),
    service = f.servicePool('tt_p2_partner_service');
  for (const sql of [
    "UPDATE partners.organizations SET status='closed' WHERE false",
    "UPDATE app.object_assets SET state='deleted' WHERE false",
    'SELECT * FROM admin.staff_identities',
    'CREATE TABLE partners.forbidden_service_table(id int)',
  ])
    await expect(worker.query(sql)).rejects.toMatchObject({ code: '42501' });
  await expect(
    service.query("UPDATE partners.coupon_codes SET state='issued' WHERE false"),
  ).rejects.toMatchObject({ code: '42501' });
  const c = await s.company();
  await expect(
    f.admin.query(
      "UPDATE partners.onboarding_profiles SET email_domain='other.example' WHERE org_id=$1",
      [c.org],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    f.admin.query("UPDATE partners.organization_audit SET result='succeeded' WHERE org_id=$1", [
      c.org,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('rejects row 100001 after staging without exposing any final code', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    q = await s.csvPool(
      c.org,
      c.handle,
      offer,
      'code\n' + Array.from({ length: 100001 }, (_, i) => 'OVERFLOW' + i).join('\n'),
    );
  const r = value(await s.consumer.process(value(await s.consumer.lease(q.queued.jobId))!));
  expect(r.state).toBe('rejected');
  expect(r.errors.at(-1)?.reason).toBe('malformed_csv');
  expect(
    (await f.admin.query('SELECT 1 FROM partners.coupon_codes WHERE pool_id=$1', [q.pool]))
      .rowCount,
  ).toBe(0);
  expect(
    (await f.admin.query('SELECT 1 FROM partners.coupon_import_rows WHERE import_id=$1', [r.id]))
      .rowCount,
  ).toBe(0);
}, 120000);

it('refuses stale agreement policy versions before activation or reviewed publication', async () => {
  const c = await s.company(),
    offer = uuid('partner_offer');
  value(await s.offers.draft(c.handle, c.org, offer, 1, offerBody(), [target()]));
  value(await s.offers.submit(c.handle, c.org, offer, 1));
  const { createPartnerOfferServices } =
    await import('../../packages/application/src/partners/partner-offers.ts');
  const newer = createPartnerOfferServices({
    ...s.d,
    policy: {
      ...s.policy,
      agreements: {
        ...s.policy.agreements,
        pilot_terms: { ...s.policy.agreements.pilot_terms, version: 'v2' },
      },
    },
  });
  expect((await newer.review(s.moderator, c.org, offer, 1, true, 'review')).ok).toBe(false);
  expect(
    (await f.admin.query('SELECT status FROM partners.offer_versions WHERE offer_id=$1', [offer]))
      .rows[0]?.status,
  ).toBe('pending_review');
});
it('allows private repair evidence during suspension while keeping serving and non-repair uploads denied', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle);
  value(await s.onboarding.lifecycle(s.verifier, c.org, rev(2), 'expired', 'expired_evidence'));
  const a = value(
    await s.onboarding.upload(
      c.handle,
      c.org,
      'verification',
      'application/json',
      new TextEncoder().encode('{"review":"renewal"}'),
    ),
  );
  expect(a.state).toBe('ready');
  expect(
    (
      await s.onboarding.upload(
        c.handle,
        c.org,
        'coupon_pool',
        'text/csv',
        new TextEncoder().encode('code\nX'),
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await f.admin.query('SELECT 1 FROM partners.eligible_offer_versions WHERE offer_id=$1', [
        offer,
      ])
    ).rowCount,
  ).toBe(0);
});

it('does not let another manager renew the original requester MFA authority', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    q = await s.csvPool(c.org, c.handle, offer),
    manager = s.session(),
    invite = value(
      await s.onboarding.invite(c.handle, c.org, s.sessions.get(manager)!.subject, 'manager'),
    );
  value(await s.onboarding.acceptInvite(manager, c.org, invite.token));
  const before = (await f.admin.query('SELECT count(*)::int n FROM app.job_runs')).rows[0]!.n;
  expect((await s.coupons.reauthorize(manager, c.org, q.queued.id, uuid('command'))).ok).toBe(
    false,
  );
  expect(
    (await f.admin.query('SELECT job_id FROM partners.coupon_imports WHERE id=$1', [q.queued.id]))
      .rows[0]?.job_id,
  ).toBe(q.queued.jobId);
  expect((await f.admin.query('SELECT count(*)::int n FROM app.job_runs')).rows[0]!.n).toBe(before);
});

it('does not replace an active owner through a new team invitation', async () => {
  const c = await s.company(),
    h = s.session(),
    subject = s.sessions.get(h)!.subject,
    invite = value(await s.onboarding.invite(c.handle, c.org, subject, 'manager'));
  value(await s.onboarding.acceptInvite(h, c.org, invite.token));
  value(await s.onboarding.member(c.handle, c.org, subject, rev(), 'owner', 'active'));
  expect((await s.onboarding.invite(c.handle, c.org, subject, 'analyst')).ok).toBe(false);
  expect(value(await s.onboarding.status(h, c.org)).member?.role).toBe('owner');
});

it('snapshots Buffer upload bytes before asynchronous authority and database admission', async () => {
  const c = await s.company(),
    source = Buffer.from('code\nBEFORE'),
    expected = new Uint8Array(source),
    pending = s.onboarding.upload(c.handle, c.org, 'coupon_pool', 'text/csv', source);
  source.fill(88);
  const asset = value(await pending);
  expect(await s.objects.get(asset)).toEqual(expected);
  expect(asset.sha256).toBe(s.crypto.checksum(expected));
});

it('lets a current owner close its organization even when its identity also has an unrelated staff profile', async () => {
  const c = await s.company(),
    staffId = uuid('staff');
  await f.admin.query(
    "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$2,'active',clock_timestamp())",
    [staffId, c.subject],
  );
  s.sessions.set(c.handle, { ...s.sessions.get(c.handle)!, staffId });
  const r = await s.onboarding.lifecycle(c.handle, c.org, rev(2), 'closed', 'owner_request');
  expect(r.ok).toBe(true);
  expect(value(await s.onboarding.status(c.handle, c.org)).organization.status).toBe('closed');
});

it('review regression: renews expired same-version agreements without losing original acceptance evidence', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    before = (
      await f.admin.query(
        "SELECT * FROM partners.agreements WHERE org_id=$1 AND kind='pilot_terms'",
        [c.org],
      )
    ).rows[0]!;
  await f.admin.query(
    "UPDATE app.object_assets SET expires_at=clock_timestamp()+interval '50 milliseconds' WHERE id=$1",
    [before.asset_id],
  );
  await f.admin.query('SELECT pg_sleep(0.1)');
  expect(value(await s.offers.preview(c.handle, c.org, offer, 1)).text).toContain(
    'unavailable for serving',
  );
  const asset = value(
    await s.onboarding.upload(c.handle, c.org, 'agreement', 'application/json', s.docs.pilot_terms),
  );
  value(await s.onboarding.acceptAgreement(c.handle, c.org, 'pilot_terms', asset.id));
  expect(value(await s.offers.preview(c.handle, c.org, offer, 1)).text).toContain('Offer preview');
  expect(
    (await f.admin.query('SELECT * FROM partners.agreements WHERE id=$1', [before.id])).rows[0],
  ).toEqual(before);
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM partners.agreement_renewals WHERE org_id=$1',
        [c.org],
      )
    ).rows[0]?.n,
  ).toBe(1);
  value(await s.onboarding.acceptAgreement(c.handle, c.org, 'pilot_terms', asset.id));
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM partners.agreement_renewals WHERE org_id=$1',
        [c.org],
      )
    ).rows[0]?.n,
  ).toBe(1);
  await expect(
    f.admin.query('UPDATE partners.agreement_renewals SET document_sha256=$2 WHERE org_id=$1', [
      c.org,
      '0'.repeat(64),
    ]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('review regression: previews only the requested eligible offer version', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle);
  value(
    await s.offers.draft(
      c.handle,
      c.org,
      offer,
      2,
      { ...offerBody(), title: 'Replacement draft' },
      [target()],
    ),
  );
  expect(value(await s.offers.preview(c.handle, c.org, offer, 2)).text).toContain(
    'Draft preview — unavailable for serving',
  );
  expect(value(await s.offers.preview(c.handle, c.org, offer, 1)).text).toContain('Offer preview');
  value(await s.offers.submit(c.handle, c.org, offer, 2));
  value(await s.offers.review(s.moderator, c.org, offer, 2, true, 'reviewed'));
  value(await s.offers.publish(s.moderator, c.org, offer, 2, 1));
  expect(value(await s.offers.preview(c.handle, c.org, offer, 1)).text).toContain(
    'Draft preview — unavailable for serving',
  );
  expect(value(await s.offers.preview(c.handle, c.org, offer, 2)).text).toContain('Offer preview');
});
it('review regression: requires a successful review newer than rejection before either reactivation path', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    asset = value(
      await s.onboarding.upload(
        c.handle,
        c.org,
        'verification',
        'application/json',
        new TextEncoder().encode('{"review":"fresh synthetic review"}'),
      ),
    );
  value(
    await s.onboarding.verification(s.verifier, c.org, {
      kind: 'manual',
      assetId: asset.id,
      approved: false,
      expiresAt: time(),
      domain: null,
    }),
  );
  expect((await s.onboarding.activate(s.verifier, c.org, rev(3))).ok).toBe(false);
  expect((await s.onboarding.lifecycle(s.verifier, c.org, rev(3), 'active', 'reviewed')).ok).toBe(
    false,
  );
  expect(
    (
      await f.admin.query('SELECT 1 FROM partners.eligible_offer_versions WHERE offer_id=$1', [
        offer,
      ])
    ).rowCount,
  ).toBe(0);
  value(
    await s.onboarding.verification(s.verifier, c.org, {
      kind: 'manual',
      assetId: asset.id,
      approved: true,
      expiresAt: time(),
      domain: null,
    }),
  );
  value(await s.onboarding.activate(s.verifier, c.org, rev(3)));
  expect(value(await s.offers.preview(c.handle, c.org, offer, 1)).text).toContain('Offer preview');
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int n FROM partners.verification_records WHERE org_id=$1 AND status='rejected'",
        [c.org],
      )
    ).rows[0]?.n,
  ).toBe(1);
});
it('review regression: rechecks the onboarding domain for in-store offers despite valid manual evidence', async () => {
  const c = await s.company(),
    offer = await s.published(c.org, c.handle),
    asset = value(
      await s.onboarding.upload(
        c.handle,
        c.org,
        'verification',
        'application/json',
        new TextEncoder().encode('{"review":"independent manual evidence"}'),
      ),
    );
  value(
    await s.onboarding.verification(s.verifier, c.org, {
      kind: 'manual',
      assetId: asset.id,
      approved: true,
      expiresAt: time(),
      domain: 'different.example',
    }),
  );
  expect(value(await s.offers.preview(c.handle, c.org, offer, 1)).text).toContain('Offer preview');
  await f.admin.query(
    "UPDATE partners.organization_domains SET expires_at=created_at+interval '1 millisecond' WHERE org_id=$1 AND domain='synthetic.example'",
    [c.org],
  );
  const eligible = async () =>
    (
      await f.admin.query('SELECT 1 FROM partners.eligible_offer_versions WHERE offer_id=$1', [
        offer,
      ])
    ).rowCount;
  expect(await eligible()).toBe(0);
  expect(value(await s.offers.preview(c.handle, c.org, offer, 1)).text).toContain(
    'unavailable for serving',
  );
  expect(value(await s.onboarding.status(c.handle, c.org)).organization).toMatchObject({
    status: 'active',
    verification: 'verified',
  });
  await f.admin.query(
    "UPDATE partners.organization_domains SET expires_at=clock_timestamp()+interval '1 day' WHERE org_id=$1 AND domain='synthetic.example'",
    [c.org],
  );
  expect(await eligible()).toBe(1);
  await f.admin.query(
    "UPDATE partners.organization_domains SET status='revoked' WHERE org_id=$1 AND domain='synthetic.example'",
    [c.org],
  );
  expect(await eligible()).toBe(0);
});
