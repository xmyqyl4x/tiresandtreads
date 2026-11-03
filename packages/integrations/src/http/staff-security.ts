import { createHmac, timingSafeEqual } from 'node:crypto';
import { id, instant } from '../../../domain/src/values/core.ts';
import type { HttpSecurity, HttpActor } from './core.ts';
export interface LocalStaffGrant {
  readonly kind: 'synthetic-local-staff-session';
  readonly staffId: string;
  readonly digest: string;
  readonly expiresAt: string;
  readonly mfaAt: string;
}
export function decodeLocalStaffGrants(raw: unknown): readonly LocalStaffGrant[] {
  if (!Array.isArray(raw) || raw.length > 16) throw Error('Invalid local staff grants');
  const grants = raw.map((value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'digest,expiresAt,kind,mfaAt,staffId' ||
      Object.values(value).some((v) => typeof v !== 'string')
    )
      throw Error('Invalid local staff grants');
    const g = value as LocalStaffGrant;
    if (
      g.kind !== 'synthetic-local-staff-session' ||
      !id('staff', g.staffId).ok ||
      !/^[a-f0-9]{64}$/.test(g.digest) ||
      !instant(g.expiresAt).ok ||
      !instant(g.mfaAt).ok ||
      Date.parse(g.expiresAt) - Date.parse(g.mfaAt) > 7200000 ||
      g.expiresAt <= g.mfaAt
    )
      throw Error('Invalid local staff grants');
    return Object.freeze({ ...g });
  });
  if (new Set(grants.map((g) => g.digest)).size !== grants.length)
    throw Error('Invalid local staff grants');
  return Object.freeze(grants);
}
export function withLocalStaffSessions(
  base: HttpSecurity,
  raw: readonly LocalStaffGrant[],
  secret: Uint8Array,
  now: () => number = Date.now,
): HttpSecurity {
  if (secret.length < 32) throw Error('Invalid local staff grants');
  const grants = decodeLocalStaffGrants(raw),
    secretCopy = Buffer.from(secret);
  const mac = (purpose: string, value: string) =>
    createHmac('sha256', secretCopy)
      .update('local-http:v1\0' + purpose + '\0' + value)
      .digest('hex');
  return {
    quota: (peer, operation) => base.quota(peer, operation),
    async authenticate(request): Promise<HttpActor | null> {
      const authorization = request.headers.get('authorization');
      if (authorization && /^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) {
        const raw = authorization.slice(7),
          digest = Buffer.from(mac('staff', raw), 'hex'),
          grant = grants.find((g) => timingSafeEqual(digest, Buffer.from(g.digest, 'hex')));
        if (grant) {
          const stamp = now(),
            staff = id('staff', grant.staffId);
          if (!staff.ok || Date.parse(grant.expiresAt) <= stamp || Date.parse(grant.mfaAt) > stamp)
            return null;
          return {
            keys: [],
            csrf: mac('staff-csrf', raw),
            staff: staff.value,
            mfaAt: Date.parse(grant.mfaAt),
          };
        }
      }
      return base.authenticate(request);
    },
  };
}
