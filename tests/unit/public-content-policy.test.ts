import { it, expect } from 'vitest';
import {
  validatePage,
  metadata,
  siteOrigin,
  titleTemplate,
  redirectRules,
  resolveRedirect,
  scorecard,
  decodeSize,
  learningLinks,
  type PublicPage,
  type LearningPage,
} from '../../packages/domain/src/public-policy.ts';
const at = '2026-10-25T00:00:00.000Z';
const base: PublicPage = {
  kind: 'article',
  contentKey: 'fixture',
  path: '/learn/tread',
  canonical: '/learn/tread',
  locale: 'en-US',
  market: 'US',
  title: 'Tread',
  summary: 'Reviewed summary',
  paragraphs: ['Public paragraph'],
  topics: ['buying'],
  related: ['/guides/buying'],
  author: 'Author',
  reviewer: 'Reviewer',
  reviewedAt: '2026-10-24T00:00:00.000Z',
  modifiedAt: '2026-10-24T00:00:01.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
};
it('derives typed metadata and restricts staging, alias, expired and future pages', () => {
  expect(validatePage(base)).toEqual(base);
  expect(metadata(base, 'https://example.test', true, at)).toMatchObject({
    robots: 'index,follow',
    canonical: 'https://example.test/learn/tread',
    structuredData: { '@type': 'Article' },
  });
  expect(
    metadata(
      { ...base, kind: 'glossary', path: '/glossary/tread', canonical: '/glossary/tread' },
      'https://example.test',
      true,
      at,
    ).structuredData['@type'],
  ).toBe('DefinedTerm');
  for (const [page, production] of [
    [base, false],
    [{ ...base, canonical: '/guides/buying' }, true],
    [{ ...base, expiresAt: '2026-10-24T12:00:00.000Z' }, true],
    [{ ...base, modifiedAt: '2026-11-01T00:00:00.000Z' }, true],
  ] as const)
    expect(metadata(page, 'https://example.test', production, at).robots).toBe('noindex,nofollow');
  expect(
    titleTemplate('{title} | {siteName} — {marketName}', {
      title: 'Tread',
      siteName: 'Tires',
      marketName: 'US',
    }),
  ).toBe('Tread | Tires — US');
});
it.each([
  { ...base, secret: 'forbidden' },
  { ...base, kind: 'review' },
  { ...base, kind: 'glossary' },
  { ...base, locale: 'invalid_thing' },
  { ...base, market: 'us' },
  { ...base, title: '<script>' },
  { ...base, summary: '' },
  { ...base, paragraphs: [] },
  { ...base, paragraphs: Array(101).fill('x') },
  { ...base, paragraphs: ['x'.repeat(2001)] },
  { ...base, topics: [] },
  { ...base, topics: ['unknown'] },
  { ...base, topics: ['buying', 'buying'] },
  { ...base, related: ['/report/token'] },
  { ...base, related: ['/learn/a', '/learn/a'] },
  { ...base, reviewedAt: 'bad' },
  { ...base, modifiedAt: '2026-10-23T00:00:00.000Z' },
  { ...base, expiresAt: '2026-10-23T00:00:00.000Z' },
])('rejects an invalid public DTO %#', (v) =>
  expect(() => validatePage(v as PublicPage)).toThrow(),
);
it.each([
  'http://example.test',
  'https://localhost',
  'https://127.0.0.1',
  'https://user:secret@example.test',
  'https://example.test:8443',
  'https://example.test/path',
  'https://example.test/?q=x',
  'https://example.test/#x',
])('rejects an unsafe site origin %s', (origin) => expect(() => siteOrigin(origin)).toThrow());
it('limits templates to known variables and escaped plain text', () => {
  expect(() => titleTemplate('{token}', { title: 'x', siteName: 'x', marketName: 'x' })).toThrow();
  expect(() =>
    titleTemplate('x'.repeat(301), { title: 'x', siteName: 'x', marketName: 'x' }),
  ).toThrow();
  expect(() =>
    titleTemplate('{title}', { title: '<x>', siteName: 'x', marketName: 'x' }),
  ).toThrow();
});
it('evaluates reviewed exact and linear slug redirects in one hop', () => {
  const rules = redirectRules([
    { source: '/learn/$1', target: '/guides/$1', mode: 'slug', code: 302 },
  ]);
  expect(resolveRedirect(rules, '/learn/tire-size')).toEqual({
    code: 302,
    target: '/guides/tire-size',
  });
  expect(resolveRedirect(rules, '/glossary/tread')).toBeNull();
  expect(
    resolveRedirect(redirectRules([{ source: '/learn/a', target: null, code: 410 }]), '/learn/a'),
  ).toEqual({ code: 410, target: null });
  expect(
    resolveRedirect(
      redirectRules([{ source: '/learn/a', target: '/guides/b', code: 301 }]),
      '/learn/a',
    ),
  ).toEqual({ code: 301, target: '/guides/b' });
  for (const x of [
    [{ source: '/learn/a', target: '/learn/a', code: 301 }],
    Array(201).fill({ source: '/learn/a', target: null, code: 410 }),
    [
      { source: '/learn/a', target: null, code: 410 },
      { source: '/learn/a', target: null, code: 410 },
    ],
    [{ source: '/learn/$1', target: '/guides/$1', mode: 'regex', code: 301 }],
    [{ source: '(a+)+', target: '/guides/$1', mode: 'slug', code: 301 }],
    [{ source: '/learn/$1', target: 'https://evil.test/$1', mode: 'slug', code: 301 }],
    [{ source: '/learn/a', target: '/guides/b', code: 307 }],
  ])
    expect(() => redirectRules(x as never)).toThrow();
  expect(() =>
    resolveRedirect(
      [
        { source: '/learn/$1', target: null, mode: 'slug', code: 410 },
        { source: '/learn/a', target: null, code: 410 },
      ],
      '/learn/a',
    ),
  ).toThrow();
});
it('keeps unsupported decoder formats honest and scorecards descriptive', () => {
  expect(decodeSize('235/60R18')).toMatchObject({ loadIndex: null, speedCode: null });
  expect(decodeSize('LT235/60R18 103H')).toMatchObject({ type: 'LT' });
  expect(decodeSize(null)).toMatchObject({ status: 'unsupported' });
  expect(decodeSize('x'.repeat(81))).toMatchObject({ status: 'unsupported' });
  const answers = Array.from({ length: 14 }, (_, i) => ({
    key: i + 1,
    answer: 'good' as 'good' | 'concern' | 'unknown',
  }));
  expect(scorecard(answers)).toMatchObject({ good: 14, summary: 'answers_recorded' });
  answers[0]!.answer = 'concern';
  expect(scorecard(answers).summary).toBe('discuss_concerns');
  answers[0]!.key = 2;
  expect(() => scorecard(answers)).toThrow();
});
it('selects no more than six current links, two per topic, checklist once and novelty only with permission', () => {
  const page = (i: number, topic: PublicPage['topics'][number] = 'buying'): LearningPage => ({
    ...base,
    contentKey: 'p' + i,
    path: '/learn/p' + i,
    canonical: '/learn/p' + i,
    topics: [topic],
    checklist: false,
  });
  const candidates = [
    page(1),
    page(2),
    page(3),
    page(4, 'winter'),
    page(5, 'winter'),
    page(6, 'wet'),
    page(7, 'ratings'),
    {
      ...page(8, 'maintenance'),
      path: '/guides/before-you-buy',
      canonical: '/guides/before-you-buy',
      checklist: true,
    },
  ];
  const weights = { buying: 10, winter: 8, wet: 7, ratings: 6, maintenance: 1 };
  const selected = learningLinks(candidates, weights, 'en-US', 'US', at, {
    permitted: false,
    clicked: ['p1'],
  });
  expect(selected).toHaveLength(6);
  expect(selected.at(-1)?.path).toBe('/guides/before-you-buy');
  expect(selected.filter((p) => p.contentKey === 'p3')).toHaveLength(0);
  expect(
    learningLinks(candidates, weights, 'en-US', 'US', at, { permitted: true, clicked: ['p1'] })[0]
      ?.contentKey,
  ).toBe('p2');
  expect(
    learningLinks(candidates, weights, 'zz-ZZ', 'US', at, { permitted: false, clicked: [] }),
  ).toEqual([]);
  const old = { ...page(9), reviewedAt: '2024-01-01T00:00:00.000Z' },
    expired = { ...page(10), expiresAt: '2026-10-24T12:00:00.000Z' };
  expect(
    learningLinks([old, expired, page(11)], { buying: 10 }, 'en-US', 'US', at, {
      permitted: false,
      clicked: [],
    }).map((p) => p.contentKey),
  ).toEqual(['p11', 'p9']);
  expect(() =>
    learningLinks(candidates, { forged: 1 } as never, 'en-US', 'US', at, {
      permitted: false,
      clicked: [],
    }),
  ).toThrow();
});
