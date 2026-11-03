import { operationQuerySchemas } from '../../../contracts/src/operation-queries.ts';
import { staffInputSchemas } from '../../../contracts/src/staff-inputs.ts';
import type { createLocalServiceHost } from '../service-host.ts';
import type { HttpContext, HttpRoute } from './core.ts';
import type { StaffPermission } from '../../../application/src/ports/commercial.ts';
import type { ImportSnapshot } from '../../../application/src/ports/import-service.ts';
import type { ApplicationFailure } from '../../../application/src/ports/transactions.ts';
import { failure } from '../../../application/src/ports/transactions.ts';
import { id, ok, fail, type Id, type Result } from '../../../domain/src/values/core.ts';
type Services = Awaited<ReturnType<typeof createLocalServiceHost>>['services'];
export function staffRoutes(d: {
  readonly services: Services;
  readonly authorize: (
    actor: Id<'staff'>,
    permission: StaffPermission,
  ) => Promise<Result<unknown, ApplicationFailure>>;
  readonly artifact: (id: string) => Promise<ImportSnapshot>;
  readonly commandId: (actor: string, key: string) => string;
}): readonly HttpRoute[] {
  const service = d.services;
  const invalid = () => fail(failure('invalid_input'));
  const route = (
    operationId: string,
    path: string,
    method: HttpRoute['method'],
    handle: HttpRoute['handle'],
    command = false,
  ): HttpRoute => ({
    operationId,
    path: '/api/v1/staff' + path,
    method,
    access: 'staff',
    command,
    handle: (c) => {
      const schema = operationQuerySchemas[operationId as keyof typeof operationQuerySchemas];
      if (
        schema &&
        (!schema.safeParse(Object.fromEntries(c.query)).success ||
          new Set(c.query.keys()).size !== [...c.query].length)
      )
        return Promise.resolve(invalid());
      return handle(c);
    },
  });
  const guarded = async (
    c: HttpContext,
    work: () => Promise<Result<unknown, ApplicationFailure>>,
  ) => {
    const allowed = await d.authorize(c.actor!.staff!, 'data.review');
    return allowed.ok ? work() : allowed;
  };
  return [
    route('staffQueue', '/queues/:kind', 'GET', (c) =>
      service.staff.queue(
        c.actor!.staff!,
        c.params.kind as Parameters<Services['staff']['queue']>[1],
        c.query.get('after'),
        Number(c.query.get('limit') ?? '25'),
      ),
    ),
    route(
      'recoverOperation',
      '/recover',
      'POST',
      async (c) => {
        const value = staffInputSchemas.recoverOperation.safeParse(c.body);
        return value.success
          ? service.staff.recover(
              c.actor!.staff!,
              d.commandId(c.actor!.staff!, c.key),
              value.data.kind,
              value.data.target,
              value.data.evidence,
            )
          : invalid();
      },
      true,
    ),
    route(
      'prepareImport',
      '/imports/prepare',
      'POST',
      (c) =>
        guarded(c, async () => {
          const value = staffInputSchemas.prepareImport.safeParse(c.body);
          if (!value.success) return invalid();
          return service.imports.service.prepare(await d.artifact(value.data.artifactId));
        }),
      true,
    ),
    route('importStatus', '/imports/:runId', 'GET', (c) =>
      guarded(c, async () => {
        const run = id('import_run', c.params.runId);
        return run.ok ? service.imports.service.status(run.value) : invalid();
      }),
    ),
    route('importDiff', '/imports/:runId/diff', 'GET', (c) =>
      guarded(c, async () => {
        const run = id('import_run', c.params.runId),
          against = c.query.has('against') ? id('bundle', c.query.get('against')) : ok(null);
        return run.ok && against.ok
          ? service.imports.service.diff(run.value, against.value)
          : invalid();
      }),
    ),
    route(
      'publishImport',
      '/imports/:runId/publish',
      'POST',
      (c) =>
        guarded(c, async () => {
          const value = staffInputSchemas.publishImport.safeParse(c.body);
          if (!value.success) return invalid();
          try {
            // Keep script/filesystem dependencies outside contract generation.
            const { parseImportPlan } = await import('../import-commands.ts');
            const plan = parseImportPlan(
              { ...value.data, runId: c.params.runId, actorId: c.actor!.staff! },
              false,
            );
            if (!('runId' in plan)) return invalid();
            return service.imports.service.publish(plan);
          } catch {
            return invalid();
          }
        }),
      true,
    ),
    route(
      'rollbackImport',
      '/imports/rollback',
      'POST',
      (c) =>
        guarded(c, async () => {
          const value = staffInputSchemas.rollbackImport.safeParse(c.body);
          if (!value.success) return invalid();
          try {
            // Keep script/filesystem dependencies outside contract generation.
            const { parseImportPlan } = await import('../import-commands.ts');
            const plan = parseImportPlan({ ...value.data, actorId: c.actor!.staff! }, true);
            if (!plan.expectedHead) return invalid();
            return service.imports.service.rollback({ ...plan, expectedHead: plan.expectedHead });
          } catch {
            return invalid();
          }
        }),
      true,
    ),
    route(
      'enqueueContent',
      '/content',
      'POST',
      async (c) => {
        const value = staffInputSchemas.enqueueContent.safeParse(c.body);
        if (!value.success) return invalid();
        const document = id('cms_document', value.data.id);
        return document.ok
          ? service.content.services.enqueue(
              c.actor!.staff!,
              {
                collection: value.data.collection,
                id: document.value,
                revision: value.data.revision,
              },
              value.data.action,
            )
          : invalid();
      },
      true,
    ),
    route(
      'auditSeo',
      '/seo/audit',
      'POST',
      (c) => {
        const value = staffInputSchemas.auditSeo.safeParse(c.body);
        return value.success
          ? service.content.services.audit(
              c.actor!.staff!,
              value.data.locale,
              value.data.market,
              value.data.after,
            )
          : Promise.resolve(invalid());
      },
      true,
    ),
    route('seoMetrics', '/seo/metrics', 'GET', (c) =>
      service.content.services.searchMetrics(
        c.actor!.staff!,
        c.query.get('path') ?? '/',
        c.query.get('locale') ?? 'en-US',
        c.query.get('market') ?? 'US',
        c.query.get('day') ?? '',
      ),
    ),
    route('operationsMetrics', '/operations', 'GET', (c) =>
      service.operations.dashboard(
        c.actor!.staff!,
        c.query.get('day') ?? '',
        (c.query.get('dimension') ?? 'all') as Parameters<Services['operations']['dashboard']>[2],
      ),
    ),
    route('adRevenue', '/advertising/revenue', 'GET', (c) =>
      service.commercial.revenue(
        c.actor!.staff!,
        c.query.get('account') ?? '',
        c.query.get('day') ?? '',
        c.query.get('dimension') ?? 'all',
        c.query.get('currency') ?? 'USD',
      ),
    ),
  ];
}
