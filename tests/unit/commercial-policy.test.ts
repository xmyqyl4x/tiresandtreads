import { it, expect } from 'vitest';
import {
  commercialPolicy,
  placement,
  adReport,
  affiliateDestination,
} from '../../packages/domain/src/commercial-policy.ts';
import { adRoute, commercialDay } from '../../packages/domain/src/commercial-policy.ts';
const config = () => ({
  schemaVersion: 1 as const,
  issuedAt: '2026-10-01T00:00:00.000Z',
  expiresAt: '2026-10-02T00:00:00.000Z',
  accountId: null,
  adsTxt: [],
  blockedCategories: [],
  blockedUrls: [],
  slots: [
    {
      key: 'education_one',
      route: 'education' as const,
      width: 320,
      height: 250,
      housePath: '/guides/before-you-buy',
      houseLabel: 'Before you buy',
    },
  ],
});
const signals = {
  consent: true,
  cmpAvailable: true,
  gpc: false,
  under13: false,
  internal: false,
  blocked: false,
  filled: true,
};
it('validates a bounded versioned policy and rejects form, private, auto or unreserved inventory', () => {
  expect(commercialPolicy(config())).toEqual(config());
  for (const change of [
    { slots: [{ ...config().slots[0], route: 'home' }] },
    { autoAds: true },
    { slots: [{ ...config().slots[0], width: 0 }] },
    { expiresAt: '2026-10-03T00:00:00.000Z' },
    { adsTxt: ['<script>'] },
    { slots: [config().slots[0], config().slots[0]] },
  ])
    expect(() => commercialPolicy({ ...config(), ...change })).toThrow();
});
it.each([
  '/',
  '/reports/secret',
  '/compare',
  '/privacy',
  '/learn/tire-care?token=secret',
  '/learn/tire-care#report',
  '/tools/decoder',
])('rejects all placements on %s including house content', (path) => {
  expect(placement(config(), path, signals, true, true)).toEqual([]);
});
it.each(['consent', 'cmpAvailable', 'filled'])(
  'uses a reserved house fallback when %s is absent',
  (key) => {
    expect(
      placement(config(), '/learn/tire-care', { ...signals, [key]: false }, true, true)[0]?.mode,
    ).toBe('house');
  },
);
it.each(['gpc', 'internal', 'blocked'])('uses house fallback for %s', (key) => {
  expect(
    placement(config(), '/learn/tire-care', { ...signals, [key]: true }, true, true)[0]?.mode,
  ).toBe('house');
});
it('requires activation, a verified network and all consent signals, and excludes known children', () => {
  expect(placement(config(), '/learn/tire-care', signals, true, true)[0]?.mode).toBe('external');
  expect(placement(config(), '/learn/tire-care', signals, false, true)[0]?.mode).toBe('house');
  expect(placement(config(), '/learn/tire-care', signals, true, false)[0]?.mode).toBe('house');
  expect(
    placement(config(), '/learn/tire-care', { ...signals, under13: true }, true, true),
  ).toEqual([]);
});
it('allows only static HTTPS destinations at the reviewed retailer origin without private parameters', () => {
  expect(affiliateDestination('https://shop.example/tires?ref=site', 'https://shop.example')).toBe(
    'https://shop.example/tires?ref=site',
  );
  for (const url of [
    'https://shop.example.evil/tires',
    'http://shop.example/',
    'https://user@shop.example/',
    'https://shop.example/?email=secret',
    'https://shop.example/#token',
    'https://shop.example/tires\\secret',
    'https://shop.example/?next=https://evil.example',
  ])
    expect(() => affiliateDestination(url, 'https://shop.example')).toThrow();
});
const report = () => ({
  accountId: '11111111-1111-4111-8111-111111111111',
  start: '2026-10-01',
  end: '2026-10-02',
  sourceRevision: 'r1',
  sourceGeneration: '1',
  fetchedAt: '2026-10-03T00:00:00.000Z',
  rows: [
    {
      day: '2026-10-01',
      dimension: 'all',
      currency: 'USD',
      impressions: '10',
      eligibleRequests: '20',
      revenueMinor: '-123',
      revenueStatus: 'finalized' as const,
      viewableImpressions: null,
      consentRequests: null,
      totalRequests: null,
      latencySamples: null,
      latencyTotalMs: null,
    },
  ],
});
it('preserves signed integer corrections, currencies and absent measurements in complete snapshots', () => {
  expect(adReport(report())).toEqual(report());
  expect(adReport({ ...report(), rows: [] }).rows).toEqual([]);
  for (const change of [
    { rows: [report().rows[0], report().rows[0]] },
    { start: '2026-02-30' },
    { sourceGeneration: '0' },
    { rows: [{ ...report().rows[0], dimension: 'report:secret' }] },
    { rows: [{ ...report().rows[0], revenueMinor: '1.5' }] },
    { rows: [{ ...report().rows[0], impressions: '900719925474099200000' }] },
    { rows: [{ ...report().rows[0], consentRequests: '5' }] },
    { rows: [{ ...report().rows[0], viewableImpressions: '11' }] },
    { rows: [{ ...report().rows[0], email: 'secret' }] },
  ])
    expect(() => adReport({ ...report(), ...change })).toThrow();
});
it('recognizes each exact public route class and validates calendar dates', () => {
  for (const [path, route] of [
    ['/guides/tire-care', 'education'],
    ['/glossary/tread', 'glossary'],
    ['/tires/models/example', 'tire_model'],
    ['/tires/sizes/example', 'tire_size'],
  ])
    expect(adRoute(path!)).toBe(route);
  expect(commercialDay('2024-02-29')).toBe('2024-02-29');
  expect(() => commercialDay('2026-02-29')).toThrow();
});
it('rejects untrusted shapes and malformed consent signals', () => {
  for (const raw of [null, [], {}, 'policy']) expect(() => commercialPolicy(raw)).toThrow();
  expect(() =>
    placement(config(), '/learn/example', { ...signals, consent: 'yes' } as never, true, true),
  ).toThrow();
  for (const change of [
    { accountId: 'bad' },
    { issuedAt: 'bad' },
    { schemaVersion: 2 },
    { adsTxt: ['example.com, fixture, DIRECT'] },
    { slots: Array(9).fill(config().slots[0]) },
    { slots: [{ ...config().slots[0], housePath: '/reports/private' }] },
    { slots: [{ ...config().slots[0], houseLabel: '<script>' }] },
  ])
    expect(() => commercialPolicy({ ...config(), ...change })).toThrow();
  expect(() =>
    commercialPolicy({
      ...config(),
      slots: [
        ...config().slots,
        { ...config().slots[0], key: 'second' },
        { ...config().slots[0], key: 'third' },
      ],
    }),
  ).toThrow();
});
it('bounds aggregate observations, nullable pairs, request grain and arbitrary private input', () => {
  const row = report().rows[0]!;
  expect(
    adReport({
      ...report(),
      rows: [
        {
          ...row,
          viewableImpressions: '5',
          consentRequests: '0',
          totalRequests: '0',
          latencySamples: '2',
          latencyTotalMs: '100',
        },
      ],
    }).rows,
  ).toHaveLength(1);
  for (const change of [
    { eligibleRequests: '9' },
    { revenueMinor: '-1000000000001' },
    { latencySamples: '0', latencyTotalMs: '0' },
    { latencySamples: '1', latencyTotalMs: '60001' },
    { latencySamples: '1' },
    { consentRequests: '2', totalRequests: '1' },
    { currency: 'usd' },
    { day: '2026-10-03' },
    { dimension: 'slot:00000000-0000-0000-0000-000000000000' },
  ])
    expect(() => adReport({ ...report(), rows: [{ ...row, ...change }] })).toThrow();
});
it('keeps external serving disabled until category and URL blocks can be synchronized with a network', () => {
  const blocked = commercialPolicy({
    ...config(),
    blockedCategories: ['sensitive_content'],
    blockedUrls: ['https://blocked.example'],
  });
  expect(placement(blocked, '/learn/example', signals, true, true)[0]?.mode).toBe('house');
  expect(
    placement({ ...blocked, blockedCategories: [] }, '/learn/example', signals, true, true)[0]
      ?.mode,
  ).toBe('house');
  for (const change of [
    { blockedUrls: ['http://invalid.example'] },
    { blockedCategories: ['<script>'] },
    { blockedUrls: ['https://blocked.example', 'https://blocked.example'] },
  ])
    expect(() => commercialPolicy({ ...config(), ...change })).toThrow();
});
