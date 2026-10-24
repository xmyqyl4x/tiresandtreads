import { integer, invalid, ok, type Result } from './core.ts';
export interface Money {
  readonly minor: bigint;
  readonly currency: string;
}
// Registry membership is supplied by the caller from the selected versioned reference data.
export function money(
  minor: unknown,
  currency: unknown,
  enabled: readonly string[],
): Result<Money> {
  const amount = integer(minor, 0n);
  if (
    !amount.ok ||
    typeof currency !== 'string' ||
    !/^[A-Z]{3}$/.test(currency) ||
    !enabled.includes(currency)
  )
    return invalid('money');
  return ok(Object.freeze({ minor: amount.value, currency }));
}
