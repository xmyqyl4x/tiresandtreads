import type { PartnerAuthority } from '../../../application/src/ports/partner-services.ts';
import { fail, ok } from '../../../domain/src/values/core.ts';
import { failure } from '../../../application/src/ports/transactions.ts';
import { staffPrincipal } from '../../../domain/src/staff-principal.ts';
import { isStaffCredential } from '../../../contracts/src/staff-session.ts';
import type { HttpSecurity } from './core.ts';
// Uses the same dedicated verifier for HTTP and application calls. No token cache or claim decoding.
export function withVerifiedStaffAuthority(
  partner: PartnerAuthority,
  security: HttpSecurity,
  origin: string,
  now: () => number = Date.now,
): PartnerAuthority {
  const u = new URL(origin);
  if (u.origin !== origin || u.username || u.password || !security.authenticateStaff)
    throw Error('Dedicated staff authority required');
  return {
    verify: (handle) => partner.verify(handle),
    async verifyStaff(handle) {
      if (!isStaffCredential(handle)) return fail(failure('forbidden'));
      const actor = await security.authenticateStaff!(
        new Request(origin + '/api/v1/staff/session', {
          headers: { authorization: 'Bearer ' + handle },
        }),
      );
      const p = staffPrincipal(actor?.staffIdentity, now());
      return actor?.staff === (p.ok ? p.value.staffId : null) && p.ok
        ? ok(p.value)
        : fail(failure('forbidden'));
    },
  };
}
