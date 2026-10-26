import {
  invalid,
  ok,
  maxInt64,
  type Result,
  type ValueError,
} from '../../../domain/src/values/core.ts';
import { quantity } from '../../../domain/src/values/units.ts';
import type { Amount, Distance } from './model.ts';
class PricingFault extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}
export function requirePrice(condition: unknown, field = 'pricing'): asserts condition {
  if (!condition) throw new PricingFault(field);
}
export function boundary<T>(work: () => T): Result<T, ValueError> {
  try {
    return ok(work());
  } catch (error) {
    return invalid(error instanceof PricingFault ? error.field : 'pricing');
  }
}
export function roundHalfUp(n: bigint, d: bigint) {
  requirePrice(n >= 0n && d > 0n, 'rounding');
  return (2n * n + d) / (2n * d);
}
export function ceil(n: bigint, d: bigint) {
  requirePrice(n >= 0n && d > 0n, 'division');
  return (n + d - 1n) / d;
}
export function amount(low: bigint, high = low): Amount {
  requirePrice(
    typeof low === 'bigint' &&
      typeof high === 'bigint' &&
      low >= 0n &&
      high >= low &&
      high <= maxInt64,
    'price_range',
  );
  return Object.freeze({ low, high, currency: 'USD' });
}
export function checked(a: Amount) {
  requirePrice(a.currency === 'USD', 'currency');
  return amount(a.low, a.high);
}
export function plus(values: readonly Amount[]): Amount {
  return amount(
    values.reduce((s, v) => s + v.low, 0n),
    values.reduce((s, v) => s + v.high, 0n),
  );
}
export function times(a: Amount, n: bigint) {
  requirePrice(n >= 0n, 'quantity');
  return amount(a.low * n, a.high * n);
}
export function rate(text: string) {
  requirePrice(typeof text === 'string' && /^(0(\.\d{1,6})?|1(\.0{1,6})?)$/.test(text), 'rate');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}
export function percentage(a: Amount, scaledRate: bigint) {
  return amount(
    roundHalfUp(a.low * scaledRate, 1000000n),
    roundHalfUp(a.high * scaledRate, 1000000n),
  );
}
export function distance(d: Distance): bigint {
  requirePrice(d.unit === 'mile' || d.unit === 'km', 'distance_unit');
  const parsed = quantity(d.value, d.unit);
  requirePrice(parsed.ok, 'distance');
  return parsed.value.microunits * (d.unit === 'mile' ? 1609344n : 1000000n);
}
export function per1000(
  a: Amount,
  lowDistanceNm: bigint,
  highDistanceNm: bigint,
  unit: 'mile' | 'km',
) {
  checked(a);
  requirePrice(lowDistanceNm > 0n && highDistanceNm >= lowDistanceNm, 'distance');
  const factor = distance({ value: '1000', unit });
  return amount((a.low * factor) / highDistanceNm, ceil(a.high * factor, lowDistanceNm));
}
