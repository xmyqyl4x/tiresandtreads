import { createHash } from 'node:crypto';
import type { ContactEncryption } from '../../application/src/ports/contact-services.ts';
// Reuse the existing KMS envelope with a distinct derived resource context. No raw key
// storage or permissive fallback. A bounded key ring supports decrypting older envelopes.
export function createAnalysisReferenceEncryption(
  current: string,
  keys: Readonly<Record<string, ContactEncryption>>,
): ContactEncryption {
  const ring = Object.freeze({ ...keys }),
    versions = Object.keys(ring);
  if (
    versions.length < 1 ||
    versions.length > 4 ||
    !Object.hasOwn(ring, current) ||
    versions.some((v) => v.length < 1 || v.length > 100)
  )
    throw Error('Invalid reference key ring');
  function resource(purpose: string, id: string) {
    if (
      purpose !== 'analysis_provider_object' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
    )
      throw Error('Invalid reference context');
    const b = createHash('sha256')
      .update('analysis-provider-object-v1:' + id)
      .digest();
    b[6] = (b[6]! & 15) | 128;
    b[8] = (b[8]! & 63) | 128;
    const h = b.subarray(0, 16).toString('hex');
    return (
      h.slice(0, 8) +
      '-' +
      h.slice(8, 12) +
      '-' +
      h.slice(12, 16) +
      '-' +
      h.slice(16, 20) +
      '-' +
      h.slice(20)
    );
  }
  const check = (b: Uint8Array) => {
    if (b.byteLength < 1 || b.byteLength > 256) throw Error('Invalid reference size');
    return new Uint8Array(b);
  };
  return Object.freeze<ContactEncryption>({
    async encrypt(bytes, purpose, id) {
      const target = resource(purpose, id),
        b = check(bytes),
        e = await ring[current]!.encrypt(b, 'report_private', target);
      if (e.keyVersion !== current) throw Error('Reference key mismatch');
      return e;
    },
    async decrypt(value, purpose, id) {
      const target = resource(purpose, id);
      if (!Object.hasOwn(ring, value.keyVersion)) throw Error('Reference key unavailable');
      return check(await ring[value.keyVersion]!.decrypt(value, 'report_private', target));
    },
  });
}
