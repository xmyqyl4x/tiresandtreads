const prefix = 'docs/implementation/evidence/P1/';
export const manifestPaths = Object.freeze([
  prefix + 'p1-pr-027-populated-preservation-local.json',
  prefix + 'p1-pr-027-dependency-compatibility-local.json',
  prefix + 'p1-pr-027-acceptance-input-review-local.json',
  prefix + 'p1-pr-027-staging-handoff-index.json',
]);
export const supplementalHistoryPaths = Object.freeze([
  ...['local.json', 'sources.json', 'validation.md'].map(
    (suffix) => prefix + 'p1-pr-027-dependency-compatibility-' + suffix,
  ),
  ...['local.json', 'validation.md'].map(
    (suffix) => prefix + 'p1-pr-027-acceptance-input-review-' + suffix,
  ),
]);
export const inputPaths = Object.freeze(
  [
    's3-service-register.json',
    'p1-pr-027-staging-decision.json',
    'p1-pr-027-staging-operations-budget.json',
    'p1-pr-017-golden-review.json',
  ].map((name) => prefix + name),
);
function must(value) {
  if (!value) throw Error('Evidence review input refused');
}
function object(value) {
  must(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value;
}
export function reviewPath(value) {
  must(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 240 &&
      /^[a-zA-Z0-9_.@\-/]+$/.test(value) &&
      !value.startsWith('/') &&
      !value.split('/').some((part) => !part || part === '.' || part === '..'),
  );
  return value;
}
function hash(value) {
  must(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
  return value;
}
export function pinList(raw) {
  must(Array.isArray(raw) && raw.length <= 512);
  const seen = new Set();
  return raw.map((value) => {
    const entry = object(value);
    must(Object.keys(entry).sort().join(',') === 'path,sha256');
    const path = reviewPath(entry.path),
      sha256 = hash(entry.sha256);
    must(!seen.has(path));
    seen.add(path);
    return { path, sha256 };
  });
}
export function mergeReviewedPins(previous, current, rawExceptions) {
  const old = new Map(pinList(previous).map((entry) => [entry.path, entry.sha256]));
  const next = pinList(current),
    after = new Map(next.map((entry) => [entry.path, entry.sha256]));
  must(Array.isArray(rawExceptions) && rawExceptions.length <= 32);
  const exceptions = new Map();
  for (const value of rawExceptions) {
    const entry = object(value),
      path = reviewPath(entry.path);
    must(Object.keys(entry).sort().join(',') === 'baselineSha256,currentSha256,path,reason');
    hash(entry.baselineSha256);
    hash(entry.currentSha256);
    must(
      typeof entry.reason === 'string' &&
        entry.reason.trim().length > 0 &&
        entry.reason.length <= 1000,
    );
    must(!exceptions.has(path));
    exceptions.set(path, entry);
  }
  for (const [path, before] of old) {
    must(after.has(path));
    if (before !== after.get(path)) {
      const entry = exceptions.get(path);
      must(entry && entry.baselineSha256 === before && entry.currentSha256 === after.get(path));
      exceptions.delete(path);
    }
  }
  must(exceptions.size === 0);
  return next.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
export function combinePins(groups) {
  must(Array.isArray(groups) && groups.length <= 8);
  const map = new Map();
  for (const group of groups)
    for (const entry of pinList(group)) {
      must(!map.has(entry.path) || map.get(entry.path) === entry.sha256);
      map.set(entry.path, entry.sha256);
    }
  must(map.size <= 512);
  return [...map.keys()].sort().map((path) => ({ path, sha256: map.get(path) }));
}
export function compileEvidenceCatalog(raw) {
  const input = object(raw),
    baseline = object(input.baseline),
    populated = object(input.populated),
    dependency = object(input.dependency),
    review = object(input.review),
    index = object(input.index);
  must(baseline.schemaVersion === 1 && baseline.scope === 'local-evidence-baseline');
  must([populated, dependency, review, index].every((value) => value.schemaVersion === 1));
  const anchors = pinList(baseline.manifestPins);
  must(JSON.stringify(anchors.map((entry) => entry.path)) === JSON.stringify(manifestPaths));
  const supplemental = pinList(baseline.supplementalPriorPins);
  must(supplemental.length === 1 && supplemental[0].path === '.gitattributes');
  const older = pinList([
    ...populated.unchangedSourcePins,
    ...populated.sourcePins,
    ...supplemental,
  ]);
  const newer = mergeReviewedPins(
    older,
    [...dependency.unchangedSourcePins, ...dependency.sourcePins],
    dependency.sourceExceptions,
  );
  must(dependency.sourceExceptions.length === 4);
  const additions = pinList(review.sourcePins),
    combined = new Map(newer.map((entry) => [entry.path, entry]));
  must(
    JSON.stringify(
      additions.filter((entry) => combined.has(entry.path)).map((entry) => entry.path),
    ) === JSON.stringify(['Dockerfile']),
  );
  for (const entry of additions) combined.set(entry.path, entry);
  must(
    Array.isArray(review.sourceExceptions) &&
      review.sourceExceptions.length === 1 &&
      review.sourceExceptions[0].path === 'Dockerfile',
  );
  const current = mergeReviewedPins(newer, [...combined.values()], review.sourceExceptions);
  must(current.length === 180);
  must(
    Array.isArray(baseline.localSourceExceptions) && baseline.localSourceExceptions.length === 2,
  );
  must(
    JSON.stringify(baseline.localSourceExceptions.map((e) => object(e).path).sort()) ===
      JSON.stringify([
        'scripts/review/repository-files.d.mts',
        'scripts/review/repository-files.mjs',
      ]),
  );
  const replacements = new Map(
    baseline.localSourceExceptions.map((e) => [e.path, e.currentSha256]),
  );
  const sources = mergeReviewedPins(
    current,
    current.map((entry) => ({
      path: entry.path,
      sha256: replacements.get(entry.path) ?? entry.sha256,
    })),
    baseline.localSourceExceptions,
  );
  const extra = pinList(baseline.frozenSupplementalPins);
  must(
    JSON.stringify(extra.map((entry) => entry.path)) === JSON.stringify(supplementalHistoryPaths),
  );
  const historical = pinList([...dependency.frozenHistoricalEvidence, ...extra]);
  const inputs = pinList(review.inputPins),
    sp08 = pinList(index.receiptDigests);
  must(historical.length === 160 && inputs.length === 4 && sp08.length === 23);
  must(JSON.stringify(inputs.map((entry) => entry.path)) === JSON.stringify(inputPaths));
  must(historical.some((entry) => entry.path === prefix + 'p1-pr-027-io-inspection-local.json'));
  const all = combinePins([sources, historical, inputs, sp08, anchors]);
  return { sources, historical, inputs, sp08, all, priorExceptions: 5, localToolExceptions: 2 };
}
