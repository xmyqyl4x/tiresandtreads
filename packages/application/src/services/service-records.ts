import type { JsonObject, JsonValue } from '../ports/catalog-records.ts';
import { demand } from './service-work.ts';
export function object(value: unknown): Record<string, unknown> {
  demand(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
export function exact(value: unknown, fields: string): Record<string, unknown> {
  const x = object(value);
  demand(Object.keys(x).sort().join(',') === fields);
  return x;
}
// Canonical JSON is also the persisted representation: bigint never passes through Number.
export function canonical(value: unknown, max = 524288): string {
  function visit(x: unknown, depth: number): JsonValue {
    demand(depth <= 32);
    if (x === null || typeof x === 'boolean' || typeof x === 'string') return x;
    if (typeof x === 'bigint') return x.toString();
    if (typeof x === 'number') {
      demand(Number.isFinite(x));
      return x;
    }
    if (Array.isArray(x)) {
      demand(x.length <= 2000);
      return x.map((v) => visit(v, depth + 1));
    }
    demand(x && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype);
    const fields = Object.keys(x).sort();
    demand(fields.length <= 100);
    return Object.fromEntries(
      fields.map((k) => [k, visit((x as Record<string, unknown>)[k], depth + 1)]),
    );
  }
  const text = JSON.stringify(visit(value, 0));
  demand(new TextEncoder().encode(text).length <= max);
  return text;
}
export const json = (x: unknown, max = 524288): JsonObject => JSON.parse(canonical(x, max));
