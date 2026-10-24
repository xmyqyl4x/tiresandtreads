import { expect, it } from 'vitest';
import { money } from '../../packages/domain/src/values/money.ts';
import { id, revision, instant, known, unknown } from '../../packages/domain/src/values/core.ts';
import { quantity } from '../../packages/domain/src/values/units.ts';

it('preserves money above JavaScript safe integers as exact minor units', () => {
  expect(money('9007199254740993', 'USD', ['USD'])).toEqual({
    ok: true,
    value: { minor: 9007199254740993n, currency: 'USD' },
  });
});
it('rejects malformed, negative, overflow and disabled-currency money', () => {
  for (const value of [-1, 0, 1.5, '-1', '1.2', '1e3', '01', '9223372036854775808', null])
    expect(money(value, 'USD', ['USD']).ok).toBe(false);
  expect(money('1', 'EUR', ['USD']).ok).toBe(false);
});
it('validates and canonicalizes opaque UUID identities', () => {
  expect(id('report', 'ABCDEF12-1234-4123-8123-ABCDEF123456')).toEqual({
    ok: true,
    value: 'abcdef12-1234-4123-8123-abcdef123456',
  });
  expect(id('report', 'not-a-uuid').ok).toBe(false);
});
it('keeps revision precision and rejects zero or overflow', () => {
  expect(revision('9007199254740993')).toEqual({ ok: true, value: 9007199254740993n });
  for (const value of ['0', '-1', 2, '9223372036854775808']) expect(revision(value).ok).toBe(false);
});
it('validates UTC instants without normalizing impossible dates', () => {
  expect(instant('2024-02-29T23:59:59.123Z')).toEqual({
    ok: true,
    value: '2024-02-29T23:59:59.123Z',
  });
  for (const value of [
    '2023-02-29T00:00:00.000Z',
    '2024-04-31T00:00:00.000Z',
    '2024-01-01',
    '2024-01-01T00:00:00+01:00',
  ])
    expect(instant(value).ok).toBe(false);
});
it('does not confuse unknown with known zero or false', () => {
  expect(known(0)).toEqual({ state: 'known', value: 0 });
  expect(known(false)).toEqual({ state: 'known', value: false });
  expect(unknown('not_supplied')).toEqual({ state: 'unknown', reason: 'not_supplied' });
  expect(Object.isFrozen(known(0))).toBe(true);
});
it('preserves explicit measurement units and exact fractional values', () => {
  expect(quantity('17.5', 'inch')).toEqual({
    ok: true,
    value: { microunits: 17500000n, unit: 'inch' },
  });
  for (const value of ['-1', 'NaN', '1e2', '1.0000001', 1.2])
    expect(quantity(value, 'mm').ok).toBe(false);
});

import { quantityText, distanceKm, type Quantity } from '../../packages/domain/src/values/units.ts';
import { tireSize } from '../../packages/domain/src/values/tire.ts';
it('checks date boundaries, leap centuries, UUID and integer input types', () => {
  for (const v of [
    null,
    '0000-01-01T00:00:00.000Z',
    '1900-02-29T00:00:00.000Z',
    '2024-00-01T00:00:00.000Z',
    '2024-13-01T00:00:00.000Z',
    '2024-01-00T00:00:00.000Z',
    '2024-01-01T24:00:00.000Z',
    '2024-01-01T00:60:00.000Z',
    '2024-01-01T00:00:60.000Z',
  ])
    expect(instant(v).ok).toBe(false);
  expect(instant('2000-02-29T00:00:00.000Z').ok).toBe(true);
  for (const v of [null, '00000000-0000-0000-0000-000000000000'])
    expect(id('report', v).ok).toBe(false);
  expect(money('0', 'USD', ['USD']).ok).toBe(true);
  expect(money('1', null, ['USD']).ok).toBe(false);
  expect(money('1', 'usd', ['usd']).ok).toBe(false);
});
it('converts distance exactly or refuses precision loss', () => {
  const mile = quantity('1', 'mile');
  if (!mile.ok) throw new Error('fixture');
  expect(distanceKm(mile.value)).toEqual({ ok: true, value: { unit: 'km', microunits: 1609344n } });
  expect(distanceKm({ unit: 'km', microunits: 1000000n })).toEqual({
    ok: true,
    value: { unit: 'km', microunits: 1000000n },
  });
  expect(distanceKm({ unit: 'mile', microunits: 1n }).ok).toBe(false);
  expect(quantityText({ unit: 'mm', microunits: 0n })).toBe('0');
  expect(quantityText({ unit: 'inch', microunits: 17500000n })).toBe('17.5');
  expect(quantity('1', 'bad' as 'mm').ok).toBe(false);
});
it('validates tire bounds without promoting an unverified code to verified fitment', () => {
  const rim: Quantity<'inch'> = { unit: 'inch', microunits: 17000000n };
  const value = {
    code: '225/55R17',
    rim,
    width: unknown('unverified'),
    aspect: unknown('not_supplied'),
  };
  expect(tireSize(value).ok).toBe(true);
  for (const code of ['', 'x'.repeat(81)]) expect(tireSize({ ...value, code }).ok).toBe(false);
  for (const microunits of [0n, 1000000000n])
    expect(tireSize({ ...value, rim: { unit: 'inch', microunits } }).ok).toBe(false);
  for (const microunits of [0n, 10000000000n])
    expect(tireSize({ ...value, width: known({ unit: 'mm', microunits }) }).ok).toBe(false);
  for (const microunits of [0n, 200000001n])
    expect(tireSize({ ...value, aspect: known({ unit: 'percent', microunits }) }).ok).toBe(false);
  expect(
    tireSize({
      ...value,
      width: known({ unit: 'mm', microunits: 225000000n }),
      aspect: known({ unit: 'percent', microunits: 55000000n }),
    }).ok,
  ).toBe(true);
});
