import type { EditorialAuthorization } from '../../application/src/ports/editorial.ts';
import type { EditorialRole } from '../../domain/src/editorial.ts';
import { id } from '../../domain/src/values/core.ts';
import type { Id } from '../../domain/src/values/core.ts';
import { isStaffCredential } from '../../contracts/src/staff-session.ts';
import { boundedIO } from './bounded-io.ts';
import { staffMfaMaxAgeMs, type HttpSecurity } from './http/core.ts';

export interface EditorialStaffOptions {
  readonly security: Required<Pick<HttpSecurity, 'authenticateStaff'>>;
  readonly permissions: (staff: Id<'staff'>) => Promise<readonly string[] | null>;
  readonly cms: (staff: Id<'staff'>) => Promise<string | null>;
  readonly profile: Readonly<Record<EditorialRole, string>>;
  readonly publicByline: string;
  readonly origin: string;
  readonly now?: () => number;
}
// Opt-in binding only. Token claims never supply editorial roles or CMS identities.
export function verifiedEditorialAuthorization(o: EditorialStaffOptions): EditorialAuthorization {
  const profile = Object.freeze({ ...o.profile }),
    roles = ['author', 'reviewer', 'publisher'] as const,
    byline = o.publicByline,
    u = new URL(o.origin),
    now = o.now ?? Date.now,
    verify = o.security.authenticateStaff.bind(o.security),
    permissions = o.permissions,
    cms = o.cms;
  if (
    u.origin !== o.origin ||
    (u.protocol !== 'https:' &&
      !(u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))) ||
    u.username ||
    u.password ||
    o.origin.length > 256 ||
    !byline ||
    byline.length > 120 ||
    [...byline].some(
      (char) =>
        char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '<' || char === '>',
    ) ||
    roles.some(
      (role) =>
        typeof profile[role] !== 'string' ||
        !/^editorial\.[a-z][a-z0-9_.]{0,62}$/.test(profile[role]),
    ) ||
    new Set(roles.map((role) => profile[role])).size !== 3
  )
    throw Error('Invalid editorial identity configuration');
  return {
    async require(credential, required) {
      if (!isStaffCredential(credential)) throw Error('unauthenticated');
      let outcome:
        { error: string } | { actor: Awaited<ReturnType<EditorialAuthorization['require']>> };
      try {
        outcome = await boundedIO(async (signal) => {
          const principal = await verify(
            new Request(u.origin + '/local-editorial/session', {
              headers: { authorization: 'Bearer ' + credential },
            }),
          );
          signal.throwIfAborted();
          const fresh = () =>
            principal &&
            Number.isFinite(principal.mfaAt) &&
            principal.mfaAt! <= now() &&
            now() - principal.mfaAt! <= staffMfaMaxAgeMs;
          if (!principal?.staff || !id('staff', principal.staff).ok || !fresh())
            return { error: 'unauthenticated' };
          const allowed = (values: readonly string[] | null) =>
            roles.filter((role) => values?.includes(profile[role]));
          const initial = allowed(await permissions(principal.staff));
          signal.throwIfAborted();
          if (!initial.length || (required !== 'read' && !initial.includes(required)))
            return { error: 'forbidden' };
          const cmsId = await cms(principal.staff);
          signal.throwIfAborted();
          if (!cmsId || !id('cms_staff', cmsId).ok) return { error: 'forbidden' };
          const current = allowed(await permissions(principal.staff));
          signal.throwIfAborted();
          if (!fresh()) return { error: 'unauthenticated' };
          if (!current.length || (required !== 'read' && !current.includes(required)))
            return { error: 'forbidden' };
          return {
            actor: { id: principal.staff, cmsId, name: byline, roles: Object.freeze(current) },
          };
        }, 5000);
      } catch {
        throw Error('unavailable');
      }
      if ('error' in outcome) throw Error(outcome.error);
      return outcome.actor;
    },
  };
}
