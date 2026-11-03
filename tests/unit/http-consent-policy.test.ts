import { it, expect, vi } from 'vitest';
import { createConsentPolicyQuery } from '../../packages/application/src/queries/consent-policy.ts';
import type { UnitOfWork } from '../../packages/application/src/ports/transactions.ts';
const uuid = '11111111-1111-4111-8111-111111111111';
function setup() {
  const uow = { run: async (fn: (tx: unknown) => unknown) => fn({}) } as UnitOfWork,
    notice = vi.fn(async () => true),
    policy = {
      version: 'synthetic',
      notices: {
        necessary: uuid,
        report: uuid,
        offers: uuid,
        analytics: uuid,
        ads: uuid,
        targeted_ads: uuid,
      },
    };
  return { notice, policy, query: createConsentPolicyQuery(uow, { notice }, policy) };
}
it('returns only the current published notice identities and policy version, without owner or consent mutation', async () => {
  const s = setup(),
    r = await s.query();
  expect(r).toEqual({ ok: true, value: s.policy });
  expect(s.notice).toHaveBeenCalledTimes(6);
  if (r.ok) expect(r.value.notices).not.toBe(s.policy.notices);
});
it('fails closed when any configured notice is absent/unpublished or has an invalid identity', async () => {
  const s = setup();
  s.notice.mockResolvedValueOnce(false);
  expect(await s.query()).toMatchObject({ ok: false, error: { code: 'conflict' } });
  s.policy.notices.ads = '00000000-0000-0000-0000-000000000000';
  expect(await s.query()).toMatchObject({ ok: false, error: { code: 'conflict' } });
});
