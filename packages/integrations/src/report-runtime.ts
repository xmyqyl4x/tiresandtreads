import { createOwnerRepository } from '../../db/src/repositories/owners.ts';
import { createReportRepository } from '../../db/src/repositories/reports.ts';
import { createCapabilityRepository } from '../../db/src/repositories/capabilities.ts';
import { createCommandRepository } from '../../db/src/repositories/jobs.ts';
import { createCatalogRepository } from '../../db/src/repositories/catalog.ts';
import {
  createReportPolicyRepository,
  createReportRecallRepository,
  createReportAccessRepository,
} from '../../db/src/repositories/report-services.ts';
import { createReportEvidence } from '../../application/src/services/report-evidence.ts';
import { createReportServices } from '../../application/src/services/reports.ts';
import type {
  ReportCrypto,
  ReportEncryption,
} from '../../application/src/ports/report-services.ts';
import type { createTransactions } from '../../db/src/transactions.ts';
import { ok } from '../../domain/src/values/core.ts';
type Scope = ReturnType<typeof createTransactions>;
// Headless composition over separately owned bounded pools; callers retain responsibility for draining them.
export async function createReportRuntime(deps: {
  readonly privateScope: Scope;
  readonly catalogScope: Scope;
  readonly sourceScope: Scope;
  readonly crypto: ReportCrypto;
  readonly encryption: ReportEncryption;
  readonly now: () => string;
}) {
  for (const [scope, role] of [
    [deps.privateScope, 'tt_private_runtime'],
    [deps.catalogScope, 'tt_catalog_runtime'],
    [deps.sourceScope, 'tt_report_source_runtime'],
  ] as const) {
    const r = await scope.unitOfWork.run(async (tx) =>
      ok((await scope.query(tx, 'SELECT current_user AS role')).rows[0]?.role),
    );
    if (!r.ok || r.value !== role) throw Error('Invalid report runtime role');
  }
  const evidence = createReportEvidence({
    catalog: createCatalogRepository(deps.catalogScope.query),
    policies: createReportPolicyRepository(deps.catalogScope),
    catalogUow: deps.catalogScope.unitOfWork,
    recalls: createReportRecallRepository(deps.sourceScope),
    sourceUow: deps.sourceScope.unitOfWork,
    crypto: deps.crypto,
  });
  return createReportServices({
    uow: deps.privateScope.unitOfWork,
    owners: createOwnerRepository(deps.privateScope),
    reports: createReportRepository(deps.privateScope),
    capabilities: createCapabilityRepository(deps.privateScope),
    access: createReportAccessRepository(deps.privateScope),
    commands: createCommandRepository(deps.privateScope),
    evidence,
    crypto: deps.crypto,
    encryption: deps.encryption,
    now: deps.now,
  });
}
