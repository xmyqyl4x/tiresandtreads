import { createHash } from 'node:crypto';
import { id } from '../../../domain/src/values/core.ts';
import { failure } from '../../../application/src/ports/transactions.ts';
import { PersistenceFailure } from '../transactions.ts';

export function reject(): never {
  throw new PersistenceFailure(failure('invalid_input'));
}
export function boundedJson(value: unknown, limit: number): string {
  const seen = new WeakSet<object>();
  function visit(item: unknown, depth: number): unknown {
    if (depth > 12) return reject();
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (!item || typeof item !== 'object' || seen.has(item)) return reject();
    seen.add(item);
    let result: unknown;
    if (Array.isArray(item)) {
      if (item.length > 1000) return reject();
      result = item.map((entry) => visit(entry, depth + 1));
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        return reject();
      const keys = Object.keys(item).sort();
      if (keys.length > 1000) return reject();
      result = Object.fromEntries(
        keys.map((key) => [key, visit((item as Record<string, unknown>)[key], depth + 1)]),
      );
    }
    seen.delete(item);
    return result;
  }
  const result = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(result, 'utf8') > limit) return reject();
  return result;
}
export function digest(value: unknown): string {
  return createHash('sha256').update(boundedJson(value, 262144)).digest('hex');
}
export function nextCursor(scope: unknown, lastId: string): string {
  return Buffer.from(JSON.stringify([1, digest(scope), lastId])).toString('base64url');
}
export function cursor(scope: unknown, value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value))
    return reject();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return reject();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 3 ||
    parsed[0] !== 1 ||
    parsed[1] !== digest(scope) ||
    !id('cursor', parsed[2]).ok
  )
    return reject();
  return parsed[2] as string;
}
export function pageLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) return reject();
  return value;
}
