import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { id, type Id } from '../../domain/src/values/core.ts';
import type { ContactCrypto } from '../../application/src/ports/contact-services.ts';
// Lookup and bearer key rings have independent lifetimes. Keep old lookup keys while tombstones need them.
export function createContactCrypto(
  currentTokenVersion: string,
  tokenKeys: Readonly<Record<string, Uint8Array>>,
  lookupKeys: Readonly<Record<string, Uint8Array>>,
  identityKey: Uint8Array,
): ContactCrypto {
  const check = (keys: Readonly<Record<string, Uint8Array>>) => {
    const entries = Object.entries(keys);
    if (
      entries.length < 1 ||
      entries.length > 4 ||
      entries.some(([v, k]) => !/^[A-Za-z0-9_-]{1,80}$/.test(v) || k.length < 32)
    )
      throw Error('Invalid contact keys');
    return Object.fromEntries(entries.map(([v, k]) => [v, Buffer.from(k)]));
  };
  const tokens = check(tokenKeys),
    lookups = check(lookupKeys),
    stable = Buffer.from(identityKey);
  if (!Object.hasOwn(tokens, currentTokenVersion) || stable.length < 32)
    throw Error('Invalid contact keys');
  const mac = (key: Uint8Array, purpose: string, value: string) =>
    createHmac('sha256', key)
      .update('contact:v1\0' + purpose + '\0' + value)
      .digest('hex');
  const crypto: ContactCrypto = {
    lookupVersions: Object.freeze(Object.keys(lookups).sort()),
    currentTokenVersion,
    hash: (purpose, value) => mac(stable, 'identity:' + purpose, value),
    id<K extends string>(kind: K, key?: string): Id<K> {
      if (key === undefined) return randomUUID() as Id<K>;
      const b = Buffer.from(mac(stable, 'uuid:' + kind, key).slice(0, 32), 'hex');
      b[6] = (b[6]! & 15) | 80;
      b[8] = (b[8]! & 63) | 128;
      const h = b.toString('hex');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as Id<K>;
    },
    emailKeys: (value) =>
      Object.keys(lookups)
        .sort()
        // Retain delivery spelling in ciphertext; a case-only change cannot evade suppression.
        .map((v) => ({ keyVersion: v, digest: mac(lookups[v]!, 'email', value.toLowerCase()) })),
    token(audience, resource, version) {
      if (!Object.hasOwn(tokens, version)) throw Error('Unavailable contact token key');
      const raw = `${audience}.${version}.${resource}.${mac(tokens[version]!, 'bearer:' + audience, resource)}`;
      return {
        raw,
        key: { keyVersion: version, digest: mac(tokens[version]!, 'lookup:' + audience, raw) },
      };
    },
    parse(audience, raw) {
      if (typeof raw !== 'string' || raw.length > 256) return null;
      const p = raw.split('.'),
        v = p[1]!,
        resource = id('verification', p[2]);
      if (
        p.length !== 4 ||
        p[0] !== audience ||
        !Object.hasOwn(tokens, v) ||
        !resource.ok ||
        !/^[a-f0-9]{64}$/.test(p[3]!)
      )
        return null;
      const expected = crypto.token(audience, resource.value, v);
      if (!timingSafeEqual(Buffer.from(raw), Buffer.from(expected.raw))) return null;
      return { id: resource.value, key: expected.key };
    },
  };
  return Object.freeze(crypto);
}
