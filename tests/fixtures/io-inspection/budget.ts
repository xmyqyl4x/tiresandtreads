export function remaining(start: number, now = performance.now()) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(now) ||
    start < 0 ||
    now < start ||
    now - start >= 4000
  )
    throw Error('I/O attempt expired');
  return Math.max(1, Math.min(1500, Math.floor(4000 - (now - start))));
}

// Observation deadline only: losing this race never proves cancellation.
export async function within<T>(work: Promise<T>, milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 1 || milliseconds > 2000)
    throw Error('Invalid I/O observation limit');
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('I/O observation unavailable')), milliseconds);
      }),
    ]);
    if (performance.now() - start >= milliseconds) throw Error('Late I/O observation');
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
