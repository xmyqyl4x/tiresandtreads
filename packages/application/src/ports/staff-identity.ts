import type { Id } from '../../../domain/src/values/core.ts';
import type { TransactionContext } from './transactions.ts';

// Returns only an already mapped, active identity with a current local grant.
// This lookup never provisions identities or trusts roles from a session token.
export interface StaffIdentityRepository {
  resolve(tx: TransactionContext, providerSubject: string): Promise<Id<'staff'> | null>;
}
