import { it, expect, vi } from 'vitest';
import { readEducation } from '../../packages/integrations/src/education-public.ts';
import { fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import {
  jsonForHtml,
  sitemapXml,
  decodedMarkingSchema,
  educationRedirectSchema,
  checklistAnswersSchema,
  checklistScoreSchema,
  checklistStorageSchema,
} from '../../packages/contracts/src/education.ts';
import {
  validateEditorialDraft,
  referenceUrl,
  transitionEditorial,
  type EditorialActor,
} from '../../packages/domain/src/editorial.ts';
import seeds from '../../content/education/en-US.drafts.json';
const base = () => structuredClone(seeds.records[0]!);
it('keeps all 25 glossary and seven guide records explicitly unreviewed and structurally valid', () => {
  expect(seeds.reviewStatus).toBe('draft');
  expect(seeds.reviewedAt).toBeNull();
  expect(seeds.reviewer).toBeNull();
  expect(seeds.actualEditorialAcceptance).toBe(false);
  expect(seeds.records.filter((r) => r.kind === 'glossary')).toHaveLength(25);
  expect(seeds.records).toHaveLength(32);
  expect(new Set(seeds.records.map((r) => r.key)).size).toBe(32);
  expect(new Set(seeds.records.map((r) => r.path)).size).toBe(32);
  seeds.records.forEach((r) => expect(validateEditorialDraft(r)).toEqual(r));
  expect(seeds.records.filter((r) => r.kind === 'glossary').map((r) => r.path)).toEqual(
    [
      'tire-size',
      'aspect-ratio',
      'wheel-diameter-radial',
      'load-index',
      'speed-rating',
      'xl-load-range',
      'p-metric-lt',
      'utqg-treadwear',
      'utqg-traction',
      'temperature-grade',
      'm-plus-s',
      'three-peak-mountain-snowflake',
      'all-season',
      'all-weather',
      'winter-tires',
      'summer-tires',
      'dot-date',
      'tread-depth',
      'cold-pressure-tpms',
      'rotation',
      'alignment',
      'awd-matching',
      'run-flat',
      'ev-considerations',
      'installed-cost-warranties',
    ].map((s) => '/glossary/' + s),
  );
  expect(
    new Set(seeds.records.filter((r) => r.kind === 'glossary').flatMap((r) => r.topics)),
  ).toEqual(new Set(['size', 'ratings', 'types', 'maintenance', 'buying']));
  const questions = seeds.records.find((r) => r.path === '/guides/before-you-buy')!.questions!;
  expect(questions).toHaveLength(14);
  questions.forEach((q) => expect(seeds.records.some((r) => r.path === q.glossaryPath)).toBe(true));
});
it('bounds optional checklist storage and rejects fabricated score totals or safety claims', () => {
  const answers = Array.from({ length: 14 }, (_, i) => ({ key: i + 1, answer: 'unknown' }));
  expect(checklistAnswersSchema.safeParse(answers).success).toBe(true);
  expect(checklistAnswersSchema.safeParse([...answers.slice(0, 13), answers[0]]).success).toBe(
    false,
  );
  expect(checklistAnswersSchema.safeParse(answers.slice(1)).success).toBe(false);
  const score = { good: 0, concerns: 0, unknown: 14, summary: 'incomplete', safetyVerified: false };
  expect(checklistScoreSchema.safeParse(score).success).toBe(true);
  for (const value of [
    { ...score, safetyVerified: true },
    { ...score, good: 1 },
    { ...score, summary: 'answers_recorded' },
  ])
    expect(checklistScoreSchema.safeParse(value).success).toBe(false);
  const saved = {
    version: 1,
    revision: '2026-11-03T12:00:00.000Z',
    expiresAt: '2026-12-03T12:00:00.000Z',
    answers,
  };
  expect(checklistStorageSchema.safeParse(saved).success).toBe(true);
  for (const value of [
    { ...saved, email: 'private@example.test' },
    { ...saved, version: 2 },
    { ...saved, answers: [] },
  ])
    expect(checklistStorageSchema.safeParse(value).success).toBe(false);
});
it('escapes JSON-LD without changing its semantic text or permitting a script terminator', () => {
  const value = { text: '</script><script>alert(1)</script>&\u2028\u2029' };
  const result = jsonForHtml(value);
  expect(result).not.toContain('<');
  expect(result).not.toContain('&');
  expect(JSON.parse(result)).toEqual(value);
});
it('serializes eligible public XML and excludes private, capability, cross-site and query-bearing URLs', () => {
  const page = {
    loc: 'https://example.test/glossary/section-width',
    lastmod: '2026-11-03T12:00:00.000Z',
  };
  expect(sitemapXml([page])).toContain('<loc>' + page.loc + '</loc>');
  expect(sitemapXml([])).not.toContain('<url>');
  for (const loc of [
    'https://example.test/reports/private',
    'https://example.test/glossary/width?token=secret',
    'https://example.test/glossary/width#secret',
    'javascript:alert(1)',
  ])
    expect(() => sitemapXml([{ ...page, loc }])).toThrow();
  expect(() => sitemapXml([page, { ...page, loc: 'https://other.test/glossary/width' }])).toThrow();
  expect(() => sitemapXml(Array(1001).fill(page))).toThrow();
  expect(() => sitemapXml([{ ...page, lastmod: 'invalid' }])).toThrow();
});
it('refuses unsafe redirect targets and fabricated decoding capabilities', () => {
  expect(
    educationRedirectSchema.safeParse({ redirect: { code: 301, target: '/learn/tire-basics' } })
      .success,
  ).toBe(true);
  expect(educationRedirectSchema.safeParse({ redirect: { code: 410, target: null } }).success).toBe(
    true,
  );
  for (const redirect of [
    { code: 301, target: 'https://evil.invalid' },
    { code: 301, target: '/reports/private' },
    { code: 410, target: '/learn/tire-basics' },
    { code: 302, target: null },
  ])
    expect(educationRedirectSchema.safeParse({ redirect }).success).toBe(false);
  expect(
    decodedMarkingSchema.safeParse({ status: 'unsupported', fitmentVerified: false }).success,
  ).toBe(true);
  expect(
    decodedMarkingSchema.safeParse({ status: 'unsupported', fitmentVerified: true }).success,
  ).toBe(false);
});
it.each([
  null,
  [],
  {},
  { ...base(), key: ' ' },
  { ...base(), title: '<script>' },
  { ...base(), summary: '' },
  { ...base(), path: '/admin/private' },
  { ...base(), kind: 'unknown' },
  { ...base(), kind: 'glossary', path: '/learn/a' },
  { ...base(), paragraphs: null },
  { ...base(), paragraphs: [] },
  { ...base(), paragraphs: Array(101).fill('a') },
  { ...base(), paragraphs: ['a'.repeat(2001)] },
  { ...base(), topics: null },
  { ...base(), topics: [] },
  { ...base(), topics: ['size', 'size'] },
  { ...base(), topics: ['unknown'] },
  { ...base(), topics: Array(15).fill('size') },
  { ...base(), related: null },
  { ...base(), related: Array(13).fill('/learn/a') },
  { ...base(), related: ['/learn/a', '/learn/a'] },
  { ...base(), related: ['/reports/private'] },
  { ...base(), references: null },
  { ...base(), references: [] },
  { ...base(), references: Array(9).fill(base().references[0]) },
  { ...base(), references: [{ title: '', url: 'https://example.test/a' }] },
  { ...base(), references: [{ ...base().references[0], extra: 'unsafe' }] },
  { ...base(), paragraphs: Array(31).fill('a'.repeat(1990)) },
  { ...base(), questions: [] },
])('refuses malformed or unbounded draft %#', (value) => {
  expect(() => validateEditorialDraft(value)).toThrow();
});
it.each([
  'http://example.test/a',
  'https://user:pass@example.test/a',
  'https://example.test:4433/a',
  'https://example.test/a#proof',
  'https://example.test/a?token=proof',
  'https://localhost/a',
  'https://127.0.0.1/a',
  'https://[::1]/a',
  'https://[2001:db8::1]/a',
  'invalid',
])('refuses nonpublic reference %s', (url) => expect(() => referenceUrl(url)).toThrow());
it('shares a bounded public read and redirect boundary without forwarding arbitrary query data', async () => {
  const readPage = vi.fn(async () => fail(failure('not_found'))),
    redirect = vi.fn(async (): Promise<{ code: 301; target: string } | null> => null),
    runtime = { services: { readPage }, routing: { redirect } };
  expect(
    await readEducation(runtime, new URLSearchParams({ path: '/learn/tire-basics' })),
  ).toMatchObject({ ok: false, error: { code: 'not_found' } });
  expect(readPage).toHaveBeenCalledWith('/learn/tire-basics', 'en-US', 'US');
  for (const query of [
    'path=/reports/private',
    'path=/learn/tire-basics&token=private',
    'path=/learn/a&path=/learn/b',
    'locale=fr',
    'market=CA',
  ])
    expect(await readEducation(runtime, new URLSearchParams(query))).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
  redirect.mockResolvedValueOnce({ code: 301, target: '/learn/tire-basics' });
  expect(await readEducation(runtime, new URLSearchParams({ path: '/learn/old' }))).toEqual({
    ok: true,
    value: { redirect: { code: 301, target: '/learn/tire-basics' } },
  });
  redirect.mockRejectedValueOnce(Error('synthetic private failure'));
  expect(await readEducation(runtime, new URLSearchParams())).toMatchObject({
    ok: false,
    error: { code: 'unavailable' },
  });
});
it('requires the existing document for noncreate actions and preserves immutable publication identity', () => {
  const actor: EditorialActor = { id: 'a', cmsId: 'b', name: 'Author', roles: ['author'] },
    at = '2026-11-03T12:00:00.000Z',
    hash = 'a'.repeat(64),
    command = {
      id: 'doc',
      expectedRevision: 0,
      key: 'command-0001',
      action: 'save',
      draft: base(),
    };
  const saved = transitionEditorial(null, actor, command, hash, at);
  expect(() =>
    transitionEditorial(null, actor, { ...command, action: 'submit', draft: undefined }, hash, at),
  ).toThrow();
  for (const draft of [
    { ...base(), key: 'changed' },
    { ...base(), kind: 'article' },
    { ...base(), path: '/glossary/changed' },
  ])
    expect(() =>
      transitionEditorial(saved, actor, { ...command, expectedRevision: 1, draft }, hash, at),
    ).toThrow('conflict');
  expect(() =>
    transitionEditorial(saved, actor, { ...command, id: 'other', expectedRevision: 1 }, hash, at),
  ).toThrow('conflict');
  for (const expectedRevision of [-1, NaN, 2147483647])
    expect(() =>
      transitionEditorial(saved, actor, { ...command, expectedRevision }, hash, at),
    ).toThrow();
  for (const key of ['bad!', 'x'.repeat(101)])
    expect(() => transitionEditorial(null, actor, { ...command, key }, hash, at)).toThrow();
  expect(() => transitionEditorial(null, actor, command, 'bad', at)).toThrow();
  expect(() => transitionEditorial(null, actor, command, hash, 'invalid')).toThrow();
});
it('rejects a review, permits a fresh submission and refuses another author submitting it', () => {
  const author: EditorialActor = { id: 'a', cmsId: 'a', name: 'Author', roles: ['author'] },
    reviewer: EditorialActor = { id: 'b', cmsId: 'b', name: 'Reviewer', roles: ['reviewer'] },
    at = '2026-11-03T12:00:00.000Z',
    hash = 'a'.repeat(64),
    baseCommand = {
      id: 'doc',
      expectedRevision: 0,
      key: 'command-0001',
      action: 'save',
      draft: base(),
    };
  const saved = transitionEditorial(null, author, baseCommand, hash, at),
    submitted = transitionEditorial(
      saved,
      author,
      { ...baseCommand, action: 'submit', expectedRevision: 1 },
      hash,
      at,
    ),
    rejected = transitionEditorial(
      submitted,
      reviewer,
      { ...baseCommand, action: 'reject', expectedRevision: 2 },
      hash,
      at,
    );
  expect(rejected.state).toBe('rejected');
  expect(rejected.review).toBeNull();
  expect(
    transitionEditorial(
      rejected,
      author,
      { ...baseCommand, action: 'submit', expectedRevision: 3 },
      hash,
      at,
    ).state,
  ).toBe('review');
  expect(() =>
    transitionEditorial(
      saved,
      { ...author, id: 'other' },
      { ...baseCommand, action: 'submit', expectedRevision: 1 },
      hash,
      at,
    ),
  ).toThrow('forbidden');
});
