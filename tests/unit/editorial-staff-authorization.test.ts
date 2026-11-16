import { it, expect, vi } from 'vitest';
import { verifiedEditorialAuthorization } from '../../packages/integrations/src/editorial-staff-authorization.ts';
import { id } from '../../packages/domain/src/values/core.ts';
import type { HttpActor } from '../../packages/integrations/src/http/core.ts';
const staff = id('staff', '10000000-0000-4000-8000-000000000001');
if (!staff.ok) throw Error('fixture');
const actor = { staff: staff.value, mfaAt: 1000000, keys: [], csrf: 'unused' };
const profile = {
  author: 'editorial.author',
  reviewer: 'editorial.review',
  publisher: 'editorial.publish',
};
function fixture() {
  const security = {
      authenticateStaff: vi.fn<(_request: Request) => Promise<HttpActor | null>>(async () => actor),
    },
    permissions = vi.fn(async () => ['editorial.author']),
    cms = vi.fn<() => Promise<string | null>>(async () => '20000000-0000-4000-8000-000000000001'),
    options = {
      security,
      permissions,
      cms,
      profile: { ...profile },
      publicByline: 'Editorial team',
      origin: 'http://127.0.0.1:8380',
      now: () => 1000000,
    };
  return { ...options, authorization: verifiedEditorialAuthorization(options) };
}
it('binds a verified identity to current permissions and a CMS mapping, then rechecks permissions', async () => {
  const f = fixture();
  expect(await f.authorization.require('a.b.c', 'author')).toEqual({
    id: actor.staff,
    cmsId: '20000000-0000-4000-8000-000000000001',
    roles: ['author'],
    name: 'Editorial team',
  });
  expect(f.permissions).toHaveBeenCalledTimes(2);
  expect(f.security.authenticateStaff.mock.calls[0]![0].headers.get('authorization')).toBe(
    'Bearer a.b.c',
  );
});
it('does not fall back to another realm or continue lookups after failed verification', async () => {
  const f = fixture();
  f.security.authenticateStaff.mockResolvedValueOnce(null);
  await expect(f.authorization.require('a.b.c', 'read')).rejects.toThrow('unauthenticated');
  expect(f.permissions).not.toHaveBeenCalled();
  expect(f.cms).not.toHaveBeenCalled();
});
it.each(['missing-role', 'removed-role', 'missing-mapping'])(
  'refuses %s before returning authority',
  async (mode) => {
    const f = fixture();
    if (mode === 'missing-role') f.permissions.mockResolvedValue([]);
    if (mode === 'removed-role')
      f.permissions.mockResolvedValueOnce(['editorial.author']).mockResolvedValueOnce([]);
    if (mode === 'missing-mapping') f.cms.mockResolvedValueOnce(null);
    await expect(f.authorization.require('a.b.c', 'author')).rejects.toThrow('forbidden');
  },
);
it.each([undefined, 699999, 1000001])('refuses absent, stale or future MFA: %s', async (mfaAt) => {
  const f = fixture();
  f.security.authenticateStaff.mockResolvedValueOnce({
    staff: actor.staff,
    keys: [],
    csrf: actor.csrf,
    ...(mfaAt === undefined ? {} : { mfaAt }),
  });
  await expect(f.authorization.require('a.b.c', 'read')).rejects.toThrow('unauthenticated');
  expect(f.cms).not.toHaveBeenCalled();
});
it('does not use a mutable caller profile to turn a non-editorial permission into a role', async () => {
  const f = fixture();
  f.profile.author = 'content.publish';
  f.permissions.mockResolvedValue(['content.publish']);
  await expect(f.authorization.require('a.b.c', 'read')).rejects.toThrow('forbidden');
  expect(() =>
    verifiedEditorialAuthorization({ ...f, profile: { ...profile, author: 'content.publish' } }),
  ).toThrow('Invalid editorial identity configuration');
});
it('rechecks MFA time after the separate CMS lookup', async () => {
  const f = fixture();
  let now = 1000000;
  f.cms.mockImplementation(async () => {
    now += 300001;
    return '20000000-0000-4000-8000-000000000001';
  });
  const a = verifiedEditorialAuthorization({ ...f, now: () => now });
  await expect(a.require('a.b.c', 'author')).rejects.toThrow('unauthenticated');
});
it('times out stalled verification and prevents its late completion from starting database reads', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    let finish!: (v: typeof actor) => void;
    f.security.authenticateStaff.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = f.authorization.require('a.b.c', 'read');
    const refusal = expect(result).rejects.toThrow('unavailable');
    await vi.advanceTimersByTimeAsync(5001);
    await refusal;
    finish(actor);
    await Promise.resolve();
    await Promise.resolve();
    expect(f.permissions).not.toHaveBeenCalled();
    expect(f.cms).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
