import { instant } from '../../domain/src/values/core.ts';
import { instantMilliseconds } from '../../domain/src/values/time.ts';
import type { EngineSnapshot, Source } from './model.ts';
export function current(reviewedAt: string, validUntil: string, asOf: string) {
  return (
    instant(reviewedAt).ok && instant(validUntil).ok && reviewedAt <= asOf && validUntil > asOf
  );
}
export function sourceUsable(snapshot: EngineSnapshot, sourceId: string, kind: Source['kind']) {
  const s = snapshot.sources.find((x) => x.datasetId === sourceId);
  return (
    !!s &&
    s.kind === kind &&
    s.market === 'US' &&
    current(s.fetchedAt, s.validUntil, snapshot.asOf) &&
    ['display', 'api', 'derived', 'cache', 'snapshot'].every(
      (k) => s.rights[k as keyof Source['rights']] === true,
    )
  );
}
export function recallFresh(snapshot: EngineSnapshot) {
  const r = snapshot.recall;
  const checked = instant(r.checkedAt),
    now = instant(snapshot.asOf);
  return (
    r.complete &&
    checked.ok &&
    now.ok &&
    r.checkedAt <= snapshot.asOf &&
    instantMilliseconds(now.value) - instantMilliseconds(checked.value) < 48 * 60 * 60 * 1000 &&
    sourceUsable(snapshot, r.datasetId, 'recall')
  );
}
