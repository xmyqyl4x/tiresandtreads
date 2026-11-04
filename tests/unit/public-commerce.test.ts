import { it, expect, vi } from 'vitest';
import { readCommercialPage, commerceResponse } from '../../apps/web/src/commercial/read.ts';
import { publicCommerceView } from '../../packages/contracts/src/public-commerce.ts';
const env = {
  APP_ENV: 'dev-local',
  PROVIDER_MODE: 'fixtures',
  LOCAL_WEB_PREVIEW: 'enabled',
  LOCAL_WEB_ORIGIN: 'http://127.0.0.1:8380',
  LOCAL_API_ORIGIN: 'http://127.0.0.1:9411',
  LOCAL_COMMERCIAL_UI: 'enabled',
};
const empty = { network: 'held', slots: [], affiliates: [], refreshSeconds: null };
const request = (path = '/ads.txt', extra: RequestInit = {}) =>
  new Request(env.LOCAL_WEB_ORIGIN + path, {
    ...extra,
    headers: { host: '127.0.0.1:8380', ...extra.headers },
  });
it('makes no I/O when the feature is disabled or the host is outside the local profile', async () => {
  const send = vi.fn<typeof fetch>();
  expect(
    await readCommercialPage(
      '/learn/tire-basics',
      { ...env, LOCAL_COMMERCIAL_UI: 'disabled' },
      send,
    ),
  ).toBeUndefined();
  expect(
    (
      await commerceResponse(
        request('/go/approved_retailer', { headers: { host: 'evil.example' } }),
        'affiliate',
        'approved_retailer',
        env,
        send,
      )
    ).status,
  ).toBe(404);
  expect(send).not.toHaveBeenCalled();
});
it('makes no inventory request from private, unreviewed or form paths', async () => {
  const send = vi.fn<typeof fetch>();
  for (const path of [
    '/preview/report',
    '/guides/size-decoder',
    '/guides/before-you-buy',
    '/learn/unreviewed',
  ])
    expect(await readCommercialPage(path, env, send)).toBeUndefined();
  expect(send).not.toHaveBeenCalled();
});
it('uses one fixed first-party read without cookies, private query fields or credentials', async () => {
  const send = vi.fn<typeof fetch>(async () => Response.json({ data: empty }));
  expect(await readCommercialPage('/learn/tire-basics', env, send)).toEqual(empty);
  expect(String(send.mock.calls[0]![0])).toBe(
    env.LOCAL_API_ORIGIN + '/api/v1/public-commerce/inventory?path=%2Flearn%2Ftire-basics',
  );
  expect(send.mock.calls[0]![1]).toMatchObject({
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    headers: { origin: env.LOCAL_API_ORIGIN },
  });
});
it.each([
  { ...empty, network: 'ready' },
  { ...empty, staffId: 'PRIVATE' },
  { ...empty, slots: new Array(3).fill({}) },
])('refuses an invalid or activating public DTO', (value) => {
  expect(publicCommerceView.safeParse(value).success).toBe(false);
});
it('withholds unapproved ads.txt entries and serves only the current approved body', async () => {
  const none = vi.fn<typeof fetch>(async () =>
    Response.json({ data: { status: 'not_connected', body: '', version: null } }),
  );
  const r = await commerceResponse(request(), 'ads-txt', '', env, none);
  expect(r.headers.get('content-type')).toContain('text/plain');
  expect(await r.text()).not.toContain('pub-');
  const ready = vi.fn<typeof fetch>(async () =>
    Response.json({
      data: { status: 'ready', body: 'example.invalid, synthetic, DIRECT\n', version: 1 },
    }),
  );
  expect(await (await commerceResponse(request(), 'ads-txt', '', env, ready)).text()).toBe(
    'example.invalid, synthetic, DIRECT\n',
  );
});
it('rechecks a retailer at click time and redirects without referrer or private parameters', async () => {
  const send = vi.fn<typeof fetch>(async () =>
    Response.json({
      data: {
        destination: 'https://shop.example/tires?ref=site',
        checkedAt: new Date().toISOString(),
        disclosure: 'We may earn a commission from this link.',
        rel: 'sponsored noopener noreferrer',
        referrerPolicy: 'no-referrer',
      },
    }),
  );
  const r = await commerceResponse(
    request('/go/approved_retailer'),
    'affiliate',
    'approved_retailer',
    env,
    send,
  );
  expect(r.status).toBe(302);
  expect(r.headers.get('location')).toBe('https://shop.example/tires?ref=site');
  expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  expect(r.headers.get('cache-control')).toBe('no-store');
  expect(
    (
      await commerceResponse(
        request('/go/approved_retailer?report=PRIVATE'),
        'affiliate',
        'approved_retailer',
        env,
        send,
      )
    ).status,
  ).toBe(404);
  expect(send).toHaveBeenCalledOnce();
});
it.each(['https://evil.example/?email=PRIVATE', 'http://shop.example/', 'https://127.0.0.1/a'])(
  'refuses unsafe redirect data: %s',
  async (destination) => {
    const send = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: {
          destination,
          checkedAt: new Date().toISOString(),
          disclosure: 'We may earn a commission from this link.',
          rel: 'sponsored noopener noreferrer',
          referrerPolicy: 'no-referrer',
        },
      }),
    );
    expect(
      (
        await commerceResponse(
          request('/go/approved_retailer'),
          'affiliate',
          'approved_retailer',
          env,
          send,
        )
      ).status,
    ).toBe(404);
  },
);
it('bounds failed, redirected, malformed and oversized upstream data while preserving safe house fallback', async () => {
  for (const response of [
    new Response('private', { status: 503 }),
    new Response('invalid'),
    new Response('x'.repeat(32769)),
  ]) {
    const send = vi.fn<typeof fetch>(async () => response);
    expect(await readCommercialPage('/learn/tire-basics', env, send)).toBeUndefined();
  }
});
it.each(['headers', 'body'])(
  'bounds a stalled upstream %s even when it ignores cancellation',
  async (phase) => {
    vi.useFakeTimers();
    try {
      const send = vi.fn<typeof fetch>(async () => {
        if (phase === 'headers') return new Promise(() => {});
        return new Response(new ReadableStream({ start() {} }));
      });
      const read = readCommercialPage('/learn/tire-basics', env, send);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await read).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  },
);
