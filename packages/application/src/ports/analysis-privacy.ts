import type { Id } from '../../../domain/src/values/core.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { PrivacyLease } from './privacy-services.ts';
import type { AssetLocation } from './assets.ts';
import type { Page, PageRequest } from './pagination.ts';
// Composed with the existing P1 journal/objects/receipt stages; no storage/provider I/O here.
export interface AnalysisPrivacyRepository {
  restrict(tx: Tx, lease: PrivacyLease): Promise<void>;
  assets(tx: Tx, lease: PrivacyLease, page: PageRequest): Promise<Page<AssetLocation>>;
  erase(tx: Tx, lease: PrivacyLease, scopeId: Id<'ai_scope'>): Promise<boolean>;
}
