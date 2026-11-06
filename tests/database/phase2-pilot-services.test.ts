import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { pilotFixture } from '../fixtures/phase2/pilot-services.ts';
import { composePilot } from '../fixtures/phase2/compose-pilot.ts';
import { value, uuid } from '../fixtures/phase2/compose-partner-services.ts';
import { success } from '../fixtures/catalog/database.ts';
import { createPilotDeliveryServices } from '../../packages/application/src/partners/pilot-delivery.ts';
import { pilotCandidates } from '../../packages/db/src/repositories/pilot-candidates.ts';
import { createPilotRepository } from '../../packages/db/src/repositories/pilot-delivery.ts';
let f: Awaited<ReturnType<typeof pilotFixture>>, s: Awaited<ReturnType<typeof composePilot>>;
beforeAll(async () => {
  f = await pilotFixture();
  s = await composePilot(f);
}, 60000);
afterAll(async () => {
  await f?.cleanup();
  console.log(
    'P2_PILOT_SERVICE_EVIDENCE ' +
      JSON.stringify({
        actualPostgreSQL: true,
        migrations: 47,
        newTables: 5,
        nativeCases: 34,
        maximumOffers: 3,
        onePerSeller: true,
        recipientCalendarMonthLimit: 4,
        perOfferRollingDays: 30,
        candidateQueries: 3,
        encryptedLocation: true,
        frozenPrivatePayload: true,
        freshConnectionHandoffRecovery: true,
        provider: 'in-memory-synthetic-double',
        privateObjects: 'in-memory-byte-double',
        actualAuthenticationAccepted: false,
        actualS1Approval: false,
        actualS2Approval: false,
        actualPrivacyAcceptance: false,
        actualProviderPilotDeploymentAcceptance: false,
        productionBootstrapChanged: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}, 60000);
beforeEach(async () => {
  await f.admin.query("UPDATE partners.offers SET status='paused' WHERE status='active'");
  s.provider.send.mockClear();
  s.renderer.render.mockClear();
  delete s.hooks.render;
});
it('installs only the opt-in extension, with forced RLS and no direct contact or owner-session access', async () => {
  expect(f.pilotApplied).toBe(1);
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int n FROM pg_tables WHERE schemaname='partners' AND tablename LIKE 'pilot_%' AND rowsecurity",
      )
    ).rows[0]!.n,
  ).toBe(5);
  const r = await s.scope.unitOfWork.run(async (tx) => {
    await s.scope.query(tx, 'SELECT encrypted_email FROM privacy.contacts');
    return { ok: true, value: 0 };
  });
  expect(r.ok).toBe(false);
});
it.each(['shared', 'unique', 'generated'] as const)(
  'reserves and sends a %s coupon atomically with immutable audit and encrypted payload',
  async (mode) => {
    const o = await s.offer(mode),
      m = await s.message();
    expect(value(await s.service.dispatch(m.send))).toEqual({ state: 'accepted' });
    expect(s.provider.send).toHaveBeenCalledTimes(1);
    const p = s.provider.send.mock.calls[0]![1];
    expect(p.mail.commercial).toBe(true);
    expect(p.mail.text).toContain('Sponsored tire offer');
    expect(p.mail.unsubscribeUrl).toMatch(/^https:/);
    const row = (
      await f.admin.query('SELECT * FROM partners.pilot_work WHERE send_id=$1', [m.send])
    ).rows[0]!;
    expect(Buffer.from(row.payload).toString()).not.toContain('LOCAL-');
    const decoded = JSON.parse(
      new TextDecoder().decode(
        await s.encryption.decrypt(
          { keyVersion: row.payload_key_version, hex: row.payload.toString('hex') },
          'pilot_payload',
          m.send,
        ),
      ),
    );
    expect(decoded).toEqual(p);
    expect(
      (
        await f.admin.query('SELECT state FROM partners.coupon_reservations WHERE send_id=$1', [
          m.send,
        ])
      ).rows[0]!.state,
    ).toBe('issued');
    expect(
      (
        await f.admin.query(
          'SELECT consumed_units::text n FROM partners.offer_cap_windows WHERE org_id=$1',
          [o.org],
        )
      ).rows.map((r) => r.n),
    ).toEqual(['1', '1', '1']);
    expect(value(await s.service.dispatch(m.send))).toEqual({ state: 'idle' });
    await expect(
      f.admin.query('UPDATE partners.pilot_considerations SET score=0 WHERE send_id=$1', [m.send]),
    ).rejects.toMatchObject({ code: '23514' });
  },
);
it('preserves report-only delivery for an underage or unconfirmed-offers request', async () => {
  await s.offer();
  for (const opt of [{ adult: false }, { offers: false }]) {
    const m = await s.message(opt);
    value(await s.service.dispatch(m.send));
    expect(s.provider.send.mock.lastCall![1].mail.commercial).toBe(false);
    expect(s.provider.send.mock.lastCall![1].mail.text).not.toContain('Sponsored');
  }
  expect(s.provider.send.mock.calls.every((c) => c[1].mail.stream === 'report')).toBe(true);
});
it('removes offers after withdrawal during render and preserves the requested report', async () => {
  await s.offer();
  const m = await s.message();
  let once = true;
  s.hooks.render = async () => {
    if (once) {
      once = false;
      await s.consent(
        m.contact.value.subjectId,
        'offers',
        'offers',
        s.policy.offersNotice,
        'withdraw',
      );
    }
  };
  expect(value(await s.service.dispatch(m.send))).toEqual({ state: 'accepted' });
  expect(s.provider.send.mock.lastCall![1].mail.commercial).toBe(false);
  expect(
    (
      await f.admin.query('SELECT state FROM partners.coupon_reservations WHERE send_id=$1', [
        m.send,
      ])
    ).rows.every((r) => r.state === 'released'),
  ).toBe(true);
});
it('suppresses an offers-only message when permission is missing', async () => {
  await s.offer();
  const m = await s.message({ report: false, offers: false });
  expect(value(await s.service.dispatch(m.send))).toEqual({ state: 'suppressed' });
  expect(s.provider.send).not.toHaveBeenCalled();
});
it('rejects foreign owner keys and changed idempotent requests', async () => {
  const m = await s.message();
  expect(
    (
      await s.service.request(
        [{ keyVersion: 'test-hmac-v1', digest: '0'.repeat(64) }],
        m.send,
        m.request,
      )
    ).ok,
  ).toBe(false);
  expect(
    (await s.service.request([m.owner.token], m.send, { ...m.request, adult: false })).ok,
  ).toBe(false);
  expect((await s.service.request([m.owner.token], m.send, m.request)).ok).toBe(true);
});
it('allows only one worker to issue the last unique code', async () => {
  await s.offer('unique');
  const a = await s.message(),
    b = await s.message();
  const result = await Promise.all([s.service.dispatch(a.send), s.fresh().dispatch(b.send)]);
  expect(result.every((x) => x.ok)).toBe(true);
  expect(s.provider.send.mock.calls.filter((x) => x[1].mail.commercial)).toHaveLength(1);
});
it('allows only one worker to consume the last cap unit', async () => {
  await s.offer('shared', 1n);
  const a = await s.message(),
    b = await s.message();
  const result = await Promise.all([s.service.dispatch(a.send), s.fresh().dispatch(b.send)]);
  expect(result.every((x) => x.ok)).toBe(true);
  expect(s.provider.send.mock.calls.filter((x) => x[1].mail.commercial)).toHaveLength(1);
});
it('quarantines an ambiguous provider result without a retry or released counters', async () => {
  await s.offer('unique');
  const m = await s.message();
  s.provider.send.mockRejectedValueOnce(Error('synthetic private failure'));
  expect(value(await s.service.dispatch(m.send))).toEqual({ state: 'uncertain' });
  expect(
    (
      await f.admin.query(
        'SELECT code.state FROM partners.coupon_codes code JOIN partners.coupon_reservations a ON a.code_id=code.id WHERE a.send_id=$1',
        [m.send],
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await f.admin.query('SELECT state FROM partners.coupon_reservations WHERE send_id=$1', [
        m.send,
      ])
    ).rows[0]!.state,
  ).toBe('uncertain');
  expect(value(await s.fresh().dispatch(m.send))).toEqual({ state: 'idle' });
  expect(s.provider.send).toHaveBeenCalledTimes(1);
});
it('releases a definitive provider refusal exactly once', async () => {
  const o = await s.offer('unique'),
    m = await s.message();
  s.provider.send.mockResolvedValueOnce({ outcome: 'definitive_rejection', messageId: null });
  expect(value(await s.service.dispatch(m.send))).toEqual({ state: 'failed' });
  expect(
    (await f.admin.query('SELECT state FROM partners.coupon_codes WHERE pool_id=$1', [o.pool]))
      .rows[0]!.state,
  ).toBe('available');
  expect(
    (
      await f.admin.query(
        'SELECT consumed_units::text n FROM partners.offer_cap_windows WHERE org_id=$1',
        [o.org],
      )
    ).rows.every((r) => r.n === '0'),
  ).toBe(true);
});
it('keeps the recipient monthly limit across different report owners', async () => {
  let person: Awaited<ReturnType<typeof f.contact>> | undefined;
  for (let i = 0; i < 5; i++) {
    await f.admin.query("UPDATE partners.offers SET status='paused' WHERE status='active'");
    await s.offer();
    const m = await s.message(person ? { contact: person } : {});
    person = m.contact;
    value(await s.service.dispatch(m.send));
    expect(s.provider.send.mock.lastCall![1].mail.commercial).toBe(i < 4);
  }
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int n FROM partners.pilot_usage WHERE recipient_subject_id=$1 AND state='issued'",
        [person!.value.subjectId],
      )
    ).rows[0]!.n,
  ).toBe(4);
});
it('cancels only before handoff and the cancellation deadline', async () => {
  await s.offer();
  const m = await s.message({ due: false });
  expect((await s.service.cancel([m.owner.token], m.send)).ok).toBe(true);
  expect(value(await s.service.dispatch(m.send))).toEqual({ state: 'idle' });
  expect(s.provider.send).not.toHaveBeenCalled();
  const late = await s.message();
  expect((await s.service.cancel([late.owner.token], late.send)).ok).toBe(false);
});
it('stops on a global safety suppression committed during rendering', async () => {
  await s.offer();
  const m = await s.message();
  let once = true;
  s.hooks.render = async () => {
    if (once) {
      once = false;
      await success(f.scope.unitOfWork, (tx) =>
        f.privacy.suppress(tx, {
          subjectId: m.contact.value.subjectId,
          scope: 'all-email',
          reason: 'synthetic',
          expiresAt: null,
        }),
      );
    }
  };
  expect(value(await s.service.dispatch(m.send))).toEqual({ state: 'suppressed' });
  expect(s.provider.send).not.toHaveBeenCalled();
});
it('simulation is pure and independent of durable reservation state', async () => {
  const o = await s.offer(),
    m = await s.message();
  const lease = value(
    await s.scope.unitOfWork.run(async (tx) => ({
      ok: true,
      value: await s.repository.acquire(tx, m.send),
    })),
  )!;
  const c = await success(s.scope.unitOfWork, (tx) => s.repository.context(tx, lease, s.policy)),
    offers = await success(s.scope.unitOfWork, (tx) =>
      s.repository.candidates(tx, lease, s.policy),
    );
  expect(
    value(await s.service.simulate(c.audience, offers)).some(
      (d) => d.offerId === o.id && d.selected,
    ),
  ).toBe(true);
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM partners.coupon_reservations WHERE send_id=$1',
        [m.send],
      )
    ).rows[0]!.n,
  ).toBe(0);
  await success(s.scope.unitOfWork, (tx) => s.repository.retry(tx, lease));
});
it('stores precise targeting location only in a send-bound encrypted envelope', async () => {
  const m = await s.message(),
    stored = (
      await f.admin.query('SELECT geo::text geo FROM partners.pilot_requests WHERE send_id=$1', [
        m.send,
      ])
    ).rows[0]!.geo;
  expect(stored).not.toMatch(/90001|latitude|longitude|postal|region/);
  const box = JSON.parse(stored).box;
  expect(
    JSON.parse(new TextDecoder().decode(await s.encryption.decrypt(box, 'pilot_geo', m.send))),
  ).toEqual({ region: 'CA', postal: '90001', latitude: 34, longitude: -118 });
  await expect(s.encryption.decrypt(box, 'pilot_geo', uuid('send'))).rejects.toThrow();
});
it('preserves an original pending report grant but refuses an invalidated pending challenge', async () => {
  for (const invalid of [false, true]) {
    const m = await s.message({ pendingReport: true, offers: false });
    if (invalid)
      await f.admin.query(
        'UPDATE privacy.verification_challenges SET invalidated_at=clock_timestamp() WHERE id=$1',
        [m.challenge],
      );
    const before = s.provider.send.mock.calls.length;
    expect(value(await s.service.dispatch(m.send))).toEqual({
      state: invalid ? 'suppressed' : 'accepted',
    });
    expect(s.provider.send.mock.calls.length - before).toBe(invalid ? 0 : 1);
  }
});
it('refuses request quantity that disagrees with the immutable selected-plan quantity', async () => {
  await s.offer();
  const m = await s.message({ quantity: 2 });
  value(await s.service.dispatch(m.send));
  expect(s.provider.send.mock.lastCall![1].mail.commercial).toBe(false);
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM partners.coupon_reservations WHERE send_id=$1',
        [m.send],
      )
    ).rows[0]!.n,
  ).toBe(0);
});
it('rechecks separately withdrawn report permission and sends only the independently permitted offers', async () => {
  await s.offer();
  const m = await s.message();
  let once = true;
  s.hooks.render = async () => {
    if (once) {
      once = false;
      await s.consent(
        m.contact.value.subjectId,
        'report',
        m.reportScope,
        s.policy.reportNotice,
        'withdraw',
      );
    }
  };
  value(await s.service.dispatch(m.send));
  const mail = s.provider.send.mock.lastCall![1].mail;
  expect(mail.commercial).toBe(true);
  expect(mail.pdf).toBeNull();
  expect(mail.subject).toBe('Your tire offers');
});
it('drops an offer paused during rendering without losing the separately requested report', async () => {
  const o = await s.offer(),
    m = await s.message();
  let once = true;
  s.hooks.render = async () => {
    if (once) {
      once = false;
      await f.admin.query("UPDATE partners.offers SET status='paused' WHERE id=$1", [o.id]);
    }
  };
  value(await s.service.dispatch(m.send));
  expect(s.provider.send.mock.lastCall![1].mail.commercial).toBe(false);
  expect(
    (
      await f.admin.query('SELECT state FROM partners.coupon_reservations WHERE send_id=$1', [
        m.send,
      ])
    ).rows.every((r) => r.state === 'released'),
  ).toBe(true);
});
it('resumes the same held assignment through a fresh connection after a pre-handoff renderer interruption', async () => {
  const o = await s.offer('unique'),
    m = await s.message();
  s.renderer.render.mockRejectedValueOnce(Error('synthetic interruption'));
  expect((await s.service.dispatch(m.send)).ok).toBe(false);
  expect(s.provider.send).not.toHaveBeenCalled();
  const held = (
    await f.admin.query('SELECT id FROM partners.coupon_reservations WHERE send_id=$1', [m.send])
  ).rows[0]!.id;
  expect(value(await s.fresh().dispatch(m.send))).toEqual({ state: 'accepted' });
  expect(
    (
      await f.admin.query('SELECT id FROM partners.coupon_reservations WHERE send_id=$1', [m.send])
    ).rows.map((r) => r.id),
  ).toEqual([held]);
  expect(
    (
      await f.admin.query(
        'SELECT consumed_units::text n FROM partners.offer_cap_windows WHERE org_id=$1',
        [o.org],
      )
    ).rows.every((r) => r.n === '1'),
  ).toBe(true);
});
it('recovers a lost result write through a fresh connection as uncertain without another provider handoff', async () => {
  await s.offer('unique');
  const m = await s.message();
  const interrupted = createPilotDeliveryServices({
    ...s.deps,
    repository: {
      ...s.repository,
      async finish() {
        throw Error('synthetic outcome persistence interruption');
      },
    },
  });
  expect((await interrupted.dispatch(m.send)).ok).toBe(false);
  expect(s.provider.send).toHaveBeenCalledTimes(1);
  await f.admin.query(
    "UPDATE partners.pilot_work SET lease_until=clock_timestamp()-interval '1 second' WHERE send_id=$1",
    [m.send],
  );
  expect(value(await s.fresh().dispatch(m.send))).toEqual({ state: 'uncertain' });
  expect(s.provider.send).toHaveBeenCalledTimes(1);
  expect(
    (await f.admin.query('SELECT outcome FROM email.send_receipts WHERE send_id=$1', [m.send]))
      .rows[0]!.outcome,
  ).toBe('uncertain');
  expect(
    (
      await f.admin.query('SELECT state FROM partners.coupon_reservations WHERE send_id=$1', [
        m.send,
      ])
    ).rows[0]!.state,
  ).toBe('uncertain');
});
it('loads the whole candidate set with three bounded SQL queries', async () => {
  await s.offer();
  await s.offer();
  const m = await s.message();
  const lease = (await success(s.scope.unitOfWork, (tx) => s.repository.acquire(tx, m.send)))!;
  const c = await success(s.scope.unitOfWork, (tx) => s.repository.context(tx, lease, s.policy));
  let count = 0;
  const scope = {
    ...s.scope,
    query: ((...args: Parameters<typeof s.scope.query>) => {
      count++;
      return s.scope.query(...args);
    }) as typeof s.scope.query,
  };
  const rows = await success(s.scope.unitOfWork, (tx) => pilotCandidates(scope, tx, c, s.policy));
  expect(count).toBe(3);
  expect(rows.filter((r) => r.available)).toHaveLength(2);
  await success(s.scope.unitOfWork, (tx) => s.repository.retry(tx, lease));
});
it('rechecks current source rights after rendering and retains the separately permitted report', async () => {
  await s.offer();
  const m = await s.message();
  let changed: string[] = [];
  s.hooks.render = async () => {
    if (!changed.length)
      changed = (
        await f.admin.query(
          "UPDATE app.data_providers SET status='disabled' WHERE id IN(SELECT provider_id FROM app.dataset_versions d JOIN app.bundle_members b ON b.dataset_version_id=d.id WHERE b.bundle_id=$1) RETURNING id",
          [s.publication.bundleId],
        )
      ).rows.map((r) => r.id);
  };
  try {
    value(await s.service.dispatch(m.send));
    expect(s.provider.send.mock.lastCall![1].mail.commercial).toBe(false);
  } finally {
    if (changed.length)
      await f.admin.query(
        "UPDATE app.data_providers SET status='active' WHERE id=ANY($1::uuid[])",
        [changed],
      );
  }
});
it('keeps per-offer rolling frequency across owners and omits stale-month holds on resumed work', async () => {
  await s.offer();
  const a = await s.message();
  value(await s.service.dispatch(a.send));
  const b = await s.message({ contact: a.contact });
  value(await s.service.dispatch(b.send));
  expect(s.provider.send.mock.lastCall![1].mail.commercial).toBe(false);
  const c = await s.message();
  s.renderer.render.mockRejectedValueOnce(Error('synthetic pre-handoff interruption'));
  expect((await s.service.dispatch(c.send)).ok).toBe(false);
  await f.admin.query(
    "UPDATE partners.pilot_usage SET reserved_at=date_trunc('month',clock_timestamp())-interval '1 second' WHERE send_id=$1",
    [c.send],
  );
  value(await s.fresh().dispatch(c.send));
  expect(s.provider.send.mock.lastCall![1].mail.commercial).toBe(false);
  expect(
    (
      await f.admin.query('SELECT state FROM partners.coupon_reservations WHERE send_id=$1', [
        c.send,
      ])
    ).rows.every((r) => r.state === 'released'),
  ).toBe(true);
});
it('refuses dispatch under a different policy version than the immutable owner request', async () => {
  await s.offer();
  const m = await s.message();
  const changed = createPilotDeliveryServices({
    ...s.deps,
    policy: { ...s.policy, version: 'unreviewed-change' },
  });
  expect((await changed.dispatch(m.send)).ok).toBe(false);
  expect(s.provider.send).not.toHaveBeenCalled();
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM partners.coupon_reservations WHERE send_id=$1',
        [m.send],
      )
    ).rows[0]!.n,
  ).toBe(0);
});
it('resolves both distinct staggered axles from the immutable selected bundle', async () => {
  await s.offer();
  const m = await s.message({ axles: 'staggered' });
  const lease = (await success(s.scope.unitOfWork, (tx) => s.repository.acquire(tx, m.send)))!;
  const c = await success(s.scope.unitOfWork, (tx) => s.repository.context(tx, lease, s.policy));
  expect(c.audience.products.map((p) => p.skuId).sort()).toEqual([s.sku, s.rearSku].sort());
  await success(s.scope.unitOfWork, (tx) => s.repository.retry(tx, lease));
  value(await s.service.dispatch(m.send));
  expect(s.provider.send.mock.lastCall![1].mail.commercial).toBe(true);
});
it.each(['before allocation', 'during rendering'])(
  'refuses the entire selected product projection when rear rights are withdrawn %s',
  async (phase) => {
    const o = await s.offer(),
      m = await s.message({ axles: 'staggered' });
    let once = true;
    const withdraw = async () => {
      await f.admin.query(
        "UPDATE app.data_licenses SET rights=jsonb_set(rights,'{display}','false') WHERE id=$1",
        [s.rearLicense],
      );
    };
    try {
      if (phase === 'before allocation') await withdraw();
      else
        s.hooks.render = async () => {
          if (once) {
            once = false;
            await withdraw();
          }
        };
      value(await s.service.dispatch(m.send));
      expect(s.provider.send.mock.lastCall![1].mail.commercial).toBe(false);
      expect(
        (
          await f.admin.query('SELECT state FROM partners.coupon_reservations WHERE send_id=$1', [
            m.send,
          ])
        ).rows.every((r) => r.state === 'released'),
      ).toBe(true);
      expect(
        (
          await f.admin.query(
            'SELECT consumed_units::text n FROM partners.offer_cap_windows WHERE org_id=$1',
            [o.org],
          )
        ).rows.every((r) => r.n === '0'),
      ).toBe(true);
    } finally {
      await f.admin.query(
        "UPDATE app.data_licenses SET rights=jsonb_set(rights,'{display}','true') WHERE id=$1",
        [s.rearLicense],
      );
    }
  },
);
it('distinguishes an absent or explicitly null optional rear axle from an unresolved selected axle', async () => {
  await s.offer();
  for (const axles of ['single-absent', 'single-null'] as const) {
    const m = await s.message({ axles });
    const lease = (await success(s.scope.unitOfWork, (tx) => s.repository.acquire(tx, m.send)))!;
    const c = await success(s.scope.unitOfWork, (tx) => s.repository.context(tx, lease, s.policy));
    expect(c.audience.products.map((p) => p.skuId)).toEqual([s.sku]);
    await success(s.scope.unitOfWork, (tx) => s.repository.retry(tx, lease));
    value(await s.service.dispatch(m.send));
    expect(s.provider.send.mock.lastCall![1].mail.commercial).toBe(true);
  }
});
const capExpiryDelay =
  "SELECT pg_sleep(least(5,greatest(0,extract(epoch FROM(window_end-clock_timestamp())))+.05)) FROM partners.offer_cap_windows WHERE org_id=$1 AND kind='day' ORDER BY window_end DESC LIMIT 1";
async function expirePilotDay(org: string) {
  expect(
    (
      await f.admin.query(
        "SELECT id FROM partners.coupon_reservations WHERE org_id=$1 AND state='reserved'",
        [org],
      )
    ).rows,
  ).toHaveLength(1);
  await f.admin.query(capExpiryDelay, [org]);
}
async function nextPilotDay(org: string, offer: string) {
  return (
    await f.admin.query(
      "INSERT INTO partners.offer_cap_windows(org_id,offer_id,kind,policy_version,window_start,window_end,limit_units) VALUES($1,$2,'day',$3,clock_timestamp(),clock_timestamp()+interval '1 day',1) RETURNING id",
      [org, offer, s.policy.version],
    )
  ).rows[0]!.id;
}
it.each(['resumed work', 'rendering'])(
  'drops expired reserved cap identities after a daily window rollover during %s',
  async (phase) => {
    const o = await s.offer('unique', 100n, 5),
      m = await s.message();
    let replacement: string | undefined;
    if (phase === 'resumed work') {
      s.renderer.render.mockRejectedValueOnce(Error('synthetic pre-handoff interruption'));
      expect((await s.service.dispatch(m.send)).ok).toBe(false);
      await expirePilotDay(o.org);
      replacement = await nextPilotDay(o.org, o.id);
      value(await s.fresh().dispatch(m.send));
    } else {
      let once = true;
      s.hooks.render = async () => {
        if (once) {
          once = false;
          await expirePilotDay(o.org);
          replacement = await nextPilotDay(o.org, o.id);
        }
      };
      value(await s.service.dispatch(m.send));
    }
    expect(s.provider.send.mock.lastCall![1].mail.commercial).toBe(false);
    expect(s.provider.send).toHaveBeenCalledTimes(1);
    expect(
      (
        await f.admin.query('SELECT state FROM partners.coupon_reservations WHERE send_id=$1', [
          m.send,
        ])
      ).rows.every((r) => r.state === 'released'),
    ).toBe(true);
    expect(
      (
        await f.admin.query(
          'SELECT consumed_units::text n FROM partners.offer_cap_windows WHERE org_id=$1',
          [o.org],
        )
      ).rows.every((r) => r.n === '0'),
    ).toBe(true);
    delete s.hooks.render;
    const fresh = await s.message({ contact: m.contact });
    value(await s.fresh().dispatch(fresh.send));
    expect(s.provider.send.mock.lastCall![1].mail.commercial).toBe(true);
    expect(
      (
        await f.admin.query(
          'SELECT consumed_units::text n FROM partners.offer_cap_windows WHERE id=$1',
          [replacement],
        )
      ).rows[0]!.n,
    ).toBe('1');
  },
);
it('rechecks cap time at the SQL handoff marker after the final application-side read', async () => {
  const o = await s.offer('unique', 100n, 5),
    m = await s.message();
  let once = true;
  const query: typeof s.scope.query = async (...args) => {
    if (once && args[1].startsWith('UPDATE partners.pilot_work SET payload=')) {
      once = false;
      expect(
        (
          await s.scope.query(
            args[0],
            "SELECT id FROM partners.coupon_reservations WHERE org_id=$1 AND state='reserved'",
            [o.org],
          )
        ).rows,
      ).toHaveLength(1);
      // Keep this fixed test delay inside SQL; preserve the adapter's normal idle timeout.
      await s.scope.query(args[0], capExpiryDelay, [o.org]);
    }
    return s.scope.query(...args);
  };
  const service = createPilotDeliveryServices({
    ...s.deps,
    repository: createPilotRepository({ ...s.scope, query }),
  });
  value(await service.dispatch(m.send));
  expect(s.provider.send).toHaveBeenCalledTimes(1);
  expect(s.provider.send.mock.lastCall![1].mail.commercial).toBe(false);
  expect(
    (
      await f.admin.query('SELECT state FROM partners.coupon_reservations WHERE send_id=$1', [
        m.send,
      ])
    ).rows.every((r) => r.state === 'released'),
  ).toBe(true);
});
