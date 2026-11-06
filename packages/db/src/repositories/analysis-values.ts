import { id, instant, integer, revision, type Result } from '../../../domain/src/values/core.ts';
import type { IntegrityError } from '../mappers.ts';
import { boundedJson, reject } from './bounds.ts';
import { stop } from './mutations.ts';
export type Row = Record<string, unknown>;
export function stored<T>(value: Result<T, IntegrityError>): T {
  return value.ok ? value.value : stop('integrity');
}
export function decode<T>(field: string, work: () => T): Result<T, IntegrityError> {
  try {
    return { ok: true, value: Object.freeze(work()) };
  } catch {
    return { ok: false, error: { code: 'invalid_stored_data', field } };
  }
}
export function parsed<T>(r: Result<T>): T {
  if (!r.ok) return reject();
  return r.value;
}
export const uid = <K extends string>(kind: K, v: unknown) => parsed(id(kind, v));
export const at = (v: unknown) =>
  parsed(instant(v instanceof Date && Number.isFinite(v.getTime()) ? v.toISOString() : v));
export const big = (v: unknown, min = 0n) =>
  parsed(integer(typeof v === 'bigint' ? v.toString() : v, min));
export const revisionValue = (v: unknown) =>
  parsed(revision(typeof v === 'bigint' ? v.toString() : v));
export function word(v: unknown, max = 200): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes('\0')) return reject();
  return v;
}
export function hash(v: unknown): string {
  if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) return reject();
  return v;
}
export function choice<const T extends readonly string[]>(v: unknown, values: T): T[number] {
  if (typeof v !== 'string' || !values.includes(v)) return reject();
  return v;
}
export function num(v: unknown, min = 0, max = 2147483647): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) return reject();
  return v;
}
export function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') return reject();
  return v;
}
export function frozen<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) frozen(x);
    Object.freeze(v);
  }
  return v;
}
export function object(v: unknown, max = 65536): Readonly<Record<string, unknown>> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return reject();
  return frozen(JSON.parse(boundedJson(v, max)) as Record<string, unknown>);
}
export function nullable<T>(v: unknown, read: (value: unknown) => T): T | null {
  return v === null ? null : read(v);
}
export const requestStates = [
  'queued',
  'running',
  'accepted',
  'rejected',
  'failed',
  'uncertain',
  'cancelled',
] as const;
export const attemptStates = [
  'created',
  'started',
  'succeeded',
  'failed',
  'uncertain',
  'cancelled',
] as const;
export const photoFields = [
  'brand',
  'model',
  'tire_size',
  'load_index',
  'speed_rating',
  'dot_tin',
  'date_code',
  'seasonal_marking',
  'run_flat_marking',
] as const;
