import type { PartnerAuthority, PartnerClock } from '../ports/partner-services.ts';
import { staffPrincipal } from '../../../domain/src/staff-principal.ts';
import { demand } from '../services/service-work.ts';
// Legacy opaque fixtures are supported only when no dedicated staff authority is configured.
export async function verifiedStaff(
  authority: PartnerAuthority,
  clock: PartnerClock,
  handle: string,
) {
  demand(typeof handle === 'string' && handle.length > 0 && handle.length <= 8185);
  const proof = await (authority.verifyStaff
    ? authority.verifyStaff(handle)
    : authority.verify(handle));
  demand(proof.ok, 'forbidden');
  const p = staffPrincipal(proof.value, clock.now());
  demand(p.ok, 'forbidden');
  return p.value;
}
