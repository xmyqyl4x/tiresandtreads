import { createRuntimePool } from '../../packages/db/src/runtime-pool.ts';
import { createTransactions } from '../../packages/db/src/transactions.ts';
import { createServiceHealth } from '../../packages/application/src/services/service-health.ts';
import { createServiceHealthRepository } from '../../packages/db/src/repositories/service-health.ts';
import { createOperationsRepository } from '../../packages/db/src/repositories/operations.ts';
import { id, ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import { localProviderProject } from '../../packages/config/src/provider-preflight.ts';
import { observerLimits } from '../runtime/local-observer.ts';
export function observationDatabase(
  env: Readonly<Record<string, string | undefined>>,
  url: string,
  actor: string,
  required: number,
) {
  localProviderProject(env);
  const u = new URL(url),
    staff = id('staff', actor);
  if (
    !staff.ok ||
    u.protocol !== 'postgresql:' ||
    u.hostname !== 'postgres' ||
    u.port !== '5432' ||
    u.username !== 'tt_operations_runtime' ||
    u.pathname !== '/tt_app_catalog' ||
    !u.password ||
    u.search ||
    u.hash ||
    !Number.isSafeInteger(required) ||
    required < 1 ||
    required > 1000000
  )
    throw Error('Invalid observation database');
  const pool = createRuntimePool(url, 1, 1, 'tt-observation:reader'),
    scope = createTransactions(pool.pool, { statementMs: 1000, lockMs: 250, transactionMs: 2500 }),
    operations = createOperationsRepository(scope),
    health = createServiceHealth({
      uow: scope.unitOfWork,
      health: createServiceHealthRepository(scope),
      operations,
    });
  return {
    review: () => health.review(staff.value, observerLimits),
    async readCapacity() {
      const r = await scope.unitOfWork.run(async (tx) => {
        const allowed = async () => {
          const s = await operations.staff(tx, staff.value);
          return s?.active && s.roles.includes('operations_read');
        };
        if (!(await allowed())) return fail(failure('forbidden'));
        const row = (
          await scope.query(
            tx,
            "SELECT current_setting('max_connections')::int AS raw,current_setting('superuser_reserved_connections')::int AS super_reserved,current_setting('reserved_connections')::int AS role_reserved,(SELECT coalesce(sum(numbackends),0)::int FROM pg_stat_database) AS backends,statement_timestamp() AS sampled_at",
          )
        ).rows[0]!;
        if (!(await allowed())) return fail(failure('forbidden'));
        return ok({
          raw: row.raw,
          superReserved: row.super_reserved,
          roleReserved: row.role_reserved,
          required,
          backends: row.backends,
          sampledAt: new Date(row.sampled_at as string).toISOString(),
        });
      });
      if (!r.ok) throw Error('Observation evidence unavailable');
      return r.value;
    },
    close: () => pool.drain(),
  };
}
