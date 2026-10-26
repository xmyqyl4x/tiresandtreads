import { ok, fail } from '../../../domain/src/values/core.ts';
import {
  maintenanceActions,
  type MaintenanceAction,
  type MaintenanceBindings,
} from '../ports/service-maintenance.ts';
import { failure, type FailureCode } from '../ports/transactions.ts';
import { serviceFailure } from './service-work.ts';
export interface MaintenanceResult {
  readonly action: MaintenanceAction;
  readonly status: 'completed' | 'disabled' | 'failed' | 'busy';
  readonly processed?: number;
  readonly error?: FailureCode;
}
export function createServiceMaintenance(d: {
  readonly bindings: MaintenanceBindings;
  readonly enabled: readonly MaintenanceAction[];
}) {
  if (
    d.enabled.length > maintenanceActions.length ||
    new Set(d.enabled).size !== d.enabled.length ||
    d.enabled.some((a) => !maintenanceActions.includes(a)) ||
    maintenanceActions.some((a) => typeof d.bindings[a] !== 'function')
  )
    throw Error('Invalid maintenance configuration');
  const enabled = new Set(d.enabled);
  let running = false;
  async function execute(action: MaintenanceAction): Promise<MaintenanceResult> {
    if (!enabled.has(action)) return { action, status: 'disabled' };
    try {
      const r = await d.bindings[action]();
      if (!r.ok) return { action, status: 'failed', error: 'unavailable' };
      if (
        !Number.isSafeInteger(r.value.processed) ||
        r.value.processed < 0 ||
        r.value.processed > 1000
      )
        throw Error('Invalid maintenance result');
      return { action, status: 'completed', processed: r.value.processed };
    } catch (e) {
      return { action, status: 'failed', error: serviceFailure(e).code };
    }
  }
  return {
    async run(action: MaintenanceAction) {
      if (!maintenanceActions.includes(action)) return fail(failure('invalid_input'));
      if (running) return ok({ action, status: 'busy' as const });
      running = true;
      try {
        return ok(await execute(action));
      } finally {
        running = false;
      }
    },
    async cycle(actions: readonly MaintenanceAction[]) {
      if (
        !Array.isArray(actions) ||
        actions.length < 1 ||
        actions.length > 4 ||
        new Set(actions).size !== actions.length ||
        actions.some((a) => !maintenanceActions.includes(a))
      )
        return fail(failure('invalid_input'));
      if (running) return ok({ status: 'busy' as const, results: [] });
      running = true;
      try {
        const results: MaintenanceResult[] = [];
        for (const action of actions) results.push(await execute(action));
        return ok({ status: 'completed' as const, results });
      } finally {
        running = false;
      }
    },
  };
}
