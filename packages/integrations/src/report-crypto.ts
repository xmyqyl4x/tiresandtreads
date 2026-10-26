import { createHmac, createHash, randomUUID } from 'node:crypto';
import type { Id } from '../../domain/src/values/core.ts';
import type { ReportCrypto } from '../../application/src/ports/report-services.ts';
// Server-held keys are supplied by composition. No key material or bearer token is logged or persisted.
export function createReportCrypto(
  currentVersion: string,
  keys: Readonly<Record<string, Uint8Array>>,
  identityKey: Uint8Array,
) {
  const versions = Object.keys(keys);
  if (
    identityKey.length < 32 ||
    versions.length < 1 ||
    versions.length > 4 ||
    !versions.includes(currentVersion) ||
    versions.some((v) => !/^[A-Za-z0-9_-]{1,80}$/.test(v) || keys[v]!.length < 32)
  )
    throw Error('Invalid report keys');
  const identitySecret = Buffer.from(identityKey);
  const keyring = Object.fromEntries(versions.map((v) => [v, Buffer.from(keys[v]!)]));
  function mac(version: string, purpose: string, value: string) {
    const secret = keyring[version];
    if (!secret) throw Error('Unavailable key version');
    return createHmac('sha256', secret)
      .update('tiresandtreads:report:v1\0' + purpose + '\0' + value)
      .digest('hex');
  }
  const crypto: ReportCrypto = {
    keyVersion: currentVersion,
    hash: (purpose, value) =>
      createHmac('sha256', identitySecret)
        .update('command:v1\0' + purpose + '\0' + value)
        .digest('hex'),
    id<K extends string>(kind: K, stableKey?: string): Id<K> {
      if (stableKey === undefined) return randomUUID() as Id<K>;
      const b = createHash('sha256')
        .update('report-identity:v1\0' + kind + '\0' + stableKey)
        .digest()
        .subarray(0, 16);
      b[6] = (b[6]! & 15) | 80;
      b[8] = (b[8]! & 63) | 128;
      const h = b.toString('hex');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as Id<K>;
    },
    token(purpose, id, version) {
      const token =
        purpose + '.' + version + '.' + id + '.' + mac(version, 'bearer:' + purpose, id);
      return {
        token,
        key: { keyVersion: version, digest: mac(version, 'lookup:' + purpose, token) },
      };
    },
  };
  return Object.freeze({
    ...crypto,
    lookup(purpose: 'share' | 'download', token: unknown) {
      if (typeof token !== 'string' || token.length > 256 || !token.startsWith(purpose + '.'))
        return [];
      const parts = token.split('.');
      if (parts.length !== 4 || !versions.includes(parts[1]!) || !/^[a-f0-9]{64}$/.test(parts[3]!))
        return [];
      const version = parts[1]!;
      return [{ keyVersion: version, digest: mac(version, 'lookup:' + purpose, token) }];
    },
  });
}
