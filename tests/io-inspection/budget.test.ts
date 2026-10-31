import { afterEach, expect, it, vi } from 'vitest';
import { remaining, within } from '../fixtures/io-inspection/budget.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('shares one absolute attempt across operations instead of resetting the budget', () => {
  expect(remaining(100, 100)).toBe(1500);
  expect(remaining(100, 3500)).toBe(600);
  expect(remaining(100, 4099)).toBe(1);
  expect(() => remaining(100, 4100)).toThrow();
});
it('refuses nonfinite, negative and reversed monotonic clocks', () => {
  for (const [start, now] of [
    [NaN, 1],
    [0, Infinity],
    [-1, 0],
    [2, 1],
  ])
    expect(() => remaining(start!, now!)).toThrow();
});
it('rejects delivery after an absolute limit even before a delayed timer callback runs', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const work = Promise.resolve().then(() => {
    now = 1000;
    return 'late result';
  });
  await expect(within(work, 50)).rejects.toThrow();
});
it('bounds a pending observation while its original work remains unresolved', async () => {
  vi.useFakeTimers();
  let resolve!: (value: string) => void;
  const work = new Promise<string>((r) => {
    resolve = r;
  });
  const observed = expect(within(work, 50)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(50);
  await observed;
  resolve('later');
  await expect(work).resolves.toBe('later');
});
it('preserves a real rejection without substituting a successful observation', async () => {
  await expect(within(Promise.reject(Error('fixed failure')), 50)).rejects.toThrow('fixed failure');
});
it('handles late rejection and clears its own deadline timer', async () => {
  vi.useFakeTimers();
  let reject!: (reason: Error) => void;
  const work = new Promise<never>((_, r) => {
    reject = r;
  });
  const observed = expect(within(work, 50)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(50);
  await observed;
  reject(Error('late failure'));
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
});
