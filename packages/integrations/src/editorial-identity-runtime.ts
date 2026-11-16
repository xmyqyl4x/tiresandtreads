import type { createTransactions } from '../../db/src/transactions.ts';
import {
  createEditorialAppIdentityRepository,
  createEditorialCmsIdentityRepository,
} from '../../db/src/repositories/editorial-identity.ts';
import { ok } from '../../domain/src/values/core.ts';
import {
  verifiedEditorialAuthorization,
  type EditorialStaffOptions,
} from './editorial-staff-authorization.ts';
// Reuse caller-owned bounded read scopes. No new pool, role, identity or privilege.
export function createEditorialStaffAuthorization(
  app: ReturnType<typeof createTransactions>,
  cms: ReturnType<typeof createTransactions>,
  options: Omit<EditorialStaffOptions, 'permissions' | 'cms'>,
) {
  const identities = createEditorialAppIdentityRepository(app),
    mappings = createEditorialCmsIdentityRepository(cms),
    requested = Object.values(options.profile);
  return verifiedEditorialAuthorization({
    ...options,
    permissions: async (staff) => {
      const result = await app.unitOfWork.run(async (tx) =>
        ok(await identities.permissions(tx, staff, requested)),
      );
      if (!result.ok) throw Error('unavailable');
      return result.value;
    },
    cms: async (staff) => {
      const result = await cms.unitOfWork.run(async (tx) => ok(await mappings.resolve(tx, staff)));
      if (!result.ok) throw Error('unavailable');
      return result.value;
    },
  });
}
