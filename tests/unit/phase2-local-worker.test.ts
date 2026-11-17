import { it, expect, vi } from 'vitest';
import { startPhase2LocalWorker } from '../../packages/integrations/src/phase2-local-worker.ts';
it.each([0, 999, 60001, NaN])('refuses an unbounded local poll interval %s', (pollMs) => {
  expect(() =>
    startPhase2LocalWorker({ tick: vi.fn(), shutdown: vi.fn(), readiness: vi.fn() }, { pollMs }),
  ).toThrow();
});
it('fails closed on missing readiness and always releases owned host resources', async () => {
  const shutdown = vi.fn(async () => undefined),
    tick = vi.fn();
  const worker = startPhase2LocalWorker(
    { shutdown, tick, readiness: async () => false },
    { pollMs: 1000 },
  );
  await expect(worker.done).rejects.toThrow();
  expect(shutdown).toHaveBeenCalledOnce();
  expect(tick).not.toHaveBeenCalled();
});
it('serializes ticks, aborts the timer and drains repeated shutdown without duplicate work', async () => {
  vi.useFakeTimers();
  try {
    let release: (() => void) | undefined;
    const events: string[] = [],
      tick = vi.fn(async () => {
        await new Promise<void>((r) => {
          release = r;
        });
        return { attemptedJobs: 0, deferred: 0, activation: false as const };
      }),
      shutdown = vi.fn(async () => undefined),
      worker = startPhase2LocalWorker(
        { tick, shutdown, readiness: async () => true },
        { pollMs: 1000, observe: (s) => events.push(s) },
      );
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledOnce();
    release!();
    await vi.advanceTimersByTimeAsync(0);
    const a = worker.stop(),
      b = worker.stop();
    expect(a).toBe(b);
    await a;
    expect(events).toEqual(['ready', 'tick_completed', 'stopped']);
    expect(tick).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
it('defers a failed tick without treating it as success and keeps observer exceptions out of control flow', async () => {
  vi.useFakeTimers();
  try {
    const tick = vi
        .fn()
        .mockRejectedValueOnce(Error('synthetic'))
        .mockResolvedValue({ attemptedJobs: 0, deferred: 0, activation: false }),
      shutdown = vi.fn(async () => undefined),
      events: string[] = [],
      worker = startPhase2LocalWorker(
        { tick, shutdown, readiness: async () => true },
        {
          pollMs: 1000,
          observe: (s) => {
            events.push(s);
            if (s === 'tick_deferred') throw Error('observer');
          },
        },
      );
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    await worker.stop();
    expect(events).toEqual(['ready', 'tick_deferred', 'tick_completed', 'stopped']);
  } finally {
    vi.useRealTimers();
  }
});

it('reports deferred service work without claiming a fully successful tick', async () => {
  vi.useFakeTimers();
  try {
    const events: string[] = [],
      worker = startPhase2LocalWorker(
        {
          readiness: async () => true,
          shutdown: async () => undefined,
          tick: async () => ({ attemptedJobs: 2, deferred: 1, activation: false }),
        },
        { pollMs: 1000, observe: (state) => events.push(state) },
      );
    await vi.advanceTimersByTimeAsync(0);
    await worker.stop();
    expect(events).toEqual(['ready', 'tick_deferred', 'stopped']);
  } finally {
    vi.useRealTimers();
  }
});
