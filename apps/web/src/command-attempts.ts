export function definiteRefusal(error: unknown) {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    'retryable' in error &&
    error.retryable === false &&
    ['invalid_input', 'conflict', 'forbidden', 'unauthorized', 'not_found'].includes(
      String(error.code),
    )
  );
}
// A command's body and key stay paired until its outcome is known.
export function commandAttempts(key = () => crypto.randomUUID()) {
  const pending = new Map<
    string,
    { body: string; key: string; promise?: Promise<unknown> | undefined }
  >();
  return async function run<T, B>(
    name: string,
    input: B,
    perform: (snapshot: B, key: string) => Promise<T>,
  ): Promise<T> {
    const snapshot = structuredClone(input),
      body = JSON.stringify(snapshot),
      old = pending.get(name);
    if (old && old.body !== body) throw Error('Retry the unconfirmed request before changing it');
    const attempt = old ?? { body, key: key(), promise: undefined };
    pending.set(name, attempt);
    if (attempt.promise) return attempt.promise as Promise<T>;
    attempt.promise = Promise.resolve()
      .then(() => perform(snapshot, attempt.key))
      .then((result) => {
        pending.delete(name);
        return result;
      })
      .catch((error) => {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          'retryable' in error &&
          error.retryable === false &&
          ['invalid_input', 'forbidden', 'unauthorized', 'not_found', 'conflict'].includes(
            String(error.code),
          )
        )
          pending.delete(name);
        throw error;
      })
      .finally(() => {
        attempt.promise = undefined;
      });
    return attempt.promise as Promise<T>;
  };
}
