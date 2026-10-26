import {
  workloadRoles,
  validateWorkloads,
  type Workload,
  type WorkloadPlan,
} from '../../config/src/workloads.ts';
import { createRuntimePool } from '../../db/src/runtime-pool.ts';
import { createTransactions } from '../../db/src/transactions.ts';
import { ok } from '../../domain/src/values/core.ts';
export async function createWorkloadPools(plan: WorkloadPlan) {
  const required = validateWorkloads(plan),
    names = Object.keys(workloadRoles) as Workload[];
  const pools = Object.fromEntries(
    names.map((name) => [name, createRuntimePool(plan.urls[name], plan.max[name], 4)]),
  ) as Record<Workload, ReturnType<typeof createRuntimePool>>;
  const shutdown = () => Promise.all(names.map((n) => pools[n].drain())).then(() => {});
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
  ) as Record<Workload, ReturnType<typeof createTransactions>>;
  try {
    for (const n of names) {
      const r = await scopes[n].unitOfWork.run(async (tx) =>
        ok(
          (
            await scopes[n].query(
              tx,
              "SELECT current_user AS role,current_setting('max_connections')::integer AS capacity",
            )
          ).rows[0],
        ),
      );
      if (!r.ok || r.value?.role !== workloadRoles[n] || required > Number(r.value?.capacity))
        throw Error('Invalid workload budget');
    }
    return { scopes, requiredConnections: required, shutdown };
  } catch {
    await shutdown();
    throw Error('Workload runtime unavailable');
  }
}
