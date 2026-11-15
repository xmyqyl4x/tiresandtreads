import type { createTransactions } from '../../db/src/transactions.ts';
import { createStaffIdentityRepository } from '../../db/src/repositories/staff-identity.ts';
import { ok } from '../../domain/src/values/core.ts';
import {
  withClerkStaffSessions,
  type ClerkStaffSecurityOptions,
} from './http/clerk-staff-security.ts';

// The caller supplies an already bounded tt_staff_runtime scope and budgets its lane.
// No pool, account, credential or identity is created by this composition.
export function createClerkStaffSecurity(
  scope: ReturnType<typeof createTransactions>,
  options: Omit<Extract<ClerkStaffSecurityOptions, { enabled: true }>, 'resolve'>,
) {
  const identities = createStaffIdentityRepository(scope);
  return withClerkStaffSessions({
    ...options,
    resolve: async (subject) => {
      const result = await scope.unitOfWork.run(async (tx) =>
        ok(await identities.resolve(tx, subject)),
      );
      return result.ok ? result.value : null;
    },
  });
}
