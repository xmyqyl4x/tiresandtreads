import { it, expect, vi } from 'vitest';
import { createPhotoScanner } from '../../packages/integrations/src/photo-scanner.ts';
it.each(['clean', 'unsafe', 'unavailable'] as const)(
  'requires an explicit scanner verdict: %s',
  async (state) =>
    expect(
      await createPhotoScanner({
        async scan() {
          return state;
        },
      }).scan(new Uint8Array([1])),
    ).toBe(state),
);
it('does not turn scanner errors into a clean verdict', async () =>
  expect(
    await createPhotoScanner({
      async scan() {
        throw Error('private scanner detail');
      },
    }).scan(new Uint8Array([1])),
  ).toBe('unavailable'));
it('refuses out-of-contract bytes without invoking a scanner', async () => {
  const scan = vi.fn(async () => 'clean' as const),
    s = createPhotoScanner({ scan });
  expect(await s.scan(new Uint8Array(10485761))).toBe('unsafe');
  expect(await s.scan(new Uint8Array())).toBe('unsafe');
  expect(scan).not.toHaveBeenCalled();
});
it('aborts a stalled scanner at its bounded deadline under controlled timers', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  try {
    const pending = createPhotoScanner({
      async scan(_b, s) {
        signal = s;
        return new Promise(() => {});
      },
    }).scan(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe('unavailable');
    expect(signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
