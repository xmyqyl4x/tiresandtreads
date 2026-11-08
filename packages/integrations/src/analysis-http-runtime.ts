import { createReportAnalysisServices } from '../../application/src/analysis/report-analysis.ts';
import { withFreshAnalysisScopes } from '../../application/src/analysis/analysis-lifecycle.ts';
import type { AnalysisErasureRepository } from '../../application/src/ports/analysis-lifecycle.ts';
import { createAnalysisExecutionSupport } from '../../db/src/repositories/analysis-execution.ts';
import type { createTransactions } from '../../db/src/transactions.ts';
import { ok } from '../../domain/src/values/core.ts';
// Explicit local composition only. No credentials, provider/model choice or default host activation.
export async function createLocalReportAnalysisRuntime(
  o: Readonly<{
    mode: 'local-opt-in';
    scope: ReturnType<typeof createTransactions>;
    dependencies: Parameters<typeof createReportAnalysisServices>[0];
    rights: AnalysisErasureRepository;
  }>,
) {
  if (o.mode !== 'local-opt-in' || o.dependencies.uow !== o.scope.unitOfWork)
    throw Error('Bound local analysis composition required');
  const role = await o.scope.unitOfWork.run(async (tx) =>
    ok((await o.scope.query(tx, 'SELECT current_user AS role')).rows[0]?.role),
  );
  if (!role.ok || role.value !== 'tt_p2_analysis_service')
    throw Error('Invalid local analysis role');
  return createReportAnalysisServices({
    ...o.dependencies,
    ...createAnalysisExecutionSupport(o.scope),
    scopes: withFreshAnalysisScopes(o.dependencies.scopes, o.rights, () =>
      o.dependencies.crypto.id('ai_scope'),
    ),
  });
}
