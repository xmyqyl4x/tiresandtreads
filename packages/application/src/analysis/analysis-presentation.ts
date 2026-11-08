import { id, instant, ok, fail, type Result } from '../../../domain/src/values/core.ts';
import { analysisSchema, analysisValidator } from '../../../domain/src/analysis-policy.ts';
import type { ReportAnalysisRepository } from '../ports/report-analysis.ts';
import type { AIScopeRepository } from '../ports/analysis-repositories.ts';
import type { AnalysisPresentationRepository } from '../ports/analysis-presentation.ts';
import type { KeyDigest } from '../ports/private-records.ts';
import type { UnitOfWork, ApplicationFailure } from '../ports/transactions.ts';
import { exact } from '../services/service-records.ts';
import { demand, serviceFailure, serviceWork } from '../services/service-work.ts';
export const assistanceNotice =
  'Optional AI assistance uses the recorded report facts and permitted source references to prepare an explanation and installer questions. It does not inspect tires or establish fitment, condition or recall clearance. You can continue without it and withdraw processing permission. Completion never sends email automatically.';
export function createAnalysisPresentationService(d: {
  uow: UnitOfWork;
  access: (
    keys: readonly KeyDigest[],
    report: string,
    version: number,
  ) => Promise<Result<unknown, ApplicationFailure>>;
  repository: Pick<ReportAnalysisRepository, 'owner' | 'evidence' | 'configuration'>;
  scopes: Pick<AIScopeRepository, 'policy'>;
  presentation: AnalysisPresentationRepository;
  policyId: string | null;
  noticeVersion: string;
  now: () => string;
}) {
  return Object.freeze({
    async read(keys: readonly KeyDigest[], raw: unknown) {
      try {
        const x = exact(raw, 'reportId,version'),
          report = id('report', x.reportId),
          checked = instant(d.now());
        demand(
          report.ok &&
            Number.isSafeInteger(x.version) &&
            Number(x.version) >= 1 &&
            Number(x.version) <= 2147483647,
        );
        demand(checked.ok && /^[A-Za-z0-9_-]{1,100}$/.test(d.noticeVersion), 'internal');
        demand(Array.isArray(keys) && keys.length >= 1 && keys.length <= 4);
        const authorization = Object.freeze(
          keys.map((k) => {
            demand(
              k && /^[A-Za-z0-9_-]{1,100}$/.test(k.keyVersion) && /^[a-f0-9]{64}$/.test(k.digest),
            );
            return Object.freeze({ keyVersion: k.keyVersion, digest: k.digest });
          }),
        );
        demand(new Set(authorization.map((k) => k.keyVersion)).size === authorization.length);
        const version = Number(x.version);
        const readable = await d.access(authorization, report.value, version);
        if (!readable.ok) return readable;
        return await serviceWork(d.uow, async (tx) => {
          const who = await d.repository.owner(tx, authorization);
          demand(who, 'forbidden');
          const evidence = await d.repository.evidence(tx, who.subjectId, report.value, version);
          let policyId: string | null = null;
          if (evidence && d.policyId !== null) {
            const policy = id('ai_policy', d.policyId);
            demand(policy.ok, 'internal');
            const p = await d.scopes.policy(tx, policy.value),
              config = await d.repository.configuration(tx, policy.value);
            if (
              p?.status === 'active' &&
              p.task === 'report_analysis' &&
              config?.schema === analysisSchema &&
              config.validator === analysisValidator
            )
              policyId = policy.value;
          }
          return ok(
            Object.freeze({
              reportId: report.value,
              version,
              checkedAt: checked.value,
              assistance: Object.freeze({
                available: policyId !== null,
                policyId,
                noticeVersion: d.noticeVersion,
                notice: assistanceNotice,
              }),
              latestRequest: await d.presentation.latest(tx, who.subjectId, report.value, version),
              selection: evidence
                ? await d.presentation.selection(tx, who.subjectId, report.value, version)
                : null,
            }),
          );
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
  });
}
