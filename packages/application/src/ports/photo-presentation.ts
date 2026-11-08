import type { Id } from '../../../domain/src/values/core.ts';
import type { TransactionContext } from './transactions.ts';
import type { PhotoStatus } from '../../../domain/src/entities/photo.ts';
import type { Page, PageRequest } from './pagination.ts';
export interface PhotoPresentationRepository {
  available(tx: TransactionContext, policy: Id<'ai_policy'>): Promise<boolean>;
  list(tx: TransactionContext, owner: Id<'subject'>, page: PageRequest): Promise<Page<PhotoStatus>>;
}
