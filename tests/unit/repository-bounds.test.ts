import { expect, it } from 'vitest';
import { boundedJson, cursor, nextCursor } from '../../packages/db/src/repositories/bounds.ts';
it('bounds UTF-8 JSON before database submission and refuses non-JSON values', () => {
  expect(boundedJson({ value: 'ok' }, 100)).toBe('{"value":"ok"}');
  for (const value of [undefined, NaN, { n: 1n }, { n: undefined }, { n: Infinity }])
    expect(() => boundedJson(value, 100)).toThrow();
  expect(() => boundedJson({ value: 'é'.repeat(10) }, 20)).toThrow();
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  expect(() => boundedJson(circular, 100)).toThrow();
});
it('binds versioned keysets to the complete pin/filter scope and validates the last id', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  expect(cursor(['bundle', 'filter'], null)).toBeNull();
  const token = nextCursor(['bundle', 'filter'], id);
  expect(cursor(['bundle', 'filter'], token)).toBe(id);
  for (const bad of [
    '!',
    'a'.repeat(513),
    nextCursor(['other'], id),
    nextCursor(['bundle', 'filter'], 'bad'),
  ])
    expect(() => cursor(['bundle', 'filter'], bad)).toThrow();
});
