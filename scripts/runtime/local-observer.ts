import { createRuntimePool } from '../../packages/db/src/runtime-pool.ts';
import { createTransactions } from '../../packages/db/src/transactions.ts';
import { createServiceHealthRepository } from '../../packages/db/src/repositories/service-health.ts';
import { createOperationsRepository } from '../../packages/db/src/repositories/operations.ts';
import { createServiceHealth } from '../../packages/application/src/services/service-health.ts';
import { createLocalObserver } from '../../packages/integrations/src/local-observer.ts';
import { localHttpReady } from '../../packages/integrations/src/local-probe.ts';
import { id } from '../../packages/domain/src/values/core.ts';
import { localWorkflowQuery } from './local-workflow-history.ts';
export const observerLimits = { backlog: 100, lagSeconds: 300, capacityBasisPoints: 8000 };
export function localObserver(
  url: string,
  actor: string,
  origin: string,
  storage: string,
  appEnv: string,
) {
  const u = new URL(url),
    parsed = id('staff', actor);
  if (
    !parsed.ok ||
    u.protocol !== 'postgresql:' ||
    u.port !== '5432' ||
    u.search ||
    u.hash ||
    !/^[a-f0-9]{64}$/.test(u.password) ||
    u.username !== 'tt_operations_runtime' ||
    u.hostname !== 'postgres' ||
    u.pathname !== '/tt_app' ||
    !['dev-local', 'stage-local', 'test-local'].includes(appEnv)
  )
    throw Error('Invalid local observer');
  const pool = createRuntimePool(url, 1, 1, 'tt-local-observer');
  const scope = createTransactions(pool.pool, {
    statementMs: 1000,
    lockMs: 250,
    transactionMs: 2500,
  });
  const health = createServiceHealth({
    uow: scope.unitOfWork,
    health: createServiceHealthRepository(scope),
    operations: createOperationsRepository(scope),
  });
  const observer = createLocalObserver({
    review: () => health.review(parsed.value, observerLimits),
    checks: {
      host_readiness: () => localHttpReady(origin + '/health/ready'),
      storage_fixture: () => localHttpReady(storage + '/moto-api/'),
      workflow_freshness: async () => {
        const from = new Date(Date.now() - 180000).toISOString();
        const data = await localWorkflowQuery(
          'http://inngest:8288',
          `{runs(first:50,orderBy:[],filter:{from:${JSON.stringify(from)}}){edges{node{id status function{slug} cronSchedule}}}}`,
        );
        return (
          data.runs?.edges.some(
            ({ node: r }) =>
              r.function.slug === 'tiresandtreads-' + appEnv + '-service-maintenance-v1' &&
              r.status === 'COMPLETED' &&
              r.cronSchedule === '* * * * *',
          ) === true
        );
      },
    },
    now: Date.now,
  });
  return { ...observer, close: () => pool.drain() };
}
