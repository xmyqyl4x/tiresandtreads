import { ok, fail, type Result } from '../../domain/src/values/core.ts';
import { failure, type ApplicationFailure } from '../../application/src/ports/transactions.ts';
import { createServiceMaintenance } from '../../application/src/services/service-maintenance.ts';
import type {
  MaintenanceAction,
  MaintenanceBindings,
} from '../../application/src/ports/service-maintenance.ts';
import type { createDeliveryRuntime } from './delivery-runtime.ts';
import type { createPrivacyRuntime } from './privacy-runtime.ts';
import type { createMailEventsRuntime } from './mail-events-runtime.ts';
import type { createAnalyticsRuntime } from './analytics-runtime.ts';
import type { createContentRuntime } from './content-runtime.ts';
import type { createImportRuntime } from './import-runtime.ts';
type Resolved<T> = Awaited<T>;
export function createServiceMaintenanceRuntime(o: {
  readonly delivery: Pick<
    Resolved<ReturnType<typeof createDeliveryRuntime>>,
    'reconcile' | 'dispatch'
  >;
  readonly privacy: Pick<
    Resolved<ReturnType<typeof createPrivacyRuntime>>,
    'ready' | 'notifications' | 'workOne' | 'dispatchVerification' | 'sweep' | 'retentionAssets'
  >;
  readonly mail: Pick<Resolved<ReturnType<typeof createMailEventsRuntime>>, 'pending' | 'replay'>;
  readonly analytics: Pick<
    Resolved<ReturnType<typeof createAnalyticsRuntime>>['analytics'],
    'rebuildOne' | 'maintenance'
  >;
  readonly admission: Pick<
    Resolved<ReturnType<typeof createAnalyticsRuntime>>['admission'],
    'cleanup'
  >;
  readonly content: Pick<
    Resolved<ReturnType<typeof createContentRuntime>>['services'],
    'reconcile' | 'dispatch'
  >;
  readonly sources: Pick<Resolved<ReturnType<typeof createImportRuntime>>['sourceRefresh'], 'tick'>;
  readonly jurisdiction: string;
  readonly applyRetention?: boolean;
  readonly enabled?: readonly MaintenanceAction[];
}) {
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/.test(o.jurisdiction) ||
    (o.applyRetention !== undefined && typeof o.applyRetention !== 'boolean')
  )
    throw Error('Invalid maintenance configuration');
  async function drain<T>(
    list: () => Promise<Result<readonly T[], ApplicationFailure>>,
    action: (id: T) => Promise<Result<unknown, ApplicationFailure>>,
  ) {
    const ids = await list();
    if (!ids.ok) return ids;
    let processed = 0;
    let failed = false;
    for (const id of ids.value.slice(0, 4)) {
      const result = await action(id);
      if (result.ok) processed++;
      else failed = true;
    }
    return failed ? fail(failure('unavailable')) : ok({ processed });
  }
  const bindings: MaintenanceBindings = {
    delivery: () => drain(o.delivery.reconcile, o.delivery.dispatch),
    callbacks: () => drain(o.mail.pending, o.mail.replay),
    publication: () => drain(o.content.reconcile, o.content.dispatch),
    privacy: () => drain(() => o.privacy.ready(4), o.privacy.workOne),
    privacy_verification: () =>
      drain(() => o.privacy.notifications(4), o.privacy.dispatchVerification),
    async analytics() {
      const a = await o.analytics.rebuildOne();
      if (!a.ok) return a;
      const b = await o.analytics.maintenance(100);
      return b.ok ? ok({ processed: a.value ? 1 : 0 }) : b;
    },
    async quotas() {
      const r = await o.admission.cleanup(250);
      return r.ok ? ok({ processed: r.value }) : r;
    },
    async retention() {
      const r = await o.privacy.sweep(o.jurisdiction, !(o.applyRetention ?? false));
      return r.ok ? ok({ processed: r.value.requests.length }) : r;
    },
    async assets() {
      const r = await o.privacy.retentionAssets(!(o.applyRetention ?? false));
      return ok({ processed: r.erased });
    },
    async sources() {
      const r = await o.sources.tick();
      return !r.ok
        ? r
        : r.value.some((v) => !v.result.ok)
          ? fail(failure('unavailable'))
          : ok({ processed: r.value.length });
    },
  };
  return createServiceMaintenance({ bindings, enabled: o.enabled ?? [] });
}
