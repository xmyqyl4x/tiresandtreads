// SDK abort signals plus an outer deadline protect against stalled/ignoring transports.
export async function boundedIO<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms = 2000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_r, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Error('Provider unavailable'));
        }, ms);
      }),
    ]);
  } catch {
    controller.abort();
    throw Error('Provider unavailable');
  } finally {
    clearTimeout(timer);
  }
}
