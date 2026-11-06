import { it, expect } from 'vitest';
import {
  completedWeek,
  suppressCells,
  domainSample,
} from '../../packages/domain/src/partner-insights-policy.ts';
const now = Date.parse('2026-11-06T12:00:00.000Z');
it('accepts only a canonical completed UTC Monday week within retention', () => {
  expect(completedWeek('2026-10-26', now).ok).toBe(true);
});
it.each([
  '2026-11-02',
  '2026-11-09',
  '2026-10-27',
  '2026-02-30',
  '2026-1-05',
  '2024-01-01',
  '',
  null,
])('refuses arbitrary or overlapping period %s', (v) => {
  expect(completedWeek(v, now).ok).toBe(false);
});
it('refuses an invalid server clock', () =>
  expect(completedWeek('2026-10-26', NaN).ok).toBe(false));
it('releases a fixed safe matrix with explicit zero cells', () => {
  expect(suppressCells(150n, { a: 100n, b: 50n, c: 0n })).toEqual({
    state: 'available',
    cells: { a: '100', b: '50', c: '0' },
  });
});
it.each([0n, 1n, 49n])('suppresses the entire small cohort %s', (n) =>
  expect(suppressCells(n, { a: n })).toEqual({ state: 'suppressed', cells: null }),
);
it.each([1n, 49n, 51n, 99n])(
  'complementary suppression prevents reconstructing the small side %s',
  (n) => expect(suppressCells(100n, { a: n, b: 0n })).toEqual({ state: 'suppressed', cells: null }),
);
it('does not publish a residual grand total on suppression', () =>
  expect(suppressCells(1000n, { a: 999n, b: 1n })).toEqual({ state: 'suppressed', cells: null }));
it('keeps exact integer arithmetic above Number precision', () =>
  expect(suppressCells(10000000000000000n, { a: 9999999999999950n })).toMatchObject({
    cells: { a: '9999999999999950' },
  }));
it.each([-1n, 101n])('rejects corrupt cell counts %s', (n) =>
  expect(() => suppressCells(100n, { a: n })).toThrow(),
);
const sample = {
  domain: 'mail.example.com',
  source: 'google_postmaster',
  day: '2026-11-05',
  status: 'available',
  reputation: 'medium',
  spamBasisPoints: 10,
  sampleSize: 1000,
};
it('normalizes a bounded structured domain-health import without network access', () =>
  expect(domainSample(sample, now)).toMatchObject({ ok: true, value: sample }));
it('records unavailable provider data explicitly without invented rates', () =>
  expect(
    domainSample(
      {
        ...sample,
        status: 'unavailable',
        reputation: null,
        spamBasisPoints: null,
        sampleSize: null,
      },
      now,
    ).ok,
  ).toBe(true));
it.each([
  { spamBasisPoints: -1 },
  { spamBasisPoints: 10001 },
  { spamBasisPoints: 1.5 },
  { sampleSize: 0 },
  { source: 'arbitrary' },
  { domain: 'https://mail.example.com' },
  { day: '2026-11-08' },
  { day: '2024-01-01' },
  { reputation: 'excellent' },
  { status: 'unavailable' },
  { freeText: 'private' },
])('refuses malformed or misleading domain samples %j', (change) =>
  expect(domainSample({ ...sample, ...change }, now).ok).toBe(false),
);
