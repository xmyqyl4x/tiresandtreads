import type { createConsentPolicyQuery } from '../../../application/src/queries/consent-policy.ts';
import { ok } from '../../../domain/src/values/core.ts';
import type { ReportCrypto } from '../../../application/src/ports/report-services.ts';
import type { createLocalServiceHost } from '../service-host.ts';
import type { createTransactions } from '../../../db/src/transactions.ts';
import { createStaffRepository } from '../../../db/src/repositories/staff-services.ts';
import type { HttpSecurity } from './core.ts';
import { consentRoutes } from './consent.ts';
import { staffRoutes } from './staff.ts';
import { withLocalStaffSessions } from './staff-security.ts';
import { readLocalStaffGrants, registeredImportArtifact } from './local-files.ts';
export async function localOperationRoutes(d: {
  readonly policy: ReturnType<typeof createConsentPolicyQuery>;
  readonly services: Awaited<ReturnType<typeof createLocalServiceHost>>['services'];
  readonly staffScope: ReturnType<typeof createTransactions>;
  readonly ownerSecurity: HttpSecurity;
  readonly secret: Uint8Array;
  readonly crypto: Pick<ReportCrypto, 'id'>;
  readonly env: Readonly<Record<string, string | undefined>>;
}) {
  const grants = await readLocalStaffGrants(d.env.LOCAL_STAFF_GRANTS_FILE),
    security = withLocalStaffSessions(d.ownerSecurity, grants, d.secret),
    staff = createStaffRepository(d.staffScope);
  return {
    security,
    routes: [
      ...consentRoutes({
        policy: d.policy,
        contacts: d.services.contacts,
        delivery: d.services.delivery,
        privacy: d.services.privacy,
      }),
      ...staffRoutes({
        services: d.services,
        authorize: (actor, permission) =>
          d.staffScope.unitOfWork.run(async (tx) => {
            await staff.authorize(tx, actor, permission);
            return ok(null);
          }),
        artifact: (identifier) => {
          const directory = d.env.LOCAL_IMPORT_ARTIFACTS_DIRECTORY;
          if (!directory) throw Error('Local import artifact unavailable');
          return registeredImportArtifact(directory, identifier);
        },
        commandId: (actor, key) => d.crypto.id('command', 'staff-http:v1\0' + actor + '\0' + key),
      }),
    ],
  };
}
