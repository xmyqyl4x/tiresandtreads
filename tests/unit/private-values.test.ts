import { expect, it } from 'vitest';
import {
  digestKeys,
  envelope,
  jsonObject,
} from '../../packages/db/src/repositories/private-values.ts';
it('bounds versioned digests and ciphertext without accepting plaintext or ambiguous lookup keys', () => {
  const key = { keyVersion: 'hmac-v1', digest: 'ab'.repeat(32) };
  expect(digestKeys([key])).toEqual([{ key_version: 'hmac-v1', digest: key.digest }]);
  for (const keys of [[], [key, key], [{ ...key, digest: 'plaintext' }], Array(5).fill(key)])
    expect(() => digestKeys(keys)).toThrow();
  expect(envelope({ keyVersion: 'enc-v1', hex: 'ab'.repeat(16) }).toString('hex')).toBe(
    'ab'.repeat(16),
  );
  expect(() => envelope({ keyVersion: 'enc-v1', hex: 'plain email' })).toThrow();
});
it('refuses arrays, oversized snapshots and implicit numeric money conversions', () => {
  expect(jsonObject({ amount: '9007199254740993' }, 64)).toBe('{"amount":"9007199254740993"}');
  for (const value of [[], { amount: 1n }, { payload: 'x'.repeat(65) }])
    expect(() => jsonObject(value, 64)).toThrow();
});
