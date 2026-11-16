import type { TransactionContext } from './transactions.ts';
import type { Id } from '../../../domain/src/values/core.ts';
export interface EditorialAppIdentityRepository {
  permissions(
    tx: TransactionContext,
    staff: Id<'staff'>,
    requested: readonly string[],
  ): Promise<readonly string[] | null>;
}
export interface EditorialCmsIdentityRepository {
  resolve(tx: TransactionContext, staff: Id<'staff'>): Promise<Id<'cms_staff'> | null>;
}
