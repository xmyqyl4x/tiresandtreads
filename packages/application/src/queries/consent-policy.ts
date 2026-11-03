import type { UnitOfWork, ApplicationFailure } from '../ports/transactions.ts';
import { failure } from '../ports/transactions.ts';
import type { ContactServiceRepository, ContactPolicy } from '../ports/contact-services.ts';
import { id, ok, fail, type Result } from '../../../domain/src/values/core.ts';
export interface ConsentPolicyView {
  readonly version: string;
  readonly notices: Readonly<Record<keyof ContactPolicy['notices'], string>>;
}
export function createConsentPolicyQuery(
  uow: UnitOfWork,
  contacts: Pick<ContactServiceRepository, 'notice'>,
  policy: ConsentPolicyView,
) {
  return (): Promise<Result<ConsentPolicyView, ApplicationFailure>> =>
    uow.run(async (tx) => {
      for (const purpose of [
        'necessary',
        'report',
        'offers',
        'analytics',
        'ads',
        'targeted_ads',
      ] as const) {
        const value = id('notice', policy.notices[purpose]);
        if (!value.ok || !(await contacts.notice(tx, value.value, purpose, policy.version)))
          return fail(failure('conflict'));
      }
      return ok({ version: policy.version, notices: { ...policy.notices } });
    });
}
