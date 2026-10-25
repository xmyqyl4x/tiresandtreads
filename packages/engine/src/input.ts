import { id, integer, invalid, ok } from '../../domain/src/values/core.ts';
import { metrics, positions, type AssessmentInput } from './model.ts';
function object(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;
}
function keys(x: Record<string, unknown>, expected: string) {
  return Object.keys(x).sort().join(',') === expected;
}
export function sizeCode(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const s = x.trim().toUpperCase();
  return /^[A-Z0-9/.-]{1,80}$/.test(s) ? s : null;
}
export function normalizeAssessment(raw: unknown) {
  const x = object(raw);
  if (
    !x ||
    !keys(
      x,
      'budget,configurationId,market,priorities,regionKey,replace,sizes,strategy,wheelPackage,winterUse',
    )
  )
    return invalid('assessment');
  const configuration =
    x.configurationId === null ? null : id('fitment_configuration', x.configurationId);
  if (
    (configuration && !configuration.ok) ||
    x.market !== 'US' ||
    typeof x.regionKey !== 'string' ||
    !/^[A-Z0-9_-]{1,80}$/.test(x.regionKey.trim().toUpperCase()) ||
    !(
      x.wheelPackage === null ||
      (typeof x.wheelPackage === 'string' &&
        x.wheelPackage.trim().length > 0 &&
        x.wheelPackage.length <= 200)
    ) ||
    typeof x.strategy !== 'string' ||
    !['year_round', 'summer_set', 'winter_set'].includes(x.strategy) ||
    typeof x.winterUse !== 'string' ||
    !['none', 'snow', 'ice', 'unknown'].includes(x.winterUse) ||
    !Array.isArray(x.replace) ||
    ![1, 2, 4].includes(x.replace.length) ||
    new Set(x.replace).size !== x.replace.length ||
    x.replace.some((p) => !positions.includes(p)) ||
    !Array.isArray(x.priorities) ||
    x.priorities.length > 3 ||
    new Set(x.priorities).size !== x.priorities.length ||
    x.priorities.some((m) => !metrics.includes(m))
  )
    return invalid('assessment');
  let sizes: AssessmentInput['sizes'] = null;
  if (x.sizes !== null) {
    const s = object(x.sizes);
    if (!s || !keys(s, 'front,rear')) return invalid('sizes');
    const front = sizeCode(s.front),
      rear = sizeCode(s.rear);
    if (!front || !rear) return invalid('sizes');
    sizes = Object.freeze({ front, rear });
  }
  let budget: AssessmentInput['budget'] = null;
  if (x.budget !== null) {
    const b = object(x.budget);
    if (
      !b ||
      !keys(b, 'basis,ceilingMinor,currency') ||
      typeof b.basis !== 'string' ||
      !['installed', 'merchandise'].includes(b.basis) ||
      b.currency !== 'USD'
    )
      return invalid('budget');
    const amount = integer(b.ceilingMinor, 0n);
    if (!amount.ok) return invalid('budget');
    budget = Object.freeze({
      basis: b.basis as 'installed' | 'merchandise',
      currency: 'USD',
      ceilingMinor: amount.value,
    });
  }
  const replace = x.replace,
    priorities = x.priorities;
  return ok(
    Object.freeze({
      market: 'US',
      regionKey: x.regionKey.trim().toUpperCase(),
      configurationId: configuration?.ok ? configuration.value : null,
      wheelPackage: typeof x.wheelPackage === 'string' ? x.wheelPackage.trim() : null,
      sizes,
      strategy: x.strategy as AssessmentInput['strategy'],
      winterUse: x.winterUse as AssessmentInput['winterUse'],
      replace: Object.freeze(positions.filter((p) => replace.includes(p))),
      priorities: Object.freeze(metrics.filter((m) => priorities.includes(m))),
      budget,
    } satisfies AssessmentInput),
  );
}
