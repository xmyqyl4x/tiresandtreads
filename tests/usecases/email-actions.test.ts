import { it, expect, vi } from 'vitest';
import { createEmailActionServices } from '../../packages/application/src/services/mail-events.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import {
  failure,
  type UnitOfWork,
  type TransactionContext,
} from '../../packages/application/src/ports/transactions.ts';
import type {
  EmailLinkRepository,
  EmailLinkCrypto,
} from '../../packages/application/src/ports/mail-events.ts';
import type { createContactServices } from '../../packages/application/src/services/contacts.ts';
function setup(origin = 'https://tires.example') {
  const contacts = {
    confirm: vi.fn(async () => ok({ status: 'confirmed' as const })),
    withdraw: vi.fn(async () => ok({ status: 'withdrawn' as const })),
    preferences: vi.fn(async () =>
      ok({ purpose: 'offers' as const, status: 'confirmed' as const }),
    ),
  };
  const links = {
    issue: vi.fn(),
    resolve: vi.fn(async () => null),
    feedback: vi.fn(),
    revoke: vi.fn(),
  } satisfies EmailLinkRepository;
  const crypto = { issue: vi.fn(), parse: vi.fn(() => null) } satisfies EmailLinkCrypto;
  const uow: UnitOfWork = { run: async (fn) => fn({} as TransactionContext) };
  return {
    contacts,
    links,
    service: createEmailActionServices({
      uow,
      contacts: contacts as Pick<
        ReturnType<typeof createContactServices>,
        'confirm' | 'withdraw' | 'preferences'
      >,
      links,
      crypto,
      origin,
    }),
  };
}
it('UC07 scanner navigation never invokes consent confirmation, withdrawal or final feedback', async () => {
  const x = setup();
  await x.service.preferences('proof', 'GET');
  await x.service.visit('proof', 'HEAD');
  await x.service.feedback('proof', 'yes', 'GET');
  await x.service.oneClick('proof', 'GET', { 'List-Unsubscribe': 'One-Click' });
  expect(x.contacts.withdraw).not.toHaveBeenCalled();
  expect(x.contacts.confirm).not.toHaveBeenCalled();
  expect(x.links.feedback).not.toHaveBeenCalled();
});
it('UC07 delegates a deliberate confirmation POST and rejects invalid unsubscribe header origins', async () => {
  const x = setup();
  expect(await x.service.confirm('verify-proof', 'POST')).toMatchObject({ ok: true });
  expect(x.contacts.confirm).toHaveBeenCalledWith('verify-proof', 'POST');
  expect((await setup('http://invalid').service.unsubscribeHeaders('proof')).ok).toBe(false);
  x.contacts.preferences.mockResolvedValueOnce(fail(failure('forbidden')) as never);
  expect((await x.service.unsubscribeHeaders('proof')).ok).toBe(false);
});
