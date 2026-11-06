import type { AIArtifactRepository } from '../../../application/src/ports/analysis-repositories.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { lockRequest } from './analysis-requests.ts';
import { createAIReuseRepository } from './analysis-reuse.ts';
import { aiArtifactFromRow } from './analysis-mappers.ts';
import { uid, num, word, hash, at, stored } from './analysis-values.ts';
import { jsonObject } from './private-values.ts';
import { reject } from './bounds.ts';
export function createAIArtifactRepository(s: WriteScope): AIArtifactRepository {
  const reuse = createAIReuseRepository(s);
  return guarded<AIArtifactRepository>(s, {
    async current(tx, id) {
      const r = (
        await s.query(
          tx,
          'SELECT * FROM app.ai_artifacts WHERE id=$1 AND app.ai_artifact_current(id)',
          [uid('ai_artifact', id)],
        )
      ).rows[0];
      return r ? stored(aiArtifactFromRow(r)) : null;
    },
    async publish(tx, input) {
      const id = uid('ai_artifact', input.id),
        request = uid('ai_request', input.requestId),
        attempt = uid('ai_attempt', input.attemptId),
        lease = { ...input.lease },
        output = jsonObject(input.output, 65536),
        valid = num(input.validSeconds, 1, 604800),
        retain = num(input.retainSeconds, 1, 2592000);
      if (valid > retain || !Array.isArray(input.sources) || input.sources.length > 64)
        return reject();
      const sources = input.sources.map((x) => {
        const dataset = x.datasetId === null ? null : uid('dataset', x.datasetId),
          advice = x.adviceId === null ? null : uid('advice_fact', x.adviceId);
        if ((dataset === null) === (advice === null)) return reject();
        return {
          key: word(x.key),
          dataset,
          advice,
          claim: hash(x.claimHash),
          until: at(x.rightsUntil),
        };
      });
      if (new Set(sources.map((x) => x.key)).size !== sources.length) return reject();
      const r = await lockRequest(s, tx, request, true);
      if (r.scope_id !== lease.scopeId || r.input_digest !== lease.digest) return stop('conflict');
      const row =
        (
          await s.query(
            tx,
            `INSERT INTO app.ai_artifacts(id,scope_id,request_id,policy_version_id,attempt_id,input_digest,input_manifest,output,output_hash,validation_version,permission_revision,subject_permission_revision,invalidation_revision,source_count,generated_at,valid_until,retain_until) SELECT $1,r.scope_id,r.id,r.policy_version_id,$2,r.input_digest,r.input_manifest,$3::jsonb,encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex'),p.validator_version,r.permission_revision,r.subject_permission_revision,r.invalidation_revision,$4,clock.at,clock.at+make_interval(secs=>$5),clock.at+make_interval(secs=>$6) FROM app.ai_analysis_requests r JOIN app.ai_policy_versions p ON p.id=r.policy_version_id CROSS JOIN (SELECT clock_timestamp() AS at) clock WHERE r.id=$7 RETURNING *`,
            [id, attempt, output, sources.length, valid, retain, request],
          )
        ).rows[0] ?? stop('not_found');
      for (const x of sources)
        await s.query(
          tx,
          'INSERT INTO app.ai_artifact_sources(artifact_id,source_key,dataset_version_id,advice_fact_id,claim_hash,rights_valid_until) VALUES($1,$2,$3,$4,$5,$6)',
          [id, x.key, x.dataset, x.advice, x.claim, x.until],
        );
      if (!(await reuse.publish(tx, lease, id))) return stop('conflict');
      return stored(aiArtifactFromRow(row));
    },
  });
}
