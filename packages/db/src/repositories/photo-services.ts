import type {
  PhotoServiceRepository,
  PhotoIntent,
  PhotoWork,
} from '../../../application/src/ports/photo-services.ts';
import { createReportAnalysisRepository } from './report-analysis.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { uid, hash, word, num, at, choice, requestStates, type Row } from './analysis-values.ts';
import { createPhotoAssetRepository } from './photo-assets.ts';
export function createPhotoServiceRepository(
  s: WriteScope,
  bucket: string,
  keyVersion: string,
): PhotoServiceRepository {
  const q = s.query,
    owner = createReportAnalysisRepository(s),
    assets = createPhotoAssetRepository(s, bucket, keyVersion);
  function mapped(r: Row): PhotoIntent {
    return Object.freeze({
      id: uid('photo_upload', r.id),
      ownerId: uid('subject', r.owner_id),
      scopeId: uid('ai_scope', r.scope_id),
      policyId: uid('ai_policy', r.policy_id),
      batchId: uid('photo_batch', r.batch_id),
      key: word(r.command_key),
      fingerprint: hash(r.fingerprint),
      grantHash: hash(r.grant_hash),
      originalId: uid('asset', r.original_id),
      sanitizedId: uid('asset', r.sanitized_id),
      mime: choice(r.mime, ['image/jpeg', 'image/png', 'image/webp']),
      sha256: hash(r.sha256),
      size: num(r.size_bytes, 1, 10485760),
      state: choice(r.state, ['pending', 'processing', 'ready', 'rejected', 'deleting', 'deleted']),
      grantUntil: at(r.grant_until),
      expiresAt: at(r.expires_at),
      lease: r.lease === null ? null : uid('photo_lease', r.lease),
      leaseUntil: r.lease_until === null ? null : at(r.lease_until),
    });
  }
  async function intent(
    tx: Parameters<PhotoServiceRepository['intent']>[0],
    person: unknown,
    id: unknown,
  ) {
    const r = (
      await q(tx, 'SELECT * FROM app.photo_service_intents WHERE id=$1 AND owner_id=$2', [
        uid('photo_upload', id),
        uid('subject', person),
      ])
    ).rows[0];
    return r ? mapped(r) : null;
  }
  async function work(
    tx: Parameters<PhotoServiceRepository['work']>[0],
    id: unknown,
  ): Promise<PhotoWork | null> {
    const r = (
      await q(
        tx,
        `SELECT e.id AS extraction_id,e.upload_id,e.owner_subject_id,e.job_id,u.scope_id,u.expires_at,u.sanitized_asset_id,p.* FROM app.photo_extractions e JOIN app.tire_photo_uploads u ON u.id=e.upload_id JOIN app.ai_analysis_requests a ON a.id=e.request_id JOIN app.ai_policy_versions p ON p.id=a.policy_version_id WHERE e.request_id=$1`,
        [uid('ai_request', id)],
      )
    ).rows[0];
    if (!r) return null;
    const sanitized = await assets.get(tx, uid('asset', r.sanitized_asset_id));
    if (!sanitized) return null;
    return Object.freeze({
      requestId: uid('ai_request', id),
      extractionId: uid('photo_extraction', r.extraction_id),
      jobId: uid('job', r.job_id),
      uploadId: uid('photo_upload', r.upload_id),
      ownerId: uid('subject', r.owner_subject_id),
      scopeId: uid('ai_scope', r.scope_id),
      expiresAt: at(r.expires_at),
      sanitized,
      configuration: Object.freeze({
        policyId: uid('ai_policy', r.id),
        provider: word(r.provider),
        model: word(r.model_id),
        prompt: word(r.prompt_version),
        schema: word(r.schema_version),
        validator: word(r.validator_version),
        canonical: word(r.canonical_version),
        configurationHash: hash(r.configuration_hash),
      }),
    });
  }
  return guarded<PhotoServiceRepository>(s, {
    async capture(tx, person, id, policy, key) {
      await q(tx, 'SELECT app.ai_repository_subject($1,true)', [person]);
      const old = (
        await q(
          tx,
          'SELECT id,policy_id,expires_at>clock_timestamp() AS current FROM app.photo_service_captures WHERE owner_id=$1 AND command_key=$2',
          [person, word(key)],
        )
      ).rows[0];
      if (old) {
        if (old.id !== id || old.policy_id !== policy || old.current !== true)
          return stop('conflict');
        return uid('photo_batch', old.id);
      }
      await q(
        tx,
        'INSERT INTO app.photo_service_captures(id,owner_id,policy_id,command_key) VALUES($1,$2,$3,$4)',
        [id, person, policy, key],
      );
      return id;
    },
    owner: owner.owner,
    subjectRevision: owner.subjectRevision,
    intent,
    async create(tx, i) {
      await q(
        tx,
        `INSERT INTO app.photo_service_intents(id,owner_id,scope_id,policy_id,batch_id,command_key,fingerprint,grant_hash,original_id,sanitized_id,mime,sha256,size_bytes,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,(SELECT expires_at FROM app.object_assets WHERE id=$9))`,
        [
          i.id,
          i.ownerId,
          i.scopeId,
          i.policyId,
          i.batchId,
          word(i.key),
          hash(i.fingerprint),
          hash(i.grantHash),
          i.originalId,
          i.sanitizedId,
          i.mime,
          hash(i.sha256),
          num(i.size, 1, 10485760),
        ],
      );
      return (await intent(tx, i.ownerId, i.id)) ?? stop('integrity');
    },
    async claim(tx, person, id, lease) {
      const i = await intent(tx, person, id);
      if (!i) return null;
      await q(tx, 'SELECT app.ai_repository_scope($1,true)', [i.scopeId]);
      const r = (
        await q(
          tx,
          "UPDATE app.photo_service_intents SET state='processing',lease=$3,lease_until=clock_timestamp()+interval '60 seconds' WHERE id=$1 AND owner_id=$2 AND grant_until>clock_timestamp() AND app.photo_intent_current(id) AND (state='pending' OR(state='processing' AND lease_until<=clock_timestamp())) RETURNING *",
          [id, person, lease],
        )
      ).rows[0];
      return r ? mapped(r) : null;
    },
    async current(tx, i, lease) {
      await q(tx, 'SELECT app.ai_repository_scope($1,false)', [i.scopeId]);
      return (
        (
          await q(
            tx,
            `SELECT app.photo_intent_current(id) AND ($2::uuid IS NULL OR(state='processing' AND lease=$2 AND lease_until>clock_timestamp())) AS current FROM app.photo_service_intents WHERE id=$1 AND owner_id=$3`,
            [i.id, lease ?? null, i.ownerId],
          )
        ).rows[0]?.current === true
      );
    },
    async finish(tx, i, lease) {
      if (
        !(
          await q(
            tx,
            "UPDATE app.photo_service_intents SET state='ready',lease=NULL,lease_until=NULL WHERE id=$1 AND owner_id=$2 AND state='processing' AND lease=$3 AND lease_until>clock_timestamp() AND app.photo_intent_current(id) RETURNING id",
            [i.id, i.ownerId, lease],
          )
        ).rowCount
      )
        return stop('conflict');
    },
    async reject(tx, i, lease) {
      const changed = await q(
        tx,
        "UPDATE app.photo_service_intents SET state='rejected',lease=NULL,lease_until=NULL WHERE id=$1 AND owner_id=$2 AND state='processing' AND lease=$3 RETURNING id",
        [i.id, i.ownerId, lease],
      );
      if (changed.rowCount)
        await q(
          tx,
          "UPDATE app.ai_scope_guards SET processing_allowed=false,state='withdrawn',permission_revision=permission_revision+1,updated_at=clock_timestamp() WHERE scope_id=$1 AND state='active'",
          [i.scopeId],
        );
    },
    async enqueue(tx, person, upload, request) {
      await q(tx, "SELECT set_config('tt.p2_photo_subject',$1,true)", [person]);
      const existing = await work(tx, request);
      if (existing) return existing;
      const extraction = uid('photo_extraction', request),
        row = (
          await q(
            tx,
            "INSERT INTO app.job_runs(job_type,business_key,schema_version,resource_id,deadline_at) SELECT 'p2.photo.extract','photo-'||id::text,1,$2,expires_at FROM app.ai_analysis_requests WHERE id=$1 ON CONFLICT(job_type,business_key) DO UPDATE SET business_key=EXCLUDED.business_key RETURNING id",
            [request, extraction],
          )
        ).rows[0];
      if (!row) return stop('integrity');
      await q(
        tx,
        'INSERT INTO app.photo_extractions(id,owner_subject_id,upload_id,request_id,job_id) VALUES($1,$2,$3,$4,$5)',
        [extraction, person, upload, request, row.id],
      );
      return (await work(tx, request)) ?? stop('integrity');
    },
    async reusable(tx, person, upload) {
      const r = (await q(tx, 'SELECT * FROM app.photo_service_reusable($1,$2)', [person, upload]))
        .rows[0];
      return r
        ? Object.freeze({
            id: uid('ai_request', r.request_id),
            state: choice(r.request_state, requestStates),
          })
        : null;
    },
    async failed(tx, request, lease) {
      await q(tx, 'SELECT app.photo_service_failed($1,$2,$3)', [
        request,
        lease?.token ?? null,
        lease?.generation.toString() ?? null,
      ]);
    },
    work,
    async currentWork(tx, w) {
      await q(tx, 'SELECT app.ai_repository_scope($1,false)', [w.scopeId]);
      return (
        (
          await q(tx, 'SELECT app.photo_service_work_current($1,$2,$3) AS current', [
            w.requestId,
            w.uploadId,
            w.sanitized.sha256,
          ])
        ).rows[0]?.current === true
      );
    },
    async delete(tx, person, id) {
      const r = (await q(tx, 'SELECT app.photo_service_remove($1,$2) AS ids', [person, id])).rows[0]
        ?.ids;
      if (!Array.isArray(r) || r.length > 2) return stop('integrity');
      return Object.freeze(r.map((v) => uid('asset', v)));
    },
    async deleted(tx, person, id) {
      return (
        (await q(tx, 'SELECT app.photo_service_deleted($1,$2) AS done', [person, id])).rows[0]
          ?.done === true
      );
    },
    async expired(tx) {
      return Object.freeze(
        (
          await q(
            tx,
            "SELECT id,owner_id FROM app.photo_service_intents WHERE state='deleting' OR(state<>'deleted' AND expires_at<=clock_timestamp()) ORDER BY expires_at,id LIMIT 25",
          )
        ).rows.map((r) =>
          Object.freeze({ id: uid('photo_upload', r.id), ownerId: uid('subject', r.owner_id) }),
        ),
      );
    },
  });
}
