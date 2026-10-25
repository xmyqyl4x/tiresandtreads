import { quantity } from '../../domain/src/values/units.ts';
import { id } from '../../domain/src/values/core.ts';
import { sizeCode } from './input.ts';
import { current, recallFresh, sourceUsable } from './evidence.ts';
import {
  positions,
  type AssessmentInput,
  type EngineSnapshot,
  type Plan,
  type Reason,
  type Position,
} from './model.ts';

function samePositions(a: readonly Position[], b: readonly Position[]) {
  return (
    a.length === b.length &&
    new Set(a).size === a.length &&
    positions.every((p) => a.includes(p) === b.includes(p))
  );
}
function finite(n: number | null): n is number {
  return n !== null && Number.isSafeInteger(n) && n >= 0;
}
export function eligibility(input: AssessmentInput, snapshot: EngineSnapshot, plan: Plan) {
  const reasons = new Set<Reason>(),
    blocked = new Set<Reason>();
  const add = (r: Reason, hard = false) => {
    reasons.add(r);
    if (hard) blocked.add(r);
  };
  const fit = snapshot.fitment,
    policy = snapshot.policy;
  if (
    !policy.reviewed ||
    !policy.reviewedBy ||
    !id('staff', policy.reviewedBy).ok ||
    !policy.reviewedAt ||
    !current(policy.reviewedAt, policy.reviewDueAt, snapshot.asOf)
  )
    add('POLICY_REVIEW_REQUIRED');
  if (input.regionKey !== policy.regionKey) add('REGIONAL_POLICY_UNCONFIRMED');
  if (
    !sourceUsable(snapshot, policy.climateSourceId, 'climate') ||
    !sourceUsable(snapshot, policy.marketRulesSourceId, 'market_rules')
  )
    add('SOURCE_UNAVAILABLE');
  if (!fit || !fit.verified || !input.configurationId || fit.id !== input.configurationId)
    add('FITMENT_UNCONFIRMED');
  if (fit && !sourceUsable(snapshot, fit.sourceId, 'fitment')) add('SOURCE_UNAVAILABLE');
  if (!fit || !input.wheelPackage || input.wheelPackage !== fit.wheelPackage)
    add('WHEEL_PACKAGE_UNCONFIRMED');
  if (!recallFresh(snapshot)) add('RECALL_STALE');
  if (input.winterUse === 'unknown') add('CLIMATE_UNKNOWN');
  const seasonal = policy.seasonal.filter(
    (r) => r.strategy === input.strategy && r.winterUse === input.winterUse,
  );
  if (seasonal.length !== 1) add('SEASONAL_POLICY_UNKNOWN');
  const refs = new Set([snapshot.recall.datasetId]),
    recallRefs = new Set<string>();
  refs.add(policy.climateSourceId);
  refs.add(policy.marketRulesSourceId);
  if (fit) refs.add(fit.sourceId);
  for (const axle of ['front', 'rear'] as const) {
    const sku = plan[axle],
      requirements = fit?.axles.filter((a) => a.axle === axle) ?? [],
      required = requirements[0];
    refs.add(sku.sourceId);
    refs.add(sku.recall.sourceId);
    for (const ref of sku.recall.targetRefs) recallRefs.add(ref);
    if (!sourceUsable(snapshot, sku.sourceId, 'catalog')) add('SOURCE_UNAVAILABLE');
    if (
      !required ||
      requirements.length !== 1 ||
      required.quantity !== 2 ||
      required.unknownConstraints.length ||
      !fit?.drivetrain
    )
      add('FITMENT_CONSTRAINT_UNKNOWN');
    if (required) {
      if (input.sizes && sizeCode(required.sizeCode) !== input.sizes[axle])
        add('FITMENT_SIZE_CONFLICT');
      if (
        !sizeCode(required.sizeCode) ||
        !sizeCode(sku.sizeCode) ||
        sizeCode(required.sizeCode) !== sizeCode(sku.sizeCode)
      )
        add('SIZE_MISMATCH', true);
      const oeRim = quantity(required.rimInches, 'inch'),
        tireRim = quantity(sku.rimInches, 'inch');
      if (
        !oeRim.ok ||
        !tireRim.ok ||
        oeRim.value.microunits <= 0n ||
        oeRim.value.microunits !== tireRim.value.microunits
      )
        add('RIM_MISMATCH', true);
      if (!required.construction || !sku.construction || required.construction !== sku.construction)
        add('CONSTRUCTION_MISMATCH', true);
      for (const [minimum, actual, reason] of [
        [required.minLoadIndex, sku.loadIndex, 'INSUFFICIENT_LOAD'],
        [required.minSpeedRank, sku.speedRank, 'INSUFFICIENT_SPEED'],
      ] as const) {
        if (
          !finite(minimum) ||
          !finite(actual) ||
          minimum > 1000 ||
          actual > 1000 ||
          (reason === 'INSUFFICIENT_LOAD' && (minimum < 1 || actual < 1))
        )
          add('FITMENT_CONSTRAINT_UNKNOWN');
        else if (actual < minimum) add(reason, true);
      }
      if (
        required.loadRange === null ||
        required.xlRequired === null ||
        required.runFlatRequired === null
      )
        add('FITMENT_CONSTRAINT_UNKNOWN');
      if (required.loadRange !== null && required.loadRange !== 'not_required') {
        if (sku.loadRange === null) add('FITMENT_CONSTRAINT_UNKNOWN');
        else if (sku.loadRange !== required.loadRange) add('LOAD_RANGE_MISMATCH', true);
      }
      for (const [needed, actual, reason] of [
        [required.xlRequired, sku.xl, 'XL_REQUIRED'],
        [required.runFlatRequired, sku.runFlat, 'RUN_FLAT_REQUIRED'],
      ] as const)
        if (needed) {
          if (actual === null) add('FITMENT_CONSTRAINT_UNKNOWN');
          else if (!actual) add(reason, true);
        }
    }
    if (input.replace.some((p) => p.startsWith(axle))) {
      if (sku.available === false) add('MARKET_UNAVAILABLE', true);
      else if (
        sku.available !== true ||
        !sku.availabilityUntil ||
        !current(snapshot.asOf, sku.availabilityUntil, snapshot.asOf)
      )
        add('AVAILABILITY_UNKNOWN');
    }
    if (
      (sku.season &&
        ((sku.season === 'winter' && input.strategy !== 'winter_set') ||
          (input.strategy === 'winter_set' && sku.season !== 'winter'))) ||
      (sku.season && seasonal.length === 1 && !seasonal[0]!.classes.includes(sku.season))
    )
      add('SEASONAL_STRATEGY_MISMATCH', true);
    else if (!sku.season) add('SEASONAL_POLICY_UNKNOWN');
    if (seasonal[0]?.require3pmsf) {
      if (sku.threePmsf === null) add('WINTER_MARK_UNKNOWN');
      else if (!sku.threePmsf) add('WINTER_MARK_REQUIRED', true);
    }
    if (sku.recall.state === 'matched') add('RECALL_MATCHED', true);
    else if (sku.recall.state !== 'clear' || sku.recall.sourceId !== snapshot.recall.datasetId)
      add('RECALL_REVIEW_REQUIRED');
  }
  const replacement = fit?.replacement;
  if (!replacement) add('REPLACEMENT_POLICY_UNKNOWN');
  else {
    if (!replacement.patterns.some((p) => samePositions(p, input.replace)))
      add('REPLACEMENT_PATTERN_UNAPPROVED', true);
    if (
      plan.front.modelId !== plan.rear.modelId &&
      !replacement.permittedModelPairs.some(
        (p) => p.front === plan.front.modelId && p.rear === plan.rear.modelId,
      )
    )
      add('MODEL_MIX_UNAPPROVED', true);
    if (input.replace.length !== 4) {
      const check = plan.inspection;
      if (check?.retainedCondition === 'rejected') add('RETAINED_TIRE_CONDITION', true);
      if (
        !check ||
        check.retainedCondition !== 'accepted' ||
        !id('inspection', check.referenceId).ok ||
        check.configurationId !== fit?.id ||
        check.planId !== plan.id ||
        !samePositions(check.replaced, input.replace) ||
        !current(check.reviewedAt, check.validUntil, snapshot.asOf) ||
        check.wheels.length !== 4 ||
        !samePositions(
          check.wheels.map((w) => w.position),
          positions,
        ) ||
        check.wheels.some(
          (w) => w.skuId !== plan[w.position.startsWith('front') ? 'front' : 'rear'].id,
        )
      )
        add('INSPECTION_REQUIRED');
      else
        for (const [key, limit, reason] of [
          ['treadUm', replacement.maxTreadDifferenceUm, 'TREAD_DIFFERENCE_EXCEEDED'],
          [
            'circumferenceUm',
            replacement.maxCircumferenceDifferenceUm,
            'CIRCUMFERENCE_DIFFERENCE_EXCEEDED',
          ],
        ] as const) {
          const values = check.wheels.map((w) => w[key]);
          if (!finite(limit) || values.some((v) => !finite(v) || v <= 0))
            add('REPLACEMENT_MEASUREMENTS_UNKNOWN');
          else if (Math.max(...(values as number[])) - Math.min(...(values as number[])) > limit)
            add(reason, true);
        }
    }
  }
  const status = blocked.size ? 'blocked' : reasons.size ? 'unverified' : 'eligible';
  if (status === 'eligible') reasons.add('FITMENT_VERIFIED');
  return { id: plan.id, status, reasons, refs, recallRefs } as const;
}
