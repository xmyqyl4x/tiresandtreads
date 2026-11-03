import { it, expect, vi } from 'vitest';
import { createHmac, createHash } from 'node:crypto';
import {
  callbackRoutes,
  type CallbackServices,
} from '../../packages/integrations/src/http/callbacks.ts';
import {
  HttpSuccess,
  HttpRedirect,
  type HttpContext,
} from '../../packages/integrations/src/http/core.ts';
import { ok, instant } from '../../packages/domain/src/values/core.ts';
const uuid = '11111111-1111-4111-8111-111111111111',
  at = '2026-11-03T10:00:00.000Z',
  mail = 'whsec_' + Buffer.alloc(32, 31).toString('base64'),
  workflow = 'whsec_' + Buffer.alloc(32, 32).toString('base64');
const parsedAt = instant(at);
if (!parsedAt.ok) throw Error('Invalid synthetic clock');
const expiresAt = parsedAt.value;
function context(
  body: unknown,
  headers: Record<string, string> = {},
  params: Record<string, string> = {},
): HttpContext {
  return {
    body,
    actor: { keys: [], csrf: 'owner-csrf' },
    key: 'synthetic_command_001',
    peer: '127.0.0.1',
    params,
    query: new URLSearchParams(),
    responseHeaders: new Headers(),
    request: new Request('http://127.0.0.1:3210', { headers }),
  } as HttpContext;
}
function signed(body: string, key: string, message = 'event_1', offset = 0) {
  const stamp = String(Date.parse(at) / 1000 + offset),
    signature = createHmac('sha256', Buffer.from(key.slice(6), 'base64'))
      .update(message + '.' + stamp + '.')
      .update(body)
      .digest('base64');
  return { 'svix-id': message, 'svix-timestamp': stamp, 'svix-signature': 'v1,' + signature };
}
function setup() {
  const method = () => vi.fn(async () => ok({ status: 'recorded' })),
    receive = method(),
    analytics = { issue: method(), collect: method() },
    actions = {
      preferences: method(),
      confirm: method(),
      withdraw: method(),
      oneClick: method(),
      visit: vi.fn(async () =>
        ok({ kind: 'redirect', destination: 'https://example.invalid/education' }),
      ),
      feedback: method(),
    },
    commercial = {
      resolveAffiliate: vi.fn(async () => ok({ destination: 'https://retailer.invalid/approved' })),
    },
    wake = vi.fn(async () => ({ accepted: true }));
  const services = {
    mail: { receive },
    analytics,
    actions,
    commercial,
  } as unknown as CallbackServices;
  const routes = callbackRoutes({
    services,
    keys: { mail: [mail], workflow: [workflow] },
    wake,
    confirmation: async () =>
      ok({ purpose: 'offers', status: 'pending', expired: false, expiresAt }),
    now: () => at,
  });
  return {
    receive,
    analytics,
    actions,
    commercial,
    wake,
    routes,
    handle: (operation: string, c: HttpContext) =>
      routes.find((x) => x.operationId === operation)!.handle(c),
  };
}
it('verifies the original signed mail bytes before passing a normalized observation into the service', async () => {
  const s = setup(),
    raw =
      ' {"type":"email.delivered", "created_at":"' +
      at +
      '", "data":{"email_id":"' +
      uuid +
      '"}}\n';
  const r = await s.handle(
    'receiveMailCallback',
    context(new TextEncoder().encode(raw), signed(raw, mail)),
  );
  expect(r).toMatchObject({ ok: true, value: expect.any(HttpSuccess) });
  expect(s.receive).toHaveBeenCalledWith(
    expect.objectContaining({
      eventId: 'event_1',
      digest: createHash('sha256').update(raw).digest('hex'),
      messageId: uuid,
      type: 'delivered',
    }),
  );
});
it.each([{}, signed('{}', workflow), signed('{}', mail, 'event_1', -301)])(
  'refuses unverified or expired mail callbacks before SQL',
  async (headers) => {
    const s = setup();
    expect(
      await s.handle('receiveMailCallback', context(new TextEncoder().encode('{}'), headers)),
    ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(s.receive).not.toHaveBeenCalled();
  },
);
it('binds a signed workflow wake to its fixed existing job reference and refuses another body for that message ID', async () => {
  const s = setup(),
    raw = JSON.stringify({ jobId: uuid });
  expect(
    await s.handle(
      'wakeDurableJob',
      context(new TextEncoder().encode(raw), signed(raw, workflow, 'job_' + uuid)),
    ),
  ).toMatchObject({ ok: true, value: expect.any(HttpSuccess) });
  expect(s.wake).toHaveBeenCalledWith(uuid);
  s.wake.mockClear();
  expect(
    await s.handle(
      'wakeDurableJob',
      context(new TextEncoder().encode(raw), signed(raw, workflow, 'job_another')),
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  const arbitrary = JSON.stringify({ jobId: uuid, method: 'delete' });
  expect(
    await s.handle(
      'wakeDurableJob',
      context(new TextEncoder().encode(arbitrary), signed(arbitrary, workflow, 'job_' + uuid)),
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  expect(s.wake).not.toHaveBeenCalled();
});
it('uses trusted peer/GPC signals and the exact analytics body rather than forwarded identities', async () => {
  const s = setup(),
    raw = ' {"schemaVersion":1} ';
  s.analytics.collect.mockResolvedValue(ok({ status: 'refused' }) as never);
  const r = await s.handle(
    'collectEvents',
    context(new TextEncoder().encode(raw), {
      authorization: 'Bearer analytics-proof',
      'sec-gpc': '1',
      'x-tt-cmp-available': 'true',
      'x-forwarded-for': 'private-spoof',
    }),
  );
  expect(r).toMatchObject({ ok: true, value: expect.objectContaining({ status: 204 }) });
  expect(s.analytics.collect).toHaveBeenCalledWith('analytics-proof', raw, {
    ip: '127.0.0.1',
    gpc: true,
    cmpAvailable: true,
    bot: 'unknown',
  });
});
it('delegates analytics grant authority with explicit CMP availability and preserves GPC', async () => {
  const s = setup();
  await s.handle(
    'issueAnalyticsGrant',
    context({ channel: 'web', cmpAvailable: true }, { 'sec-gpc': '1' }),
  );
  expect(s.analytics.issue).toHaveBeenCalledWith([], { gpc: true, cmpAvailable: true }, 'web');
  expect(
    await s.handle(
      'issueAnalyticsGrant',
      context({ channel: 'web', cmpAvailable: true, subjectId: uuid }),
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
});
it('does not confirm, withdraw or record feedback during any link/preferences GET', async () => {
  const s = setup();
  for (const operation of [
    'readEmailConfirmation',
    'readEmailUnsubscribe',
    'readPreferences',
    'getEmailPreferences',
  ])
    await s.handle(
      operation,
      context(null, { authorization: 'Bearer purpose-proof' }, { token: 'purpose-proof' }),
    );
  expect(s.actions.preferences).toHaveBeenCalledTimes(3);
  expect(s.actions.confirm).not.toHaveBeenCalled();
  expect(s.actions.withdraw).not.toHaveBeenCalled();
  expect(s.actions.feedback).not.toHaveBeenCalled();
});
it('preserves the RFC8058 form and purpose proof without inventing a login or challenge', async () => {
  const s = setup(),
    body = { 'List-Unsubscribe': 'One-Click' };
  await s.handle('oneClickUnsubscribe', context(body, {}, { token: 'purpose-proof' }));
  expect(s.actions.oneClick).toHaveBeenCalledWith('purpose-proof', 'POST', body);
  expect(s.routes.find((x) => x.operationId === 'oneClickUnsubscribe')).toMatchObject({
    access: 'callback',
    bodyMode: 'form',
    maxBodyBytes: 8192,
  });
});
it('restricts preference/feedback commands to their supported actions and never accepts an actor override', async () => {
  const s = setup();
  expect(
    await s.handle('updatePreferences', context({ action: 'delete' }, {}, { token: 'proof' })),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  expect(
    await s.handle(
      'recordEmailFeedback',
      context({ value: 'yes', actorId: uuid }, {}, { token: 'proof' }),
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  await s.handle('updatePreferences', context({ action: 'withdraw' }, {}, { token: 'proof' }));
  expect(s.actions.withdraw).toHaveBeenCalledWith('proof', 'POST');
});
it('uses only service-approved fixed education/retailer destinations and has no outbound destination fetch', async () => {
  const s = setup();
  expect(await s.handle('visitEmailLink', context(null, {}, { token: 'proof' }))).toMatchObject({
    ok: true,
    value: expect.any(HttpRedirect),
  });
  expect(
    await s.handle('redirectAffiliate', context(null, {}, { linkId: 'approved' })),
  ).toMatchObject({ ok: true, value: expect.any(HttpRedirect) });
  expect(s.commercial.resolveAffiliate).toHaveBeenCalledWith('approved', 'US');
  s.commercial.resolveAffiliate.mockResolvedValue(ok(null) as never);
  expect(
    await s.handle('redirectAffiliate', context(null, {}, { linkId: 'missing' })),
  ).toMatchObject({ ok: false, error: { code: 'not_found' } });
});
it('binds the finite 19-operation callback/event/action surface without an arbitrary method dispatcher', () => {
  const s = setup();
  expect(s.routes).toHaveLength(19);
  expect(
    s.routes
      .filter((x) => x.access === 'callback')
      .map((x) => x.operationId)
      .sort(),
  ).toEqual([
    'oneClickUnsubscribe',
    'oneClickUnsubscribeApi',
    'receiveMailCallback',
    'wakeDurableJob',
  ]);
});
