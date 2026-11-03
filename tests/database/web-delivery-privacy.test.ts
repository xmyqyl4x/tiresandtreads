import { beforeAll, afterAll, it, expect } from 'vitest';
import { operationsApiFixture } from '../fixtures/http/operations-api.ts';
import { emailControlRoutes } from '../fixtures/http/email-control-routes.ts';
import { deliveryPrivacyController } from '../../apps/web/src/delivery-privacy/controller.ts';
import { createDeliveryPrivacyClient } from '../../packages/contracts/src/delivery-privacy-client.ts';
import { uid } from '../fixtures/private/database.ts';
import type { Id } from '../../packages/domain/src/values/core.ts';
let f: Awaited<ReturnType<typeof operationsApiFixture>>;
beforeAll(async () => {
  f = await operationsApiFixture(emailControlRoutes);
}, 45000);
afterAll(async () => {
  await f?.cleanup();
});
type Session = Awaited<ReturnType<typeof f.session>>;
function transport(who?: Session): typeof fetch {
  return async (u, options = {}) => {
    const headers = new Headers(options.headers);
    headers.set('origin', f.server.origin);
    if (options.credentials === 'same-origin' && who) headers.set('cookie', who.cookie);
    return fetch(u, { ...options, headers });
  };
}
async function seed() {
  const who = await f.session(),
    report = await f.report(who);
  return {
    who,
    id: report.head.id,
    client: createDeliveryPrivacyClient(f.server.origin, transport(who)),
    controller: deliveryPrivacyController(f.server.origin, transport(who)),
  };
}
const key = () => uid('command');
const body = (report: string, email: string, offers = false) => ({
  email,
  report: { id: report, version: 1 },
  comparisonRevision: null,
  offers,
  notices: { report: f.notices.report, ...(offers ? { offers: f.notices.offers } : {}) },
});
async function proofs(who: Session) {
  const owner = await f.ownerIdentity(who),
    rows = await f.db.admin.query(
      'SELECT v.id,v.purpose FROM privacy.verification_challenges v JOIN privacy.contact_intents i ON i.challenge_id=v.id WHERE i.owner_subject_id=$1 ORDER BY v.id LIMIT 10',
      [owner.subjectId],
    );
  const result = new Map<string, { verificationToken: string; unsubscribeToken: string }>();
  for (const r of rows.rows) {
    const message = await f.contacts.verificationMessage(r.id as Id<'verification'>);
    if (!message.ok) throw Error('Missing synthetic inbox proof');
    result.set(r.purpose, message.value);
  }
  return result;
}
it('UC06 records report-only once through the typed controller, fixes the server 60-second deadline and grants no offers', async () => {
  const a = await seed(),
    input = { kind: 'delivery' as const, input: body(a.id, uid('address') + '@example.invalid') },
    first = await a.controller.submit(input);
  expect(first.kind).toBe('delivery');
  if (first.kind !== 'delivery') throw Error('Wrong receipt');
  const stored = await f.db.admin.query(
    'SELECT report_id,report_version,requested_purposes,extract(epoch from cancel_deadline-created_at)::int AS delay FROM email.email_sends WHERE id=$1',
    [first.view.id],
  );
  expect(stored.rows).toEqual([
    { report_id: a.id, report_version: 1, requested_purposes: ['report'], delay: 60 },
  ]);
  const before = await f.db.admin.query(
    'SELECT v.purpose FROM privacy.verification_challenges v JOIN privacy.contact_intents i ON i.challenge_id=v.id WHERE i.owner_subject_id=$1',
    [(await f.ownerIdentity(a.who)).subjectId],
  );
  expect(before.rows.map((x) => x.purpose)).toEqual(['report']);
  const replayKey = key(),
    b = body(a.id, uid('address') + '@example.invalid');
  expect((await a.client.deliver(b, a.who.csrf, replayKey)).id).toBe(
    (await a.client.deliver(b, a.who.csrf, replayKey)).id,
  );
  expect((await a.client.delivery(first.view.id)).state).toBe('scheduled');
  const foreign = createDeliveryPrivacyClient(f.server.origin, transport(await f.session()));
  await expect(foreign.delivery(first.view.id)).rejects.toMatchObject({ code: 'not_found' });
  expect(f.providerCalls()).toBe(0);
  expect(f.inbox).toHaveLength(0);
});
it('UC06/AT10 keeps offers-only independent and masks existing-address preferences', async () => {
  const a = await seed(),
    address = uid('address') + '@example.invalid';
  for (let i = 0; i < 2; i++)
    expect(
      (
        await a.controller.submit({
          kind: 'offers',
          input: {
            email: address,
            report: null,
            offers: true,
            notices: { offers: f.notices.offers },
          },
        })
      ).kind,
    ).toBe('offers');
  const owner = await f.ownerIdentity(a.who),
    sends = await f.db.admin.query(
      'SELECT count(*)::int AS n FROM email.email_sends WHERE owner_subject_id=$1',
      [owner.subjectId],
    );
  expect(sends.rows[0].n).toBe(0);
  const p = await proofs(a.who);
  expect([...p.keys()]).toEqual(['offers']);
  expect((await a.client.preferences(p.get('offers')!.unsubscribeToken)).status).toBe('pending');
  expect(f.providerCalls()).toBe(0);
});
it('AT07 preserves cancelled sends, uses CAS and refuses a missed cancellation deadline without pretending recall', async () => {
  const a = await seed(),
    v = await a.client.deliver(body(a.id, uid('address') + '@example.invalid'), a.who.csrf, key());
  const cancelled = await a.controller.cancel(v, 'cancel');
  expect(cancelled.state).toBe('cancelled');
  expect((await a.controller.cancel(v, 'cancel')).state).toBe('cancelled');
  const late = await a.client.deliver(
      body(a.id, uid('address') + '@example.invalid'),
      a.who.csrf,
      key(),
    ),
    owner = await f.ownerIdentity(a.who);
  const lateId = uid('send');
  // Insert one historical scheduled fixture; never disable guards or edit an existing send identity.
  const seeded = await f.db.admin.query(
    `INSERT INTO email.email_sends(id,kind,recipient_contact_id,owner_subject_id,report_id,report_version,comparison_revision,template_id,send_after,cancel_deadline,provider_key,provider,requested_purposes,notice_id,dispatch_policy_version,created_at)
     SELECT $3,kind,recipient_contact_id,owner_subject_id,report_id,report_version,comparison_revision,template_id,now()-interval '1 minute',now()-interval '1 minute',$4,provider,requested_purposes,notice_id,dispatch_policy_version,now()-interval '3 minutes'
     FROM email.email_sends WHERE id=$1 AND owner_subject_id=$2 AND dispatch_state='scheduled' RETURNING id`,
    [late.id, owner.subjectId, lateId, uid('provider-key')],
  );
  expect(seeded.rowCount).toBe(1);
  const past = await a.client.delivery(lateId);
  await expect(a.controller.cancel(past, 'cancel')).rejects.toMatchObject({ code: 'conflict' });
  expect((await a.client.delivery(lateId)).state).toBe('scheduled');
  expect(await a.client.delivery(late.id)).toEqual(late);
  expect(f.providerCalls()).toBe(0);
});
it('AT07 cancels before correction, invalidates pending wrong-address proofs and requires an explicit new request', async () => {
  const a = await seed(),
    old = await a.client.deliver(
      body(a.id, uid('wrong') + '@example.invalid', true),
      a.who.csrf,
      key(),
    ),
    links = await proofs(a.who);
  const before = await f.db.admin.query(
    'SELECT recipient_contact_id FROM email.email_sends WHERE id=$1',
    [old.id],
  );
  expect((await a.controller.cancel(old, 'correct_address')).state).toBe('cancelled');
  await expect(a.client.confirmation(links.get('offers')!.verificationToken)).rejects.toMatchObject(
    { code: 'not_found' },
  );
  await expect(a.client.confirmEmail(links.get('offers')!.verificationToken)).rejects.toMatchObject(
    { code: 'not_found' },
  );
  const count = await f.db.admin.query(
    'SELECT count(*)::int AS n FROM email.email_sends WHERE owner_subject_id=$1',
    [(await f.ownerIdentity(a.who)).subjectId],
  );
  expect(count.rows[0].n).toBe(1);
  const replacement = await a.client.deliver(
    body(a.id, uid('corrected') + '@example.invalid'),
    a.who.csrf,
    key(),
  );
  expect(replacement.id).not.toBe(old.id);
  const after = await f.db.admin.query(
    'SELECT recipient_contact_id FROM email.email_sends WHERE id=$1',
    [old.id],
  );
  expect(after.rows).toEqual(before.rows);
  expect(f.providerCalls()).toBe(0);
});
it('AT10/AT19 makes GET confirmation/preferences read-only and withdraws only the capability purpose without an account', async () => {
  const a = await seed(),
    v = await a.client.deliver(
      body(a.id, uid('address') + '@example.invalid', true),
      a.who.csrf,
      key(),
    ),
    links = await proofs(a.who),
    publicClient = createDeliveryPrivacyClient(f.server.origin, transport());
  const offers = links.get('offers')!,
    report = links.get('report')!;
  for (let i = 0; i < 2; i++) {
    expect((await publicClient.confirmation(offers.verificationToken)).status).toBe('pending');
    expect((await publicClient.preferences(offers.unsubscribeToken)).status).toBe('pending');
  }
  expect((await publicClient.confirmEmail(offers.verificationToken)).status).toBe('confirmed');
  expect((await publicClient.preferences(offers.unsubscribeToken)).status).toBe('confirmed');
  expect((await publicClient.withdraw(offers.unsubscribeToken)).status).toBe('withdrawn');
  expect((await publicClient.withdraw(offers.unsubscribeToken)).status).toBe('withdrawn');
  expect((await publicClient.preferences(report.unsubscribeToken)).status).toBe('pending');
  expect((await a.client.delivery(v.id)).state).toBe('scheduled');
  const owner = await f.ownerIdentity(a.who);
  await f.db.admin.query(
    "UPDATE privacy.verification_challenges v SET created_at=clock_timestamp()-interval '3 days',expires_at=clock_timestamp()-interval '1 day' FROM privacy.contact_intents i WHERE i.challenge_id=v.id AND i.owner_subject_id=$1 AND v.purpose='report'",
    [owner.subjectId],
  );
  await expect(publicClient.confirmation(report.verificationToken)).rejects.toMatchObject({
    code: 'not_found',
  });
  await expect(publicClient.confirmEmail(report.verificationToken)).rejects.toMatchObject({
    code: 'not_found',
  });
  expect(f.providerCalls()).toBe(0);
});
it('AT11/UC09 records owner rights idempotently, exposes a proof-bound masked status and masks email requests', async () => {
  const a = await seed(),
    requestKey = key(),
    input = { kind: 'access' as const, jurisdiction: 'synthetic' },
    r = await a.client.ownerRights(input, a.who.csrf, requestKey);
  expect(await a.client.ownerRights(input, a.who.csrf, requestKey)).toEqual(r);
  const publicClient = createDeliveryPrivacyClient(f.server.origin, transport()),
    status = await publicClient.privacyStatus(r.proof);
  expect(status).toMatchObject({ id: r.id, kind: 'access', status: 'verified', completedAt: null });
  expect(Date.parse(status.dueAt)).toBeGreaterThan(Date.now());
  expect(Object.keys(status).sort()).toEqual(['completedAt', 'dueAt', 'id', 'kind', 'status']);
  for (const address of [uid('known') + '@example.invalid', uid('unknown') + '@example.invalid'])
    expect(await publicClient.emailRights({ email: address, ...input })).toEqual({
      accepted: true,
    });
  const pending = await f.db.admin.query(
    "SELECT count(*)::int AS n FROM privacy.privacy_requests WHERE status='pending'",
  );
  expect(pending.rows[0].n).toBeGreaterThanOrEqual(2);
  expect(f.inbox).toHaveLength(0);
  expect(f.providerCalls()).toBe(0);
});

it('requires the synthetic inbox delivery record and an explicit POST before verifying email rights, without fulfilling them', async () => {
  const a = await seed(),
    email = uid('privacy') + '@example.invalid',
    publicClient = createDeliveryPrivacyClient(f.server.origin, transport());
  expect(
    await publicClient.emailRights({ email, kind: 'access', jurisdiction: 'synthetic' }),
  ).toEqual({ accepted: true });
  const row = (
    await f.db.admin.query(
      "SELECT r.id,w.proof_key_version FROM privacy.privacy_requests r JOIN privacy.request_work w ON w.request_id=r.id WHERE r.status='pending' AND r.encrypted_reply_context=$1",
      [Buffer.from(email)],
    )
  ).rows[0];
  expect(row).toBeTruthy();
  const delivered = await f.privacy.dispatchVerification(row.id as Id<'privacy_request'>);
  expect(delivered.ok).toBe(true);
  const inbox = f.inbox.find((x) => x.address === email);
  expect(inbox).toBeTruthy();
  expect((await publicClient.privacyStatus(inbox!.proof)).status).toBe('pending');
  expect(await publicClient.confirmPrivacy(inbox!.proof)).toEqual({ verified: true });
  expect(await publicClient.privacyStatus(inbox!.proof)).toMatchObject({
    id: row.id,
    status: 'verified',
    completedAt: null,
  });
  await expect(publicClient.confirmPrivacy(inbox!.proof)).rejects.toMatchObject({
    code: 'conflict',
  });
  expect(f.providerCalls()).toBe(0);
  expect(a.who.csrf).toBeTruthy();
});
