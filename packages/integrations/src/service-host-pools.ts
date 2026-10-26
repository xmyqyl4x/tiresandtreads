import {
  serviceHostRoles,
  validateServiceHostPlan,
  type ServiceHostPlan,
  type ServiceHostLane,
} from '../../config/src/service-host-plan.ts';
import { createRuntimePool } from '../../db/src/runtime-pool.ts';
import { createTransactions } from '../../db/src/transactions.ts';
import { ok } from '../../domain/src/values/core.ts';
export async function createServiceHostPools(plan: ServiceHostPlan) {
  const budget = validateServiceHostPlan(plan),
    names = Object.keys(serviceHostRoles) as ServiceHostLane[];
  const pools = Object.fromEntries(
    names.map((n) => [n, createRuntimePool(plan.urls[n], plan.max[n], 4, 'tt-service-host:' + n)]),
  ) as Record<ServiceHostLane, ReturnType<typeof createRuntimePool>>;
  let shutdown: Promise<void> | undefined;
  const stop = () => (shutdown ??= Promise.all(names.map((n) => pools[n].drain())).then(() => {}));
  const scopes = Object.fromEntries(
    names.map((n) => [
      n,
      createTransactions(pools[n].pool, {
        admissionMs: 500,
        transactionMs: 2500,
        statementMs: n === 'aggregate' ? 2000 : 1000,
        lockMs: 250,
        idleMs: 1000,
      }),
    ]),
  ) as Record<ServiceHostLane, ReturnType<typeof createTransactions>>;
  try {
    async function check(n: ServiceHostLane) {
      const r = await scopes[n].unitOfWork.run(async (tx) =>
        ok(
          (
            await scopes[n].query(
              tx,
              "SELECT current_user AS role,current_database() AS database,current_setting('max_connections')::integer AS capacity",
            )
          ).rows[0],
        ),
      );
      if (
        !r.ok ||
        r.value?.role !== serviceHostRoles[n] ||
        r.value.database !== new URL(plan.urls[n]).pathname.slice(1) ||
        budget.required > Number(r.value.capacity)
      )
        throw Error('Invalid service host capacity');
      return Number(r.value.capacity);
    }
    // One connection discovers cluster capacity before any other lane is admitted.
    const capacity = await check('report');
    await Promise.all(names.filter((n) => n !== 'report').map(check));
    return { scopes, budget: Object.freeze({ ...budget, capacity }), shutdown: stop };
  } catch {
    await stop();
    throw Error('Service host database unavailable');
  }
}
