import {
  failure,
  type FailureCode,
  type UnitOfWork,
  type TransactionContext,
  type ApplicationFailure,
} from '../ports/transactions.ts';
import { fail, type Result } from '../../../domain/src/values/core.ts';
export class ServiceFault extends Error {
  constructor(
    readonly code: FailureCode,
    readonly detail?: ApplicationFailure,
  ) {
    super(code);
  }
}
export function demand(condition: unknown, code: FailureCode = 'invalid_input'): asserts condition {
  if (!condition) throw new ServiceFault(code);
}
export function serviceFailure(error: unknown) {
  return error instanceof ServiceFault
    ? (error.detail ?? failure(error.code))
    : failure('unavailable');
}
export function serviceWork<T>(
  uow: UnitOfWork,
  work: (tx: TransactionContext) => Promise<Result<T, ApplicationFailure>>,
) {
  return uow.run(async (tx) => {
    try {
      return await work(tx);
    } catch (e) {
      if (e instanceof ServiceFault) return fail(serviceFailure(e));
      throw e;
    }
  });
}
