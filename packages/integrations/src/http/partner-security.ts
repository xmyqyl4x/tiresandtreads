import { createHmac } from 'node:crypto';
import type { PartnerAuthority } from '../../../application/src/ports/partner-services.ts';
import { partnerPrincipal } from '../../../domain/src/partner-policy.ts';
import type { HttpSecurity } from './core.ts';
// Inject a verified authority. A request cannot supply its own subject, tenant or MFA timestamp.
export function withPartnerSessions(
  base: HttpSecurity,
  authority: PartnerAuthority,
  secret: Uint8Array,
  now: () => number = Date.now,
): HttpSecurity {
  if (secret.length < 32) throw Error('HTTP session key required');
  const key = Buffer.from(secret);
  return {
    quota: (peer, operation) => base.quota(peer, operation),
    async authenticate(request) {
      const raw = request.headers.get('authorization');
      if (raw?.startsWith('Bearer ') && /^Bearer [A-Za-z0-9_-]{16,128}$/.test(raw)) {
        // Never silently reinterpret a rejected partner credential as a different credential.
        if (
          request.headers
            .get('cookie')
            ?.split(';')
            .some((x) => x.trim().startsWith('tt_owner='))
        )
          return null;
        const handle = raw.slice(7),
          proof = await authority.verify(handle);
        if (proof.ok) {
          const p = partnerPrincipal(proof.value, now());
          if (!p.ok) return null;
          return {
            keys: [],
            csrf: createHmac('sha256', key)
              .update('p2-csrf\0' + handle)
              .digest('hex'),
            partner: { handle, subject: p.value.subject },
            ...(p.value.staffId
              ? { staff: p.value.staffId, mfaAt: Date.parse(p.value.mfaAt) }
              : {}),
          };
        }
      }
      return base.authenticate(request);
    },
  };
}
