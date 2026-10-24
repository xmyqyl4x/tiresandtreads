import { id, instant } from '../../../domain/src/values/core.ts';
import type { FactKind, FactRecords } from '../../../application/src/ports/catalog-records.ts';
import type { PublicFact } from '../../../application/src/ports/catalog.ts';
import { failure } from '../../../application/src/ports/transactions.ts';
import { PersistenceFailure } from '../transactions.ts';
import { facts, type Field } from './facts.ts';
import { boundedJson, reject } from './bounds.ts';
export const privateFields = new Set(['reviewedBy', 'sourceDetails', 'sourceNote']);
export function spec(kind: FactKind): { table: string; fields: Record<string, Field> } {
  if (!Object.hasOwn(facts, kind)) return reject();
  return facts[kind];
}
export function value(field: Field, input: unknown, read = false): unknown {
  if (input === null && field.nullable) return null;
  switch (field.codec) {
    case 'uuid': {
      const parsed = id('record', input);
      if (parsed.ok) return parsed.value;
      break;
    }
    case 'text':
      if (typeof input === 'string' && input.length <= 16384 && !input.includes('\0')) return input;
      break;
    case 'integer':
      if (typeof input === 'number' && Number.isSafeInteger(input)) return input;
      break;
    case 'decimal':
      if (typeof input === 'string' && /^-?(0|[1-9][0-9]{0,30})(\.[0-9]{1,12})?$/.test(input))
        return input;
      break;
    case 'bigint': {
      const n =
        read && typeof input === 'string' && /^-?[0-9]{1,19}$/.test(input) ? BigInt(input) : input;
      if (typeof n === 'bigint' && n >= -9223372036854775808n && n <= 9223372036854775807n)
        return n;
      break;
    }
    case 'boolean':
      if (typeof input === 'boolean') return input;
      break;
    case 'date':
      if (typeof input === 'string' && instant(input + 'T00:00:00.000Z').ok) return input;
      break;
    case 'instant': {
      const n =
        read && input instanceof Date && Number.isFinite(input.getTime())
          ? input.toISOString()
          : input;
      const parsed = instant(n);
      if (parsed.ok) return parsed.value;
      break;
    }
    case 'object':
      if (input && typeof input === 'object' && !Array.isArray(input))
        return JSON.parse(boundedJson(input, 16384));
      break;
    case 'array':
      if (Array.isArray(input) && input.length <= 64 && input.every((x) => typeof x === 'string'))
        return JSON.parse(boundedJson(input, 4096));
      break;
  }
  return reject();
}
export function encode<K extends FactKind>(kind: K, record: FactRecords[K]): unknown[] {
  const fields = spec(kind).fields;
  if (Object.keys(record).some((key) => !Object.hasOwn(fields, key))) return reject();
  return Object.entries(fields).map(([key, f]) => {
    const item = value(f, (record as Record<string, unknown>)[key]);
    if (key === 'schemaVersion' && item !== 1) return reject();
    return f.codec === 'object' || f.codec === 'array'
      ? item === null
        ? null
        : boundedJson(item, 16384)
      : typeof item === 'bigint'
        ? item.toString()
        : item;
  });
}
export function decode<K extends FactKind>(kind: K, row: Record<string, unknown>): PublicFact<K> {
  try {
    const entries = Object.entries(spec(kind).fields)
      .filter(([key]) => !privateFields.has(key))
      .map(([key, f]) => {
        const item = value(f, row[f.column], true);
        if (key === 'schemaVersion' && item !== 1) return reject();
        return [key, item];
      });
    // Each allowlisted field was checked above; no raw row is cast or exposed.
    return Object.freeze(Object.fromEntries(entries)) as PublicFact<K>;
  } catch {
    throw new PersistenceFailure(failure('integrity'));
  }
}
