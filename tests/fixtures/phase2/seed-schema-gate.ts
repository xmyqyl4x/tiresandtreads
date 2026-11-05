import { randomBytes, randomUUID } from 'node:crypto';
import type { schemaGateFixture } from './schema-gate.ts';
type Fixture = Awaited<ReturnType<typeof schemaGateFixture>>;
const hash = () => randomBytes(32).toString('hex');
export async function seedGateRecords(f: Fixture) {
  const q = f.admin.query.bind(f.admin),
    owner = f.retainedOwner.identity.subjectId;
  async function asset(purpose: string, mime: string) {
    const id = randomUUID(),
      digest = hash();
    await q(
      "INSERT INTO app.object_assets(id,purpose,bucket,object_key,mime_type,state,sha256,size_bytes,object_version,key_version,expires_at) VALUES($1,$2,'synthetic-gate-private',$3,$4,'ready',$5,1024,'v1','synthetic-k1',now()+interval '31 days')",
      [id, purpose, 'assets/' + id, mime, digest],
    );
    return { id, hash: digest };
  }
  const photo = {
    upload: randomUUID(),
    scope: randomUUID(),
    policy: randomUUID(),
    request: randomUUID(),
    job: randomUUID(),
    extraction: randomUUID(),
    attempt: randomUUID(),
    budget: randomUUID(),
    reservation: randomUUID(),
    artifact: randomUUID(),
    candidate: randomUUID(),
  };
  const original = await asset('tire_photo_original', 'image/jpeg'),
    sanitized = await asset('tire_photo_sanitized', 'image/jpeg');
  await q(
    "INSERT INTO app.ai_policy_versions(id,task,provider,model_id,prompt_version,schema_version,validator_version,canonical_version,configuration_hash,status,reviewed_by,reviewed_at) VALUES($1,'photo_extraction','synthetic-gate','local-v1','p1','s1','v1','local-jsonb-v1',$2,'active',$3,now())",
    [photo.policy, hash(), f.staff],
  );
  await q(
    "INSERT INTO app.ai_reuse_scopes(id,kind,owner_subject_id,scope_key,policy_version_id) VALUES($1,'owner',$2,$1::uuid::text,$3)",
    [photo.scope, owner, photo.policy],
  );
  await q(
    "INSERT INTO app.ai_scope_guards(scope_id,subject_permission_revision,processing_allowed,notice_version,choice_evidence_hash,choice_recorded_at) SELECT $1,permission_revision,true,'gate-notice-v1',$2,now() FROM app.subjects WHERE id=$3",
    [photo.scope, hash(), owner],
  );
  await q('BEGIN');
  try {
    await q(
      "INSERT INTO app.photo_asset_claims(asset_id,upload_id,owner_subject_id,kind) VALUES($1,$2,$3,'original'),($4,$2,$3,'sanitized')",
      [original.id, photo.upload, owner, sanitized.id],
    );
    await q(
      "INSERT INTO app.tire_photo_uploads(id,owner_subject_id,capture_batch_id,scope_id,original_asset_id,width,height,permission_revision,invalidation_revision,subject_permission_revision,expires_at) SELECT $1,$2,$1,$3,$4,100,100,permission_revision,invalidation_revision,subject_permission_revision,now()+interval '24 hours' FROM app.ai_scope_guards WHERE scope_id=$3",
      [photo.upload, owner, photo.scope, original.id],
    );
    await q("UPDATE app.tire_photo_uploads SET state='quarantined' WHERE id=$1", [photo.upload]);
    await q("UPDATE app.tire_photo_uploads SET state='ready',sanitized_asset_id=$2 WHERE id=$1", [
      photo.upload,
      sanitized.id,
    ]);
    await q('COMMIT');
  } catch (e) {
    await q('ROLLBACK');
    throw e;
  }
  const manifest = JSON.stringify({ parameters: {}, sanitized_sha256: sanitized.hash });
  const inputHash = (
    await q("SELECT app.ai_input_digest($1,$2,'local-jsonb-v1',$3) AS hash", [
      photo.scope,
      photo.policy,
      manifest,
    ])
  ).rows[0]!.hash;
  await q(
    "INSERT INTO app.ai_analysis_requests(id,scope_id,owner_subject_id,policy_version_id,input_digest,input_manifest,request_key,notice_version,permission_revision,subject_permission_revision,invalidation_revision,expires_at) SELECT $1,$2,$3,$4,$5,$6,$1::uuid::text,notice_version,permission_revision,subject_permission_revision,invalidation_revision,now()+interval '110 seconds' FROM app.ai_scope_guards WHERE scope_id=$2",
    [photo.request, photo.scope, owner, photo.policy, inputHash, manifest],
  );
  await q(
    "INSERT INTO app.job_runs(id,job_type,business_key,schema_version,resource_id,deadline_at) VALUES($1,'p2.photo.extract',$2,1,$3,now()+interval '90 seconds')",
    [photo.job, photo.extraction, photo.extraction],
  );
  await q(
    'INSERT INTO app.photo_extractions(id,upload_id,owner_subject_id,request_id,job_id) VALUES($1,$2,$3,$4,$5)',
    [photo.extraction, photo.upload, owner, photo.request, photo.job],
  );
  const token = randomUUID();
  await q(
    "UPDATE app.job_runs SET state='running',lease_token=$2,lease_generation=1,lease_until=clock_timestamp()+interval '80 seconds' WHERE id=$1",
    [photo.job, token],
  );
  await q(
    "UPDATE app.photo_extractions SET state='processing',lease_token=$2,lease_generation=1 WHERE id=$1",
    [photo.extraction, token],
  );
  await q(
    "INSERT INTO app.ai_attempts(id,request_id,scope_id,policy_version_id,attempt,currency_code) VALUES($1,$2,$3,$4,1,'USD')",
    [photo.attempt, photo.request, photo.scope, photo.policy],
  );
  await q(
    "INSERT INTO app.ai_budget_windows(id,policy_key,policy_version_id,window_start,window_end,currency_code,limit_minor) VALUES($1,$1::uuid::text,$2,now()-interval '1 minute',now()+interval '1 day','USD',1000)",
    [photo.budget, photo.policy],
  );
  await q(
    "INSERT INTO app.ai_budget_reservations(id,budget_id,attempt_id,policy_version_id,currency_code,reserved_minor) VALUES($1,$2,$3,$4,'USD',100)",
    [photo.reservation, photo.budget, photo.attempt, photo.policy],
  );
  await q("UPDATE app.ai_analysis_requests SET state='running' WHERE id=$1", [photo.request]);
  await q("UPDATE app.ai_attempts SET state='started',started_at=clock_timestamp() WHERE id=$1", [
    photo.attempt,
  ]);
  await q(
    "UPDATE app.ai_attempts SET state='succeeded',finished_at=clock_timestamp() WHERE id=$1",
    [photo.attempt],
  );
  await q("UPDATE app.ai_analysis_requests SET state='accepted' WHERE id=$1", [photo.request]);
  await q('BEGIN');
  try {
    await q(
      "INSERT INTO app.ai_artifacts(id,scope_id,request_id,policy_version_id,attempt_id,input_digest,input_manifest,output,output_hash,validation_version,permission_revision,subject_permission_revision,invalidation_revision,source_count,valid_until,retain_until) SELECT $1,$2,$3,$4,$5,$6,$7,'{}',encode(sha256(convert_to('{}','UTF8')),'hex'),'v1',permission_revision,subject_permission_revision,invalidation_revision,0,now()+interval '1 hour',now()+interval '2 hours' FROM app.ai_scope_guards WHERE scope_id=$2",
      [
        photo.artifact,
        photo.scope,
        photo.request,
        photo.policy,
        photo.attempt,
        inputHash,
        manifest,
      ],
    );
    await q(
      "UPDATE app.photo_extractions SET state='complete',artifact_id=$2,candidate_count=1,result_xid=pg_current_xact_id(),completed_at=clock_timestamp() WHERE id=$1",
      [photo.extraction, photo.artifact],
    );
    await q(
      "INSERT INTO app.photo_field_candidates(id,extraction_id,upload_id,owner_subject_id,field_code,ordinal,normalized_value,quality) VALUES($1,$2,$3,$4,'brand',0,'Synthetic Gate Brand','clear')",
      [photo.candidate, photo.extraction, photo.upload, owner],
    );
    await q("SELECT set_config('tt.p2_photo_subject',$1,true)", [owner]);
    await q(
      "INSERT INTO app.confirmed_photo_fields(upload_id,owner_subject_id,field_code,revision,candidate_id,origin,confirmed_value) VALUES($1,$2,'brand',1,$3,'accepted_candidate','Synthetic Gate Brand')",
      [photo.upload, owner, photo.candidate],
    );
    await q('COMMIT');
  } catch (e) {
    await q('ROLLBACK');
    throw e;
  }
  // Retain an unsettled reservation intentionally: purge must refuse uncertainty before reconciliation.
  const csv = {
    template: randomUUID(),
    intake: randomUUID(),
    run: randomUUID(),
    job: randomUUID(),
    dataset: randomUUID(),
    uploader: randomUUID(),
    reviewer: randomUUID(),
    review: randomUUID(),
  };
  for (const actor of [csv.uploader, csv.reviewer]) {
    await q(
      "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$1::uuid::text,'active',now())",
      [actor],
    );
    await q(
      "INSERT INTO admin.staff_role_assignments(staff_id,role_id,granted_at) SELECT $1,id,now() FROM admin.roles WHERE code='data_operator'",
      [actor],
    );
  }
  await q("SELECT set_config('tt.p2_csv_actor',$1,false)", [csv.uploader]);
  await q(
    "INSERT INTO admin.csv_template_versions(id,template_key,version,source_kind,schema_version,mapping_version,parser_revision,definition_hash,columns,max_bytes,max_rows,state,reviewed_by) VALUES($1,'synthetic_gate',1,'synthetic_catalog','s1','m1',$2,$3,'[{\"name\":\"brand\",\"type\":\"text\",\"required\":true}]',20971520,100000,'active',$4)",
    [csv.template, 'a'.repeat(40), hash(), csv.uploader],
  );
  const csvAsset = await asset('import_source', 'text/csv'),
    packet = hash();
  await q(
    "INSERT INTO app.dataset_versions(id,provider_id,license_id,kind,external_version,checksum,status,effective_at,fetched_at,row_count) VALUES($1,$2,$3,'synthetic_catalog',$1::uuid::text,$4,'staging',now(),now(),0)",
    [csv.dataset, f.provider, f.license, packet],
  );
  const head =
    (await q("SELECT revision FROM app.market_dataset_heads WHERE market='US'")).rows[0]
      ?.revision ?? 0;
  await q(
    "INSERT INTO app.import_runs(id,provider_id,dataset_version_id,asset_id,status,started_at,upstream_run_key,mode,mapping_version,content_hash,schema_version,requested_by,expected_head_revision) VALUES($1,$2,$3,$4,'registered',now(),$1::uuid::text,'manual','m1',$5,'s1',$6,$7)",
    [csv.run, f.provider, csv.dataset, csvAsset.id, packet, csv.uploader, head],
  );
  await q(
    "INSERT INTO app.job_runs(id,job_type,business_key,schema_version,resource_id,deadline_at) VALUES($1,'p2.csv.validate',$2::uuid::text,1,$2,now()+interval '1 hour')",
    [csv.job, csv.intake],
  );
  await q(
    "INSERT INTO admin.csv_intakes(id,template_id,run_id,job_id,provider_id,license_id,market,asset_id,raw_sha256,packet_sha256,uploader_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,'US',$7,$8,$9,$10,now()+interval '29 days')",
    [
      csv.intake,
      csv.template,
      csv.run,
      csv.job,
      f.provider,
      f.license,
      csvAsset.id,
      csvAsset.hash,
      packet,
      csv.uploader,
    ],
  );
  await q("UPDATE app.import_runs SET status='validated' WHERE id=$1", [csv.run]);
  const evidence: string[] = [];
  for (const kind of ['diff', 'validation']) {
    const id = randomUUID(),
      a = await asset('import_evidence', 'text/csv');
    evidence.push(id);
    await q(
      "INSERT INTO app.import_artifacts(id,run_id,kind,asset_id,checksum,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day')",
      [id, csv.run, kind, a.id, a.hash],
    );
  }
  await q("SELECT set_config('tt.p2_csv_actor',$1,false)", [csv.reviewer]);
  await q(
    "INSERT INTO admin.csv_review_decisions(id,intake_id,run_revision,run_fence,expected_head_revision,diff_artifact_id,validation_artifact_id,reviewer_id,reviewer_role_revision,decision,reason_code) SELECT $1,$2,revision,fence,$3,$4,$5,$6,1,'approved','synthetic_gate' FROM app.import_runs WHERE id=$7",
    [csv.review, csv.intake, head, evidence[0], evidence[1], csv.reviewer, csv.run],
  );
  return { owner, photo: { ...photo, original: original.id, sanitized: sanitized.id }, csv };
}
