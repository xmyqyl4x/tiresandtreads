import type {
  GenericAnalysisRepository,
  GenericWork,
} from '../../../application/src/ports/generic-analysis.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import type { GenericAnalysisPacket } from '../../../domain/src/analysis-reuse-policy.ts';
import { createAIScopeRepository } from './analysis-scope.ts';
import { createReportAnalysisRepository } from './report-analysis.ts';
import { canonicalManifest } from './analysis-input.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { uid, hash, word, object, at, num } from './analysis-values.ts';
import { jsonObject } from './private-values.ts';
export function createGenericAnalysisRepository(s: WriteScope): GenericAnalysisRepository {
  const q = s.query,
    scopes = createAIScopeRepository(s),
    configs = createReportAnalysisRepository(s);
  async function work(tx: Tx, request: unknown): Promise<GenericWork | null> {
    const r = (
      await q(
        tx,
        'SELECT w.*,r.scope_id,r.policy_version_id FROM app.ai_generic_work w JOIN app.ai_analysis_requests r ON r.id=w.request_id WHERE w.request_id=$1',
        [uid('ai_request', request)],
      )
    ).rows[0];
    if (!r || r.job_id === null) return null;
    const configuration = await configs.configuration(tx, uid('ai_policy', r.policy_version_id));
    if (!configuration) return stop('integrity');
    return Object.freeze({
      requestId: uid('ai_request', r.request_id),
      scopeId: uid('ai_scope', r.scope_id),
      definitionId: uid('ai_definition', r.definition_id),
      jobId: uid('job', r.job_id),
      packet: object(r.packet, 8192) as unknown as GenericAnalysisPacket,
      configuration,
    });
  }
  return guarded<GenericAnalysisRepository>(s, {
    async definition(tx, id) {
      const raw = (
        await q(tx, 'SELECT app.ai_generic_source($1) AS source', [uid('ai_definition', id)])
      ).rows[0]?.source;
      if (raw === null || raw === undefined) return null;
      const r = object(raw, 8192);
      return Object.freeze({
        id: uid('ai_definition', r.definition),
        policyId: uid('ai_policy', r.policyId),
        fact: Object.freeze({
          id: uid('advice_fact', r.adviceId),
          text: word(r.text, 2000),
          source: uid('dataset', r.source),
          validUntil: at(new Date(String(r.validUntil))),
        }),
      });
    },
    async scope(tx, d, key) {
      await q(
        tx,
        "SELECT pg_advisory_xact_lock(hashtextextended('ai.generic.definition:'||$1,0))",
        [d.id],
      );
      const r = (
        await q(
          tx,
          "SELECT id FROM app.ai_reuse_scopes WHERE scope_key=$1 AND policy_version_id=$2 AND kind='shared'",
          [hash(key), d.policyId],
        )
      ).rows[0];
      return r ? scopes.scope(tx, uid('ai_scope', r.id)) : null;
    },
    async digest(tx, scope, policy, d, parameters) {
      return hash(
        (
          await q(tx, 'SELECT app.ai_input_digest($1,$2,$3,$4::jsonb) AS digest', [
            scope.id,
            policy.id,
            policy.canonicalVersion,
            canonicalManifest(
              { parameters, rule_version: d.id, advice_revision: d.fact.id },
              policy,
              scope,
            ),
          ])
        ).rows[0]!.digest,
      );
    },
    async lookup(tx, scope, digest, definition, pendingOnly = false, maxAgeSeconds = 604800) {
      if (scope.kind !== 'shared') return stop('forbidden');
      if (!pendingOnly) {
        const r = (
          await q(
            tx,
            `SELECT a.request_id,a.output FROM app.ai_reuse_entries e JOIN app.ai_artifacts a ON a.id=e.artifact_id JOIN app.ai_generic_work w ON w.request_id=a.request_id WHERE e.scope_id=$1 AND e.cache_key=$2 AND e.state IN('ready','leased') AND w.definition_id=$3 AND app.ai_artifact_current(a.id) AND a.generated_at+make_interval(secs=>$4)>clock_timestamp() AND app.ai_generic_current(a.request_id)`,
            [scope.id, hash(digest), definition, num(maxAgeSeconds, 10, 604800)],
          )
        ).rows[0];
        if (r)
          return Object.freeze({
            requestId: uid('ai_request', r.request_id),
            output: object(r.output, 8192),
            pending: false,
          });
      }
      const r = (
        await q(
          tx,
          "SELECT r.id FROM app.ai_analysis_requests r JOIN app.ai_generic_work w ON w.request_id=r.id WHERE r.scope_id=$1 AND r.input_digest=$2 AND w.definition_id=$3 AND r.state IN('queued','running') AND r.expires_at>clock_timestamp() AND app.ai_generic_current(r.id) ORDER BY r.created_at DESC LIMIT 1",
          [scope.id, hash(digest), definition],
        )
      ).rows[0];
      return r
        ? Object.freeze({ requestId: uid('ai_request', r.id), output: null, pending: true })
        : null;
    },
    async enqueue(tx, request, d, packet) {
      const prior = await work(tx, request.id);
      if (prior) {
        if (
          prior.definitionId !== d.id ||
          jsonObject(prior.packet, 8192) !== jsonObject(packet, 8192)
        )
          return stop('conflict');
        return prior;
      }
      await q(
        tx,
        'INSERT INTO app.ai_generic_work(request_id,definition_id,packet) VALUES($1,$2,$3::jsonb)',
        [request.id, d.id, jsonObject(packet, 8192)],
      );
      await q(
        tx,
        "INSERT INTO app.job_runs(job_type,business_key,schema_version,resource_id,deadline_at) SELECT 'ai.generic-analysis',$2,1,id,expires_at FROM app.ai_analysis_requests WHERE id=$1 ON CONFLICT(job_type,business_key) DO NOTHING",
        [request.id, 'generic:' + request.id],
      );
      const job = (
        await q(
          tx,
          "SELECT id,resource_id FROM app.job_runs WHERE job_type='ai.generic-analysis' AND business_key=$1",
          ['generic:' + request.id],
        )
      ).rows[0];
      if (!job || job.resource_id !== request.id) return stop('integrity');
      await q(tx, 'UPDATE app.ai_generic_work SET job_id=$2 WHERE request_id=$1', [
        request.id,
        job.id,
      ]);
      return (await work(tx, request.id)) ?? stop('integrity');
    },
    work,
    async current(tx, w) {
      return (
        (await q(tx, 'SELECT app.ai_generic_current($1) AS current', [w.requestId])).rows[0]
          ?.current === true
      );
    },
    async touch(tx, scope, digest) {
      if (scope.kind !== 'shared') return stop('forbidden');
      await q(
        tx,
        "INSERT INTO app.ai_shared_demand(scope_id,digest,hour) VALUES($1,$2,date_trunc('hour',transaction_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') ON CONFLICT(scope_id,digest,hour) DO UPDATE SET hits=least(1000000,app.ai_shared_demand.hits+1)",
        [scope.id, hash(digest)],
      );
    },
    async refresh(tx) {
      const hour =
        "date_trunc('hour',transaction_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'";
      await q(
        tx,
        `INSERT INTO app.ai_refresh_batches(hour) VALUES(${hour}) ON CONFLICT DO NOTHING`,
      );
      const budget = (
        await q(
          tx,
          `SELECT hour,scheduled FROM app.ai_refresh_batches WHERE hour=${hour} FOR UPDATE`,
        )
      ).rows[0]!;
      const remaining = 25 - num(budget.scheduled);
      if (remaining === 0) return [];
      const rows = (
        await q(
          tx,
          `SELECT e.scope_id,e.cache_key,w.definition_id,w.packet->'parameters' AS parameters,g.permission_revision::text,g.invalidation_revision::text FROM app.ai_reuse_entries e JOIN app.ai_artifacts a ON a.id=e.artifact_id JOIN app.ai_generic_work w ON w.request_id=a.request_id JOIN app.ai_reuse_scopes scope ON scope.id=e.scope_id JOIN app.ai_scope_guards g ON g.scope_id=e.scope_id WHERE scope.kind='shared' AND e.state='ready' AND app.ai_artifact_current(a.id) AND app.ai_generic_source(w.definition_id) IS NOT NULL AND a.generated_at+(a.valid_until-a.generated_at)*0.8<=clock_timestamp() AND a.valid_until>clock_timestamp() AND (SELECT coalesce(sum(hits),0) FROM app.ai_shared_demand d WHERE d.scope_id=e.scope_id AND d.digest=e.cache_key AND d.hour>=transaction_timestamp()-interval '24 hours')>=3 AND NOT EXISTS(SELECT 1 FROM app.ai_shared_demand d WHERE d.scope_id=e.scope_id AND d.digest=e.cache_key AND d.refresh_hour=$1) ORDER BY e.scope_id,e.cache_key LIMIT $2`,
          [budget.hour, remaining],
        )
      ).rows;
      for (const r of rows)
        await q(
          tx,
          "UPDATE app.ai_shared_demand SET refresh_hour=$3 WHERE scope_id=$1 AND digest=$2 AND hour>=transaction_timestamp()-interval '24 hours'",
          [r.scope_id, r.cache_key, budget.hour],
        );
      await q(tx, 'UPDATE app.ai_refresh_batches SET scheduled=scheduled+$2 WHERE hour=$1', [
        budget.hour,
        rows.length,
      ]);
      return Object.freeze(
        rows.map((r) =>
          Object.freeze({
            definitionId: uid('ai_definition', r.definition_id),
            parameters: object(r.parameters, 2048) as Readonly<Record<string, string | null>>,
            key:
              'refresh-' +
              r.scope_id +
              '-' +
              r.cache_key +
              '-' +
              Date.parse(at(budget.hour)) +
              '-' +
              r.permission_revision +
              '-' +
              r.invalidation_revision,
          }),
        ),
      );
    },
    async maintain(tx) {
      await q(
        tx,
        "WITH old AS(SELECT scope_id,digest,hour FROM app.ai_shared_demand WHERE hour<transaction_timestamp()-interval '24 hours' ORDER BY hour,scope_id,digest LIMIT 100) DELETE FROM app.ai_shared_demand d USING old WHERE (d.scope_id,d.digest,d.hour)=(old.scope_id,old.digest,old.hour)",
      );
      await q(
        tx,
        "WITH old AS(SELECT hour FROM app.ai_refresh_batches WHERE hour<transaction_timestamp()-interval '48 hours' ORDER BY hour LIMIT 25) DELETE FROM app.ai_refresh_batches b USING old WHERE b.hour=old.hour",
      );
      await q(tx, 'SELECT app.ai_expire_shared_cold()');
    },
  });
}
