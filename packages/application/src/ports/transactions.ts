import type { Result } from '../../../domain/src/values/core.ts';
declare const scope: unique symbol;
// Opaque capability; construction and client binding belong only to a persistence adapter.
export interface TransactionContext {
  readonly [scope]: 'transaction';
}
export type FailureCode =
  | 'invalid_input'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'integrity'
  | 'unavailable'
  | 'timeout'
  | 'transaction_context'
  | 'commit_unknown'
  | 'internal';
export interface ApplicationFailure {
  readonly code: FailureCode;
  readonly messageKey: string;
  readonly retryable: boolean;
}
export interface UnitOfWork {
  run<T>(
    work: (tx: TransactionContext) => Promise<Result<T, ApplicationFailure>>,
  ): Promise<Result<T, ApplicationFailure>>;
}
export function failure(code: FailureCode, retryable = false): ApplicationFailure {
  return Object.freeze({ code, messageKey: `errors.${code}`, retryable });
}
