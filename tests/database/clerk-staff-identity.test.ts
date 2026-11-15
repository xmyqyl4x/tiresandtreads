import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { operationsApiFixture } from '../fixtures/http/operations-api.ts';
import { createClerkStaffSecurity } from '../../packages/integrations/src/clerk-staff-runtime.ts';
import { clerkStaffSubject } from '../../packages/integrations/src/http/clerk-staff-security.ts';
import { createHttpApi } from '../../packages/integrations/src/http/core.ts';
import { staffRoutes } from '../../packages/integrations/src/http/staff.ts';
import { createStaffRepository } from '../../packages/db/src/repositories/staff-services.ts';
import { uid } from '../fixtures/private/database.ts';
import { ok } from '../../packages/domain/src/values/core.ts';

const issuer = 'https://synthetic.clerk.accounts.dev',
  origin = 'http://127.0.0.1:3890',
  pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
let f: Awaited<ReturnType<typeof operationsApiFixture>>;
beforeAll(async () => {
  f = await operationsApiFixture();
}, 45000);
afterAll(async () => {
  await f?.cleanup();
});
async function scenario(role = 'support_operator') {
  const actor = uid('staff'),
    subject = 'user_' + actor.replaceAll('-', ''),
    sid = 'sess_' + actor.replaceAll('-', ''),
    now = Date.now();
  await f.db.admin.query(
    "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$2,'active',now())",
    [actor, clerkStaffSubject(issuer, subject)],
  );
  await f.db.admin.query(
    'INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code=$2',
    [actor, role],
  );
  const state = {
    object: 'session',
    id: sid,
    user_id: subject,
    status: 'active',
    created_at: now - 60000,
    last_active_at: now - 1000,
    expire_at: now + 3600000,
    abandon_at: now + 1800000,
    actor: null,
  };
  let reads = 0;
  const identityScope = f.db.adapter('tt_staff_runtime'),
    scope = f.db.adapter('tt_staff_service_runtime'),
    repository = createStaffRepository(scope),
    security = createClerkStaffSecurity(identityScope, {
      enabled: true,
      base: { authenticate: async () => null, quota: async () => ({ allowed: true }) },
      issuer,
      audience: 'tiresandtreads:staff',
      authorizedParties: [origin],
      publishableKey: 'pk_test_' + Buffer.from('synthetic.clerk.accounts.dev$').toString('base64'),
      publicKeys: [pair.publicKey],
      apiKey: async () => 'sk_test_' + 'synthetic'.repeat(4),
      csrfKey: new Uint8Array(32).fill(77),
      fetch: async () => {
        reads++; // The lookup transaction must be released before any provider I/O.
        const open = await f.db.admin.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename='tt_staff_runtime' AND state='idle in transaction'",
        );
        expect(open.rows[0].n).toBe(0);
        return Response.json(state);
      },
    });
  const claims = {
      iss: issuer,
      azp: origin,
      aud: 'tiresandtreads:staff',
      sub: subject,
      sid,
      iat: Math.floor(now / 1000),
      nbf: Math.floor(now / 1000) - 1,
      exp: Math.floor(now / 1000) + 60,
      v: 2,
      fva: [0, 0],
    },
    body =
      Buffer.from(
        JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'synthetic', cat: 'cl_B7d4PD111AAA' }),
      ).toString('base64url') +
      '.' +
      Buffer.from(JSON.stringify(claims)).toString('base64url'),
    token =
      body + '.' + sign('RSA-SHA256', Buffer.from(body), pair.privateKey).toString('base64url');
  const api = createHttpApi({
    origin,
    security,
    routes: staffRoutes({
      services: f.services,
      authorize: (actor, permission) =>
        scope.unitOfWork.run(async (tx) => {
          await repository.authorize(tx, actor, permission);
          return ok(null);
        }),
      artifact: async () => {
        throw Error('No fixture artifact');
      },
      commandId: () => randomUUID(),
    }),
  });
  const call = (extra: Record<string, string> = {}) =>
    api(
      new Request(origin + '/api/v1/staff/queues/mail', {
        headers: { authorization: 'Bearer ' + token, ...extra },
      }),
    );
  return { actor, token, state, security, call, reads: () => reads };
}
it('uses locally signed SDK identity and current PostgreSQL roles through the actual staff HTTP/service boundary', async () => {
  const s = await scenario();
  expect((await s.call()).status).toBe(200);
  expect(s.reads()).toBe(1);
  await f.db.admin.query("UPDATE admin.staff_identities SET status='disabled' WHERE id=$1", [
    s.actor,
  ]);
  expect((await s.call()).status).toBe(401);
  expect(s.reads()).toBe(1);
});
it('refuses removed and future grants without external reads or a client-selected identity', async () => {
  const s = await scenario();
  await f.db.admin.query(
    'UPDATE admin.staff_role_assignments SET revoked_at=clock_timestamp() WHERE staff_id=$1',
    [s.actor],
  );
  expect(
    (await s.call({ 'x-staff-id': String(f.db.staff), 'x-mfa-at': String(Date.now()) })).status,
  ).toBe(401);
  expect(s.reads()).toBe(0);
  await f.db.admin.query(
    "UPDATE admin.staff_role_assignments SET revoked_at=NULL,granted_at=clock_timestamp()+interval '1 hour' WHERE staff_id=$1",
    [s.actor],
  );
  expect((await s.call()).status).toBe(401);
});
it('checks provider revocation afresh without trusting a still-valid signed token', async () => {
  const s = await scenario();
  expect((await s.call()).status).toBe(200);
  s.state.status = 'revoked';
  expect((await s.call()).status).toBe(401);
  expect(s.reads()).toBe(2);
});
it('retains current service permission checks for authenticated staff with another role', async () => {
  const s = await scenario('commercial_operator');
  expect((await s.call()).status).toBe(404);
  expect(s.reads()).toBe(1);
});
it('refuses an elevated or different database scope rather than using its broader reads as identity authority', async () => {
  const s = await scenario(),
    security = createClerkStaffSecurity(f.db.scope, {
      enabled: true,
      base: { authenticate: async () => null, quota: async () => ({ allowed: true }) },
      issuer,
      audience: 'tiresandtreads:staff',
      authorizedParties: [origin],
      publishableKey: 'pk_test_' + Buffer.from('synthetic.clerk.accounts.dev$').toString('base64'),
      publicKeys: [pair.publicKey],
      apiKey: async () => 'sk_test_' + 'synthetic'.repeat(4),
      csrfKey: new Uint8Array(32).fill(77),
      fetch: async () => {
        throw Error('Must not dispatch');
      },
    });
  expect(
    await security.authenticateStaff(
      new Request(origin + '/api/v1/staff/queues/mail', {
        headers: { authorization: 'Bearer ' + s.token },
      }),
    ),
  ).toBeNull();
});
