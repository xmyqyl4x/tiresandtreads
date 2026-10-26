import { it, expect } from 'vitest';
import {
  publicPath,
  redirectRules,
  decodeSize,
  scorecard,
  learningLinks,
  metadata,
} from '../../packages/domain/src/public-policy.ts';
it.each([
  '/report/secret',
  '/api/reports',
  '//evil.test',
  '/learn/a?token=x',
  '/learn/%61',
  '/admin',
  '/learn/a#x',
  '/learn/../private',
])('excludes private or ambiguous public path %s', (p) => expect(() => publicPath(p)).toThrow());
it('rejects redirect chains, loops, open redirects and unsafe patterns', () => {
  expect(() =>
    redirectRules([
      { source: '/learn/a', target: '/guides/b', code: 301 },
      { source: '/guides/b', target: '/learn/a', code: 302 },
    ]),
  ).toThrow();
  expect(() =>
    redirectRules([{ source: '/learn/a', target: 'https://evil.test', code: 301 }]),
  ).toThrow();
  expect(redirectRules([{ source: '/learn/a', target: null, code: 410 }])).toHaveLength(1);
});
it('decodes metric size components without claiming verified load/speed/fitment or guessing unsupported codes', () => {
  expect(decodeSize('P235/60R18 103H')).toMatchObject({
    widthMm: 235,
    aspectPercent: 60,
    rimInches: 18,
    loadIndex: 103,
    speedCode: 'H',
    fitmentVerified: false,
  });
  expect(decodeSize('31x10.5R15')).toEqual({ status: 'unsupported', fitmentVerified: false });
});
it('requires all fourteen scorecard answers and exposes unknowns without a safety verdict', () => {
  expect(() => scorecard([])).toThrow();
  expect(
    scorecard(Array.from({ length: 14 }, (_, i) => ({ key: i + 1, answer: 'unknown' as const }))),
  ).toMatchObject({ unknown: 14, summary: 'incomplete', safetyVerified: false });
});
it('never indexes private input even through metadata and excludes unreviewed content from learning', () => {
  expect(() =>
    metadata(
      { path: '/report/a' } as never,
      'https://example.test',
      true,
      '2026-10-25T00:00:00.000Z',
    ),
  ).toThrow();
  expect(
    learningLinks([], {}, 'en-US', 'US', '2026-10-25T00:00:00.000Z', {
      permitted: false,
      clicked: [],
    }),
  ).toEqual([]);
});
