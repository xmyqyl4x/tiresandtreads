import { it, expect } from 'vitest';
import { instant } from '../../packages/domain/src/values/core.ts';
import { instantMilliseconds } from '../../packages/domain/src/values/time.ts';
function ms(s: string) {
  const p = instant(s);
  if (!p.ok) throw Error('fixture');
  return instantMilliseconds(p.value);
}
it('computes exact explicit UTC differences across month, leap, century and year boundaries', () => {
  for (const [from, to, hours] of [
    ['2026-12-31T12:00:00.000Z', '2027-01-02T12:00:00.000Z', 48],
    ['2024-02-28T12:00:00.000Z', '2024-03-01T12:00:00.000Z', 48],
    ['1900-02-28T12:00:00.000Z', '1900-03-01T12:00:00.000Z', 24],
    ['2000-02-28T12:00:00.000Z', '2000-03-01T12:00:00.000Z', 48],
  ] as const)
    expect(ms(to) - ms(from)).toBe(hours * 3600000);
  expect(ms('0001-01-01T00:00:00.000Z')).toBe(0);
  expect(ms('2026-10-25T12:00:00.001Z') - ms('2026-10-25T12:00:00.000Z')).toBe(1);
});
it('matches independent host UTC arithmetic across 120 dates without reading the engine clock', () => {
  const origin = '0001-01-01T00:00:00.000Z';
  for (let n = 0; n < 120; n++) {
    const year = String(1600 + n * 67).padStart(4, '0'),
      month = String((n % 12) + 1).padStart(2, '0');
    const t = `${year}-${month}-15T13:14:15.123Z`;
    expect(ms(t)).toBe(Date.parse(t) - Date.parse(origin));
  }
});
