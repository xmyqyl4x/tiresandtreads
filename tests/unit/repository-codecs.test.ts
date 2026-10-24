import { expect, it } from 'vitest';
import { decode, encode, value, spec } from '../../packages/db/src/repositories/codec.ts';
import type { Field } from '../../packages/db/src/repositories/facts.ts';
import type { FactKind } from '../../packages/application/src/ports/catalog-records.ts';
const field = (codec: Field['codec'], nullable = false): Field => ({
  codec,
  nullable,
  column: 'test',
});
it('decodes exact scalars and rejects unsupported precision, shapes and nonfinite values', () => {
  const good: [Field['codec'], unknown, unknown][] = [
    ['text', '', ''],
    ['integer', 0, 0],
    ['decimal', '-1.2500', '-1.2500'],
    ['bigint', '9007199254740993', 9007199254740993n],
    ['boolean', false, false],
    ['date', '2024-02-29', '2024-02-29'],
    ['instant', new Date('2026-01-01T00:00:00Z'), '2026-01-01T00:00:00.000Z'],
    ['object', { v: 0 }, { v: 0 }],
    ['array', ['unknown'], ['unknown']],
  ];
  for (const [codec, input, expected] of good)
    expect(value(field(codec), input, true)).toEqual(expected);
  for (const [codec, input] of [
    ['uuid', 'bad'],
    ['text', 'a\0'],
    ['integer', 1.1],
    ['decimal', 'NaN'],
    ['decimal', '1.0000000000001'],
    ['bigint', '9223372036854775808'],
    ['boolean', 0],
    ['date', '2023-02-29'],
    ['instant', 'invalid'],
    ['object', []],
    ['array', [1]],
  ] as [Field['codec'], unknown][])
    expect(() => value(field(codec), input, true)).toThrow();
  expect(value(field('text', true), null)).toBeNull();
  expect(() => value(field('text'), null)).toThrow();
});
it('maps allowlisted camel-case fields and omits private fields with safe integrity failures', () => {
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    source_record_key: 'a',
    topic_key: 'tire',
    market: 'US',
    locale: 'en-US',
    claim: 'Synthetic',
    applicability: {},
    reviewed_by: 'private',
    reviewed_at: new Date('2026-01-01T00:00:00Z'),
    review_due_at: new Date('2026-12-01T00:00:00Z'),
    status: 'reviewed',
    schema_version: 1,
    private: 'must not leak',
  };
  const mapped = decode('adviceFacts', row);
  expect(mapped).not.toHaveProperty('reviewedBy');
  expect(mapped).not.toHaveProperty('private');
  expect(mapped.applicability).toEqual({});
  expect(() => decode('adviceFacts', { ...row, schema_version: 2 })).toThrow('errors.integrity');
  expect(() => encode('adviceFacts', { ...mapped, reviewedBy: 'bad' } as never)).toThrow(
    'errors.invalid_input',
  );
  expect(() => spec('arbitrary_table' as FactKind)).toThrow();
});
