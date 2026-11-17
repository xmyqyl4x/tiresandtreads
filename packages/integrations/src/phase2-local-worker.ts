import type { createPhase2LocalHost } from './phase2-local-host.ts';
type Host = Pick<
  Awaited<ReturnType<typeof createPhase2LocalHost>>,
  'tick' | 'shutdown' | 'readiness'
>;
export function startPhase2LocalWorker(
  host: Host,
  options: Readonly<{
    pollMs: number;
    observe?: (state: 'ready' | 'tick_completed' | 'tick_deferred' | 'stopped') => void;
  }>,
) {
  if (!Number.isSafeInteger(options.pollMs) || options.pollMs < 1000 || options.pollMs > 60000)
    throw Error('Local worker interval refused');
  const controller = new AbortController();
  let stop: Promise<void> | undefined;
  const observe = (state: Parameters<NonNullable<typeof options.observe>>[0]) => {
    try {
      options.observe?.(state);
    } catch {
      /* Observers grant no authority and cannot interrupt cleanup. */
    }
  };
  async function delay() {
    if (controller.signal.aborted) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', finish);
          resolve();
        },
        timer = setTimeout(finish, options.pollMs);
      controller.signal.addEventListener('abort', finish, { once: true });
    });
  }
  const done = (async () => {
    try {
      if (!(await host.readiness())) throw Error('Local worker dependencies unavailable');
      observe('ready');
      while (!controller.signal.aborted) {
        try {
          const result = await host.tick();
          observe(result.deferred > 0 ? 'tick_deferred' : 'tick_completed');
        } catch {
          observe('tick_deferred');
        }
        await delay();
      }
    } finally {
      await host.shutdown();
      observe('stopped');
    }
  })();
  // Await done or stop in the embedding process; do not silently abandon worker failures.
  return {
    done,
    stop() {
      return (stop ??= (async () => {
        controller.abort();
        await host.shutdown();
        await done;
      })());
    },
  };
}
