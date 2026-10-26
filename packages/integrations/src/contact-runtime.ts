import type { createTransactions } from '../../db/src/transactions.ts';
import type {
  ContactCrypto,
  ContactEncryption,
  ContactPolicy,
} from '../../application/src/ports/contact-services.ts';
import { createContactServices } from '../../application/src/services/contacts.ts';
import { createOwnerRepository } from '../../db/src/repositories/owners.ts';
import { createReportRepository } from '../../db/src/repositories/reports.ts';
import { createPrivacyRepository } from '../../db/src/repositories/privacy.ts';
import { createContactServiceRepository } from '../../db/src/repositories/contact-services.ts';
import { createCommandRepository } from '../../db/src/repositories/jobs.ts';
import { createReliabilityRepository } from '../../db/src/repositories/reliability.ts';
import { ok } from '../../domain/src/values/core.ts';
export async function createContactRuntime(deps: {
  readonly scope: ReturnType<typeof createTransactions>;
  readonly crypto: ContactCrypto;
  readonly encryption: ContactEncryption;
  readonly policy: ContactPolicy;
  readonly now: () => string;
}) {
  const s = deps.scope;
  const role = await s.unitOfWork.run(async (tx) =>
    ok((await s.query(tx, 'SELECT current_user AS role')).rows[0]?.role),
  );
  if (!role.ok || role.value !== 'tt_private_runtime') throw Error('Invalid contact runtime role');
  return createContactServices({
    uow: s.unitOfWork,
    owners: createOwnerRepository(s),
    reports: createReportRepository(s),
    privacy: createPrivacyRepository(s, deps.crypto.lookupVersions),
    contacts: createContactServiceRepository(s, deps.crypto.lookupVersions),
    commands: createCommandRepository(s),
    reliability: createReliabilityRepository(s),
    ...deps,
  });
}
