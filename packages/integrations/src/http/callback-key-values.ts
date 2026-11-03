export interface LocalCallbackKeys {
  readonly mail: readonly string[];
  readonly workflow: readonly string[];
}
export function decodeCallbackKeys(raw: unknown): LocalCallbackKeys {
  const invalid = () => Error('Invalid local callback keys');
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).sort().join(',') !== 'mail,workflow'
  )
    throw invalid();
  const value = raw as Record<string, unknown>,
    arrays = [value.mail, value.workflow].map((items) => {
      if (!Array.isArray(items) || items.length > 4) throw invalid();
      return Object.freeze(
        items.map((key) => {
          if (
            typeof key !== 'string' ||
            !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(key) ||
            key.length > 100
          )
            throw invalid();
          const bytes = Buffer.from(key.slice(6), 'base64');
          if (bytes.length < 24 || bytes.length > 64 || bytes.toString('base64') !== key.slice(6))
            throw invalid();
          return key;
        }),
      );
    });
  const all = arrays.flat();
  if (new Set(all).size !== all.length) throw invalid();
  return Object.freeze({ mail: arrays[0]!, workflow: arrays[1]! });
}
