import { id, instant, invalid, ok } from '../../domain/src/values/core.ts';
import { eligibility } from './eligibility.ts';
import { rank } from './ranking.ts';
import {
  metrics,
  type AssessmentInput,
  type Decision,
  type EngineResult,
  type EngineSnapshot,
} from './model.ts';

export function evaluate(input: AssessmentInput, snapshot: EngineSnapshot) {
  const ids = snapshot.plans.map((p) => p.id),
    sources = snapshot.sources.map((s) => s.datasetId);
  if (
    !instant(snapshot.asOf).ok ||
    !id('bundle', snapshot.bundleId).ok ||
    snapshot.plans.length > 1000 ||
    snapshot.plans.some(
      (p) =>
        [p.front, p.rear].some(
          (s) =>
            !id('sku', s.id).ok ||
            !id('tire_model', s.modelId).ok ||
            s.measurements.length > 9 ||
            s.recall.targetRefs.length > 1000,
        ) ||
        (p.inspection && p.inspection.wheels.length > 4),
    ) ||
    snapshot.policy.seasonal.length > 12 ||
    (snapshot.fitment &&
      (snapshot.fitment.axles.length > 4 ||
        (snapshot.fitment.replacement &&
          (snapshot.fitment.replacement.patterns.length > 15 ||
            snapshot.fitment.replacement.permittedModelPairs.length > 100)))) ||
    new Set(ids).size !== ids.length ||
    ids.some((v) => !id('plan', v).ok) ||
    snapshot.sources.length > 16 ||
    new Set(sources).size !== sources.length ||
    snapshot.sources.some(
      (s) => ![s.datasetId, s.providerId, s.licenseId].every((v) => id('source', v).ok),
    ) ||
    !/^[A-Za-z0-9_.-]{1,80}$/.test(snapshot.policy.version) ||
    !/^[A-Za-z0-9_.-]{1,80}$/.test(snapshot.policy.scoringVersion) ||
    Object.keys(snapshot.policy.weights).some(
      (k) => !metrics.includes(k as (typeof metrics)[number]),
    ) ||
    Object.values(snapshot.policy.weights).some(
      (w) => !Number.isSafeInteger(w) || w < 0 || w > 10000,
    ) ||
    !Object.values(snapshot.policy.weights).some((w) => w > 0)
  )
    return invalid('engine_snapshot');
  const checked = snapshot.plans.map((plan) => ({
    plan,
    check: eligibility(input, snapshot, plan),
  }));
  const ranked = rank(
    input,
    snapshot,
    checked.filter((p) => p.check.status === 'eligible').map((p) => p.plan),
  );
  const decisions: Decision[] = checked.map(({ plan, check }) => {
    const scored = ranked.scored.get(plan.id),
      cost = ranked.costs.get(plan.id),
      reasons = [...check.reasons];
    let budget: Decision['budget'] = 'not_requested';
    if (scored) {
      reasons.push(scored.reason);
      if (
        input.priorities.some(
          (m) => !(snapshot.policy.weights[m] && snapshot.policy.weights[m]! > 0),
        )
      )
        reasons.push('PRIORITY_UNSUPPORTED');
      if (input.budget) {
        budget = cost === null ? 'unknown' : cost! > input.budget.ceilingMinor ? 'above' : 'within';
        if (budget === 'unknown') reasons.push('BUDGET_UNVERIFIED');
        if (budget === 'above') reasons.push('ABOVE_BUDGET');
      }
    }
    return Object.freeze({
      id: plan.id,
      status: check.status,
      reasons: Object.freeze(reasons.sort()),
      sourceIds: Object.freeze([...check.refs].sort()),
      recallReferences: Object.freeze([...check.recallRefs].sort()),
      scoreBp: scored?.scoreBp ?? null,
      confidence: scored?.confidence ?? 0,
      suitability: scored?.suitability ?? 'evidence_limited',
      budget,
    });
  });
  const eligible = decisions.filter((d) => d.status === 'eligible').sort(ranked.compare);
  const shortlist = (budget: readonly Decision['budget'][]) =>
    Object.freeze(
      eligible
        .filter((d) => budget.includes(d.budget))
        .slice(0, 5)
        .map((d) => d.id),
    );
  const result: EngineResult = {
    purpose: 'technical_evaluation',
    issuanceAuthorized: false,
    versions: Object.freeze({
      engine: '1.0.0',
      schema: 1,
      bundleId: snapshot.bundleId,
      policy: snapshot.policy.version,
      scoring: snapshot.policy.scoringVersion,
      datasets: Object.freeze([...sources].sort()),
    }),
    asOf: snapshot.asOf,
    decisions: Object.freeze(decisions.sort((a, b) => (a.id < b.id ? -1 : 1))),
    picks: shortlist(['within', 'not_requested']),
    aboveBudget: shortlist(['above']),
    budgetUnknown: shortlist(['unknown']),
    exclusions: Object.freeze(
      decisions
        .filter((d) => d.status !== 'eligible')
        .slice(0, 5)
        .map((d) => d.id),
    ),
  };
  return ok(Object.freeze(result));
}
