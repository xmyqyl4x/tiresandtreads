import { it, expect } from 'vitest';
import { presentSlots, densityPermits } from '../../packages/domain/src/commercial-presentation.ts';
const slot = {
  key: 'education_one',
  route: 'education' as const,
  width: 300,
  height: 100,
  housePath: '/guides/trust',
  houseLabel: 'How we choose',
};
it.each([
  '/',
  '/preview/find-tires',
  '/preview/report',
  '/preview/compare',
  '/guides/size-decoder',
  '/guides/before-you-buy',
  '/privacy',
  '/staff',
  '/learn/not-reviewed',
])('refuses inventory on %s', (path) => {
  expect(presentSlots(path, 2000, [slot])).toEqual([]);
});
it('caps inventory at two and refuses short content or oversized creatives', () => {
  expect(
    presentSlots('/learn/tire-basics', 2000, [
      slot,
      { ...slot, key: 'two' },
      { ...slot, key: 'three' },
    ]),
  ).toHaveLength(2);
  expect(presentSlots('/learn/tire-basics', 800, [slot, slot])).toHaveLength(1);
  expect(presentSlots('/learn/tire-basics', 599, [slot])).toEqual([]);
  expect(presentSlots('/learn/tire-basics', 2000, [{ ...slot, height: 600 }])).toEqual([]);
});
it.each([
  [700, 300, true],
  [699, 300, false],
  [0, 100, false],
  [100, 0, false],
  [NaN, 100, false],
  [100, Infinity, false],
])('enforces actual density for %s and %s', (content, ads, expected) => {
  expect(densityPermits(content as number, ads as number)).toBe(expected);
});
