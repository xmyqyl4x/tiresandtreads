import { maxInt64 } from '../../domain/src/values/core.ts';
import { current, sourceUsable } from './evidence.ts';
import {
  metrics,
  type AssessmentInput,
  type EngineSnapshot,
  type Plan,
  type Metric,
  type Decision,
} from './model.ts';

export function comparableCost(input: AssessmentInput, snapshot: EngineSnapshot, plan: Plan) {
  const c = plan.cost;
  return c &&
    c.basis === (input.budget?.basis ?? 'installed') &&
    c.currency === 'USD' &&
    c.quantity === input.replace.length &&
    typeof c.amountMinor === 'bigint' &&
    c.amountMinor >= 0n &&
    c.amountMinor <= maxInt64 &&
    current(snapshot.asOf, c.validUntil, snapshot.asOf) &&
    sourceUsable(snapshot, c.sourceId, 'catalog')
    ? c.amountMinor
    : null;
}
export function rank(input: AssessmentInput, snapshot: EngineSnapshot, eligible: readonly Plan[]) {
  const weighted = metrics.filter((m) => (snapshot.policy.weights[m] ?? 0) > 0);
  const table = new Map<
    string,
    { values: Map<Metric, number>; confidence: number; missing: boolean; incompatible: boolean }
  >();
  for (const plan of eligible) {
    const values = new Map<Metric, number>();
    let confidence = 3,
      missing = false,
      incompatible = false;
    for (const metric of weighted) {
      const axleValues: number[] = [];
      for (const sku of [plan.front, plan.rear]) {
        const matches = sku.measurements.filter((m) => m.metric === metric),
          m = matches[0];
        if (
          !m ||
          matches.length !== 1 ||
          m.skuId !== sku.id ||
          m.valueBp === null ||
          !Number.isSafeInteger(m.valueBp) ||
          m.valueBp < 0 ||
          m.valueBp > 10000 ||
          !['high', 'medium', 'low'].includes(m.confidence) ||
          !current(m.reviewedAt, m.validUntil, snapshot.asOf) ||
          !sourceUsable(snapshot, m.sourceId, 'catalog')
        ) {
          missing = true;
          continue;
        }
        if (
          !snapshot.policy.comparisonKeys[metric] ||
          m.comparisonKey !== snapshot.policy.comparisonKeys[metric]
        )
          incompatible = true;
        confidence = Math.min(confidence, { high: 3, medium: 2, low: 1 }[m.confidence]);
        axleValues.push(m.valueBp);
      }
      if (axleValues.length === 2) values.set(metric, Math.min(...axleValues));
    }
    table.set(plan.id, { values, confidence, missing, incompatible });
  }
  const numeric = [...table.values()].every((x) => !x.missing && !x.incompatible);
  const scored = new Map<
    string,
    Pick<Decision, 'scoreBp' | 'confidence' | 'suitability'> & {
      reason: 'PREFERENCE_SCORE' | 'EVIDENCE_MISSING' | 'EVIDENCE_NOT_COMPARABLE';
    }
  >();
  for (const plan of eligible) {
    const row = table.get(plan.id)!;
    let numerator = 0n,
      denominator = 0n;
    for (const m of weighted) {
      const weight = BigInt(snapshot.policy.weights[m]! * (input.priorities.includes(m) ? 2 : 1));
      numerator += BigInt(row.values.get(m) ?? 0) * weight;
      denominator += weight;
    }
    scored.set(plan.id, {
      scoreBp: numeric ? Number((numerator + denominator / 2n) / denominator) : null,
      confidence: row.missing ? 0 : row.confidence,
      suitability: numeric ? 'comparable' : 'evidence_limited',
      reason: numeric
        ? 'PREFERENCE_SCORE'
        : [...table.values()].some((x) => x.incompatible)
          ? 'EVIDENCE_NOT_COMPARABLE'
          : 'EVIDENCE_MISSING',
    });
  }
  const costs = new Map(eligible.map((p) => [p.id, comparableCost(input, snapshot, p)]));
  // Price only breaks a tie when every ranked option has the same usable cost basis.
  const compareCosts = eligible.length > 0 && [...costs.values()].every((c) => c !== null);
  function compare(a: Decision, b: Decision) {
    const score = (b.scoreBp ?? -1) - (a.scoreBp ?? -1) || b.confidence - a.confidence;
    if (score) return score;
    if (compareCosts) {
      const ac = costs.get(a.id)!,
        bc = costs.get(b.id)!;
      if (ac !== bc) return ac! < bc! ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  return { scored, costs, compare };
}
