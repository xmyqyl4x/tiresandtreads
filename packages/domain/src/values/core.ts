export type Result<T, E = ValueError> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;
export interface ValueError {
  readonly code: 'invalid_value';
  readonly field: string;
}
export function ok<T>(value: T): Result<T, never> {
  return Object.freeze({ ok: true, value });
}
export function fail<E>(error: E): Result<never, E> {
  return Object.freeze({ ok: false, error });
}
export function invalid(field: string): Result<never> {
  return fail(Object.freeze({ code: 'invalid_value' as const, field }));
}
declare const brand: unique symbol;
export type Id<K extends string> = string & { readonly [brand]: K };
export type Revision = bigint & { readonly [brand]: 'revision' };
export type Instant = string & { readonly [brand]: 'instant' };
export const maxInt64 = 9223372036854775807n;
export function id<K extends string>(kind: K, value: unknown): Result<Id<K>> {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) &&
    !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)
    ? ok(value.toLowerCase() as Id<K>)
    : invalid(kind);
}
export function integer(value: unknown, minimum: bigint, maximum = maxInt64): Result<bigint> {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value)) return invalid('integer');
  const parsed = BigInt(value);
  return parsed >= minimum && parsed <= maximum ? ok(parsed) : invalid('integer');
}
export function revision(value: unknown): Result<Revision> {
  const parsed = integer(value, 1n);
  return parsed.ok ? ok(parsed.value as Revision) : parsed;
}
export function instant(value: unknown): Result<Instant> {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return invalid('instant');
  const year = Number(value.slice(0, 4)),
    month = Number(value.slice(5, 7)),
    day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (days[month - 1] ?? 0) ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 ||
    Number(value.slice(17, 19)) > 59
  )
    return invalid('instant');
  return ok(value as Instant);
}
export type UnknownReason = 'not_supplied' | 'not_measured' | 'unverified' | 'not_applicable';
export type Evidence<T> =
  Readonly<{ state: 'known'; value: T }> | Readonly<{ state: 'unknown'; reason: UnknownReason }>;
export function known<T>(value: T): Evidence<T> {
  return Object.freeze({ state: 'known', value });
}
export function unknown(reason: UnknownReason): Evidence<never> {
  return Object.freeze({ state: 'unknown', reason });
}
