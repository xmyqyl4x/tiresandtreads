import { it, expect } from 'vitest';
import { checklist, redirectRules } from '../../packages/domain/src/public-policy.ts';
import { parseRedirectCsv } from '../../packages/integrations/src/redirect-csv.ts';
import { contentIdentity } from '../../packages/integrations/src/content-identity.ts';
const items = () =>
  Array.from({ length: 14 }, (_, i) => ({
    key: i + 1,
    question: 'Synthetic question ' + (i + 1),
    goodAnswer: 'Reviewed answer required',
    redFlags: ['Clarify before purchase'],
    glossaryPath: '/glossary/tread',
  }));
it('validates fourteen reviewed checklist entries and never derives a tire safety verdict', () => {
  expect(checklist(items().reverse())).toMatchObject({ schemaVersion: 1, safetyVerified: false });
  expect(checklist(items().reverse()).items[0]?.key).toBe(1);
  expect(() => checklist([])).toThrow();
  expect(() => checklist(items().map((x) => ({ ...x, key: 1 })))).toThrow();
  for (const change of [
    { question: '' },
    { goodAnswer: '<script>' },
    { redFlags: [] },
    { glossaryPath: '/report/private' },
    { glossaryPath: '/learn/anything' },
    { key: 15 },
  ])
    expect(() => checklist(items().map((x, i) => (i ? x : { ...x, ...change })))).toThrow();
});
it('parses bounded quoted redirect CSV and rejects formula/unsafe targets and duplicate/ambiguous rules', () => {
  expect(
    parseRedirectCsv('source,target,code,mode\r\n"/learn/old","/guides/new",301,exact\r\n'),
  ).toEqual([{ source: '/learn/old', target: '/guides/new', code: 301, mode: 'exact' }]);
  expect(parseRedirectCsv('source,target,code,mode\n/learn/old,,410,exact')).toHaveLength(1);
  for (const text of [
    'wrong\n',
    'source,target,code,mode\na,b',
    'source,target,code,mode\n"/learn/a"x,,410,exact',
    'source,target,code,mode\n"/learn/a,,410,exact',
    'source,target,code,mode\n/learn/a,"=bad",301,exact',
    'source,target,code,mode\n/learn/a,"/guides/a""quote",301,exact',
    'x'.repeat(65537),
  ])
    expect(() => parseRedirectCsv(text)).toThrow();
  expect(() =>
    redirectRules([
      { source: '/learn/$1', target: null, code: 410, mode: 'slug' },
      { source: '/learn/a', target: null, code: 410 },
    ]),
  ).toThrow();
  expect(() => contentIdentity.id('')).toThrow();
  expect(contentIdentity.id('content')).toHaveLength(36);
});
