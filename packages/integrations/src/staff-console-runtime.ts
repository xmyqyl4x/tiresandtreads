import type { createTransactions } from '../../db/src/transactions.ts';
import { ok, fail, type Id } from '../../domain/src/values/core.ts';
import { ServiceFault, serviceFailure } from '../../application/src/services/service-work.ts';
import { createStaffConsoleQueries } from '../../application/src/queries/staff-console.ts';
import {
  createReportTriageRepository,
  createSourceHealthRepository,
  createSeoFindingsRepository,
} from '../../db/src/repositories/staff-console.ts';
import { createStaffRepository } from '../../db/src/repositories/staff-services.ts';
import { createCatalogRepository } from '../../db/src/repositories/catalog.ts';
import { createOperationsRepository } from '../../db/src/repositories/operations.ts';
import { createCommercialRepository } from '../../db/src/repositories/commercial-services.ts';
type Scope = ReturnType<typeof createTransactions>;
export function createStaffConsoleRuntime(
  scopes: Readonly<{
    report: Scope;
    content: Scope;
    ingest: Scope;
    catalog: Scope;
    operations: Scope;
    commercial: Scope;
    staff: Scope;
  }>,
  now: () => string,
) {
  const reports = createReportTriageRepository(scopes.report),
    sources = createSourceHealthRepository(scopes.ingest),
    findings = createSeoFindingsRepository(scopes.content),
    catalog = createCatalogRepository(scopes.catalog.query),
    ops = createOperationsRepository(scopes.operations),
    commercial = createCommercialRepository(scopes.commercial),
    staff = createStaffRepository(scopes.staff);
  async function read<T>(scope: Scope, work: (tx: Parameters<Scope['query']>[0]) => Promise<T>) {
    const r = await scope.unitOfWork.run(async (tx) => ok(await work(tx)));
    if (!r.ok) throw new ServiceFault(r.error.code);
    return r.value;
  }
  return {
    ...createStaffConsoleQueries({
      now,
      authority: {
        require: async (actor, permission) => {
          await read(scopes.staff, (tx) => staff.authorize(tx, actor, permission));
        },
      },
      reads: {
        findings: (page) => read(scopes.content, (tx) => findings.page(tx, page)),
        reports: (page) => read(scopes.report, (tx) => reports.page(tx, page)),
        sources: (page) => read(scopes.ingest, (tx) => sources.page(tx, page)),
        bundle: () => read(scopes.catalog, (tx) => catalog.pin(tx, 'US', null)),
        strategy: (page) => read(scopes.operations, (tx) => ops.pages(tx, page)),
        configuration: () =>
          read(scopes.commercial, async (tx) => {
            const c = await commercial.policy(tx);
            return c
              ? { version: c.version, policy: c.policy, networkReady: c.networkReady }
              : null;
          }),
      },
    }),
    async session(actor: Id<'staff'>) {
      try {
        const active = await read(scopes.operations, (tx) => ops.staff(tx, actor));
        if (!active?.active) throw new ServiceFault('forbidden');
        return ok({ active: true as const });
      } catch (error) {
        return fail(serviceFailure(error));
      }
    },
  };
}
