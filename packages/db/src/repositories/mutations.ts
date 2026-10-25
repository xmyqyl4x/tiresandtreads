import { failure, type TransactionContext } from '../../../application/src/ports/transactions.ts';
import { PersistenceFailure, type createTransactions } from '../transactions.ts';
export type WriteScope = Pick<ReturnType<typeof createTransactions>, 'query' | 'abort'>;
export function stop(code: Parameters<typeof failure>[0]): never {
  throw new PersistenceFailure(failure(code));
}
// Preserve each port's generic signatures while poisoning a scope on every failed mutation.
// A service catching an adapter exception must never commit an earlier partial write.
export function guarded<T extends object>(scope: WriteScope, repository: T): T {
  return Object.fromEntries(
    Object.entries(repository).map(([key, method]) => [
      key,
      async (tx: TransactionContext, ...args: unknown[]) => {
        try {
          return await (method as (tx: TransactionContext, ...args: unknown[]) => Promise<unknown>)(
            tx,
            ...args,
          );
        } catch (error) {
          return scope.abort(
            tx,
            error instanceof PersistenceFailure ? error.failure : failure('internal'),
          );
        }
      },
    ]),
  ) as T;
}
