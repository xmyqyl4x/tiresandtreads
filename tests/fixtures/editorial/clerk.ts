import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createClerkStaffSecurity } from '../../../packages/integrations/src/clerk-staff-runtime.ts';
import { clerkStaffSubject } from '../../../packages/integrations/src/http/clerk-staff-security.ts';
import { createEditorialStaffAuthorization } from '../../../packages/integrations/src/editorial-identity-runtime.ts';
import type { editorialFixture } from './runtime.ts';
// Bounded generated keys and synthetic GET records; no real provider calls or account setup.
export function syntheticEditorialSessions() {
  const issuer = 'https://synthetic.clerk.accounts.dev',
    pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }),
    sessions = new Map<string, Record<string, unknown>>(),
    profile = {
      author: 'editorial.author',
      reviewer: 'editorial.review',
      publisher: 'editorial.publish',
    };
  let reads = 0;
  const authorization: NonNullable<
    NonNullable<Parameters<typeof editorialFixture>[1]>['authorization']
  > = async ({ f, actors, credentials, origin }) => {
    for (const role of ['author', 'reviewer', 'publisher'] as const) {
      const actor = actors[role],
        user = 'user_' + role,
        sid = 'sess_' + role,
        stamp = Date.now(),
        at = Math.floor(stamp / 1000),
        roleId = randomUUID();
      await f.owner.query('UPDATE admin.staff_identities SET provider_subject=$2 WHERE id=$1', [
        actor.id,
        clerkStaffSubject(issuer, user),
      ]);
      // Fixture-only grants in the disposable database. No production role/policy is created.
      await f.owner.query(
        "INSERT INTO admin.roles(id,code,permissions,policy_version) VALUES($1,$2,$3,'synthetic-editorial')",
        [roleId, 'synthetic_editorial_' + role, JSON.stringify([profile[role]])],
      );
      await f.owner.query(
        'INSERT INTO admin.staff_role_assignments(staff_id,role_id) VALUES($1,$2)',
        [actor.id, roleId],
      );
      sessions.set(sid, {
        object: 'session',
        id: sid,
        user_id: user,
        status: 'active',
        created_at: stamp - 60000,
        last_active_at: stamp - 1000,
        expire_at: stamp + 3600000,
        abandon_at: stamp + 1800000,
        actor: null,
      });
      const body =
        Buffer.from(
          JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'synthetic', cat: 'cl_B7d4PD111AAA' }),
        ).toString('base64url') +
        '.' +
        Buffer.from(
          JSON.stringify({
            iss: issuer,
            azp: origin,
            aud: 'tiresandtreads:staff',
            sub: user,
            sid,
            iat: at,
            nbf: at - 1,
            exp: at + 240,
            v: 2,
            fva: [0, 0],
          }),
        ).toString('base64url');
      credentials[role] =
        body + '.' + sign('RSA-SHA256', Buffer.from(body), pair.privateKey).toString('base64url');
    }
    const scope = f.adapter('tt_staff_runtime'),
      security = createClerkStaffSecurity(scope, {
        enabled: true,
        base: { authenticate: async () => null, quota: async () => ({ allowed: true }) },
        issuer,
        audience: 'tiresandtreads:staff',
        authorizedParties: [origin],
        publishableKey:
          'pk_test_' + Buffer.from('synthetic.clerk.accounts.dev$').toString('base64'),
        publicKeys: [pair.publicKey],
        apiKey: async () => 'sk_test_' + 'synthetic'.repeat(4),
        csrfKey: new Uint8Array(32).fill(88),
        fetch: async (input) => {
          if (++reads > 1000) throw Error('Synthetic read bound');
          const u = new URL(String(input));
          if (
            u.origin !== 'https://api.clerk.com' ||
            !/^\/v1\/sessions\/sess_(author|reviewer|publisher)$/.test(u.pathname)
          )
            throw Error('Unexpected synthetic provider request');
          return Response.json(sessions.get(u.pathname.split('/').at(-1)!)!);
        },
      });
    return createEditorialStaffAuthorization(scope, f.cmsScope, {
      security,
      profile,
      publicByline: 'Synthetic editorial team',
      origin,
    });
  };
  return {
    authorization,
    reads: () => reads,
    revoke(role: 'author' | 'reviewer' | 'publisher') {
      sessions.get('sess_' + role)!.status = 'revoked';
    },
  };
}
