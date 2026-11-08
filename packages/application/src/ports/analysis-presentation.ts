import type { Id } from '../../../domain/src/values/core.ts';
import type { TransactionContext } from './transactions.ts';
export interface AnalysisPresentationRepository {
  latest(
    tx: TransactionContext,
    owner: Id<'subject'>,
    report: Id<'report'>,
    version: number,
  ): Promise<Id<'ai_request'> | null>;
  selection(
    tx: TransactionContext,
    owner: Id<'subject'>,
    report: Id<'report'>,
    version: number,
  ): Promise<Readonly<{ revision: string; attachedAt: string }> | null>;
}
