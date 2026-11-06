import {
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { id } from '../../domain/src/values/core.ts';
import type { PartnerCrypto, CodeSeal } from '../../application/src/ports/partner-services.ts';
import { couponCode } from '../../domain/src/partner-policy.ts';
function canonical(v: unknown, depth = 0): unknown {
  if (depth > 8) throw Error('Invalid identity input');
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return { int64: v.toString() };
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (Array.isArray(v) && v.length <= 1000) return v.map((x) => canonical(x, depth + 1));
  if (v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v))) {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k], depth + 1)]),
    );
  }
  throw Error('Invalid identity input');
}
export function createPartnerCrypto(
  version: string,
  keys: Readonly<Record<string, Uint8Array>>,
  identityKey: Uint8Array,
): PartnerCrypto {
  if (
    !/^[A-Za-z0-9_-]{1,80}$/.test(version) ||
    !Object.hasOwn(keys, version) ||
    Object.keys(keys).length > 4 ||
    Object.keys(keys).length < 1 ||
    Object.entries(keys).some(
      ([v, k]) => !/^[A-Za-z0-9_-]{1,80}$/.test(v) || !(k instanceof Uint8Array) || k.length !== 32,
    ) ||
    identityKey.length !== 32
  )
    throw Error('Invalid partner key ring');
  const ring = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, Buffer.from(v)])),
    identity = Buffer.from(identityKey);
  const mac = (scope: string, value: string) =>
    createHmac('sha256', identity)
      .update('partner:v1\0' + scope + '\0' + value)
      .digest('hex');
  const context = (org: string, pool: string) => {
    if (!id('organization', org).ok || !id('coupon_pool', pool).ok)
      throw Error('Invalid coupon scope');
    return Buffer.from('partner-code:v1\0' + org.toLowerCase() + '\0' + pool.toLowerCase());
  };
  return Object.freeze({
    currentKeyVersion: version,
    id<K extends string>(kind: K, key?: string) {
      const raw =
        key === undefined
          ? randomUUID()
          : mac('id:' + kind, key)
              .slice(0, 32)
              .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
      const value = id(kind, raw);
      if (!value.ok) throw Error('Invalid generated ID');
      return value.value;
    },
    checksum: (bytes) => createHash('sha256').update(bytes).digest('hex'),
    digest(value) {
      const text = JSON.stringify(canonical(value));
      if (text.length > 1048576) throw Error('Identity input too large');
      return mac('command', text);
    },
    token: () => randomBytes(32).toString('base64url'),
    tokenHash(raw) {
      if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw))
        throw Error('Invalid invitation token');
      return mac('invite', raw);
    },
    seal(org, pool, code, keyVersion) {
      const valid = couponCode(code);
      if (!valid.ok || !Object.hasOwn(ring, keyVersion)) throw Error('Invalid coupon');
      const aad = context(org, pool),
        nonce = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', ring[keyVersion]!, nonce);
      cipher.setAAD(aad);
      const encrypted = Buffer.concat([cipher.update(valid.value, 'utf8'), cipher.final()]);
      return Object.freeze({
        hash: createHmac('sha256', identity)
          .update(aad)
          .update('\0')
          .update(valid.value)
          .digest('hex'),
        cipherHex: Buffer.concat([
          Buffer.from('PC01'),
          nonce,
          cipher.getAuthTag(),
          encrypted,
        ]).toString('hex'),
        keyVersion,
      });
    },
    open(org, pool, seal: CodeSeal) {
      if (
        !Object.hasOwn(ring, seal.keyVersion) ||
        !/^[a-f0-9]{66,8192}$/.test(seal.cipherHex) ||
        seal.cipherHex.length % 2 ||
        !/^[a-f0-9]{64}$/.test(seal.hash)
      )
        throw Error('Invalid coupon box');
      const b = Buffer.from(seal.cipherHex, 'hex');
      if (b.subarray(0, 4).toString() !== 'PC01') throw Error('Invalid coupon box');
      const aad = context(org, pool),
        cipher = createDecipheriv('aes-256-gcm', ring[seal.keyVersion]!, b.subarray(4, 16));
      cipher.setAAD(aad);
      cipher.setAuthTag(b.subarray(16, 32));
      const result = Buffer.concat([cipher.update(b.subarray(32)), cipher.final()]).toString(
        'utf8',
      );
      if (
        !couponCode(result).ok ||
        createHmac('sha256', identity).update(aad).update('\0').update(result).digest('hex') !==
          seal.hash
      )
        throw Error('Invalid coupon box');
      return result;
    },
  } satisfies PartnerCrypto);
}
