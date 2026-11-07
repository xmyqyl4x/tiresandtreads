import { randomBytes } from 'node:crypto';
import type { analysisServiceFixture } from './report-analysis.ts';
import { uuid, value } from './compose-partner-services.ts';
import { ok, type Id } from '../../../packages/domain/src/values/core.ts';
import { createReportAnalysisServices } from '../../../packages/application/src/analysis/report-analysis.ts';
import { createReportAnalysisRepository } from '../../../packages/db/src/repositories/report-analysis.ts';
import { createAIScopeRepository } from '../../../packages/db/src/repositories/analysis-scope.ts';
import { createAIRequestRepository } from '../../../packages/db/src/repositories/analysis-requests.ts';
import { createAIArtifactRepository } from '../../../packages/db/src/repositories/analysis-artifacts.ts';
import { createAIReuseRepository } from '../../../packages/db/src/repositories/analysis-reuse.ts';
import { createAIBudgetRepository } from '../../../packages/db/src/repositories/analysis-budgets.ts';
import { createAIAttachmentRepository } from '../../../packages/db/src/repositories/analysis-attachments.ts';
import { createJobRepository } from '../../../packages/db/src/repositories/jobs.ts';
import { createReportCrypto } from '../../../packages/integrations/src/report-crypto.ts';
import { createStructuredAnalysisProvider } from '../../../packages/integrations/src/analysis-provider.ts';
import type { StructuredAnalysisTransport } from '../../../packages/application/src/ports/report-analysis.ts';
export async function composeReportAnalysis(f: Awaited<ReturnType<typeof analysisServiceFixture>>) {
  const adapter = f.analysisServiceAdapter(),
    crypto = createReportCrypto(
      'synthetic-v1',
      { 'synthetic-v1': randomBytes(32) },
      randomBytes(32),
    ),
    calls: Parameters<StructuredAnalysisTransport['send']>[0][] = [];
  const defaultBehavior: StructuredAnalysisTransport['send'] = async (input) => ({
    state: 'complete',
    output: {
      schema: 1,
      summary: 'report_facts',
      claims: input.packet.claims.map((c) => ({ id: c.id, citations: c.citations })),
      limitations: ['source_limits'],
      questions: ['verify_fitment'],
    },
    providerRequestId: 'synthetic-only',
    inputTokens: 10n,
    outputTokens: 10n,
    costMinor: 5n,
  });
  let behavior = defaultBehavior;
  const repository = createReportAnalysisRepository(adapter);
  const d = {
    uow: adapter.unitOfWork,
    repository,
    scopes: createAIScopeRepository(adapter),
    requests: createAIRequestRepository(adapter),
    artifacts: createAIArtifactRepository(adapter),
    reuse: createAIReuseRepository(adapter),
    budgets: createAIBudgetRepository(adapter),
    attachments: createAIAttachmentRepository(adapter),
    jobs: createJobRepository(adapter),
    crypto,
    now: () => new Date().toISOString(),
    noticeVersion: 'ai-processing-v1',
    provider: createStructuredAnalysisProvider({
      async send(input) {
        calls.push(input);
        return behavior(input);
      },
    }),
    admission: {
      async plan(_tx: unknown, policy: { id: Id<'ai_policy'> }) {
        const rows = (
          await f.admin.query(
            'SELECT b.id,p.configuration_hash FROM app.ai_budget_windows b JOIN app.ai_policy_versions p ON p.id=b.policy_version_id WHERE b.policy_version_id=$1 ORDER BY b.id',
            [policy.id],
          )
        ).rows;
        return rows.length
          ? {
              configurationHash: String(rows[0]!.configuration_hash),
              currency: 'USD' as const,
              windows: rows.map((r) => ({ id: r.id as Id<'ai_budget'>, amountMinor: 100n })),
            }
          : null;
      },
    },
  };
  const service = createReportAnalysisServices(d);
  await f.admin.query(
    "INSERT INTO app.market_dataset_heads(market,bundle_id) VALUES('US',$1) ON CONFLICT(market) DO UPDATE SET bundle_id=EXCLUDED.bundle_id,revision=app.market_dataset_heads.revision+1",
    [f.bundleId],
  );
  const sourceRows = (
    await f.admin.query(
      'SELECT DISTINCT dataset_version_id FROM app.bundle_members WHERE bundle_id=$1 ORDER BY dataset_version_id',
      [f.bundleId],
    )
  ).rows;
  const sourceIds = sourceRows.map((r) => r.dataset_version_id as string);
  if (sourceIds.length === 0) throw Error('Owned fixture sources required');
  await f.admin.query(
    'UPDATE app.data_licenses SET rights=rights || \'{"ai_processing":true,"derived":true,"cache":true,"snapshot":true,"display":true,"api":true}\'::jsonb WHERE id IN(SELECT license_id FROM app.dataset_versions WHERE id=ANY($1::uuid[]))',
    [sourceIds],
  );
  await f.admin.query(
    "UPDATE app.data_providers SET status='active' WHERE id IN(SELECT provider_id FROM app.dataset_versions WHERE id=ANY($1::uuid[]))",
    [sourceIds],
  );
  async function example(budgetLimit = 100000n) {
    const owner = await f.owner(),
      policy = uuid('ai_policy'),
      budget = uuid('ai_budget'),
      hash = randomBytes(32).toString('hex');
    await f.admin.query(
      "INSERT INTO app.ai_policy_versions(id,task,provider,model_id,prompt_version,schema_version,validator_version,canonical_version,configuration_hash,status,reviewed_by,reviewed_at) VALUES($1,'report_analysis','synthetic','no-provider-call','local-grounded-v1','grounded-selection-v1','grounded-validator-v1','local-jsonb-v1',$2,'active',$3,clock_timestamp())",
      [policy, hash, f.staff],
    );
    await f.admin.query(
      "INSERT INTO app.ai_budget_windows(id,policy_key,policy_version_id,window_start,window_end,currency_code,limit_minor) VALUES($1,$1::uuid::text,$2,statement_timestamp()-interval '1 minute',statement_timestamp()+interval '1 day','USD',$3)",
      [budget, policy, budgetLimit.toString()],
    );
    const head = value(
      await f.scope.unitOfWork.run(async (tx) =>
        ok(
          await f.reports.create(tx, owner.identity, {
            id: uuid('report'),
            market: 'US',
            locale: 'en-US',
            expiresAt: new Date(
              Date.now() + 86400000,
            ).toISOString() as import('../../../packages/domain/src/values/core.ts').Instant,
          }),
        ),
      ),
    );
    const until = new Date(Date.now() + 3600000).toISOString(),
      decision = {
        id: 'synthetic-pick',
        status: 'eligible',
        reasons: ['PREFERENCE_SCORE'],
        sourceIds,
        scoreBp: 8123,
        budget: 'unknown',
      };
    const version = {
      reportId: head.id,
      version: 1,
      baseVersion: null,
      bundleId: f.bundleId,
      ruleVersionId: f.ruleId,
      engineVersion: 'synthetic-v1',
      schemaVersion: 1 as const,
      input: {
        market: 'US',
        strategy: 'year_round',
        winterUse: 'none',
        priorities: ['wet'],
        sizes: null,
        regionKey: 'PRIVATE_ZIP',
        contactNote: 'omit-this-note',
      },
      output: {
        result: { picks: ['synthetic-pick'], decisions: [decision] },
        evidence: { sources: sourceIds.map((id) => ({ datasetId: id, validUntil: until })) },
      },
    };
    value(
      await f.scope.unitOfWork.run(async (tx) =>
        ok(
          await f.reports.publish(tx, owner.identity, head.revision, version, [
            { key: 'synthetic-pick', skuId: null, kind: 'picked', rank: 1, snapshot: decision },
          ]),
        ),
      ),
    );
    const input = {
      reportId: head.id,
      version: 1,
      policyId: policy,
      key: 'synthetic-' + uuid('command'),
      allowed: true,
      noticeVersion: d.noticeVersion,
    };
    return { owner, policy, budget, input, report: head.id, version, keys: [owner.token] };
  }
  return {
    adapter,
    d,
    service,
    repository,
    calls,
    example,
    sourceIds,
    resetBehavior() {
      behavior = defaultBehavior;
    },
    defaultBehavior,
    setBehavior(fn: StructuredAnalysisTransport['send']) {
      behavior = fn;
    },
  };
}
