import { it, expect, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fixtureServer as server } from '../setup.ts';
import {
  createSearchProvider,
  createPublicCrawler,
} from '../../packages/integrations/src/seo-providers.ts';
const endpoint = 'https://www.googleapis.com/webmasters/v3/sites/:property/searchAnalytics/query';
const options = {
  origin: 'https://example.test',
  property: 'https://example.test/',
  accessToken: async () => 'synthetic-token',
  indexNowKey: 'synthetic-key',
  verified: true,
};
afterEach(() => vi.useRealTimers());
it('uses an authorized exact registered page filter and daily aggregate dimensions only', async () => {
  let seen: unknown;
  server.use(
    http.post(endpoint, async ({ request }) => {
      seen = await request.json();
      expect(request.headers.get('authorization')).toBe('Bearer synthetic-token');
      return HttpResponse.json({
        responseAggregationType: 'byPage',
        rows: [{ keys: ['2026-10-01'], clicks: 3, impressions: 12, position: 2.5 }],
      });
    }),
  );
  const p = createSearchProvider(options);
  expect(await p.daily('/learn/tread', '2026-10-01', '2026-10-01')).toEqual([
    { day: '2026-10-01', clicks: 3n, impressions: 12n, positionSum: '30' },
  ]);
  expect(seen).toMatchObject({
    dimensions: ['date'],
    dataState: 'final',
    dimensionFilterGroups: [
      {
        filters: [
          { dimension: 'page', operator: 'equals', expression: 'https://example.test/learn/tread' },
        ],
      },
    ],
  });
});
it('treats omitted rows as missing and validates provider scope before any request', async () => {
  server.use(http.post(endpoint, () => HttpResponse.json({ responseAggregationType: 'byPage' })));
  expect(
    await createSearchProvider(options).daily('/learn/tread', '2026-10-01', '2026-10-01'),
  ).toEqual([]);
  const off = createSearchProvider({ origin: options.origin, verified: false });
  expect(off.enabled).toBe(false);
  expect(await off.notify(['/learn/tread'])).toBe('disabled');
  await expect(off.daily('/learn/tread', 'x', 'y')).rejects.toThrow();
  expect(() => createSearchProvider({ ...options, property: 'sc-domain:other.test' })).toThrow();
  expect(() => createSearchProvider({ ...options, indexNowKey: 'bad' })).toThrow();
  expect(createSearchProvider({ ...options, property: 'sc-domain:example.test' }).enabled).toBe(
    true,
  );
});
it.each([
  { responseAggregationType: 'byProperty', rows: [] },
  { responseAggregationType: 'byPage', rows: {} },
  {
    responseAggregationType: 'byPage',
    rows: [{ keys: ['2026-10-01'], clicks: -1, impressions: 10, position: 2 }],
  },
  {
    responseAggregationType: 'byPage',
    rows: [{ keys: ['2026-09-01'], clicks: 1, impressions: 10, position: 2 }],
  },
  {
    responseAggregationType: 'byPage',
    rows: [{ keys: ['2026-10-01'], clicks: 1.5, impressions: 10, position: 2 }],
  },
  {
    responseAggregationType: 'byPage',
    rows: Array(32).fill({ keys: ['2026-10-01'], clicks: 1, impressions: 10, position: 2 }),
  },
  {
    responseAggregationType: 'byPage',
    rows: Array(2).fill({ keys: ['2026-10-01'], clicks: 1, impressions: 10, position: 2 }),
  },
])('rejects malformed/partial/mis-scoped provider data %#', async (response) => {
  server.use(http.post(endpoint, () => HttpResponse.json(response)));
  await expect(
    createSearchProvider(options).daily('/learn/tread', '2026-10-01', '2026-10-01'),
  ).rejects.toThrow();
});
it.each([401, 403, 429, 500])('fails closed on provider status %s', async (status) => {
  server.use(http.post(endpoint, () => new HttpResponse(null, { status })));
  await expect(
    createSearchProvider(options).daily('/learn/tread', '2026-10-01', '2026-10-01'),
  ).rejects.toThrow();
});
it('rejects corrupt/oversized bytes and invalid bearer material', async () => {
  for (const text of ['{', 'a'.repeat(262145)]) {
    server.use(http.post(endpoint, () => HttpResponse.text(text)));
    await expect(
      createSearchProvider(options).daily('/learn/tread', '2026-10-01', '2026-10-01'),
    ).rejects.toThrow();
  }
  await expect(
    createSearchProvider({ ...options, accessToken: async () => 'bad\nheader' }).daily(
      '/learn/tread',
      '2026-10-01',
      '2026-10-01',
    ),
  ).rejects.toThrow();
});
it('notifies IndexNow only for public same-site paths, distinguishes pending verification and never promises indexing', async () => {
  let payload: unknown;
  server.use(
    http.post('https://api.indexnow.org/indexnow', async ({ request }) => {
      payload = await request.json();
      return new HttpResponse(null, { status: 200 });
    }),
  );
  const p = createSearchProvider(options);
  expect(await p.notify(['/learn/tread'])).toBe('received');
  expect(payload).toMatchObject({
    host: 'example.test',
    keyLocation: 'https://example.test/synthetic-key.txt',
    urlList: ['https://example.test/learn/tread'],
  });
  server.use(
    http.post('https://api.indexnow.org/indexnow', () => new HttpResponse(null, { status: 202 })),
  );
  expect(await p.notify(['/learn/tread'])).toBe('pending_key');
  server.use(
    http.post('https://api.indexnow.org/indexnow', () => new HttpResponse(null, { status: 422 })),
  );
  await expect(p.notify(['/learn/tread'])).rejects.toThrow();
  await expect(p.notify(['/report/token'])).rejects.toThrow();
  await expect(p.notify([])).rejects.toThrow();
  await expect(p.notify(['/learn/tread', '/learn/tread'])).rejects.toThrow();
});
it('bounds same-origin crawl observations, refuses private requests and does not follow redirects', async () => {
  server.use(
    http.get('https://example.test/learn/tread', () =>
      HttpResponse.html(
        `<head><title>Tread</title><meta name="description" content="Reviewed"><link rel="canonical" href="https://example.test/learn/tread"><meta name="robots" content="index,follow"></head><a href="/guides/buying">Buying</a>`,
      ),
    ),
  );
  const p = createPublicCrawler('https://example.test');
  expect(await p.observe('/learn/tread')).toEqual({
    status: 200,
    title: 'Tread',
    description: 'Reviewed',
    canonical: 'https://example.test/learn/tread',
    robots: 'index,follow',
    links: ['/guides/buying'],
  });
  await expect(p.observe('/report/token')).rejects.toThrow();
  server.use(
    http.get(
      'https://example.test/learn/tread',
      () =>
        new HttpResponse('Moved', {
          status: 302,
          headers: { Location: 'http://127.0.0.1/private', 'X-Robots-Tag': 'noindex' },
        }),
    ),
  );
  expect(await p.observe('/learn/tread')).toMatchObject({
    status: 302,
    title: null,
    robots: 'noindex',
  });
  server.use(
    http.get('https://example.test/learn/tread', () => HttpResponse.text('x'.repeat(262145))),
  );
  await expect(p.observe('/learn/tread')).rejects.toThrow();
});
