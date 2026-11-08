import { it, expect, vi } from 'vitest';
import { createPartnerInsightsServices } from '../../packages/application/src/partners/partner-insights.ts';
import { ServiceFault } from '../../packages/application/src/services/service-work.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
type Dependencies = Parameters<typeof createPartnerInsightsServices>[0];
const id = '17d9a577-5a46-491f-87e5-2945fced5512';
function setup() {
  const now = Date.parse('2026-11-07T12:00:00.000Z');
  const member = vi.fn(async () => undefined),
    staff = vi.fn(async () => undefined),
    dispute = vi.fn(async () => ({ id }));
  const encrypt = vi.fn(async () => ({ keyVersion: 'fixture', hex: 'aa' }));
  const deps = {
    uow: { run: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) },
    repository: { member, staff, dispute },
    authority: {
      verify: async () =>
        ok({
          subject: 'synthetic',
          emailVerified: true,
          emailDomain: 'example.invalid',
          staffId: null,
          mfaAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 600000).toISOString(),
        }),
    },
    clock: { now: () => now },
    crypto: { digest: () => 'a'.repeat(64) },
    encryption: { encrypt },
    tokens: {},
  } as unknown as Dependencies;
  const service = createPartnerInsightsServices(deps);
  const input = {
    id,
    key: id,
    assignment: id,
    reason: 'terms',
    kind: 'opened',
    expected: 0,
    details: 'Private details',
  } as Parameters<typeof service.dispute>[2];
  return { service, input, member, staff, encrypt, dispute };
}
it('denies a nonmember before encrypting private dispute content', async () => {
  const s = setup();
  s.member.mockRejectedValue(new ServiceFault('forbidden'));
  expect((await s.service.dispute('session', id as never, s.input)).ok).toBe(false);
  expect(s.encrypt).not.toHaveBeenCalled();
  expect(s.dispute).not.toHaveBeenCalled();
});
it('denies unassigned staff resolution before encryption', async () => {
  const s = setup();
  s.staff.mockRejectedValue(new ServiceFault('forbidden'));
  expect(
    (await s.service.dispute('session', id as never, { ...s.input, kind: 'resolved', expected: 1 }))
      .ok,
  ).toBe(false);
  expect(s.encrypt).not.toHaveBeenCalled();
  expect(s.member).not.toHaveBeenCalled();
});
it('reauthorizes a membership revoked while encryption was in flight', async () => {
  const s = setup();
  s.encrypt.mockImplementationOnce(async () => {
    s.member.mockRejectedValue(new ServiceFault('forbidden'));
    return { keyVersion: 'fixture', hex: 'aa' };
  });
  expect((await s.service.dispute('session', id as never, s.input)).ok).toBe(false);
  expect(s.encrypt).toHaveBeenCalledOnce();
  expect(s.dispute).not.toHaveBeenCalled();
});
it('permits a current independent staff decision and retains the final authorization check', async () => {
  const s = setup();
  expect(
    (await s.service.dispute('session', id as never, { ...s.input, kind: 'resolved', expected: 1 }))
      .ok,
  ).toBe(true);
  expect(s.staff).toHaveBeenCalledTimes(4);
  expect(s.dispute).toHaveBeenCalledOnce();
});
