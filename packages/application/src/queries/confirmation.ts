import type { ContactCrypto, ContactServiceRepository } from '../ports/contact-services.ts';
import type { PrivacyRepository } from '../ports/privacy.ts';
import type { UnitOfWork } from '../ports/transactions.ts';
import { failure } from '../ports/transactions.ts';
import { ok, fail, instant } from '../../../domain/src/values/core.ts';
export function createConfirmationQuery(d: {
  readonly uow: UnitOfWork;
  readonly contacts: Pick<ContactServiceRepository, 'intent' | 'guard'>;
  readonly privacy: Pick<PrivacyRepository, 'permission'>;
  readonly crypto: Pick<ContactCrypto, 'parse'>;
  readonly now: () => string;
}) {
  return async (raw: string) => {
    const proof = d.crypto.parse('verify', raw);
    if (!proof) return fail(failure('not_found'));
    const now = instant(d.now());
    if (!now.ok) return fail(failure('unavailable', true));
    return d.uow.run(async (tx) => {
      const intent = await d.contacts.intent(tx, proof.id);
      if (
        !intent ||
        intent.key.keyVersion !== proof.key.keyVersion ||
        intent.key.digest !== proof.key.digest ||
        intent.invalidated ||
        !intent.live
      )
        return fail(failure('not_found'));
      await d.contacts.guard(tx, null, intent.contactId);
      const state = await d.privacy.permission(tx, intent.subjectId, intent.purpose, intent.scope);
      return ok({
        purpose: intent.purpose,
        status: state.status,
        expiresAt: intent.expiresAt,
        expired: Date.parse(intent.expiresAt) <= Date.parse(now.value),
      });
    });
  };
}
