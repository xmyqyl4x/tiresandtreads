import { it, expect } from 'vitest';
import { localStaffFixture } from '../../packages/integrations/src/http/local-fixtures.ts';
import { withLocalStaffSessions } from '../../packages/integrations/src/http/staff-security.ts';
const id = '11111111-1111-4111-8111-111111111111',
  secret = new Uint8Array(32).fill(41),
  at = '2026-11-03T00:00:00.000Z';
it('creates unique synthetic credentials while persisting only a digest and server-controlled claims', async () => {
  const first = localStaffFixture(secret, id, at),
    second = localStaffFixture(secret, id, at);
  expect(first.bearer).not.toBe(second.bearer);
  expect(JSON.stringify(first.grant)).not.toContain(first.bearer);
  const auth = withLocalStaffSessions(
    { authenticate: async () => null, quota: async () => ({ allowed: true }) },
    [first.grant],
    secret,
    () => Date.parse(at),
  );
  expect(
    await auth.authenticate(
      new Request('http://127.0.0.1', { headers: { authorization: 'Bearer ' + first.bearer } }),
    ),
  ).toMatchObject({ staff: id, csrf: first.csrf });
});
it.each([
  [new Uint8Array(31), id, at],
  [secret, 'invalid', at],
  [secret, id, 'invalid'],
] as const)('refuses invalid fixture key/identity/time inputs', (key, staff, time) => {
  expect(() => localStaffFixture(key, staff, time)).toThrow('Local staff fixture unavailable');
});
