import { createHmac, randomBytes } from 'node:crypto';
import { id, instant } from '../../../domain/src/values/core.ts';
import type { LocalStaffGrant } from './staff-security.ts';
export function localStaffFixture(
  secret: Uint8Array,
  staff: string,
  at: string = new Date().toISOString(),
) {
  if (secret.length < 32 || !id('staff', staff).ok || !instant(at).ok)
    throw Error('Local staff fixture unavailable');
  const bearer = randomBytes(32).toString('base64url'),
    mac = (purpose: string) =>
      createHmac('sha256', secret)
        .update('local-http:v1\0' + purpose + '\0' + bearer)
        .digest('hex');
  const grant: LocalStaffGrant = {
    kind: 'synthetic-local-staff-session',
    staffId: staff,
    digest: mac('staff'),
    mfaAt: at,
    expiresAt: new Date(Date.parse(at) + 3600000).toISOString(),
  };
  return { bearer, csrf: mac('staff-csrf'), grant };
}
