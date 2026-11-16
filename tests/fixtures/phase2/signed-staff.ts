import { generateKeyPairSync, sign } from 'node:crypto';
import type { staffWebFixture } from './staff-web.ts';
import { createClerkStaffSecurity } from '../../../packages/integrations/src/clerk-staff-runtime.ts';
import { clerkStaffSubject } from '../../../packages/integrations/src/http/clerk-staff-security.ts';
import { withVerifiedStaffAuthority } from '../../../packages/integrations/src/http/phase2-staff-authority.ts';
import { withPartnerSessions } from '../../../packages/integrations/src/http/partner-security.ts';
import { fail } from '../../../packages/domain/src/values/core.ts';
import { failure } from '../../../packages/application/src/ports/transactions.ts';
import type { HttpSecurity } from '../../../packages/integrations/src/http/core.ts';
// Generated RSA signatures and fixed GET session responses only; no real identity account.
export function signedP2Staff(
  f: Parameters<NonNullable<Parameters<typeof staffWebFixture>[1]>>[0],
  authority: Parameters<NonNullable<Parameters<typeof staffWebFixture>[1]>>[1]['d']['authority'],
  base: HttpSecurity,
  party = 'http://127.0.0.1:3000',
) {
  const issuer = 'https://synthetic.clerk.accounts.dev',
    pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }),
    sessions = new Map<string, Record<string, unknown>>();
  let reads = 0;
  const dedicated = createClerkStaffSecurity(f.baseAdapter('tt_staff_runtime'), {
    enabled: true,
    base,
    issuer,
    audience: 'tiresandtreads:staff',
    authorizedParties: [party],
    publishableKey: 'pk_test_' + Buffer.from('synthetic.clerk.accounts.dev$').toString('base64'),
    publicKeys: [pair.publicKey],
    apiKey: async () => 'sk_test_' + 'synthetic'.repeat(4),
    csrfKey: new Uint8Array(32).fill(91),
    fetch: async (input, init) => {
      const u = new URL(String(input));
      if (
        ++reads > 2000 ||
        u.origin !== 'https://api.clerk.com' ||
        !/^\/v1\/sessions\/sess_[a-f0-9]+$/.test(u.pathname) ||
        init?.method !== 'GET'
      )
        throw Error('Unexpected synthetic identity request');
      const state = sessions.get(u.pathname.split('/').at(-1)!);
      return state ? Response.json(state) : Response.json({}, { status: 404 });
    },
  });
  const proof = withVerifiedStaffAuthority(
    { verify: (h) => authority.verify(h) },
    dedicated,
    party,
  );
  Object.assign(authority, { verifyStaff: proof.verifyStaff });
  const security = withPartnerSessions(dedicated, authority, new Uint8Array(32).fill(92));
  async function credential(staffId: string, extra: Record<string, unknown> = {}) {
    const user = 'user_' + staffId.replaceAll('-', ''),
      sid = 'sess_' + staffId.replaceAll('-', ''),
      now = Date.now(),
      at = Math.floor(now / 1000);
    await f.admin.query('UPDATE admin.staff_identities SET provider_subject=$2 WHERE id=$1', [
      staffId,
      clerkStaffSubject(issuer, user),
    ]);
    if (!sessions.has(sid))
      sessions.set(sid, {
        object: 'session',
        id: sid,
        user_id: user,
        status: 'active',
        created_at: now - 60000,
        last_active_at: now - 1000,
        expire_at: now + 3600000,
        abandon_at: now + 1800000,
        actor: null,
      });
    const head = Buffer.from(
        JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'synthetic', cat: 'cl_B7d4PD111AAA' }),
      ).toString('base64url'),
      body =
        head +
        '.' +
        Buffer.from(
          JSON.stringify({
            iss: issuer,
            azp: party,
            aud: 'tiresandtreads:staff',
            sub: user,
            sid,
            iat: at,
            nbf: at - 1,
            exp: at + 120,
            v: 2,
            fva: [0, 0],
            ...extra,
          }),
        ).toString('base64url');
    return (
      body + '.' + sign('RSA-SHA256', Buffer.from(body), pair.privateKey).toString('base64url')
    );
  }
  return {
    security,
    credential,
    reads: () => reads,
    revoke(staffId: string) {
      sessions.get('sess_' + staffId.replaceAll('-', ''))!.status = 'revoked';
    },
    refusePartner: async () => fail(failure('forbidden')),
  };
}
