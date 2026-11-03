import { it, expect, vi } from 'vitest';
import { createConfirmationQuery } from '../../packages/application/src/queries/confirmation.ts';
import type { UnitOfWork } from '../../packages/application/src/ports/transactions.ts';
const uuid = '11111111-1111-4111-8111-111111111111';
function setup() {
  const intent = {
      id: uuid,
      contactId: uuid,
      subjectId: uuid,
      purpose: 'offers',
      scope: 'offers',
      key: { keyVersion: 'v1', digest: 'a'.repeat(64) },
      expiresAt: '2026-11-03T11:00:00.000Z',
      usedAt: null,
      invalidated: false,
      live: true,
    },
    parse = vi.fn(() => ({ id: uuid, key: { keyVersion: 'v1', digest: 'a'.repeat(64) } })),
    guard = vi.fn(async () => ({})),
    read = vi.fn(async () => intent),
    permission = vi.fn(async () => ({ status: 'pending' })),
    now = vi.fn(() => '2026-11-03T10:00:00.000Z'),
    uow = { run: async (fn: (tx: unknown) => unknown) => fn({}) } as UnitOfWork;
  const query = createConfirmationQuery({
    uow,
    contacts: { intent: read, guard } as never,
    privacy: { permission } as never,
    crypto: { parse } as never,
    now,
  });
  return { intent, parse, guard, read, permission, now, query };
}
it('reads only verification-scoped purpose/state/expiry without creating a mutation capability', async () => {
  const s = setup();
  expect(await s.query('verification-proof')).toEqual({
    ok: true,
    value: { purpose: 'offers', status: 'pending', expiresAt: s.intent.expiresAt, expired: false },
  });
  expect(s.parse).toHaveBeenCalledWith('verify', 'verification-proof');
  expect(s.guard).toHaveBeenCalledWith(expect.anything(), null, uuid);
});
it.each(['missing', 'version', 'digest', 'invalidated', 'not_live'])(
  'refuses %s or stale authority before reading state',
  async (mode) => {
    const s = setup();
    if (mode === 'missing') s.read.mockResolvedValue(null as never);
    if (mode === 'version') s.intent.key.keyVersion = 'retired';
    if (mode === 'digest') s.intent.key.digest = 'b'.repeat(64);
    if (mode === 'invalidated') s.intent.invalidated = true;
    if (mode === 'not_live') s.intent.live = false;
    expect(await s.query('proof')).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(s.permission).not.toHaveBeenCalled();
  },
);
it('refuses another token audience and invalid server time, and reports expiry without confirming', async () => {
  const s = setup();
  s.parse.mockReturnValueOnce(null as never);
  expect(await s.query('unsubscribe-proof')).toMatchObject({
    ok: false,
    error: { code: 'not_found' },
  });
  s.now.mockReturnValueOnce('invalid');
  expect(await s.query('proof')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  s.intent.expiresAt = '2026-11-03T09:00:00.000Z';
  expect(await s.query('proof')).toMatchObject({
    ok: true,
    value: { expired: true, status: 'pending' },
  });
});
