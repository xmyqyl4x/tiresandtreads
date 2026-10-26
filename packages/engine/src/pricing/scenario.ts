import { id, instant } from '../../../domain/src/values/core.ts';
import { current } from '../evidence.ts';
import {
  amount,
  boundary,
  checked,
  ceil,
  distance,
  per1000,
  plus,
  requirePrice,
  times,
} from './arithmetic.ts';
import { allowedSource } from './quote.ts';
import type { Amount, LifeModel, QuoteEstimate, ScenarioInput, ScenarioEstimate } from './model.ts';
export function usableLife(q: QuoteEstimate, life: LifeModel | null) {
  if (
    !life ||
    life.kind !== 'modeled_life' ||
    life.reviewed !== true ||
    life.skuIds.length < 1 ||
    life.skuIds.length > 2 ||
    !current(life.reviewedAt, life.validUntil, q.asOf) ||
    !allowedSource(life.source, q.asOf)
  )
    return false;
  const skus = [...new Set(q.selection.map((i) => i.skuId))].sort();
  return (
    id('life_model', life.id).ok &&
    /^[A-Za-z0-9_.-]{1,80}$/.test(life.version) &&
    skus.every((s) => s !== null) &&
    [...new Set(life.skuIds)].sort().join('|') === skus.join('|')
  );
}
export function modeledCostPer1000(q: QuoteEstimate, life: LifeModel | null, unit: 'mile' | 'km') {
  return boundary(() => {
    if (q.freshness !== 'fresh' || !q.productKnown || !q.installed || !usableLife(q, life))
      return null;
    const lo = distance(life!.low),
      hi = distance(life!.high);
    return per1000(q.installed, lo, hi, unit);
  });
}
export function estimateScenario(s: ScenarioInput) {
  return boundary(() => {
    requirePrice(
      id('scenario', s.id).ok &&
        id('assumption_set', s.assumptionSetId).ok &&
        instant(s.asOf).ok &&
        /^[A-Z0-9_-]{1,80}$/.test(s.regionKey),
      'scenario_identity',
    );
    requirePrice(
      Number.isSafeInteger(s.years) &&
        s.years >= 1 &&
        s.years <= 20 &&
        ['one_set', 'two_set'].includes(s.strategy),
      'horizon',
    );
    requirePrice(
      s.sets.length === (s.strategy === 'one_set' ? 1 : 2) &&
        new Set(s.sets.map((x) => x.role)).size === s.sets.length &&
        (s.strategy === 'one_set'
          ? s.sets[0]!.role === 'year_round'
          : s.sets.every((x) => ['summer', 'winter'].includes(x.role))),
      'scenario_strategy',
    );
    const reasons = new Set<string>(),
      purchases: { role: string; minimum: number; maximum: number; lifeModelId: string }[] = [];
    const base = {
      mathVersion: '1.0.0' as const,
      id: s.id,
      assumptionSetId: s.assumptionSetId,
      regionKey: s.regionKey,
      asOf: s.asOf,
      currency: 'USD' as const,
      years: s.years,
      winterShareBp: s.winterShareBp,
      residualPolicy: s.residualPolicy,
      distanceUnit: s.annualDistance?.unit ?? null,
      issuanceAuthorized: false as const,
      assumptions: Object.freeze([
        'UNIFORM_ANNUAL_USAGE',
        'CONSTANT_CURRENT_NOMINAL_PRICES',
        'NO_INFLATION',
        'NO_DISCOUNTING',
        'ADDITIONAL_SWAPS_EXCLUDE_INITIAL_INSTALL',
        'MODEL_IS_NOT_SAFE_LIFE',
      ]),
    };
    if (s.eligibility !== 'eligible') reasons.add('SAFETY_UNVERIFIED');
    if (s.annualDistance === null) reasons.add('ANNUAL_DISTANCE_MISSING');
    if (s.winterShareBp === null) reasons.add('WINTER_SHARE_MISSING');
    else
      requirePrice(
        Number.isSafeInteger(s.winterShareBp) && s.winterShareBp >= 0 && s.winterShareBp <= 10000,
        'winter_share',
      );
    if (s.residualPolicy === null || s.residual === null)
      reasons.add('RESIDUAL_ASSUMPTION_MISSING');
    else {
      requirePrice(['zero', 'reviewed_estimate'].includes(s.residualPolicy), 'residual_policy');
      checked(s.residual);
      requirePrice(s.residualPolicy !== 'zero' || s.residual.high === 0n, 'residual_policy');
    }
    if (s.additionalSwapEvents === null || s.swapCost === null || s.storagePerYear === null)
      reasons.add('OPERATING_COST_MISSING');
    else
      requirePrice(
        Number.isSafeInteger(s.additionalSwapEvents) &&
          s.additionalSwapEvents >= 0 &&
          s.additionalSwapEvents <= 200,
        'swap_events',
      );
    const annual = s.annualDistance === null ? null : distance(s.annualDistance);
    const total = annual === null ? null : annual * BigInt(s.years),
      denominator = 10000n;
    const winter =
      total === null || s.winterShareBp === null ? null : total * BigInt(s.winterShareBp);
    const distances =
      total === null || winter === null
        ? null
        : Object.freeze({
            denominator: '10000' as const,
            totalNumerator: (total * denominator).toString(),
            summerNumerator: (total * denominator - winter).toString(),
            winterNumerator: winter.toString(),
          });
    const costs: Amount[] = [];
    for (const set of [...s.sets].sort((a, b) => (a.role < b.role ? -1 : 1))) {
      const q = set.quote;
      requirePrice(
        q.asOf === s.asOf && q.regionKey === s.regionKey && q.currency === 'USD',
        'scenario_scope',
      );
      if (q.freshness !== 'fresh' || !q.currentPriceClaim || !q.productKnown || !q.installed)
        reasons.add('CURRENT_INSTALLED_COST_MISSING');
      if (q.quantity !== 4) reasons.add('PARTIAL_LIFE_MODEL_UNSUPPORTED');
      if (set.upfrontWheels === null) reasons.add('WHEEL_COST_MISSING');
      else costs.push(checked(set.upfrontWheels));
      if (!usableLife(q, set.life)) {
        reasons.add('MODELED_LIFE_MISSING');
        continue;
      }
      const life = set.life!,
        lo = distance(life.low),
        hi = distance(life.high);
      requirePrice(lo > 0n && hi >= lo, 'modeled_life');
      if (life.calendarYears === null) {
        reasons.add('CALENDAR_MODEL_MISSING');
        continue;
      }
      requirePrice(
        Number.isSafeInteger(life.calendarYears) &&
          life.calendarYears >= 1 &&
          life.calendarYears <= 20,
        'calendar_model',
      );
      if (distances) {
        const travel =
          set.role === 'year_round'
            ? total! * denominator
            : set.role === 'summer'
              ? BigInt(distances.summerNumerator)
              : BigInt(distances.winterNumerator);
        const age = ceil(BigInt(s.years), BigInt(life.calendarYears));
        const byHigh = ceil(travel, hi * denominator),
          byLow = ceil(travel, lo * denominator);
        const minimum = [1n, age, byHigh].reduce((a, b) => (a > b ? a : b)),
          maximum = [1n, age, byLow].reduce((a, b) => (a > b ? a : b));
        requirePrice(maximum <= 1000n, 'scenario_bound');
        purchases.push(
          Object.freeze({
            role: set.role,
            minimum: Number(minimum),
            maximum: Number(maximum),
            lifeModelId: life.id,
          }),
        );
        if (q.installed) {
          const price = checked(q.installed);
          costs.push(amount(price.low * minimum, price.high * maximum));
        }
      }
    }
    const common = {
      ...base,
      annualDistanceNm: annual?.toString() ?? null,
      distances,
      purchases: Object.freeze(purchases),
      reasons: Object.freeze([...reasons].sort()),
    };
    if (reasons.size)
      return Object.freeze({
        ...common,
        state: 'unavailable' as const,
        total: null,
        costPer1000: null,
      }) satisfies ScenarioEstimate;
    costs.push(
      times(checked(s.swapCost!), BigInt(s.additionalSwapEvents!)),
      times(checked(s.storagePerYear!), BigInt(s.years)),
    );
    const gross = plus(costs),
      residual = checked(s.residual!);
    requirePrice(residual.high <= gross.low, 'residual_bound');
    const net = amount(gross.low - residual.high, gross.high - residual.low);
    return Object.freeze({
      ...common,
      state: 'modeled' as const,
      total: net,
      costPer1000: total! > 0n ? per1000(net, total!, total!, s.annualDistance!.unit) : null,
    }) satisfies ScenarioEstimate;
  });
}
