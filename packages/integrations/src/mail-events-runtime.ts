import type { createTransactions } from '../../db/src/transactions.ts';
import { createMailEventsRepository } from '../../db/src/repositories/mail-events.ts';
import { createEmailLinkRepository } from '../../db/src/repositories/email-links.ts';
import {
  createMailEventServices,
  createEmailActionServices,
} from '../../application/src/services/mail-events.ts';
import type { EmailLinkCrypto } from '../../application/src/ports/mail-events.ts';
import type { createContactServices } from '../../application/src/services/contacts.ts';
import { ok, fail } from '../../domain/src/values/core.ts';
import { failure } from '../../application/src/ports/transactions.ts';
import { verifyResendCallback } from './resend-webhook.ts';
type Scope = ReturnType<typeof createTransactions>;
export async function createMailEventsRuntime(o: {
  readonly scope: Scope;
  readonly lookupVersions: readonly string[];
  readonly retrieve: (id: string) => Promise<Readonly<{ id: string; event: string }> | null>;
}) {
  const role = await o.scope.unitOfWork.run(async (tx) =>
    ok((await o.scope.query(tx, 'SELECT current_user AS role')).rows[0]?.role),
  );
  if (!role.ok || role.value !== 'tt_private_runtime')
    throw Error('Invalid mail events runtime role');
  return createMailEventServices({
    uow: o.scope.unitOfWork,
    events: createMailEventsRepository(o.scope, o.lookupVersions),
    retrieve: o.retrieve,
  });
}
export function createResendWebhookIngress(o: {
  readonly services: ReturnType<typeof createMailEventServices>;
  readonly secrets: readonly string[];
  readonly now: () => string;
}) {
  return {
    async receive(bytes: Uint8Array, headers: Readonly<Record<string, string>>) {
      let observation;
      try {
        observation = verifyResendCallback(bytes, headers, o.secrets, o.now());
      } catch {
        return fail(failure('invalid_input'));
      }
      return o.services.receive(observation);
    },
  };
}
export function createEmailActionsRuntime(o: {
  readonly scope: Scope;
  readonly crypto: EmailLinkCrypto;
  readonly contacts: Pick<
    ReturnType<typeof createContactServices>,
    'confirm' | 'withdraw' | 'preferences'
  >;
  readonly origin: string;
}) {
  return createEmailActionServices({
    uow: o.scope.unitOfWork,
    links: createEmailLinkRepository(o.scope),
    ...o,
  });
}
