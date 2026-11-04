import { it, expect, vi } from 'vitest';
import { forwardStaff, staffProxyPath } from '../../apps/web/src/staff/proxy.ts';
const web = 'http://127.0.0.1:8380',
  api = 'http://127.0.0.1:9411',
  env = {
    APP_ENV: 'dev-local',
    PROVIDER_MODE: 'fixtures',
    LOCAL_WEB_PREVIEW: 'enabled',
    LOCAL_WEB_ORIGIN: web,
    LOCAL_API_ORIGIN: api,
    LOCAL_STAFF_CONSOLE: 'enabled',
    LOCAL_STAFF_API_ORIGIN: api,
  };
const request = (path = '/api/v1/staff-console/reports', options: RequestInit = {}) =>
  new Request(web + '/local-staff-api' + path, {
    ...options,
    headers: {
      host: '127.0.0.1:8380',
      authorization: 'Bearer ' + 'a'.repeat(43),
      ...options.headers,
    },
  });
it('refuses a disabled local console before forwarding any private read', async () => {
  const send = vi.fn<typeof fetch>();
  const response = await forwardStaff(request(), { ...env, LOCAL_STAFF_CONSOLE: 'disabled' }, send);
  expect(response.status).toBe(404);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ error: 'not_found' });
  expect(send).not.toHaveBeenCalled();
});
it.each([
  '/api/v1/staff/imports/prepare',
  '/api/v1/staff/imports/rollback',
  '/api/v1/staff/content',
  '/api/v1/staff-console/publish/extra',
  '//evil.test/api/v1/staff',
])('refuses paths outside the exact console surface: %s', async (path) => {
  const send = vi.fn<typeof fetch>();
  expect(staffProxyPath(path, 'POST')).toBe(false);
  expect(
    (await forwardStaff(request(path, { method: 'POST', headers: { origin: web } }), env, send))
      .status,
  ).toBe(400);
  expect(send).not.toHaveBeenCalled();
});
it('refuses cross-origin writes, forged hosts, missing credentials and arbitrary upstreams', async () => {
  const send = vi.fn<typeof fetch>();
  for (const r of [
    request(undefined, { headers: { host: 'evil.test' } }),
    request('/api/v1/staff/recover', { method: 'POST', headers: { origin: 'https://evil.test' } }),
  ])
    expect((await forwardStaff(r, env, send)).status).toBe(403);
  expect(
    (await forwardStaff(request(undefined, { headers: { authorization: '' } }), env, send)).status,
  ).toBe(401);
  expect(
    (await forwardStaff(request(), { ...env, LOCAL_STAFF_API_ORIGIN: 'https://evil.test' }, send))
      .status,
  ).toBe(503);
  expect(send).not.toHaveBeenCalled();
});
it('forwards a bounded command only to the fixed API and strips cookies and response credentials', async () => {
  const send = vi.fn<typeof fetch>(
    async () =>
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'PRIVATE', 'x-private': 'PRIVATE' },
      }),
  );
  const result = await forwardStaff(
    request('/api/v1/staff-console/publish', {
      method: 'POST',
      headers: {
        origin: web,
        cookie: 'PRIVATE',
        'x-csrf-token': 'b'.repeat(64),
        'idempotency-key': 'command_12345678',
        'x-reviewer-authorization': 'Bearer ' + 'c'.repeat(43),
      },
      body: '{}',
    }),
    env,
    send,
  );
  expect(result.status).toBe(200);
  expect(result.headers.get('set-cookie')).toBeNull();
  expect(result.headers.get('x-private')).toBeNull();
  expect(String(send.mock.calls[0]![0])).toBe(api + '/api/v1/staff-console/publish');
  const out = new Headers(send.mock.calls[0]![1]!.headers);
  expect(out.get('cookie')).toBeNull();
  expect(out.get('x-reviewer-authorization')).toBe('Bearer ' + 'c'.repeat(43));
  expect(send.mock.calls[0]![1]!.redirect).toBe('error');
});
it('bounds request and response streams and keeps failures private', async () => {
  const send = vi.fn<typeof fetch>(async () => new Response('x'.repeat(262145)));
  expect((await forwardStaff(request(), env, send)).status).toBe(503);
  expect(
    (
      await forwardStaff(
        request('/api/v1/staff/recover', {
          method: 'POST',
          headers: { origin: web },
          body: 'x'.repeat(65537),
        }),
        env,
        send,
      )
    ).status,
  ).toBe(503);
  expect(send).toHaveBeenCalledTimes(1);
});
