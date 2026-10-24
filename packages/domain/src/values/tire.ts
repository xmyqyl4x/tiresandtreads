import { invalid, ok, type Evidence, type Result } from './core.ts';
import type { Quantity } from './units.ts';
export interface TireSize {
  readonly code: string;
  readonly width: Evidence<Quantity<'mm'>>;
  readonly aspect: Evidence<Quantity<'percent'>>;
  readonly rim: Quantity<'inch'>;
}
// Shape validation is not a fitment verification or interpretation of an arbitrary size code.
export function tireSize(value: TireSize): Result<TireSize> {
  if (
    value.code.length < 1 ||
    value.code.length > 80 ||
    value.rim.microunits <= 0n ||
    value.rim.microunits >= 1000000000n ||
    (value.width.state === 'known' &&
      (value.width.value.microunits <= 0n || value.width.value.microunits >= 10000000000n)) ||
    (value.aspect.state === 'known' &&
      (value.aspect.value.microunits <= 0n || value.aspect.value.microunits > 200000000n))
  )
    return invalid('tire_size');
  return ok(Object.freeze({ ...value }));
}
