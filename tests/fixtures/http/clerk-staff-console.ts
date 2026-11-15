import { generateKeyPairSync, sign } from 'node:crypto';
import { operationsApiFixture } from './operations-api.ts';
import { staffConsoleRoutes } from '../../../packages/integrations/src/http/staff-console.ts';
import { createStaffConsoleRuntime } from '../../../packages/integrations/src/staff-console-runtime.ts';
import { createClerkStaffSecurity } from '../../../packages/integrations/src/clerk-staff-runtime.ts';
import { clerkStaffSubject } from '../../../packages/integrations/src/http/clerk-staff-security.ts';
import { createStaffConsoleClient } from '../../../packages/contracts/src/staff-console-client.ts';
import { startWebPreview } from './web-preview.ts';
// Synthetic SDK signing/session records only: no account, authentication or provider acceptance claim.
export async function clerkStaffConsoleFixture() {
  const issuer = 'https://synthetic.clerk.accounts.dev',
    party = 'http://127.0.0.1:3000',
    pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }),
    sessions = new Map<string, Record<string, unknown>>();
  let reads = 0;
  const f = await operationsApiFixture(async ({ db, services, security }) => {
    security.authenticateStaff = createClerkStaffSecurity(db.adapter('tt_staff_runtime'), {
      enabled: true,
      base: security,
      issuer,
      audience: 'tiresandtreads:staff',
      authorizedParties: [party],
      publishableKey: 'pk_test_' + Buffer.from('synthetic.clerk.accounts.dev$').toString('base64'),
      publicKeys: [pair.publicKey],
      apiKey: async () => 'sk_test_' + 'synthetic'.repeat(4),
      csrfKey: new Uint8Array(32).fill(77),
      fetch: async (input) => {
        if (++reads > 1000) throw Error('Synthetic read bound');
        const u = new URL(String(input));
        if (
          u.origin !== 'https://api.clerk.com' ||
          !/^\/v1\/sessions\/sess_[A-Za-z0-9_-]+$/.test(u.pathname)
        )
          throw Error('Unexpected fixture provider read');
        const state = sessions.get(u.pathname.split('/').at(-1)!);
        return state ? Response.json(state) : Response.json({}, { status: 404 });
      },
    }).authenticateStaff;
    return staffConsoleRoutes({
      security,
      commercial: services.commercial,
      queries: createStaffConsoleRuntime(
        {
          report: db.scope,
          content: db.adapter('tt_content_runtime'),
          ingest: db.ingestScope,
          catalog: db.adapter('tt_catalog_runtime'),
          staff: db.adapter('tt_staff_service_runtime'),
          commercial: db.adapter('tt_commercial_runtime'),
          operations: db.adapter('tt_operations_runtime'),
        },
        () => new Date().toISOString(),
      ),
    });
  });
  return {
    ...f,
    providerReads: () => reads,
    async signedStaff(role = 'support_operator') {
      if (sessions.size >= 20) throw Error('Synthetic identity bound');
      const local = await f.staff(role),
        user = 'user_' + local.id.replaceAll('-', ''),
        sid = 'sess_' + local.id.replaceAll('-', ''),
        now = Date.now(),
        at = Math.floor(now / 1000);
      await f.db.admin.query('UPDATE admin.staff_identities SET provider_subject=$2 WHERE id=$1', [
        local.id,
        clerkStaffSubject(issuer, user),
      ]);
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
      const body =
          Buffer.from(
            JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'synthetic', cat: 'cl_B7d4PD111AAA' }),
          ).toString('base64url') +
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
              exp: at + 60,
              v: 2,
              fva: [0, 0],
            }),
          ).toString('base64url'),
        bearer =
          body + '.' + sign('RSA-SHA256', Buffer.from(body), pair.privateKey).toString('base64url');
      const receipt = await createStaffConsoleClient(f.server.origin, {
        bearer,
        csrf: '',
      }).session();
      if (receipt.staffId !== local.id) throw Error('Synthetic binding mismatch');
      return {
        id: local.id,
        bearer,
        csrf: receipt.csrf,
        revoke: () => {
          sessions.get(sid)!.status = 'revoked';
        },
      };
    },
  };
}
export async function clerkStaffConsolePreview() {
  const f = await clerkStaffConsoleFixture();
  try {
    const web = await startWebPreview('http://127.0.0.1:3000', 'dev', 'unsupported', {
      fixture: { cleanup: () => f.cleanup() },
      api: { origin: f.server.origin, shutdown: async () => undefined },
      env: { LOCAL_STAFF_CONSOLE: 'enabled', LOCAL_STAFF_API_ORIGIN: f.server.origin },
    });
    return { ...f, web, cleanup: () => web.cleanup() };
  } catch (e) {
    await f.cleanup();
    throw e;
  }
}
