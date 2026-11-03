import { beforeAll, afterAll, it, expect } from 'vitest';
import { callbackApiFixture } from '../fixtures/http/callback-api.ts';
import { uid, time } from '../fixtures/private/database.ts';
import { success } from '../fixtures/private/database.ts';
import { createContentPublicationRepository } from '../../packages/db/src/repositories/content.ts';
let f: Awaited<ReturnType<typeof callbackApiFixture>>;
beforeAll(async () => {
  f = await callbackApiFixture();
}, 45000);
afterAll(async () => {
  await f?.cleanup();
});
it('commits a verified mail receipt/fact before202 and replays the same signed event without duplication or raw PII retention', async () => {
  const send = await f.send(),
    event = uid('event'),
    body = send.body();
  const responses = await Promise.all([
    f.signedPost('/api/v1/webhooks/resend', body, 'mail', event),
    f.signedPost('/api/v1/webhooks/resend', body, 'mail', event),
  ]);
  expect(responses.map((r) => r.status)).toEqual([202, 202]);
  const rows = await f.db.admin.query('SELECT count(*) FROM email.email_events WHERE send_id=$1', [
    send.send.id,
  ]);
  expect(Number(rows.rows[0].count)).toBe(1);
  expect(await f.mail.status(send.send.id)).toMatchObject({ ok: true, value: { delivered: true } });
  const raw = await f.db.admin.query(
    'SELECT row_to_json(x)::text AS value FROM email.callback_observations x',
  );
  expect(JSON.stringify(raw.rows)).not.toContain('unretained@example.invalid');
});
it('refuses forged, expired or byte-mutated callbacks without durable receipts and keeps raw errors private', async () => {
  const before = await f.db.admin.query('SELECT count(*) FROM email.callback_observations'),
    send = await f.send(),
    body = send.body();
  for (const request of [
    () =>
      fetch(f.server.origin + '/api/v1/webhooks/resend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    () => f.signedPost('/api/v1/webhooks/resend', body, 'mail', uid('event'), -301),
    () =>
      fetch(f.server.origin + '/api/v1/webhooks/resend', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...f.signed(body, 'mail', uid('event')) },
        body: body + ' ',
      }),
  ]) {
    const response = await request();
    expect(response.status).toBe(400);
    expect(await response.text()).not.toMatch(/unretained|whsec_|private/);
  }
  const after = await f.db.admin.query('SELECT count(*) FROM email.callback_observations');
  expect(after.rows[0].count).toBe(before.rows[0].count);
});
it('rejects a conflicting signed provider event identity and cannot alter its already committed facts', async () => {
  const send = await f.send(),
    event = uid('event');
  expect((await f.signedPost('/api/v1/webhooks/resend', send.body(), 'mail', event)).status).toBe(
    202,
  );
  expect(
    (await f.signedPost('/api/v1/webhooks/resend', send.body('email.complained'), 'mail', event))
      .status,
  ).toBe(409);
  expect(await f.mail.status(send.send.id)).toMatchObject({
    ok: true,
    value: { delivered: true, complained: false },
  });
});
it('reconciles an uncertain local delivery using signed provider evidence without sending or retrieving a real message', async () => {
  const send = await f.send('uncertain');
  expect(
    (await f.signedPost('/api/v1/webhooks/resend', send.body(), 'mail', uid('event'))).status,
  ).toBe(202);
  expect(await f.mail.status(send.send.id)).toMatchObject({
    ok: true,
    value: { state: 'accepted', delivered: true },
  });
  expect(f.providerCalls()).toBe(0);
});
it('applies a fixed existing SQL job once under concurrent signed wakes', async () => {
  const job = await f.job(),
    body = JSON.stringify({ jobId: job.id }),
    responses = await Promise.all([
      f.signedPost('/api/v1/workflows/wake', body, 'workflow', 'job_' + job.id),
      f.signedPost('/api/v1/workflows/wake', body, 'workflow', 'job_' + job.id),
    ]);
  expect(responses.map((r) => r.status)).toEqual([202, 202]);
  expect(
    Number(
      (await f.db.admin.query('SELECT count(*) FROM app.outbox WHERE event_id=$1', [job.eventId]))
        .rows[0].count,
    ),
  ).toBe(1);
  expect(
    (await f.db.admin.query('SELECT attempts FROM app.job_runs WHERE id=$1', [job.id])).rows[0]
      .attempts,
  ).toBe(1);
});
it('preserves a committed job when the synthetic HTTP acknowledgement is lost and does not repeat its SQL effect on retry', async () => {
  const job = await f.job(),
    body = JSON.stringify({ jobId: job.id });
  f.loseNextJobAck();
  const lost = await f.signedPost('/api/v1/workflows/wake', body, 'workflow', 'job_' + job.id);
  expect(lost.status).toBe(503);
  expect(await lost.text()).not.toContain('Synthetic response');
  expect(
    (await f.signedPost('/api/v1/workflows/wake', body, 'workflow', 'job_' + job.id)).status,
  ).toBe(202);
  expect(
    Number(
      (await f.db.admin.query('SELECT count(*) FROM app.outbox WHERE event_id=$1', [job.eventId]))
        .rows[0].count,
    ),
  ).toBe(1);
});
it('never applies an arbitrary action, another message/job binding or a forged workflow signature', async () => {
  const job = await f.job();
  for (const [body, purpose, message] of [
    [JSON.stringify({ jobId: job.id, method: 'delete' }), 'workflow', 'job_' + job.id],
    [JSON.stringify({ jobId: job.id }), 'workflow', 'job_another'],
    [JSON.stringify({ jobId: job.id }), 'mail', 'job_' + job.id],
  ] as const)
    expect((await f.signedPost('/api/v1/workflows/wake', body, purpose, message)).status).toBe(400);
  expect(
    Number(
      (await f.db.admin.query('SELECT count(*) FROM app.outbox WHERE event_id=$1', [job.eventId]))
        .rows[0].count,
    ),
  ).toBe(0);
});
it('keeps confirmation/preference scanner GETs read-only and RFC8058 withdrawal immediate, purpose-scoped and repeatable', async () => {
  const who = await f.session(),
    email = uid('email') + '@example.invalid';
  expect(
    (
      await f.call('/contacts', who, {
        email,
        report: null,
        offers: true,
        notices: { offers: f.notices.offers },
      })
    ).status,
  ).toBe(200);
  const owner = await f.ownerIdentity(who),
    row = (
      await f.db.admin.query(
        'SELECT challenge_id FROM privacy.contact_intents WHERE owner_subject_id=$1 ORDER BY created_at DESC LIMIT 1',
        [owner.subjectId],
      )
    ).rows[0],
    message = await f.contacts.verificationMessage(row.challenge_id);
  if (!message.ok) throw Error('Missing synthetic verification');
  const confirm = message.value.verificationToken,
    unsubscribe = message.value.unsubscribeToken;
  for (const path of [
    '/email/confirm/' + encodeURIComponent(confirm),
    '/email/unsubscribe/' + encodeURIComponent(unsubscribe),
    '/preferences/' + encodeURIComponent(unsubscribe),
  ]) {
    const response = await fetch(f.server.origin + path);
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe('pending');
  }
  const confirmation = await fetch(f.server.origin + '/api/v1/email/confirm', {
    method: 'POST',
    headers: {
      origin: f.server.origin,
      authorization: 'Bearer ' + confirm,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  expect(confirmation.status).toBe(200);
  for (let replay = 0; replay < 2; replay++) {
    const response = await fetch(
      f.server.origin + '/email/unsubscribe/' + encodeURIComponent(unsubscribe),
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe('withdrawn');
  }
  const status = await fetch(f.server.origin + '/api/v1/email/preferences', {
    headers: { authorization: 'Bearer ' + unsubscribe },
  });
  expect((await status.json()).data).toMatchObject({ purpose: 'offers', status: 'withdrawn' });
  expect(f.providerCalls()).toBe(0);
});
it('requires explicit signed feedback POST and never records a vote on GET', async () => {
  const send = await f.send(),
    issued = await f.actions.issue({
      sendId: send.send.id,
      slot: 'fixture_feedback',
      purpose: 'feedback',
      path: '/email/feedback',
      expiresAt: time(3600000),
    });
  if (!issued.ok) throw Error('No synthetic link');
  const token = issued.value.token,
    get = await fetch(f.server.origin + '/e/c/' + encodeURIComponent(token));
  expect(get.status).toBe(200);
  expect((await get.json()).data.kind).toBe('feedback');
  expect(
    Number((await f.db.admin.query('SELECT count(*) FROM email.email_feedback')).rows[0].count),
  ).toBe(0);
  const post = await fetch(f.server.origin + '/api/v1/email/feedback', {
    method: 'POST',
    headers: {
      origin: f.server.origin,
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ value: 'yes' }),
  });
  expect(post.status).toBe(200);
  expect(
    Number((await f.db.admin.query('SELECT count(*) FROM email.email_feedback')).rows[0].count),
  ).toBe(1);
});
it('commits only consented events before202, deduplicates/rejects conflicting IDs and stops collection after withdrawal', async () => {
  const who = await f.session(),
    before = (await (await f.call('/consent/browser?cmpAvailable=true', who)).json()).data;
  const notices = {
    necessary: f.notices.necessary,
    analytics: f.notices.analytics,
    ads: f.notices.ads,
    targeted_ads: f.notices.targeted_ads,
  };
  expect(
    (
      await f.call(
        '/consent/browser',
        who,
        { expectedRevision: before.revision, allowed: ['analytics'], gpc: false, notices },
        'synthetic_analytics_001',
      )
    ).status,
  ).toBe(200);
  const grant = await (
    await f.call('/analytics/grants', who, { channel: 'web', cmpAvailable: true })
  ).json();
  expect(grant.data.status).toBe('issued');
  const event = {
      id: uid('event'),
      name: 'public_page_view',
      occurredAt: time(),
      route: '/',
      props: {},
    },
    body = JSON.stringify({ events: [event] });
  const collect = (raw: string, extra: Record<string, string> = {}) =>
    fetch(f.server.origin + '/api/v1/collect', {
      method: 'POST',
      headers: {
        origin: f.server.origin,
        authorization: 'Bearer ' + grant.data.token,
        'content-type': 'application/json',
        'x-tt-cmp-available': 'true',
        ...extra,
      },
      body: raw,
    });
  expect((await collect(body)).status).toBe(202);
  expect((await collect(body)).status).toBe(202);
  expect(
    (await collect(JSON.stringify({ events: [{ ...event, props: { outcome: 'success' } }] })))
      .status,
  ).toBe(409);
  expect((await collect(body, { 'sec-gpc': '1' })).status).toBe(204);
  expect(
    Number(
      (await f.db.admin.query('SELECT count(*) FROM analytics.events WHERE id=$1', [event.id]))
        .rows[0].count,
    ),
  ).toBe(1);
  const revision = (await (await f.call('/consent/browser?cmpAvailable=true', who)).json()).data
    .revision;
  expect(
    (
      await f.call(
        '/consent/browser',
        who,
        { expectedRevision: revision, allowed: [], gpc: false, notices },
        'synthetic_withdraw_001',
      )
    ).status,
  ).toBe(200);
  expect((await collect(JSON.stringify({ events: [{ ...event, id: uid('event') }] }))).status).toBe(
    204,
  );
});
it('rejects arbitrary destination queries and missing retailer links without fetching or disclosing a destination', async () => {
  expect((await fetch(f.server.origin + '/go/missing', { redirect: 'manual' })).status).toBe(404);
  expect(
    (await fetch(f.server.origin + '/go/missing?to=https://evil.invalid/', { redirect: 'manual' }))
      .status,
  ).toBe(400);
});
it('redirects to a current approved education snapshot without following it and refuses the same link after withdrawal', async () => {
  const send = await f.send(),
    path = '/learn/fixture-' + uid('path'),
    content = uid('content'),
    document = uid('document'),
    scope = f.db.adapter('tt_content_runtime'),
    publication = createContentPublicationRepository(scope);
  await success(scope.unitOfWork, (tx) =>
    publication.publish(tx, {
      key: content,
      locale: 'en-US',
      market: 'US',
      generation: 1n,
      cmsRevision: 'synthetic:1',
      publishedAt: time(-60000),
      expiresAt: time(3600000),
      content: { title: 'Synthetic', summary: 'Summary', paragraphs: ['Text'] },
    }),
  );
  await f.db.admin.query(
    "INSERT INTO app.public_page_details(content_key,locale,market,generation,document_id,collection,public_path,document) VALUES($1,'en-US','US',1,$2,'articles',$3,'{}')",
    [content, document, path],
  );
  await f.db.admin.query(
    "INSERT INTO admin.seo_page_registry(public_path,locale,market,content_key,page_class,owner_staff_id,review_due_at,index_status,canonical_path) VALUES($1,'en-US','US',$2,'education',$3,now()+interval '1 hour','eligible',$1)",
    [path, content, f.db.staff],
  );
  const issued = await f.actions.issue({
    sendId: send.send.id,
    slot: 'education',
    purpose: 'education',
    path,
    expiresAt: time(3600000),
  });
  if (!issued.ok) throw Error('No synthetic education link');
  const url = f.server.origin + '/e/c/' + encodeURIComponent(issued.value.token),
    response = await fetch(url, { redirect: 'manual' });
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('https://tiresandtreads.test' + path);
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('cache-control')).toBe('no-store');
  await f.db.admin.query(
    "UPDATE admin.seo_page_registry SET index_status='removed',revision=revision+1 WHERE public_path=$1",
    [path],
  );
  expect((await fetch(url, { redirect: 'manual' })).status).toBe(404);
});
it('redirects only a revision-checked synthetic retailer link and refuses it after its destination changes', async () => {
  const actor = await f.staff('commercial_operator'),
    reviewer = await f.staff('commercial_operator'),
    retailer = uid('retailer'),
    terms = await f.db.asset(),
    key = uid('link'),
    destination = 'https://retailer.invalid/approved?ref=fixture';
  await f.db.admin.query(
    "INSERT INTO app.retailers(id,code,name,market,approved_origin,status) VALUES($1,$2,'Synthetic retailer','US','https://retailer.invalid','active')",
    [retailer, retailer],
  );
  await f.db.admin.query(
    "INSERT INTO admin.affiliate_applications(retailer_id,network,status,submitted_at,approved_terms_asset_id) VALUES($1,'synthetic','approved',now(),$2)",
    [retailer, terms.id],
  );
  expect(
    await f.commercial.setAffiliate(actor.id, reviewer.id, {
      key,
      retailerId: retailer,
      destination,
      market: 'US',
    }),
  ).toMatchObject({ ok: true });
  expect((await fetch(f.server.origin + '/go/' + key, { redirect: 'manual' })).status).toBe(404);
  expect(await f.commercial.checkAffiliate(actor.id, key)).toMatchObject({ ok: true });
  const response = await fetch(f.server.origin + '/go/' + key, { redirect: 'manual' });
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(destination);
  expect(
    await f.commercial.setAffiliate(
      actor.id,
      reviewer.id,
      { key, retailerId: retailer, destination: 'https://retailer.invalid/changed', market: 'US' },
      '1',
    ),
  ).toMatchObject({ ok: true });
  expect((await fetch(f.server.origin + '/go/' + key, { redirect: 'manual' })).status).toBe(404);
});
