import { invalid, ok, type Result } from './core.ts';
export type Unit = 'mm' | 'inch' | 'km' | 'mile' | 'percent';
export interface Quantity<U extends Unit = Unit> {
  readonly microunits: bigint;
  readonly unit: U;
}
// Six decimal places are the explicit v1 precision contract. Reject rounding and numeric coercion.
export function quantity<U extends Unit>(value: unknown, unit: U): Result<Quantity<U>> {
  if (
    !['mm', 'inch', 'km', 'mile', 'percent'].includes(unit) ||
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$/.test(value)
  )
    return invalid('quantity');
  const [whole, fraction = ''] = value.split('.');
  return ok(
    Object.freeze({
      microunits: BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, '0')),
      unit,
    }),
  );
}
export function quantityText(value: Quantity): string {
  const whole = value.microunits / 1000000n;
  const fraction = (value.microunits % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return whole.toString() + (fraction ? '.' + fraction : '');
}
export function distanceKm(value: Quantity<'km' | 'mile'>): Result<Quantity<'km'>> {
  const numerator =
    value.unit === 'mile' ? value.microunits * 1609344n : value.microunits * 1000000n;
  if (numerator % 1000000n !== 0n) return invalid('distance_precision');
  return quantity(quantityText({ microunits: numerator / 1000000n, unit: 'km' }), 'km');
}
