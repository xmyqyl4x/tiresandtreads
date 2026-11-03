import { it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  withLocalStaffSessions,
  type LocalStaffGrant,
} from '../../packages/integrations/src/http/staff-security.ts';
import { createHttpApi } from '../../packages/integrations/src/http/core.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
const secret = new Uint8Array(32).fill(43),
  now = Date.parse('2026-11-03T08:00:00.000Z'),
  token = Buffer.alloc(32, 77).toString('base64url');
const mac = (purpose: string, value: string) =>
  createHmac('sha256', secret)
    .update('local-http:v1\0' + purpose + '\0' + value)
    .digest('hex');
function grant(): LocalStaffGrant {
  return {
    kind: 'synthetic-local-staff-session',
    staffId: '11111111-1111-4111-8111-111111111111',
    digest: mac('staff', token),
    expiresAt: new Date(now + 60000).toISOString(),
    mfaAt: new Date(now - 1000).toISOString(),
  };
}
function setup(grants: LocalStaffGrant[] = [grant()]) {
  const base = {
    authenticate: vi.fn(async () => null),
    quota: vi.fn(async () => ({ allowed: true })),
  };
  return { base, security: withLocalStaffSessions(base, grants, secret, () => now) };
}
const request = () =>
  new Request('http://127.0.0.1:3210/api/v1/staff/queues/imports', {
    headers: { authorization: 'Bearer ' + token },
  });
it('derives a local staff actor and CSRF from a server-controlled synthetic grant without trusting client role/MFA fields', async () => {
  const s = setup(),
    actor = await s.security.authenticate(request());
  expect(actor).toMatchObject({
    staff: grant().staffId,
    csrf: mac('staff-csrf', token),
    keys: [],
    mfaAt: now - 1000,
  });
  expect(s.base.authenticate).not.toHaveBeenCalled();
});
it('keeps owner authentication and quota admission in the existing PostgreSQL-backed adapter', async () => {
  const s = setup();
  await s.security.authenticate(new Request('http://127.0.0.1'));
  expect(s.base.authenticate).toHaveBeenCalledOnce();
  await s.security.quota('127.0.0.1', 'read');
  expect(s.base.quota).toHaveBeenCalledOnce();
});
it('refuses expired/future synthetic grants and delegates a tampered bearer without selecting an actor', async () => {
  for (const value of [
    { ...grant(), expiresAt: new Date(now).toISOString() },
    { ...grant(), mfaAt: new Date(now + 1000).toISOString() },
  ])
    expect(await setup([value]).security.authenticate(request())).toBeNull();
  const s = setup();
  expect(
    await s.security.authenticate(
      new Request('http://127.0.0.1', { headers: { authorization: 'Bearer ' + 'a'.repeat(43) } }),
    ),
  ).toBeNull();
});
it('enforces current MFA freshness at the shared HTTP boundary', async () => {
  const s = setup([{ ...grant(), mfaAt: new Date(now - 300001).toISOString() }]);
  const effect = vi.fn(async () => ok(null));
  const api = createHttpApi({
    origin: 'http://127.0.0.1:3210',
    now: () => now,
    security: s.security,
    routes: [
      {
        path: '/api/v1/staff/queues/imports',
        method: 'GET',
        operationId: 'queue',
        access: 'staff',
        handle: effect,
      },
    ],
  });
  expect((await api(request())).status).toBe(403);
  expect(effect).not.toHaveBeenCalled();
});
it('copies grant inputs so later caller mutation cannot alter a previously validated identity binding', async () => {
  const grants = [grant()],
    s = setup(grants);
  grants[0] = { ...grant(), digest: '0'.repeat(64) };
  expect(await s.security.authenticate(request())).toMatchObject({ staff: grant().staffId });
});
it.each([
  { ...grant(), kind: 'production' },
  { ...grant(), staffId: 'not-an-id' },
  { ...grant(), digest: 'bad' },
  { ...grant(), expiresAt: 'invalid' },
  { ...grant(), mfaAt: 'invalid' },
  { ...grant(), expiresAt: new Date(now + 7200001).toISOString() },
  { ...grant(), extra: true },
])('refuses malformed or unbounded synthetic grant records', (value) => {
  expect(() => setup([value as LocalStaffGrant])).toThrow();
});
it('refuses duplicate grants and short key material', () => {
  expect(() => setup([grant(), grant()])).toThrow();
  expect(() =>
    withLocalStaffSessions(
      { authenticate: async () => null, quota: async () => ({ allowed: true }) },
      [],
      new Uint8Array(31),
    ),
  ).toThrow();
});
