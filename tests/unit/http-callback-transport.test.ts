import { it, expect, vi } from 'vitest';
import {
  createHttpApi,
  HttpSuccess,
  HttpRedirect,
  type HttpRoute,
  type HttpObservation,
} from '../../packages/integrations/src/http/core.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
const origin = 'http://127.0.0.1:3210';
function setup(bodyMode: 'json' | 'bytes' | 'form' = 'bytes', maxBodyBytes = 65536) {
  const effect = vi.fn<HttpRoute['handle']>(async () => ok({ accepted: true })),
    observe = vi.fn<(value: HttpObservation) => void>(),
    security = {
      authenticate: vi.fn(async () => null),
      quota: vi.fn(async () => ({ allowed: true })),
    },
    route: HttpRoute = {
      operationId: 'syntheticCallback',
      method: 'POST',
      path: '/api/v1/callback',
      access: 'callback',
      bodyMode,
      maxBodyBytes,
      handle: effect,
    };
  return {
    effect,
    observe,
    security,
    api: createHttpApi({ origin, routes: [route], security, observe }),
  };
}
function request(body: string, type = 'application/json') {
  return new Request(origin + '/api/v1/callback', {
    method: 'POST',
    headers: { 'content-type': type, 'x-request-id': 'caller-private-secret' },
    body,
  });
}
it('preserves exact raw callback bytes without JSON normalization or owner authentication', async () => {
  const s = setup(),
    bytes = ' { "a" : "é" }\n';
  expect((await s.api(request(bytes))).status).toBe(200);
  expect(s.effect.mock.calls[0]![0].body).toEqual(new TextEncoder().encode(bytes));
  expect(s.security.authenticate).not.toHaveBeenCalled();
});
it('decodes a bounded RFC8058 form callback without requiring browser Origin or owner cookies', async () => {
  const s = setup('form', 8192);
  expect(
    (await s.api(request('List-Unsubscribe=One-Click', 'application/x-www-form-urlencoded')))
      .status,
  ).toBe(200);
  expect(s.effect.mock.calls[0]![0].body).toEqual({ 'List-Unsubscribe': 'One-Click' });
});
it.each(['a=1&a=2', 'a=%ZZ', 'a=%FF'])(
  'refuses duplicate/malformed form fields %s before dispatch',
  async (body) => {
    const s = setup('form', 8192);
    expect((await s.api(request(body, 'application/x-www-form-urlencoded'))).status).toBe(400);
    expect(s.effect).not.toHaveBeenCalled();
  },
);
it('enforces declared callback byte limits even for chunked data without a Content-Length', async () => {
  const s = setup('bytes', 8);
  expect((await s.api(request('123456789'))).status).toBe(413);
  expect(s.effect).not.toHaveBeenCalled();
});
it('retains callback admission and rejects unsupported media before dispatch', async () => {
  const s = setup();
  expect((await s.api(request('{}', 'text/plain'))).status).toBe(415);
  s.security.quota.mockResolvedValue({ allowed: false });
  expect((await s.api(request('{}'))).status).toBe(429);
  expect(s.effect).not.toHaveBeenCalled();
});
it('projects committed 202 results, empty 204 responses and fixed HTTPS redirects', async () => {
  const s = setup();
  s.effect.mockResolvedValue(ok(new HttpSuccess(202, { committed: true })) as never);
  const accepted = await s.api(request('{}'));
  expect(accepted.status).toBe(202);
  expect(await accepted.json()).toMatchObject({ data: { committed: true } });
  s.effect.mockResolvedValue(ok(new HttpSuccess(204)) as never);
  const dropped = await s.api(request('{}'));
  expect(dropped.status).toBe(204);
  expect(await dropped.text()).toBe('');
  s.effect.mockResolvedValue(ok(new HttpRedirect('https://example.invalid/education')) as never);
  const redirect = await s.api(request('{}'));
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get('location')).toBe('https://example.invalid/education');
  expect(redirect.headers.get('referrer-policy')).toBe('no-referrer');
  expect(redirect.headers.get('cache-control')).toBe('no-store');
});
it.each(['javascript:alert(1)', 'http://example.invalid/', 'https://user:secret@example.invalid/'])(
  'refuses unsafe redirect projection %s',
  (location) => {
    expect(() => new HttpRedirect(location)).toThrow();
  },
);
it('records only declared operation metadata, server request ID and bounded duration', async () => {
  const s = setup();
  s.effect.mockResolvedValue(ok(new HttpSuccess(202)) as never);
  const response = await s.api(request('{"private":"body-secret"}'));
  expect(response.status).toBe(202);
  expect(s.observe).toHaveBeenCalledWith(
    expect.objectContaining({
      operationId: 'syntheticCallback',
      method: 'POST',
      status: 202,
      requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      durationMs: expect.any(Number),
    }),
  );
  const record = s.observe.mock.calls[0]![0];
  expect(Object.keys(record).sort()).toEqual([
    'durationMs',
    'method',
    'operationId',
    'requestId',
    'status',
  ]);
  expect(JSON.stringify(record)).not.toMatch(
    /body-secret|caller-private-secret|authorization|callback$/,
  );
});
it('keeps observer failure outside the committed result and masks handler exceptions', async () => {
  const s = setup();
  s.observe.mockImplementation(() => {
    throw Error('observer private');
  });
  expect((await s.api(request('{}'))).status).toBe(200);
  s.effect.mockRejectedValue(Error('raw SQL secret'));
  const response = await s.api(request('{}'));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('raw SQL secret');
});
it.each([0, -1, 262145, Number.POSITIVE_INFINITY])(
  'refuses an invalid declared byte limit %s before listener composition',
  (limit) => {
    expect(() => setup('bytes', limit)).toThrow('Invalid HTTP body declaration');
  },
);
it('accepts case-insensitive JSON media types without changing signed bytes', async () => {
  const s = setup();
  expect((await s.api(request('{}', 'Application/JSON; charset=utf-8'))).status).toBe(200);
});
