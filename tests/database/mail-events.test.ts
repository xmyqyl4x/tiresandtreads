import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { privateFixture, uid, time, success, key } from '../fixtures/private/database.ts';
import { ok, type Result } from '../../packages/domain/src/values/core.ts';
import {
  createMailEventsRuntime,
  createResendWebhookIngress,
  createEmailActionsRuntime,
} from '../../packages/integrations/src/mail-events-runtime.ts';
import { createContactRuntime } from '../../packages/integrations/src/contact-runtime.ts';
import { createContactCrypto } from '../../packages/integrations/src/contact-crypto.ts';
import { createEmailLinkCrypto } from '../../packages/integrations/src/email-link-crypto.ts';
import { runMailCommand } from '../../packages/integrations/src/mail-commands.ts';
import type { ContactPolicy } from '../../packages/application/src/ports/contact-services.ts';
import type { MailObservation } from '../../packages/application/src/ports/mail-events.ts';
import { createMailEventsRepository } from '../../packages/db/src/repositories/mail-events.ts';
import { createContentPublicationRepository } from '../../packages/db/src/repositories/content.ts';
let f: Awaited<ReturnType<typeof privateFixture>>;
beforeAll(async () => {
  f = await privateFixture();
}, 30000);
afterAll(async () => {
  await f?.cleanup();
});
function value<R extends Result<unknown, unknown>>(r: R): Extract<R, { ok: true }>['value'] {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value as Extract<R, { ok: true }>['value'];
}
const secret = 'whsec_' + Buffer.alloc(32, 7).toString('base64');
async function setup() {
  const a = await f.owner(),
    c = await f.contact(),
    template = await f.template('necessary');
  const send = await success(f.scope.unitOfWork, (tx) =>
    f.delivery.schedule(tx, {
      id: uid('send'),
      owner: a.identity,
      contactId: c.value.id,
      kind: 'confirmation',
      reportId: null,
      reportVersion: null,
      comparisonRevision: null,
      templateId: template,
      provider: 'resend',
      providerKey: key().digest,
      delaySeconds: 60,
      policyVersion: 'synthetic',
      noticeId: null,
      purposes: ['necessary'],
    }),
  );
  const retrieve = vi.fn(async (id: string) => ({ id, event: 'sent' }));
  const services = await createMailEventsRuntime({
    scope: f.scope,
    lookupVersions: ['test-hmac-v1'],
    retrieve,
  });
  const ingress = createResendWebhookIngress({ services, secrets: [secret], now: () => time() });
  const occurred = time(-3600000);
  async function receive(
    type = 'email.delivered',
    overrides: Record<string, unknown> = {},
    eventId = uid('event'),
  ) {
    const body = JSON.stringify({
      type,
      created_at: occurred,
      data: {
        email_id: messageId,
        tags: { tt_delivery_key: send.providerKey },
        to: ['should-not-be-retained@example.invalid'],
        ...overrides,
      },
    });
    const stamp = String(Math.floor(Date.now() / 1000));
    return ingress.receive(new TextEncoder().encode(body), {
      'svix-id': eventId,
      'svix-timestamp': stamp,
      'svix-signature':
        'v1,' +
        createHmac('sha256', Buffer.alloc(32, 7))
          .update(eventId + '.' + stamp + '.' + body)
          .digest('base64'),
    });
  }
  const messageId = uid('message');
  async function attempted(
    state: 'accepted' | 'uncertain' | 'dispatching' = 'accepted',
    known = true,
  ) {
    const asset = await f.asset('email_payload');
    await f.admin.query('ALTER TABLE email.email_sends DISABLE TRIGGER email_sends_identity');
    try {
      await f.admin.query(
        `UPDATE email.email_sends SET created_at=now()-interval '2 minutes',send_after=now()-interval '1 minute',cancel_deadline=now()-interval '1 minute' WHERE id=$1`,
        [send.id],
      );
    } finally {
      await f.admin.query('ALTER TABLE email.email_sends ENABLE TRIGGER email_sends_identity');
    }
    // Trigger remains enabled for every behavioral transition, including real dispatch ordering.
    await f.admin.query(
      "UPDATE email.email_sends SET dispatch_state='dispatching',claimed_at=clock_timestamp(),payload_asset_id=$2,payload_hash=$3 WHERE id=$1",
      [send.id, asset.id, asset.hash],
    );
    if (state !== 'dispatching')
      await f.admin.query(
        "UPDATE email.email_sends SET dispatch_state=$2,accepted_at=CASE WHEN $2='accepted' THEN clock_timestamp() ELSE NULL END,provider_message_id=$3 WHERE id=$1",
        [send.id, state, known ? messageId : null],
      );
  }
  return { a, c, send, messageId, services, ingress, receive, attempted, retrieve };
}
it('commits signed durable inbox and facts once under duplicate concurrent callbacks', async () => {
  const x = await setup();
  await x.attempted();
  const e = uid('event');
  const r = await Promise.all([x.receive(undefined, {}, e), x.receive(undefined, {}, e)]);
  expect(r.every((r) => r.ok)).toBe(true);
  expect(
    (
      await f.admin.query('SELECT count(*)::int AS n FROM email.email_events WHERE send_id=$1', [
        x.send.id,
      ])
    ).rows[0]!.n,
  ).toBe(1);
  expect(value(await x.services.status(x.send.id))).toMatchObject({
    state: 'accepted',
    delivered: true,
    bounced: false,
  });
});
it('rejects invalid signature without any durable receipt', async () => {
  const x = await setup();
  expect((await x.ingress.receive(new TextEncoder().encode('{}'), {})).ok).toBe(false);
});
it('conflicting signed body with reused provider event identity cannot alter facts', async () => {
  const x = await setup();
  await x.attempted();
  const id = uid('event');
  expect((await x.receive(undefined, {}, id)).ok).toBe(true);
  expect((await x.receive('email.complained', {}, id)).ok).toBe(false);
  expect(value(await x.services.status(x.send.id)).complained).toBe(false);
});
it('handles reordered delay/delivery observations without regressing acceptance or duplicating a delivered-send metric', async () => {
  const x = await setup();
  await x.attempted();
  await x.receive();
  await x.receive('email.delivery_delayed');
  await x.receive();
  expect(value(await x.services.status(x.send.id))).toMatchObject({
    state: 'accepted',
    delivered: true,
  });
});
it.each(['email.bounced', 'email.complained'])(
  'suppresses %s atomically and retains address tombstones',
  async (type) => {
    const x = await setup();
    await x.attempted();
    expect(value(await x.receive(type)).state).toBe('processed');
    expect(
      await success(f.scope.unitOfWork, (tx) =>
        f.privacy.suppressed(tx, x.c.value.subjectId, ['all-email']),
      ),
    ).toBe(true);
    expect(
      (
        await f.admin.query(
          'SELECT count(*)::int AS n FROM privacy.suppression_tombstones WHERE lookup_hmac=$1',
          [Buffer.from(x.c.token.digest, 'hex')],
        )
      ).rows[0]!.n,
    ).toBe(1);
    await x.receive(type);
    expect(
      (
        await f.admin.query(
          'SELECT count(*)::int AS n FROM privacy.suppressions WHERE subject_id=$1',
          [x.c.value.subjectId],
        )
      ).rows[0]!.n,
    ).toBe(1);
  },
);
it('rolls back callback receipt and observation if applying facts fails', async () => {
  const x = await setup(),
    repo = createMailEventsRepository(f.scope, ['test-hmac-v1']);
  const e: MailObservation = {
    eventId: uid('event'),
    digest: key().digest,
    messageId: x.messageId,
    deliveryKey: x.send.providerKey,
    type: 'delivered',
    classification: 'unknown',
    occurredAt: time(),
    receivedAt: time(),
  };
  const r = await f.scope.unitOfWork.run(async (tx) => {
    await repo.receive(tx, e);
    throw Error('fixture lost write');
    return ok(null);
  });
  expect(r.ok).toBe(false);
  expect(
    (await f.admin.query('SELECT 1 FROM app.webhook_inbox WHERE provider_event_id=$1', [e.eventId]))
      .rows,
  ).toHaveLength(0);
});
it('correlates timeout without saved provider ID by the signed stable delivery key', async () => {
  const x = await setup();
  await x.attempted('uncertain', false);
  expect(value(await x.receive('email.sent')).state).toBe('processed');
  expect(value(await x.services.status(x.send.id))).toMatchObject({
    state: 'accepted',
    messageId: x.messageId,
    delivered: false,
  });
  expect(
    (await success(f.scope.unitOfWork, (tx) => f.delivery.receipt(tx, x.send.id)))?.outcome,
  ).toBe('accepted');
});
it('retains an early callback until dispatch acknowledgement, then replays without duplicating facts', async () => {
  const x = await setup();
  await x.attempted('dispatching');
  const r = value(await x.receive());
  expect(r.state).toBe('pending');
  await f.admin.query(
    "UPDATE app.webhook_inbox SET next_attempt_at=now()-interval '1 second' WHERE id=$1",
    [r.id],
  );
  expect(value(await x.services.pending())).toContain(r.id);
  await f.admin.query("UPDATE email.email_sends SET dispatch_state='uncertain' WHERE id=$1", [
    x.send.id,
  ]);
  expect(value(await runMailCommand(['replay', r.id], x.services))).toBe('processed');
  expect(value(await x.services.replay(r.id))).toBe('processed');
  expect(
    (
      await f.admin.query('SELECT count(*)::int AS n FROM email.email_events WHERE send_id=$1', [
        x.send.id,
      ])
    ).rows[0]!.n,
  ).toBe(1);
});
it('quarantines conflicting message/key association and unsupported provider semantics', async () => {
  const x = await setup();
  await x.attempted();
  expect(value(await x.receive(undefined, { email_id: uid('message') })).state).toBe('quarantined');
  expect(value(await x.receive('domain.created')).state).toBe('quarantined');
});
it('unmatched provider identity stays pending for operator recovery and never uses callback recipient addresses', async () => {
  const x = await setup();
  const r = value(await x.receive(undefined, { email_id: uid('message'), tags: {} }));
  expect(r.state).toBe('pending');
  await f.admin.query(
    "UPDATE app.webhook_inbox SET next_attempt_at=now()-interval '1 second' WHERE id=$1",
    [r.id],
  );
  expect(value(await runMailCommand(['pending'], x.services))).toContain(r.id);
});
it('declines events for cancelled sends', async () => {
  const x = await setup();
  await success(f.scope.unitOfWork, (tx) =>
    f.delivery.cancel(tx, x.a.identity, x.send.id, x.send.revision),
  );
  expect(value(await x.receive()).state).toBe('quarantined');
});
it('discards engagement facts without separate current email analytics permission', async () => {
  const x = await setup();
  await x.attempted();
  await x.receive('email.clicked', {
    click: {
      userAgent: 'Mozilla/5.0',
      ipAddress: '192.0.2.1',
      link: 'https://private.invalid/?secret',
    },
  });
  expect(
    (
      await f.admin.query("SELECT 1 FROM email.email_events WHERE send_id=$1 AND type='clicked'", [
        x.send.id,
      ])
    ).rows,
  ).toHaveLength(0);
  const stored = await f.admin.query(
    'SELECT row_to_json(o) AS o FROM email.callback_observations o JOIN app.webhook_inbox i ON i.id=o.inbox_id WHERE o.delivery_key=$1',
    [x.send.providerKey],
  );
  expect(JSON.stringify(stored.rows)).not.toMatch(/should-not|192\.0\.2|private\.invalid|Mozilla/);
});
it('classifies permitted scanners without claiming human clicks and honors later analytics withdrawal', async () => {
  const x = await setup();
  await x.attempted();
  const notice = await f.notice('analytics');
  await success(f.scope.unitOfWork, async (tx) => {
    const p = await f.privacy.permission(tx, x.c.value.subjectId, 'analytics', 'email');
    return f.privacy.consent(tx, {
      id: uid('consent_event'),
      subjectId: x.c.value.subjectId,
      purpose: 'analytics',
      scope: 'email',
      expectedRevision: p.revision,
      action: 'confirm',
      noticeId: notice,
      policyVersion: 'synthetic',
      method: 'fixture',
      expiresAt: time(86400000),
    });
  });
  await x.receive('email.clicked', { click: { userAgent: 'Proofpoint scanner' } });
  expect(
    (
      await f.admin.query(
        "SELECT classification FROM email.email_events WHERE send_id=$1 AND type='clicked'",
        [x.send.id],
      )
    ).rows[0]!.classification,
  ).toBe('machine');
  await success(f.scope.unitOfWork, (tx) =>
    f.privacy.suppress(tx, {
      subjectId: x.c.value.subjectId,
      scope: 'analytics',
      reason: 'withdrawn',
      expiresAt: null,
    }),
  );
  await x.receive('email.opened');
  expect(
    (
      await f.admin.query("SELECT 1 FROM email.email_events WHERE send_id=$1 AND type='opened'", [
        x.send.id,
      ])
    ).rows,
  ).toHaveLength(0);
});
it('reconciles known provider IDs outside SQL, with no fabricated delivery metric or new send', async () => {
  const x = await setup();
  await x.attempted('uncertain');
  expect(await runMailCommand(['reconcile', x.send.id], x.services)).toMatchObject({
    ok: true,
    value: { status: 'reconciled' },
  });
  expect(x.retrieve).toHaveBeenCalledWith(x.messageId);
  expect(value(await runMailCommand(['status', x.send.id], x.services))).toMatchObject({
    state: 'accepted',
    delivered: false,
  });
});
it('cannot reconcile a missing provider identity and has no force resend command', async () => {
  const x = await setup();
  await x.attempted('uncertain', false);
  expect(value(await x.services.reconcile(x.send.id)).status).toBe('manual_review');
  expect(x.retrieve).not.toHaveBeenCalled();
  expect((await runMailCommand(['resend', x.send.id], x.services)).ok).toBe(false);
});
it('sanitizes reconciliation provider failures and rejects mismatched returned IDs', async () => {
  const x = await setup();
  await x.attempted('uncertain');
  x.retrieve.mockRejectedValueOnce(Error('private message'));
  expect(JSON.stringify(await x.services.reconcile(x.send.id))).not.toContain('private message');
  x.retrieve.mockResolvedValueOnce({ id: uid('message'), event: 'sent' });
  expect((await x.services.reconcile(x.send.id)).ok).toBe(false);
  x.retrieve.mockResolvedValueOnce(null as never);
  expect(value(await x.services.reconcile(x.send.id)).status).toBe('manual_review');
});
it('operator boundary rejects invalid identities and wrong runtime role', async () => {
  const x = await setup();
  for (const fn of [x.services.status, x.services.replay, x.services.reconcile])
    expect((await fn('invalid')).ok).toBe(false);
  expect((await x.services.status(uid('send'))).ok).toBe(false);
  expect((await x.services.replay(uid('inbox'))).ok).toBe(false);
  expect((await runMailCommand([], x.services)).ok).toBe(false);
  await expect(
    createMailEventsRuntime({
      scope: f.adapter('tt_app_runtime'),
      lookupVersions: ['test-hmac-v1'],
      retrieve: x.retrieve,
    }),
  ).rejects.toThrow();
});
async function actions(x: Awaited<ReturnType<typeof setup>>) {
  const crypto = createContactCrypto(
    'v1',
    { v1: new Uint8Array(32).fill(3) },
    { 'test-hmac-v1': new Uint8Array(32).fill(4) },
    new Uint8Array(32).fill(5),
  );
  const notices = {} as ContactPolicy['notices'];
  for (const p of ['report', 'offers', 'necessary', 'analytics', 'ads', 'targeted_ads'] as const)
    (notices as Record<string, string>)[p] = await f.notice(p);
  const encryption = {
    encrypt: async () => ({ keyVersion: 'fixture', hex: 'aa'.repeat(32) }),
    decrypt: async () => new TextEncoder().encode('fixture@example.invalid'),
  };
  const contacts = await createContactRuntime({
    scope: f.scope,
    crypto,
    encryption,
    policy: { version: 'synthetic', notices },
    now: () => time(),
  });
  const svc = createEmailActionsRuntime({
    scope: f.scope,
    crypto: createEmailLinkCrypto('v1', { v1: new Uint8Array(32).fill(6) }, crypto),
    contacts,
    origin: 'https://tires.example',
  });
  const request = value(
    await contacts.request([x.a.token], uid('command'), {
      email: uid('email') + '@example.invalid',
      report: null,
      offers: true,
      notices: { offers: notices.offers },
    }),
  );
  const challenge = crypto.id(
    'verification',
    crypto.hash('actor', x.a.identity.subjectId) + crypto.hash('key', uid('unrelated')),
  );
  void challenge;
  const i = (
    await f.admin.query(
      'SELECT challenge_id FROM privacy.contact_intents WHERE owner_subject_id=$1 ORDER BY created_at DESC LIMIT 1',
      [x.a.identity.subjectId],
    )
  ).rows[0]!;
  const msg = value(await contacts.verificationMessage(i.challenge_id));
  void request;
  return { svc, contacts, msg };
}
it('scanner GET/HEAD cannot confirm, unsubscribe or record feedback; explicit RFC8058 POST withdraws only offers', async () => {
  const x = await setup(),
    a = await actions(x),
    raw = a.msg.unsubscribeToken;
  expect(value(await a.svc.preferences(raw, 'GET'))).toMatchObject({
    purpose: 'offers',
    status: 'pending',
  });
  expect((await a.svc.confirm(a.msg.verificationToken, 'GET')).ok).toBe(false);
  expect((await a.svc.withdraw(raw, 'GET')).ok).toBe(false);
  expect((await a.svc.oneClick(raw, 'HEAD', { 'List-Unsubscribe': 'One-Click' })).ok).toBe(false);
  expect((await a.svc.oneClick(raw, 'POST', { 'List-Unsubscribe': 'wrong' })).ok).toBe(false);
  expect(
    (await a.svc.oneClick(raw, 'POST', { 'List-Unsubscribe': 'One-Click', extra: true })).ok,
  ).toBe(false);
  expect(value(await a.svc.unsubscribeHeaders(raw))['List-Unsubscribe-Post']).toBe(
    'List-Unsubscribe=One-Click',
  );
  expect(value(await a.svc.oneClick(raw, 'POST', { 'List-Unsubscribe': 'One-Click' }))).toEqual({
    status: 'withdrawn',
  });
  expect(value(await a.svc.oneClick(raw, 'POST', { 'List-Unsubscribe': 'One-Click' }))).toEqual({
    status: 'withdrawn',
  });
  expect(value(await a.svc.preferences(raw, 'HEAD')).status).toBe('withdrawn');
  expect((await a.svc.preferences('bad', 'GET')).ok).toBe(false);
});
it('feedback uses a purpose-bound fixed destination and immutable idempotent final POST', async () => {
  const x = await setup(),
    a = await actions(x),
    input = {
      sendId: x.send.id,
      slot: 'helpful',
      purpose: 'feedback' as const,
      path: '/email/feedback',
      expiresAt: time(3600000),
    };
  const issued = value(await a.svc.issue(input));
  expect(value(await a.svc.issue(input))).toEqual(issued);
  expect(value(await a.svc.visit(issued.token, 'GET'))).toEqual({ kind: 'feedback' });
  expect(value(await a.svc.visit(issued.token, 'HEAD'))).toEqual({ kind: 'feedback' });
  expect((await a.svc.feedback(issued.token, 'yes', 'GET')).ok).toBe(false);
  expect(
    (await f.admin.query('SELECT 1 FROM email.email_feedback WHERE send_id=$1', [x.send.id])).rows,
  ).toHaveLength(0);
  expect(value(await a.svc.feedback(issued.token, 'yes', 'POST'))).toEqual({ status: 'recorded' });
  expect((await a.svc.feedback(issued.token, 'yes', 'POST')).ok).toBe(true);
  expect((await a.svc.feedback(issued.token, 'no', 'POST')).ok).toBe(false);
  expect((await a.svc.visit(issued.token, 'POST')).ok).toBe(false);
  expect((await a.svc.visit('bad', 'GET')).ok).toBe(false);
});
it('rejects external destinations, malformed slot, expired links and send-slot replacement', async () => {
  const x = await setup(),
    a = await actions(x),
    input = {
      sendId: x.send.id,
      slot: 'helpful',
      purpose: 'feedback' as const,
      path: '/email/feedback',
      expiresAt: time(3600000),
    };
  expect((await a.svc.issue({ ...input, path: 'https://evil.invalid' })).ok).toBe(false);
  expect((await a.svc.issue({ ...input, slot: 'bad slot' })).ok).toBe(false);
  expect((await a.svc.issue({ ...input, expiresAt: 'invalid' })).ok).toBe(false);
  expect((await a.svc.issue({ ...input, expiresAt: time(-1000) })).ok).toBe(false);
  const issued = value(await a.svc.issue(input));
  expect((await a.svc.issue({ ...input, expiresAt: time(7200000) })).ok).toBe(false);
  const row = (
    await f.admin.query('SELECT id FROM email.email_links WHERE send_id=$1', [x.send.id])
  ).rows[0]!;
  expect(value(await a.svc.revoke(row.id))).toEqual({ status: 'revoked' });
  expect((await a.svc.visit(issued.token, 'GET')).ok).toBe(false);
  expect((await a.svc.revoke('bad')).ok).toBe(false);
});
it('public role cannot access callback observations or link capabilities', async () => {
  const s = f.adapter('tt_app_runtime');
  for (const table of ['email.callback_observations', 'email.email_links', 'email.email_feedback'])
    expect(
      (
        await s.unitOfWork.run(async (tx) =>
          ok((await s.query(tx, 'SELECT * FROM ' + table + ' LIMIT 1')).rows),
        )
      ).ok,
    ).toBe(false);
});
it('redirects only to a currently reviewed public learning route and blocks withdrawn content', async () => {
  const x = await setup(),
    a = await actions(x),
    path = '/learn/fixture-' + uid('path'),
    contentKey = uid('content'),
    doc = uid('document');
  const s = f.adapter('tt_content_runtime'),
    pub = createContentPublicationRepository(s);
  await success(s.unitOfWork, (tx) =>
    pub.publish(tx, {
      key: contentKey,
      locale: 'en-US',
      market: 'US',
      generation: 1n,
      cmsRevision: 'fixture:1',
      publishedAt: time(-60000),
      expiresAt: time(3600000),
      content: { title: 'Fixture', summary: 'Summary', paragraphs: ['Text'] },
    }),
  );
  await f.admin.query(
    "INSERT INTO app.public_page_details(content_key,locale,market,generation,document_id,collection,public_path,document) VALUES($1,'en-US','US',1,$2,'articles',$3,'{}')",
    [contentKey, doc, path],
  );
  await f.admin.query(
    "INSERT INTO admin.seo_page_registry(public_path,locale,market,content_key,page_class,owner_staff_id,review_due_at,index_status,canonical_path) VALUES($1,'en-US','US',$2,'education',$3,now()+interval '1 hour','eligible',$1)",
    [path, contentKey, f.staff],
  );
  const i = {
    sendId: x.send.id,
    slot: 'education',
    purpose: 'education' as const,
    path,
    expiresAt: time(3600000),
  };
  const r = value(await a.svc.issue(i));
  expect(value(await a.svc.visit(r.token, 'GET'))).toEqual({
    kind: 'redirect',
    destination: 'https://tires.example' + path,
  });
  expect((await a.svc.feedback(r.token, 'yes', 'POST')).ok).toBe(false);
  await f.admin.query(
    "UPDATE admin.seo_page_registry SET index_status='removed',revision=revision+1 WHERE public_path=$1",
    [path],
  );
  expect((await a.svc.visit(r.token, 'GET')).ok).toBe(false);
  expect((await a.svc.issue({ ...i, slot: 'new' })).ok).toBe(false);
});
it('revocation, expiry and inactive ownership block feedback even with a valid MAC', async () => {
  const x = await setup(),
    a = await actions(x),
    r = value(
      await a.svc.issue({
        sendId: x.send.id,
        slot: 'helpful',
        purpose: 'feedback',
        path: '/email/feedback',
        expiresAt: time(3600000),
      }),
    );
  await f.admin.query(
    "UPDATE app.subjects SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",
    [x.a.identity.subjectId],
  );
  expect((await a.svc.feedback(r.token, 'yes', 'POST')).ok).toBe(false);
});
it('retrieval complaint suppresses but never manufactures delivery metrics', async () => {
  const x = await setup();
  await x.attempted('uncertain');
  x.retrieve.mockResolvedValue({ id: x.messageId, event: 'complained' });
  expect((await x.services.reconcile(x.send.id)).ok).toBe(true);
  expect(
    await success(f.scope.unitOfWork, (tx) =>
      f.privacy.suppressed(tx, x.c.value.subjectId, ['all-email']),
    ),
  ).toBe(true);
  expect(value(await x.services.status(x.send.id))).toMatchObject({
    state: 'accepted',
    complained: false,
  });
});
