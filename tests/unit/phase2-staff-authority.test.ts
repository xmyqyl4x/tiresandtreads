import { it, expect, vi } from 'vitest';
import { staffPrincipal } from '../../packages/domain/src/staff-principal.ts';
import { verifiedStaff } from '../../packages/application/src/partners/staff-authority.ts';
import { withVerifiedStaffAuthority } from '../../packages/integrations/src/http/phase2-staff-authority.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
const now = Date.now(),
  clock = { now: () => now },
  valid = {
    subject: 'clerk:synthetic:user_Test',
    staffId: '11111111-1111-4111-8111-111111111111',
    mfaAt: new Date(now - 60000).toISOString(),
    expiresAt: new Date(now + 60000).toISOString(),
  };
it('validates a staff identity without asserting business-email facts', () => {
  const p = staffPrincipal(valid, now);
  expect(p.ok).toBe(true);
  expect(p.ok && Object.keys(p.value).sort()).toEqual(['expiresAt', 'mfaAt', 'staffId', 'subject']);
});
it.each([
  null,
  [],
  {},
  { ...valid, staffId: null },
  { ...valid, subject: 'x y' },
  { ...valid, mfaAt: 'bad' },
  { ...valid, mfaAt: new Date(now + 1).toISOString() },
  { ...valid, mfaAt: new Date(now - 300001).toISOString() },
  { ...valid, expiresAt: new Date(now).toISOString() },
  { ...valid, expiresAt: new Date(now + 3600001).toISOString() },
])('refuses invalid/currently expired staff authority %#', (v) =>
  expect(staffPrincipal(v, now).ok).toBe(false),
);
it('never falls back from rejected dedicated service authority', async () => {
  const verify = vi.fn(async () => ok(valid as never)),
    verifyStaff = vi.fn(async () => fail(failure('forbidden')));
  await expect(verifiedStaff({ verify, verifyStaff }, clock, 'a.b.c')).rejects.toThrow();
  expect(verify).not.toHaveBeenCalled();
});
it('uses an explicit legacy authority only when dedicated verification is absent', async () => {
  expect(
    await verifiedStaff({ verify: async () => ok(valid as never) }, clock, 'opaque-local-session'),
  ).toEqual(valid);
});
it('rejects oversized credentials before any service authority call', async () => {
  const verify = vi.fn(async () => ok(valid as never));
  await expect(verifiedStaff({ verify }, clock, 'a'.repeat(8186))).rejects.toThrow();
  expect(verify).not.toHaveBeenCalled();
});
it('bridges only matching dedicated verified staff metadata', async () => {
  const p = staffPrincipal(valid, now);
  if (!p.ok) throw Error();
  const authenticateStaff = vi.fn(async () => ({
      keys: [],
      csrf: 'synthetic',
      staff: p.value.staffId,
      staffIdentity: p.value,
    })),
    verify = vi.fn(async () => ok(valid as never)),
    base = {
      authenticate: async () => null,
      authenticateStaff,
      quota: async () => ({ allowed: true }),
    },
    a = withVerifiedStaffAuthority({ verify }, base, 'https://staff.example.invalid', () => now);
  expect(await a.verifyStaff!('aaa.bbb.ccc')).toEqual(ok(valid));
  expect((await a.verifyStaff!('invalid')).ok).toBe(false);
  expect(authenticateStaff).toHaveBeenCalledTimes(1);
  expect(verify).not.toHaveBeenCalled();
  expect(() =>
    withVerifiedStaffAuthority(
      { verify },
      { ...base, authenticateStaff: undefined } as never,
      'https://staff.example.invalid',
    ),
  ).toThrow();
});

it.each([null, 12, 'staff', [], { ...valid, expiresAt: 'bad' }, { ...valid, subject: '' }])(
  'fails closed for incomplete staff records %#',
  (v) => expect(staffPrincipal(v, now).ok).toBe(false),
);
it('requires a finite authority clock and rejects invalid verified metadata', async () => {
  expect(staffPrincipal(valid, NaN).ok).toBe(false);
  await expect(
    verifiedStaff({ verify: async () => ok({ ...valid, mfaAt: 'bad' } as never) }, clock, 'legacy'),
  ).rejects.toThrow();
  const verify = async () => fail(failure('forbidden'));
  for (const actor of [
    null,
    { keys: [], csrf: 'synthetic' },
    {
      keys: [],
      csrf: 'synthetic',
      staff: '22222222-2222-4222-8222-222222222222',
      staffIdentity: valid,
    },
  ]) {
    const a = withVerifiedStaffAuthority(
      { verify },
      {
        authenticate: async () => null,
        authenticateStaff: async () => actor as never,
        quota: async () => ({ allowed: true }),
      },
      'https://staff.example.invalid',
      () => now,
    );
    expect((await a.verifyStaff!('aaa.bbb.ccc')).ok).toBe(false);
  }
  expect(() =>
    withVerifiedStaffAuthority(
      { verify },
      {
        authenticate: async () => null,
        authenticateStaff: async () => null,
        quota: async () => ({ allowed: true }),
      },
      'https://staff.example.invalid/path',
    ),
  ).toThrow();
});
