import type {
  ReportAnalysisRepository,
  AnalysisConfiguration,
  AnalysisWork,
  AnalysisReportEvidence,
} from '../../../application/src/ports/report-analysis.ts';
import type { AnalysisPacket } from '../../../domain/src/analysis-policy.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { createAIScopeRepository } from './analysis-scope.ts';
import { keyJson, jsonObject } from './private-values.ts';
import { uid, word, hash, num, object, big, revisionValue, type Row } from './analysis-values.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
function configuration(r: Row): AnalysisConfiguration {
  return Object.freeze({
    policyId: uid('ai_policy', r.policy_version_id ?? r.id),
    provider: word(r.provider, 100),
    model: word(r.model_id),
    prompt: word(r.prompt_version, 100),
    schema: word(r.schema_version, 100),
    validator: word(r.validator_version, 100),
    canonical: word(r.canonical_version, 100),
    configurationHash: hash(r.configuration_hash),
  });
}
export function createReportAnalysisRepository(s: WriteScope): ReportAnalysisRepository {
  const q = s.query,
    scopes = createAIScopeRepository(s);
  async function work(tx: Tx, request: unknown): Promise<AnalysisWork | null> {
    const r = (
      await q(
        tx,
        `SELECT w.*,r.input_manifest,p.id AS policy_version_id,p.provider,p.model_id,p.prompt_version,p.schema_version,p.validator_version,p.canonical_version,p.configuration_hash FROM app.ai_report_work w JOIN app.ai_analysis_requests r ON r.id=w.request_id JOIN app.ai_policy_versions p ON p.id=r.policy_version_id WHERE w.request_id=$1`,
        [uid('ai_request', request)],
      )
    ).rows[0];
    if (!r || r.job_id === null) return null;
    const manifest = object(r.input_manifest);
    return Object.freeze({
      requestId: uid('ai_request', r.request_id),
      reportId: uid('report', r.report_id),
      version: num(r.report_version, 1),
      ownerId: uid('subject', r.owner_subject_id),
      jobId: uid('job', r.job_id),
      packet: object(manifest.parameters, 32768) as unknown as AnalysisPacket,
      expectedAttachment: big(r.expected_attachment),
      configuration: configuration(r),
    });
  }
  return guarded<ReportAnalysisRepository>(s, {
    async owner(tx, keys) {
      const r = (await q(tx, 'SELECT * FROM app.ai_service_owner($1::jsonb)', [keyJson(keys)]))
        .rows[0];
      return r
        ? Object.freeze({
            subjectId: uid('subject', r.subject_id),
            sessionId: uid('owner_session', r.session_id),
          })
        : null;
    },
    async subjectRevision(tx, owner) {
      return revisionValue(
        (
          await q(tx, 'SELECT app.ai_repository_subject($1,true)::text AS revision', [
            uid('subject', owner),
          ])
        ).rows[0]!.revision,
      );
    },
    async evidence(tx, owner, report, version) {
      const raw = (
        await q(tx, 'SELECT app.ai_service_evidence($1,$2,$3) AS evidence', [
          uid('subject', owner),
          uid('report', report),
          num(version, 1),
        ])
      ).rows[0]?.evidence;
      if (raw === null || raw === undefined) return null;
      const e = object(raw, 262144);
      if (!Array.isArray(e.sources) || e.sources.length < 1 || e.sources.length > 16)
        return stop('integrity');
      return Object.freeze({
        market: word(e.market, 3),
        locale: word(e.locale, 20),
        snapshotHash: hash(e.snapshotHash),
        bundleId: uid('bundle', e.bundleId),
        ruleVersion: uid('rule', e.ruleVersion),
        engineVersion: word(e.engineVersion),
        input: object(e.input),
        output: object(e.output),
        sources: Object.freeze(
          e.sources.map((raw) => {
            const v = object(raw);
            const validUntil = new Date(String(v.validUntil));
            if (!Number.isFinite(validUntil.getTime())) return stop('integrity');
            return Object.freeze({
              id: uid('dataset', v.id),
              validUntil: validUntil.toISOString(),
            });
          }),
        ),
        subjectRevision: revisionValue(e.subjectRevision),
        attachmentRevision: big(e.attachmentRevision),
      }) satisfies AnalysisReportEvidence;
    },
    async configuration(tx, id) {
      const r = (
        await q(tx, 'SELECT * FROM app.ai_policy_versions WHERE id=$1', [uid('ai_policy', id)])
      ).rows[0];
      return r ? configuration(r) : null;
    },
    async scope(tx, owner, policy, key) {
      const person = uid('subject', owner),
        policyId = uid('ai_policy', policy),
        scopeKey = hash(key);
      await q(tx, 'SELECT app.ai_repository_subject($1,true)', [person]);
      const r = (
        await q(
          tx,
          'SELECT id FROM app.ai_reuse_scopes WHERE owner_subject_id=$1 AND policy_version_id=$2 AND scope_key=$3',
          [person, policyId, scopeKey],
        )
      ).rows[0];
      return r ? scopes.scope(tx, uid('ai_scope', r.id)) : null;
    },
    async enqueue(tx, input) {
      const request = uid('ai_request', input.requestId),
        person = uid('subject', input.ownerId),
        report = uid('report', input.reportId),
        version = num(input.version, 1),
        expected = big(input.expectedAttachment);
      const prior = await work(tx, request);
      if (prior) {
        if (
          prior.ownerId !== person ||
          prior.reportId !== report ||
          prior.version !== version ||
          jsonObject(prior.packet, 32768) !== jsonObject(input.packet, 32768)
        )
          return stop('conflict');
        return prior;
      }
      await q(
        tx,
        'INSERT INTO app.ai_report_work(request_id,owner_subject_id,report_id,report_version,expected_attachment) VALUES($1,$2,$3,$4,$5)',
        [request, person, report, version, expected.toString()],
      );
      await q(
        tx,
        `INSERT INTO app.job_runs(job_type,business_key,schema_version,resource_id,deadline_at) SELECT 'ai.report-analysis',$2,1,id,expires_at FROM app.ai_analysis_requests WHERE id=$1 ON CONFLICT(job_type,business_key) DO NOTHING`,
        [request, 'analysis:' + request],
      );
      const row = (
        await q(
          tx,
          "SELECT id,resource_id,schema_version FROM app.job_runs WHERE job_type='ai.report-analysis' AND business_key=$1",
          ['analysis:' + request],
        )
      ).rows[0];
      if (!row || row.resource_id !== request || row.schema_version !== 1) return stop('integrity');
      const job = uid('job', row.id);
      await q(tx, 'UPDATE app.ai_report_work SET job_id=$2 WHERE request_id=$1', [request, job]);
      return (await work(tx, request)) ?? stop('integrity');
    },
    work,
    async current(tx, input) {
      return (
        (
          await q(tx, 'SELECT app.ai_service_current($1) AS current', [
            uid('ai_request', input.requestId),
          ])
        ).rows[0]?.current === true
      );
    },
    async output(tx, input) {
      await q(tx, "SELECT set_config('tt.p2_ai_subject',$1,true)", [uid('subject', input.ownerId)]);
      const r = (
        await q(
          tx,
          `SELECT a.output FROM app.report_analysis_attachments x JOIN app.ai_artifacts a ON a.id=x.artifact_id WHERE a.request_id=$1 AND x.report_id=$2 AND x.report_version=$3 AND x.owner_subject_id=$4 AND app.ai_attachment_readable(x.report_id,x.report_version,x.revision) ORDER BY x.revision DESC LIMIT 1`,
          [
            uid('ai_request', input.requestId),
            uid('report', input.reportId),
            num(input.version, 1),
            uid('subject', input.ownerId),
          ],
        )
      ).rows[0];
      return r ? object(r.output, 16384) : null;
    },
    async withdraw(tx, scope) {
      await q(tx, 'SELECT app.ai_service_withdraw($1)', [uid('ai_scope', scope)]);
    },
  });
}
