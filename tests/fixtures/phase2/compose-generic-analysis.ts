import { randomBytes, createHash } from 'node:crypto';
import type { executionFixture } from './analysis-execution.ts';
import type { composeReportAnalysis } from './compose-report-analysis.ts';
import { uuid } from './compose-partner-services.ts';
import { createGenericAnalysisRepository } from '../../../packages/db/src/repositories/generic-analysis.ts';
import { createAnalysisExecutionSupport } from '../../../packages/db/src/repositories/analysis-execution.ts';
import { createGenericAnalysisServices } from '../../../packages/application/src/analysis/generic-analysis.ts';
import { createStructuredGenericProvider } from '../../../packages/integrations/src/generic-analysis-provider.ts';
import type { GenericAnalysisTransport } from '../../../packages/application/src/ports/generic-analysis.ts';
export async function composeGenericAnalysis(
  f: Awaited<ReturnType<typeof executionFixture>>,
  s: Awaited<ReturnType<typeof composeReportAnalysis>>,
) {
  const repository = createGenericAnalysisRepository(s.adapter),
    support = createAnalysisExecutionSupport(s.adapter),
    calls: Parameters<GenericAnalysisTransport['send']>[0][] = [],
    providerId = uuid('provider'),
    license = uuid('license'),
    dataset = uuid('dataset'),
    claim = 'Ask the installer to verify tire size and fitment.',
    claimHash = createHash('sha256').update(claim).digest('hex'),
    facts: Array<ReturnType<typeof uuid<'advice_fact'>>> = [];
  await f.admin.query(
    "INSERT INTO app.data_providers(id,code,name,status) VALUES($1,$2,'Owned generic advice fixture','active')",
    [providerId, 'generic-fixture-' + providerId],
  );
  await f.admin.query(
    `INSERT INTO app.data_licenses(id,provider_id,market,rights,effective_at,reviewed_at,expires_at) VALUES($1,$2,'US','{"display":true,"api":true,"ai_processing":true,"cache":true,"snapshot":true,"derived":true}',clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '7 days')`,
    [license, providerId],
  );
  await f.admin.query(
    "INSERT INTO app.dataset_versions(id,provider_id,license_id,kind,external_version,checksum,status,effective_at,fetched_at,row_count) VALUES($1,$2,$3,'generic_advice','fixture',repeat('f',64),'staging',clock_timestamp(),clock_timestamp(),100)",
    [dataset, providerId, license],
  );
  for (let n = 0; n < 100; n++) {
    const fact = uuid('advice_fact');
    facts.push(fact);
    await f.admin.query(
      "INSERT INTO app.advice_facts(id,topic_key,market,locale,claim,applicability,reviewed_by,reviewed_at,review_due_at,status,dataset_version_id,source_record_key) VALUES($1,$1::uuid::text,'US','en-US',$2,'{}',$3,clock_timestamp(),clock_timestamp()+interval '1 day','reviewed',$4,$1::uuid::text)",
      [fact, claim, f.staff, dataset],
    );
  }
  await f.admin.query(
    "UPDATE app.dataset_versions SET status='published',published_at=clock_timestamp() WHERE id=$1",
    [dataset],
  );
  const defaultBehavior: GenericAnalysisTransport['send'] = async (input) => ({
    state: 'complete',
    output: { schema: 1, factIds: [input.packet.fact.id], questions: ['verify_fitment'] },
    providerRequestId: 'synthetic-generic-only',
    inputTokens: 10n,
    outputTokens: 10n,
    costMinor: 5n,
  });
  let behavior = defaultBehavior,
    next = 0;
  const provider = createStructuredGenericProvider({
    async send(input) {
      calls.push(input);
      return behavior(input);
    },
  });
  const deps = { ...s.d, ...support, repository, provider };
  const service = createGenericAnalysisServices(deps);
  async function example(fact = facts[next++]!) {
    if (!fact) throw Error('Bounded fixture facts exhausted');
    const policy = uuid('ai_policy'),
      definition = uuid('ai_definition'),
      configuration = randomBytes(32).toString('hex');
    await f.admin.query(
      `INSERT INTO app.ai_policy_versions(id,task,provider,model_id,prompt_version,schema_version,validator_version,canonical_version,configuration_hash,status,shared_allowed,shared_parameter_allowlist,template_key,reviewed_by,reviewed_at) VALUES($1,'generic_explanation','synthetic','no-provider-call','generic-local-v1','generic-selection-v1','generic-validator-v1','generic-c14n-v1',$2,'active',true,'["market","usage"]','generic-install-v1',$3,clock_timestamp())`,
      [policy, configuration, f.staff],
    );
    await f.admin.query(
      "INSERT INTO app.ai_cost_plans(policy_id,configuration_hash,input_ceiling,output_ceiling,input_per_million_minor,output_per_million_minor,daily_limit,hourly_limit,owner_daily_limit,max_concurrency,status,reviewed_by) VALUES($1,$2,65536,512,100,100,100000,10000,1000,2,'active',$3)",
      [policy, configuration, f.staff],
    );
    await f.admin.query(
      "INSERT INTO app.ai_generic_definitions(id,policy_id,advice_id,claim_hash,renderer_version,status,reviewed_by) VALUES($1,$2,$3,$4,'generic-render-v1','reviewed',$5)",
      [definition, policy, fact, claimHash, f.staff],
    );
    return {
      definition,
      policy,
      fact,
      input: {
        definitionId: definition,
        allowed: true,
        parameters: { market: 'US', usage: 'commute' },
      },
    };
  }
  return {
    service,
    deps,
    repository,
    support,
    calls,
    example,
    dataset,
    providerId,
    license,
    claim,
    defaultBehavior,
    reset() {
      behavior = defaultBehavior;
    },
    setBehavior(fn: GenericAnalysisTransport['send']) {
      behavior = fn;
    },
  };
}
