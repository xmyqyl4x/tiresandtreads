import { createHmac, timingSafeEqual } from 'node:crypto';
import type { EmailLinkCrypto } from '../../application/src/ports/mail-events.ts';
import type { ContactCrypto } from '../../application/src/ports/contact-services.ts';
import { id } from '../../domain/src/values/core.ts';
export function createEmailLinkCrypto(
  current: string,
  keys: Readonly<Record<string, Uint8Array>>,
  identities: Pick<ContactCrypto, 'id'>,
): EmailLinkCrypto {
  const ring = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, Buffer.from(v)]));
  if (
    !Object.hasOwn(ring, current) ||
    Object.keys(ring).length > 4 ||
    Object.entries(ring).some(([v, k]) => !/^[A-Za-z0-9_-]{1,80}$/.test(v) || k.length < 32)
  )
    throw Error('Invalid email link keys');
  const mac = (version: string, purpose: string, value: string) =>
    createHmac('sha256', ring[version]!)
      .update('email-link:v1\0' + purpose + '\0' + value)
      .digest('hex');
  function token(version: string, resource: string) {
    const raw = `link.${version}.${resource}.${mac(version, 'bearer', resource)}`;
    return { raw, key: { keyVersion: version, digest: mac(version, 'lookup', raw) } };
  }
  return {
    issue(sendId, slot) {
      const resource = identities.id('email_link', sendId + ':' + slot);
      return { id: resource, ...token(current, resource) };
    },
    parse(raw) {
      if (typeof raw !== 'string' || raw.length > 256) return null;
      const p = raw.split('.'),
        version = p[1]!,
        resource = id('email_link', p[2]);
      if (
        p.length !== 4 ||
        p[0] !== 'link' ||
        !Object.hasOwn(ring, version) ||
        !resource.ok ||
        !/^[a-f0-9]{64}$/.test(p[3]!)
      )
        return null;
      const expected = token(version, resource.value);
      if (!timingSafeEqual(Buffer.from(raw), Buffer.from(expected.raw))) return null;
      return { id: resource.value, key: expected.key };
    },
  };
}
