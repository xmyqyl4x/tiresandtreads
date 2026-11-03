import { it, expect, vi } from 'vitest';
import {
  createHttpApi,
  type HttpRoute,
  type HttpActor,
} from '../../packages/integrations/src/http/core.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import { PrivateDownload } from '../../packages/integrations/src/http/core.ts';
const origin = 'http://127.0.0.1:3210';
it('does not treat unrelated browser cookies as a competing owner credential', async () => {
  const s = setup();
  const response = await s.api(
    new Request(origin + '/api/v1/reports/example', {
      headers: { authorization: 'Bearer owner-token', cookie: 'unrelated_preference=1' },
    }),
  );
  expect(response.status).toBe(200);
  expect(s.effect).toHaveBeenCalledOnce();
});
it.each(['public', 'capability'] as const)(
  'ignores unrelated owner cookies on a %s route with an independent capability header',
  async (access) => {
    const authenticate = vi.fn(async () => null),
      effect = vi.fn(async () => ok(null));
    const api = createHttpApi({
      origin,
      routes: [
        { operationId: 'read', path: '/api/v1/mixed', method: 'GET', access, handle: effect },
      ],
      security: { authenticate, quota: async () => ({ allowed: true }) },
    });
    const response = await api(
      new Request(origin + '/api/v1/mixed', {
        headers: {
          cookie: 'tt_owner=existing-session',
          authorization: 'Bearer independent-capability',
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(authenticate).not.toHaveBeenCalled();
    expect(effect).toHaveBeenCalledOnce();
  },
);
it('serves only bounded PDF bytes with private headers and refuses unsupported file output', async () => {
  const s = setup();
  s.effect.mockResolvedValue(
    ok(new PrivateDownload(new Uint8Array([37, 80, 68, 70]), 'application/pdf')) as never,
  );
  const r = await s.api(s.request());
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toBe('application/pdf');
  expect(r.headers.get('content-disposition')).toContain('attachment');
  expect(await r.text()).toBe('%PDF');
  for (const file of [
    new PrivateDownload(new Uint8Array(), 'text/html'),
    new PrivateDownload(new Uint8Array(10485761), 'application/pdf'),
  ]) {
    s.effect.mockResolvedValue(ok(file) as never);
    expect((await s.api(s.request())).status).toBe(503);
  }
});
function setup() {
  let actor: HttpActor | null = { keys: [], csrf: 'session-csrf' };
  const effect = vi.fn(async () => ok({ revision: 9223372036854775807n }));
  const quota = vi.fn(async () => ({ allowed: true, retryAfterSeconds: 5 }));
  const routes: HttpRoute[] = [
    {
      method: 'POST',
      path: '/api/v1/reports',
      operationId: 'createReport',
      access: 'owner',
      command: true,
      handle: effect,
    },
    {
      method: 'GET',
      path: '/api/v1/reports/:id',
      operationId: 'readReport',
      access: 'owner',
      handle: effect,
    },
    {
      method: 'GET',
      path: '/api/v1/reference',
      operationId: 'reference',
      access: 'public',
      handle: effect,
    },
    {
      method: 'POST',
      path: '/api/v1/staff',
      operationId: 'staff',
      access: 'staff',
      handle: effect,
    },
  ];
  const api = createHttpApi({
    origin,
    routes,
    security: { authenticate: async () => actor, quota },
    now: () => 1000000,
  });
  const request = (path = '/api/v1/reports', init: RequestInit = {}) =>
    new Request(origin + path, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'x-csrf-token': 'session-csrf',
        'idempotency-key': 'synthetic_command_001',
      },
      body: '{}',
      ...init,
    });
  return {
    api,
    effect,
    quota,
    request,
    setActor: (value: HttpActor | null) => {
      actor = value;
    },
  };
}
it('preserves int64 decimals and emits private response headers with a server request ID', async () => {
  const s = setup(),
    r = await s.api(s.request());
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ data: { revision: '9223372036854775807' } });
  for (const header of [
    'cache-control',
    'x-robots-tag',
    'x-content-type-options',
    'referrer-policy',
    'content-security-policy',
    'x-request-id',
  ])
    expect(r.headers.has(header)).toBe(true);
  expect(s.effect).toHaveBeenCalledOnce();
});
it.each([
  ['missing origin', {}, 403],
  ['cross-site origin', { origin: 'https://evil.invalid' }, 403],
  [
    'missing CSRF',
    { origin, 'content-type': 'application/json', 'idempotency-key': 'synthetic_command_001' },
    403,
  ],
  [
    'bad key',
    {
      origin,
      'x-csrf-token': 'session-csrf',
      'content-type': 'application/json',
      'idempotency-key': 'short',
    },
    400,
  ],
  [
    'wrong type',
    {
      origin,
      'x-csrf-token': 'session-csrf',
      'content-type': 'text/plain',
      'idempotency-key': 'synthetic_command_001',
    },
    415,
  ],
  [
    'oversized body',
    {
      origin,
      'x-csrf-token': 'session-csrf',
      'content-type': 'application/json',
      'idempotency-key': 'synthetic_command_001',
      'content-length': '65537',
    },
    413,
  ],
  ['ambiguous credentials', { authorization: 'Bearer opaque', cookie: 'tt_owner=opaque' }, 400],
  ['host rebinding', { host: 'evil.invalid' }, 403],
] as const)('rejects %s before a service effect', async (_label, headers, status) => {
  const s = setup(),
    r = await s.api(s.request(undefined, { headers }));
  expect(r.status).toBe(status);
  expect(s.effect).not.toHaveBeenCalled();
});
it.each([
  '/missing',
  '/api/v1/reference?kind=a&kind=b',
  '/api/v1/reports/%ZZ',
  '/api/v1/reports/a%2fb',
])('bounds malformed path/query %s', async (path) => {
  const s = setup(),
    r = await s.api(new Request(origin + path));
  expect([400, 404]).toContain(r.status);
  expect(s.effect).not.toHaveBeenCalled();
});
it('denies non-loopback callers, unauthenticated owners, stale MFA and unsupported methods', async () => {
  const s = setup();
  expect((await s.api(s.request(), '192.0.2.1')).status).toBe(403);
  s.setActor(null);
  expect((await s.api(s.request())).status).toBe(401);
  s.setActor({ keys: [], csrf: 'session-csrf' });
  expect((await s.api(s.request('/api/v1/staff'))).status).toBe(403);
  const r = await s.api(new Request(origin + '/api/v1/reference', { method: 'PUT' }));
  expect(r.status).toBe(405);
  expect(r.headers.get('allow')).toBe('GET');
  expect(s.effect).not.toHaveBeenCalled();
});
it('fails closed when quota is denied or unavailable without dispatching a command', async () => {
  const s = setup();
  s.quota.mockResolvedValue({ allowed: false, retryAfterSeconds: 5 });
  const r = await s.api(s.request());
  expect(r.status).toBe(429);
  expect(r.headers.get('retry-after')).toBe('5');
  s.quota.mockRejectedValue(Error('postgres://private-secret'));
  const down = await s.api(s.request());
  expect(down.status).toBe(503);
  expect(await down.text()).not.toContain('private-secret');
  expect(s.effect).not.toHaveBeenCalled();
});
it('masks foreign-owner absence and raw errors and preserves commit uncertainty', async () => {
  for (const [code, status] of [
    ['forbidden', 404],
    ['conflict', 409],
    ['commit_unknown', 503],
    ['invalid_input', 400],
    ['internal', 500],
  ] as const) {
    const s = setup();
    s.effect.mockResolvedValue(fail(failure(code, true)) as never);
    const r = await s.api(s.request());
    expect(r.status).toBe(status);
    expect(await r.json()).toMatchObject({ retryable: true });
  }
  const s = setup();
  s.effect.mockRejectedValue(Error('SELECT secret_value'));
  expect(await (await s.api(s.request())).text()).not.toContain('secret_value');
});
it.each(['{', '"unterminated', ' '.repeat(65537)])(
  'rejects malformed and chunked oversized JSON',
  async (body) => {
    const s = setup(),
      r = await s.api(s.request(undefined, { body }));
    expect([400, 413]).toContain(r.status);
    expect(s.effect).not.toHaveBeenCalled();
  },
);
it('refuses public/non-HTTP origins and duplicate route declarations', () => {
  for (const value of ['https://127.0.0.1', 'http://example.invalid', 'http://127.0.0.1/path'])
    expect(() =>
      createHttpApi({
        origin: value,
        routes: [],
        security: { authenticate: async () => null, quota: async () => ({ allowed: true }) },
      }),
    ).toThrow();
  const route: HttpRoute = {
    path: '/api/v1/a',
    method: 'GET',
    operationId: 'a',
    access: 'public',
    handle: async () => ok(null),
  };
  expect(() =>
    createHttpApi({
      origin,
      routes: [route, route],
      security: { authenticate: async () => null, quota: async () => ({ allowed: true }) },
    }),
  ).toThrow();
});
