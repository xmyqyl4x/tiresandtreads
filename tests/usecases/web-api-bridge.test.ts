import { it, expect, vi } from 'vitest';
import { forwardLocalApi } from '../../apps/web/src/bridge.ts';
const env = {
  LOCAL_WEB_PREVIEW: 'enabled',
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  LOCAL_WEB_ORIGIN: 'http://127.0.0.1:8380',
  LOCAL_API_ORIGIN: 'http://127.0.0.1:43127',
};
const request = (
  path = '/api/v1/consent/policy',
  headers: Record<string, string> = {},
  method = 'GET',
  body?: string,
) =>
  new Request(env.LOCAL_WEB_ORIGIN + path, {
    method,
    headers: { host: '127.0.0.1:8380', ...headers },
    ...(body === undefined ? {} : { body }),
  });
it.each([
  { host: 'evil.invalid' },
  { origin: 'http://evil.invalid' },
  { host: '127.0.0.1:3200' },
  { origin: 'null' },
])('refuses untrusted browser routing before forwarding %j', async (headers) => {
  const send = vi.fn();
  const r = await forwardLocalApi(request('/api/v1/consent/policy', headers), env, send);
  expect(r.status).toBe(403);
  expect(send).not.toHaveBeenCalled();
});
it('requires the exact browser Origin before rewriting any mutation authority', async () => {
  const send = vi.fn();
  expect(
    (await forwardLocalApi(request('/api/v1/sessions', {}, 'POST', '{}'), env, send)).status,
  ).toBe(403);
  expect(send).not.toHaveBeenCalled();
});
it('forwards only declared operations to the private loopback host, preserving proof/CSRF and stripping spoofed peer headers', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const send = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
    const h = new Headers(options?.headers);
    expect(h.get('origin')).toBe(env.LOCAL_API_ORIGIN);
    expect(h.get('cookie')).toBe('tt_owner=synthetic');
    expect(h.get('x-csrf-token')).toBe('csrf');
    expect(h.has('x-forwarded-for')).toBe(false);
    return Response.json(
      { data: null, requestId: id },
      {
        headers: {
          'set-cookie': 'tt_owner=synthetic; HttpOnly; SameSite=Strict; Path=/',
          'x-request-id': id,
        },
      },
    );
  });
  const r = await forwardLocalApi(
    request(
      '/api/v1/consent/browser',
      {
        origin: env.LOCAL_WEB_ORIGIN,
        cookie: 'tt_owner_web_test=synthetic',
        'x-csrf-token': 'csrf',
        'x-forwarded-for': '1.2.3.4',
        'content-type': 'application/json',
      },
      'POST',
      '{}',
    ),
    env,
    send as typeof fetch,
  );
  expect(r.status).toBe(200);
  expect(r.headers.get('cache-control')).toBe('no-store');
  expect(r.headers.get('set-cookie')).toContain('HttpOnly');
  expect(send.mock.calls[0]![0]).toBe(env.LOCAL_API_ORIGIN + '/api/v1/consent/browser');
});
it.each([
  '/api/v1/webhooks/resend',
  '/api/v1/workflows/wake',
  '/api/v1/private-query',
  '/api/v1/reference/%2Fprivate',
])('does not turn the web adapter into a callback or arbitrary proxy for %s', async (path) => {
  const send = vi.fn();
  const r = await forwardLocalApi(request(path), env, send);
  expect([400, 404]).toContain(r.status);
  expect(send).not.toHaveBeenCalled();
});
it('refuses oversized input before dispatch and masks an unavailable backend', async () => {
  const send = vi.fn();
  const big = request(
    '/api/v1/sessions',
    { origin: env.LOCAL_WEB_ORIGIN, 'content-type': 'application/json' },
    'POST',
    'x'.repeat(65537),
  );
  expect((await forwardLocalApi(big, env, send)).status).toBe(413);
  expect(send).not.toHaveBeenCalled();
  const bad = await forwardLocalApi(request(), env, async () => {
    throw Error('secret postgres credential');
  });
  expect(bad.status).toBe(503);
  expect(await bad.text()).not.toContain('secret');
});
it('keeps all new web routes inactive with the default environment', async () => {
  const send = vi.fn();
  expect((await forwardLocalApi(request(), {}, send)).status).toBe(404);
  expect(send).not.toHaveBeenCalled();
});
it('isolates dev/stage owner cookies on the same loopback host and refuses duplicate active-environment cookies', async () => {
  const observed: string[] = [];
  const send: typeof fetch = async (_url, options) => {
    observed.push(new Headers(options?.headers).get('cookie') ?? '');
    return Response.json({ data: null, requestId: '11111111-1111-4111-8111-111111111111' });
  };
  const cookies = 'tt_owner_web_dev=dev_value; tt_owner_web_stage=stage_value; tt_owner=legacy';
  for (const [mode, port] of [
    ['dev', 8380],
    ['stage', 8480],
  ] as const) {
    const origin = 'http://127.0.0.1:' + port,
      r = await forwardLocalApi(
        new Request(origin + '/api/v1/sessions/current', {
          headers: { host: '127.0.0.1:' + port, cookie: cookies },
        }),
        { ...env, APP_ENV: mode + '-local', LOCAL_WEB_ORIGIN: origin },
        send,
      );
    expect(r.status).toBe(200);
  }
  expect(observed).toEqual(['tt_owner=dev_value', 'tt_owner=stage_value']);
  const bad = vi.fn();
  expect(
    (
      await forwardLocalApi(
        request('/api/v1/sessions/current', {
          cookie: 'tt_owner_web_test=first; tt_owner_web_test=second',
        }),
        env,
        bad,
      )
    ).status,
  ).toBe(400);
  expect(bad).not.toHaveBeenCalled();
});
