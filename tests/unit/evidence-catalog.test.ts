import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  combinePins,
  compileEvidenceCatalog,
  manifestPaths,
  mergeReviewedPins,
  pinList,
  reviewPath,
} from '../../scripts/review/evidence-catalog.mjs';
const a = 'a'.repeat(64),
  b = 'b'.repeat(64),
  c = 'c'.repeat(64);
const old = [{ path: 'code.mjs', sha256: a }];
const next = [
  { path: 'code.mjs', sha256: b },
  { path: 'new.mjs', sha256: c },
];
const exception = {
  path: 'code.mjs',
  baselineSha256: a,
  currentSha256: b,
  reason: 'Reviewed local change',
};
it('reconciles exact documented old/current pins while retaining unchanged and newly added files', () => {
  expect(reviewPath('patches/deepmerge@4.3.1.patch')).toBe('patches/deepmerge@4.3.1.patch');
  expect(mergeReviewedPins(old, next, [exception])).toEqual(next);
  expect(mergeReviewedPins(old, [...old, next[1]!], [])).toHaveLength(2);
});
it('refuses silent latest-pin-wins and any removal of an earlier expected source', () => {
  expect(() => mergeReviewedPins(old, next, [])).toThrow('Evidence review input refused');
  expect(() => mergeReviewedPins(old, [next[1]], [])).toThrow('Evidence review input refused');
});
for (const change of [
  { ...exception, baselineSha256: c },
  { ...exception, currentSha256: c },
  { ...exception, path: 'not-old.mjs' },
  { ...exception, reason: ' ' },
  { ...exception, extra: true },
])
  it('refuses incorrect or unaccounted exception provenance', () => {
    expect(() => mergeReviewedPins(old, next, [change])).toThrow('Evidence review input refused');
  });
it('refuses duplicate, unchanged and unused exceptions', () => {
  expect(() => mergeReviewedPins(old, next, [exception, exception])).toThrow();
  expect(() => mergeReviewedPins(old, old, [{ ...exception, currentSha256: a }])).toThrow();
  expect(() => mergeReviewedPins([], next, [exception])).toThrow();
});
it('rejects duplicate/conflicting pins before hashes can be overwritten', () => {
  expect(() => pinList([...old, ...old])).toThrow();
  expect(() => pinList([...old, next[0]])).toThrow();
  expect(() => combinePins([old, next])).toThrow();
  expect(combinePins([old, old])).toEqual(old);
});
it('rejects malformed and oversized pin inventories', () => {
  for (const bad of [
    null,
    {},
    [null],
    [{ path: 'code.mjs', sha256: 'short' }],
    [{ path: 'code.mjs', sha256: a, extra: 'unreviewed' }],
    Array(513).fill(old[0]),
  ])
    expect(() => pinList(bad)).toThrow('Evidence review input refused');
});
for (const bad of [
  '../outside',
  '/outside',
  'C:/outside',
  'https://outside',
  'a\\outside',
  'a//b',
  'a/./b',
  'a/../b',
])
  it('refuses non-repository paths in an expected pin', () => {
    expect(() => reviewPath(bad)).toThrow('Evidence review input refused');
  });
it('returns defensive, deterministic pin records without mutating historical inputs', () => {
  const before = JSON.stringify({ old, next, exception });
  const result = mergeReviewedPins(old, next.slice().reverse(), [exception]);
  result.splice(0);
  expect(JSON.stringify({ old, next, exception })).toBe(before);
  expect(mergeReviewedPins(old, next, [exception])).toEqual(next);
});
function currentCatalog() {
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
  const manifests = manifestPaths.map(read);
  return {
    populated: manifests[0],
    dependency: manifests[1],
    review: manifests[2],
    index: manifests[3],
    baseline: read('docs/implementation/evidence/P1/p1-pr-027-evidence-review-baseline.json'),
  };
}
it('compiles the real reviewed catalog with every historical and current local exception accounted for', () => {
  const input = currentCatalog(),
    before = JSON.stringify(input);
  const catalog = compileEvidenceCatalog(input);
  expect(catalog.sources).toHaveLength(180);
  expect(catalog.historical).toHaveLength(160);
  expect(catalog.inputs).toHaveLength(4);
  expect(catalog.sp08).toHaveLength(23);
  expect(catalog.priorExceptions).toBe(5);
  expect(catalog.localToolExceptions).toBe(2);
  expect(JSON.stringify(input)).toBe(before);
});
for (const [name, change] of [
  [
    'missing earlier exception',
    (i: ReturnType<typeof currentCatalog>) => {
      i.dependency.sourceExceptions.pop();
    },
  ],
  [
    'false build provenance',
    (i: ReturnType<typeof currentCatalog>) => {
      i.review.sourceExceptions[0].baselineSha256 = 'e'.repeat(64);
    },
  ],
  [
    'substituted input path',
    (i: ReturnType<typeof currentCatalog>) => {
      i.review.inputPins[0].path = 'unrelated.json';
    },
  ],
  [
    'unaccounted reader change',
    (i: ReturnType<typeof currentCatalog>) => {
      i.baseline.localSourceExceptions.pop();
    },
  ],
  [
    'unreviewed production exception',
    (i: ReturnType<typeof currentCatalog>) => {
      i.baseline.localSourceExceptions[0].path = 'scripts/verify/s3.mjs';
    },
  ],
] as const)
  it(`refuses ${name} in the actual manifest shapes`, () => {
    const input = currentCatalog();
    change(input);
    expect(() => compileEvidenceCatalog(input)).toThrow('Evidence review input refused');
  });
