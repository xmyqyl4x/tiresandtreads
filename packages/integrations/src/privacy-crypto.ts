import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { id, type Id } from '../../domain/src/values/core.ts';
import type { PrivacyCrypto } from '../../application/src/ports/privacy-services.ts';
import { canonical } from '../../application/src/services/service-records.ts';
export function createPrivacyCrypto(
  current: string,
  keys: Readonly<Record<string, Uint8Array>>,
): PrivacyCrypto {
  const entries = Object.entries(keys);
  if (
    entries.length < 1 ||
    entries.length > 4 ||
    !Object.hasOwn(keys, current) ||
    entries.some(([v, k]) => !/^[A-Za-z0-9_-]{1,80}$/.test(v) || k.length < 32)
  )
    throw Error('Invalid privacy keys');
  const ring = Object.fromEntries(entries.map(([v, k]) => [v, Buffer.from(k)]));
  const mac = (v: string, p: string, value: string) =>
    createHmac('sha256', ring[v]!)
      .update('privacy:v1\0' + p + '\0' + value)
      .digest('hex');
  const equal = (a: string, b: string) =>
    /^[a-f0-9]{64}$/.test(a) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  const c: PrivacyCrypto = {
    current,
    versions: Object.freeze(Object.keys(ring).sort()),
    id: <K extends string>() => randomUUID() as Id<K>,
    hash: (p, v) => mac(current, 'identity:' + p, v),
    markers: (kind, resource) =>
      Object.keys(ring)
        .sort()
        .map((v) => ({ keyVersion: v, digest: mac(v, 'marker:' + kind, resource) })),
    proof(resource, version) {
      if (!Object.hasOwn(ring, version)) throw Error('Unavailable privacy key');
      const raw = 'privacy.' + version + '.' + resource + '.' + mac(version, 'proof', resource);
      return { raw, key: { keyVersion: version, digest: mac(version, 'proof_lookup', raw) } };
    },
    parse(raw) {
      if (typeof raw !== 'string' || raw.length > 256) return null;
      const p = raw.split('.'),
        resource = id('privacy_request', p[2]),
        v = p[1]!;
      if (p.length !== 4 || p[0] !== 'privacy' || !Object.hasOwn(ring, v) || !resource.ok)
        return null;
      if (!equal(p[3]!, mac(v, 'proof', resource.value))) return null;
      return { id: resource.value, key: c.proof(resource.value, v).key };
    },
    sign(document) {
      return {
        keyVersion: current,
        digest: mac(current, 'journal', canonical(document, 2097152)),
        document,
      };
    },
    verify(record) {
      try {
        if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
        const r = record as Record<string, unknown>;
        if (
          Object.keys(r).sort().join(',') !== 'digest,document,keyVersion' ||
          typeof r.keyVersion !== 'string' ||
          !Object.hasOwn(ring, r.keyVersion) ||
          typeof r.digest !== 'string'
        )
          return null;
        return equal(r.digest, mac(r.keyVersion, 'journal', canonical(r.document, 2097152)))
          ? r.document
          : null;
      } catch {
        return null;
      }
    },
  };
  return Object.freeze(c);
}
