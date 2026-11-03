import { beforeAll, afterAll, it, expect } from 'vitest';
import { operationsApiFixture } from '../fixtures/http/operations-api.ts';
import { uid } from '../fixtures/private/database.ts';
let f: Awaited<ReturnType<typeof operationsApiFixture>>;
beforeAll(async () => {
  f = await operationsApiFixture();
}, 45000);
afterAll(async () => {
  await f?.cleanup();
});
it('UC08 persists explicit browser choices and applies GPC over contradictory caller data', async () => {
  const who = await f.session(),
    before = await (await f.call('/consent/browser?cmpAvailable=true', who)).json();
  expect(before.data).toMatchObject({ analytics: false, ads: false, targeted_ads: false });
  const body = {
    expectedRevision: before.data.revision,
    allowed: ['analytics', 'ads', 'targeted_ads'],
    gpc: false,
    notices: {
      necessary: f.notices.necessary,
      analytics: f.notices.analytics,
      ads: f.notices.ads,
      targeted_ads: f.notices.targeted_ads,
    },
  };
  const set = await fetch(f.server.origin + '/api/v1/consent/browser', {
    method: 'POST',
    headers: {
      origin: f.server.origin,
      cookie: who.cookie,
      'x-csrf-token': who.csrf,
      'idempotency-key': 'synthetic_gpc_001',
      'content-type': 'application/json',
      'sec-gpc': '1',
    },
    body: JSON.stringify(body),
  });
  expect(set.status).toBe(200);
  const after = await (await f.call('/consent/browser?cmpAvailable=true', who)).json();
  expect(after.data.targeted_ads).toBe(false);
  expect((await f.call('/consent/browser', who, body, 'synthetic_stale_001')).status).toBe(409);
});
it('UC06 records a report-only contact without implying offers and rejects caller-selected owner metadata', async () => {
  const who = await f.session(),
    report = await f.report(who),
    body = {
      email: uid('email') + '@example.invalid',
      report: { id: report.head.id, version: 1 },
      offers: false,
      notices: { report: f.notices.report },
    };
  const r = await f.call('/contacts', who, body);
  expect(r.status).toBe(200);
  expect(await r.text()).not.toContain(body.email);
  expect(
    (await f.call('/contacts', who, { ...body, subjectId: uid('subject') }, 'synthetic_extra_001'))
      .status,
  ).toBe(400);
  expect(f.providerCalls()).toBe(0);
});
it('UC06/UC08 commits delivery before replying, masks another owner and cancels with an expected revision', async () => {
  const who = await f.session(),
    report = await f.report(who),
    r = await f.call('/deliveries', who, {
      email: uid('email') + '@example.invalid',
      report: { id: report.head.id, version: 1 },
      offers: false,
      notices: { report: f.notices.report },
    });
  expect(r.status).toBe(200);
  const receipt = (await r.json()).data;
  expect(receipt.id).toBeTruthy();
  const rows = await f.db.admin.query('SELECT id,revision FROM email.email_sends WHERE id=$1', [
    receipt.id,
  ]);
  expect(rows.rowCount).toBe(1);
  const id = receipt.id as string;
  const status = await f.call('/deliveries/' + id, who);
  expect(status.status).toBe(200);
  expect(await status.text()).not.toContain('@example.invalid');
  const other = await f.session();
  expect((await f.call('/deliveries/' + id, other)).status).toBe(404);
  const cancel = await f.call(
    '/deliveries/' + id + '/cancel',
    who,
    { expectedRevision: String(rows.rows[0].revision), reason: 'cancel' },
    'synthetic_cancel_001',
  );
  expect(cancel.status).toBe(200);
  expect(f.providerCalls()).toBe(0);
});
it('UC10 returns a purpose-scoped owner privacy proof and a masked status projection', async () => {
  const who = await f.session(),
    r = await f.call('/privacy/owner-requests', who, { kind: 'access', jurisdiction: 'synthetic' });
  expect(r.status).toBe(200);
  const value = (await r.json()).data;
  expect(value.id).toBeTruthy();
  expect(value.proof).toBeTruthy();
  const status = await fetch(f.server.origin + '/api/v1/privacy/status', {
    headers: { authorization: 'Bearer ' + value.proof },
  });
  expect(status.status).toBe(200);
  const data = (await status.json()).data;
  expect(Object.keys(data).sort()).toEqual(['completedAt', 'dueAt', 'id', 'kind', 'status']);
  expect(JSON.stringify(data)).not.toMatch(/subject|email|proof|journal|key_version/);
  expect(
    (
      await fetch(f.server.origin + '/api/v1/privacy/status', {
        headers: { authorization: 'Bearer forged-private-proof' },
      })
    ).status,
  ).toBe(404);
});
it('does not enumerate known versus unknown email rights requests or send actual notifications', async () => {
  const email = uid('email') + '@example.invalid',
    who = await f.session(),
    report = await f.report(who);
  expect(
    (
      await f.call('/contacts', who, {
        email,
        report: { id: report.head.id, version: 1 },
        offers: false,
        notices: { report: f.notices.report },
      })
    ).status,
  ).toBe(200);
  const a = await f.call('/privacy/email-requests', undefined, {
      email,
      kind: 'delete',
      jurisdiction: 'synthetic',
    }),
    b = await f.call('/privacy/email-requests', undefined, {
      email: uid('email') + '@example.invalid',
      kind: 'delete',
      jurisdiction: 'synthetic',
    });
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect((await a.json()).data).toEqual({ accepted: true });
  expect((await b.json()).data).toEqual({ accepted: true });
  expect(f.providerCalls()).toBe(0);
});
it('UC09 requires server-held staff credentials and emits only masked queue fields', async () => {
  expect((await f.call('/staff/queues/imports')).status).toBe(401);
  const forged = await fetch(f.server.origin + '/api/v1/staff/queues/imports', {
    headers: { 'x-staff-id': f.db.staff, 'x-mfa-verified': 'true' },
  });
  expect(forged.status).toBe(401);
  const staff = await f.staff('data_operator'),
    r = await f.call('/staff/queues/imports?limit=5', staff);
  expect(r.status).toBe(200);
  const data = (await r.json()).data;
  expect(Object.keys(data).sort()).toEqual(['items', 'next']);
  for (const item of data.items) expect(Object.keys(item).sort()).toEqual(['dueAt', 'id', 'state']);
});
it('rechecks current roles on every request and refuses access after revocation', async () => {
  const staff = await f.staff('data_operator');
  expect((await f.call('/staff/queues/imports', staff)).status).toBe(200);
  await f.db.admin.query(
    'UPDATE admin.staff_role_assignments SET revoked_at=now(),updated_at=now(),revision=revision+1 WHERE staff_id=$1',
    [staff.id],
  );
  expect((await f.call('/staff/queues/imports', staff)).status).toBe(404);
});
it('UC09 checks data-review authority before opening a registered import and rejects paths or actor overrides', async () => {
  const support = await f.staff('support_operator');
  expect(
    (await f.call('/staff/imports/prepare', support, { artifactId: uid('artifact') })).status,
  ).toBe(404);
  const staff = await f.staff('data_operator');
  for (const body of [
    { path: 'C:/private/secret' },
    { url: 'https://remote.invalid/data' },
    { artifactId: uid('artifact'), actorId: staff.id },
  ])
    expect((await f.call('/staff/imports/prepare', staff, body)).status).toBe(400);
});
it('UC09 stages a registered bounded snapshot through ingestion and exposes durable status/diff', async () => {
  const staff = await f.staff('data_operator'),
    artifact = await f.artifact(),
    r = await f.call('/staff/imports/prepare', staff, { artifactId: artifact });
  expect(r.status).toBe(200);
  const data = (await r.json()).data;
  expect(data.id).toBeTruthy();
  expect((await f.call('/staff/imports/' + data.id, staff)).status).toBe(200);
  expect((await f.call('/staff/imports/' + data.id + '/diff', staff)).status).toBe(200);
});
it('UC09 recovery is audited, stable on replay and rejects same-key different commands', async () => {
  const staff = await f.staff('support_operator'),
    body = { kind: 'mail_reconcile', target: uid('target'), evidence: 'a'.repeat(64) };
  expect((await f.call('/staff/recover', staff, body)).status).toBe(200);
  expect((await f.call('/staff/recover', staff, body)).status).toBe(200);
  expect((await f.call('/staff/recover', staff, { ...body, target: uid('target') })).status).toBe(
    409,
  );
  const audit = await f.db.admin.query(
    "SELECT count(*) FROM admin.audit_events a JOIN admin.audit_identity_links l ON l.event_id=a.id WHERE l.actor_staff_id=$1 AND action='recovery.mail_reconcile'",
    [staff.id],
  );
  expect(Number(audit.rows[0].count)).toBeGreaterThanOrEqual(1);
  expect(f.providerCalls()).toBe(0);
});

it('exposes only configured published notice IDs and policy version for anonymous consent clients', async () => {
  const response = await f.call('/consent/policy');
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ version: 'synthetic', notices: f.notices });
});
