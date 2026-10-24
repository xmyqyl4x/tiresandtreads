import { fail, type Result } from '../../domain/src/values/core.ts';
import {
  failure,
  type ApplicationFailure,
  type TransactionContext,
  type UnitOfWork,
} from '../../application/src/ports/transactions.ts';

// Structural adapter boundary implemented by pg.Pool/PoolClient; no driver object crosses the application port.
export interface PgConnection {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null; command: string }>;
  release(destroy?: boolean): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
  removeListener(event: 'error', listener: (error: Error) => void): unknown;
}
export interface PgPool {
  connect(): Promise<PgConnection>;
}
export interface TransactionLimits {
  readonly admissionMs: number;
  readonly transactionMs: number;
  readonly statementMs: number;
  readonly lockMs: number;
  readonly idleMs: number;
}
export class PersistenceFailure extends Error {
  constructor(readonly failure: ApplicationFailure) {
    super(failure.messageKey);
    this.name = 'PersistenceFailure';
  }
}
function classify(error: unknown): ApplicationFailure {
  if (error instanceof PersistenceFailure) return error.failure;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === '40001' || code === '40P01' || code === '23505')
    return failure('conflict', code !== '23505');
  if (typeof code === 'string' && code.startsWith('23')) return failure('integrity');
  if (code === '57014' || code === '55P03') return failure('timeout', true);
  return failure('unavailable');
}
function fault(code: Parameters<typeof failure>[0]): PersistenceFailure {
  return new PersistenceFailure(failure(code));
}
interface State {
  client: PgConnection;
  active: boolean;
  pending: boolean;
  poison: ApplicationFailure | null;
}
export function createTransactions(
  pool: PgPool,
  overrides: Partial<TransactionLimits> = {},
): {
  readonly unitOfWork: UnitOfWork;
  readonly abort: (tx: TransactionContext, error: ApplicationFailure) => never;
  readonly query: (
    tx: TransactionContext,
    text: string,
    values?: readonly unknown[],
  ) => Promise<Readonly<{ rows: readonly Record<string, unknown>[]; rowCount: number }>>;
} {
  const limits = {
    admissionMs: 1000,
    transactionMs: 5000,
    statementMs: 2000,
    lockMs: 500,
    idleMs: 3000,
    ...overrides,
  };
  for (const [key, maximum] of Object.entries({
    admissionMs: 5000,
    transactionMs: 30000,
    statementMs: 15000,
    lockMs: 3000,
    idleMs: 10000,
  })) {
    const value = limits[key as keyof TransactionLimits];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new Error('Invalid transaction limits');
  }
  const states = new WeakMap<TransactionContext, State>();
  const query = async (tx: TransactionContext, text: string, values: readonly unknown[] = []) => {
    const state = states.get(tx);
    if (!state?.active) throw fault('transaction_context');
    if (state.pending || state.poison) {
      state.poison ??= failure('transaction_context');
      throw new PersistenceFailure(state.poison);
    }
    state.pending = true;
    try {
      const result = await state.client.query(text, [...values]);
      if (!state.active) throw fault('transaction_context');
      return Object.freeze({ rows: result.rows, rowCount: result.rowCount ?? 0 });
    } catch (error) {
      state.poison = classify(error);
      throw new PersistenceFailure(state.poison);
    } finally {
      state.pending = false;
    }
  };
  const unitOfWork: UnitOfWork = {
    async run<T>(
      work: (tx: TransactionContext) => Promise<Result<T, ApplicationFailure>>,
    ): Promise<Result<T, ApplicationFailure>> {
      let admission: ReturnType<typeof setTimeout> | undefined;
      let abandoned = false;
      let client: PgConnection;
      try {
        const arriving = pool.connect().then((connection) => {
          if (abandoned) {
            connection.release(true);
            throw fault('timeout');
          }
          return connection;
        });
        client = await Promise.race([
          arriving,
          new Promise<never>((_, reject) => {
            admission = setTimeout(() => {
              abandoned = true;
              reject(fault('timeout'));
            }, limits.admissionMs);
          }),
        ]);
      } catch (error) {
        return fail(classify(error));
      } finally {
        clearTimeout(admission);
      }
      // The brand is created only here; the WeakMap checks liveness and adapter ownership at runtime.
      const tx = Object.freeze({}) as TransactionContext;
      const state: State = { client, active: true, pending: false, poison: null };
      states.set(tx, state);
      let began = false,
        committing = false,
        committed = false,
        destroy = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const onError = () => {
        destroy = true;
        state.poison = failure('unavailable');
      };
      client.on('error', onError);
      const guard = () => {
        if (!state.active) throw fault('transaction_context');
        if (state.poison) throw new PersistenceFailure(state.poison);
      };
      const execute = async () => {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        began = true;
        guard();
        await client.query(
          "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true),set_config('idle_in_transaction_session_timeout',$3,true)",
          [String(limits.statementMs), String(limits.lockMs), String(limits.idleMs)],
        );
        guard();
        let result: Result<T, ApplicationFailure>;
        try {
          result = await work(tx);
        } catch (error) {
          if (error instanceof PersistenceFailure) throw error;
          throw fault('internal');
        }
        guard();
        // Floating/parallel statements must not commit after the callback has returned.
        if (state.pending) {
          destroy = true;
          throw fault('transaction_context');
        }
        state.active = false;
        if (!result.ok) return result;
        committing = true;
        const commit = await client.query('COMMIT');
        if (commit.command !== 'COMMIT') throw fault('integrity');
        committed = true;
        return result;
      };
      const execution = execute();
      try {
        return await Promise.race([
          execution,
          new Promise<never>((_, reject) => {
            deadline = setTimeout(() => {
              destroy = true;
              state.active = false;
              reject(fault('timeout'));
            }, limits.transactionMs);
          }),
        ]);
      } catch (error) {
        // Explicit server integrity/transaction-rollback errors prove COMMIT was rejected.
        const classified = classify(error);
        const serverRejectedCommit =
          error &&
          typeof error === 'object' &&
          'code' in error &&
          typeof error.code === 'string' &&
          /^(23|40)/.test(error.code);
        if (classified.code === 'unavailable') destroy = true;
        if (committing && !serverRejectedCommit) {
          destroy = true;
          return fail(failure('commit_unknown'));
        }
        return fail(classified);
      } finally {
        clearTimeout(deadline);
        state.active = false;
        states.delete(tx);
        if (began && !committed && !destroy) {
          try {
            await Promise.race([
              client.query('ROLLBACK'),
              new Promise<never>((_, reject) => {
                deadline = setTimeout(() => reject(fault('timeout')), limits.statementMs);
              }),
            ]);
          } catch {
            destroy = true;
          } finally {
            clearTimeout(deadline);
          }
        }
        client.release(destroy);
        // Keep a listener on a destroyed in-flight client until its pending execution settles.
        void execution.finally(() => client.removeListener('error', onError)).catch(() => {});
      }
    },
  };
  const abort = (tx: TransactionContext, error: ApplicationFailure): never => {
    const state = states.get(tx);
    if (!state?.active) throw fault('transaction_context');
    state.poison ??= error;
    throw new PersistenceFailure(state.poison);
  };
  return { unitOfWork, query, abort };
}
