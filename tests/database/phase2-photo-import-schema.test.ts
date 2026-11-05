import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  photoImportFixture,
  photoImportSources,
  photoImportRoles,
} from '../fixtures/phase2/photo-import.ts';
import { migrateApplication } from '../../scripts/database/migrate.ts';

let fixture: Awaited<ReturnType<typeof photoImportFixture>>;
let worker: pg.Client, reader: pg.Client, csv: pg.Client;
beforeAll(async () => {
  fixture = await photoImportFixture();
  worker = await fixture.photoImportConnect('tt_p2_photo_worker');
  reader = await fixture.photoImportConnect('tt_p2_photo_runtime');
  csv = await fixture.photoImportConnect('tt_p2_csv_staff');
}, 30000);
afterAll(async () => {
  await fixture?.cleanup();
});
it('installs the opt-in photo and CSV extension on the retained AI base', async () => {
  expect(
    (await fixture.admin.query("SELECT to_regclass('app.tire_photo_uploads')::text AS relation"))
      .rows,
  ).toEqual([{ relation: 'app.tire_photo_uploads' }]);
});

const digest = () => randomBytes(32).toString('hex');
const deny = async (p: Promise<unknown>, code = '23514') =>
  expect(p).rejects.toMatchObject({ code });
async function actor(client: pg.Client, kind: 'photo' | 'csv', id: string) {
  await client.query('SELECT set_config($1,$2,false)', [
    kind === 'photo' ? 'tt.p2_photo_subject' : 'tt.p2_csv_actor',
    id,
  ]);
}
async function asset(purpose = 'tire_photo_original', options: Record<string, unknown> = {}) {
  const id = randomUUID(),
    hash = digest(),
    row = {
      mime: 'image/jpeg',
      bytes: 1024,
      state: 'ready',
      version: 'v1',
      key: 'synthetic-k1',
      ...options,
    };
  await fixture.admin.query(
    `INSERT INTO app.object_assets(id,purpose,bucket,object_key,mime_type,state,sha256,size_bytes,object_version,key_version,expires_at)
 VALUES($1,$2,'synthetic-private',$3,$4,$5,$6,$7,$8,$9,now()+interval '31 days')`,
    [id, purpose, 'assets/' + id, row.mime, row.state, hash, row.bytes, row.version, row.key],
  );
  return { id, hash };
}
async function photo(
  options: {
    owner?: string;
    batch?: string;
    bytes?: number;
    mime?: string;
    width?: number;
    hours?: number;
    ready?: boolean;
    swapped?: boolean;
  } = {},
) {
  const owner = options.owner ?? (await fixture.owner()).identity.subjectId,
    id = randomUUID(),
    scope = randomUUID(),
    policy = randomUUID();
  await fixture.admin.query(
    `INSERT INTO app.ai_policy_versions(id,task,provider,model_id,prompt_version,schema_version,validator_version,canonical_version,configuration_hash,status,reviewed_by,reviewed_at)
 VALUES($1,'photo_extraction','synthetic','synthetic-v1','p1','s1','v1','local-jsonb-v1',$2,'active',$3,now())`,
    [policy, digest(), fixture.staff],
  );
  await fixture.admin.query(
    "INSERT INTO app.ai_reuse_scopes(id,kind,owner_subject_id,scope_key,policy_version_id) VALUES($1,'owner',$2,$3,$4)",
    [scope, owner, 'photo:' + scope, policy],
  );
  await fixture.admin.query(
    `INSERT INTO app.ai_scope_guards(scope_id,subject_permission_revision,processing_allowed,notice_version,choice_evidence_hash,choice_recorded_at)
 SELECT $1,permission_revision,true,'synthetic-v1',$2,now() FROM app.subjects WHERE id=$3`,
    [scope, digest(), owner],
  );
  const original = await asset(options.swapped ? 'tire_photo_sanitized' : 'tire_photo_original', {
    bytes: options.bytes ?? 1024,
    mime: options.mime ?? 'image/jpeg',
  });
  const sanitized = await asset(options.swapped ? 'tire_photo_original' : 'tire_photo_sanitized');
  const guard = (
    await fixture.admin.query(
      'SELECT permission_revision,invalidation_revision,subject_permission_revision FROM app.ai_scope_guards WHERE scope_id=$1',
      [scope],
    )
  ).rows[0]!;
  await worker.query('BEGIN');
  try {
    await worker.query(
      'INSERT INTO app.photo_asset_claims(asset_id,upload_id,owner_subject_id,kind) VALUES($1,$2,$3,$4)',
      [original.id, id, owner, options.swapped ? 'sanitized' : 'original'],
    );
    await worker.query(
      `INSERT INTO app.tire_photo_uploads(id,owner_subject_id,capture_batch_id,scope_id,original_asset_id,width,height,permission_revision,invalidation_revision,subject_permission_revision,expires_at)
 VALUES($1,$2,$3,$4,$5,$6,100,$8,$9,$10,now()+make_interval(hours=>$7))`,
      [
        id,
        owner,
        options.batch ?? randomUUID(),
        scope,
        original.id,
        options.width ?? 100,
        options.hours ?? 24,
        guard.permission_revision,
        guard.invalidation_revision,
        guard.subject_permission_revision,
      ],
    );
    if (options.ready !== false) {
      await worker.query(
        'INSERT INTO app.photo_asset_claims(asset_id,upload_id,owner_subject_id,kind) VALUES($1,$2,$3,$4)',
        [sanitized.id, id, owner, options.swapped ? 'original' : 'sanitized'],
      );
      await worker.query("UPDATE app.tire_photo_uploads SET state='quarantined' WHERE id=$1", [id]);
      await worker.query(
        "UPDATE app.tire_photo_uploads SET state='ready',sanitized_asset_id=$2 WHERE id=$1",
        [id, sanitized.id],
      );
    }
    await worker.query('COMMIT');
  } catch (e) {
    await worker.query('ROLLBACK');
    throw e;
  }
  return { id, owner, scope, policy, original, sanitized };
}
type Photo = Awaited<ReturnType<typeof photo>>;
async function extraction(u: Photo) {
  const id = randomUUID(),
    request = randomUUID(),
    job = randomUUID(),
    manifest = { parameters: {}, sanitized_sha256: u.sanitized.hash };
  const hash = (
    await fixture.admin.query(
      "SELECT app.ai_input_digest($1,$2,'local-jsonb-v1',$3::jsonb) AS hash",
      [u.scope, u.policy, JSON.stringify(manifest)],
    )
  ).rows[0]!.hash;
  await fixture.admin.query(
    `INSERT INTO app.ai_analysis_requests(id,scope_id,owner_subject_id,policy_version_id,input_digest,input_manifest,request_key,notice_version,permission_revision,subject_permission_revision,invalidation_revision,expires_at)
 SELECT $1,$2,$3,$4,$5,$6,$1::uuid::text,notice_version,permission_revision,subject_permission_revision,invalidation_revision,now()+interval '110 seconds'
 FROM app.ai_scope_guards WHERE scope_id=$2`,
    [request, u.scope, u.owner, u.policy, hash, JSON.stringify(manifest)],
  );
  await fixture.admin.query(
    "INSERT INTO app.job_runs(id,job_type,business_key,schema_version,resource_id,deadline_at) VALUES($1,'p2.photo.extract',$2,1,$3,now()+interval '100 seconds')",
    [job, id, id],
  );
  await worker.query(
    'INSERT INTO app.photo_extractions(id,upload_id,owner_subject_id,request_id,job_id) VALUES($1,$2,$3,$4,$5)',
    [id, u.id, u.owner, request, job],
  );
  return { id, request, job, hash, manifest, u };
}
type Extraction = Awaited<ReturnType<typeof extraction>>;
async function start(e: Extraction) {
  const token = randomUUID();
  await fixture.admin.query(
    "UPDATE app.job_runs SET state='running',lease_token=$2,lease_generation=1,lease_until=clock_timestamp()+interval '80 seconds' WHERE id=$1",
    [e.job, token],
  );
  await worker.query(
    "UPDATE app.photo_extractions SET state='processing',lease_token=$2,lease_generation=1 WHERE id=$1",
    [e.id, token],
  );
  return token;
}
async function result(
  e: Extraction,
  options: { count?: number; retainHours?: number; region?: unknown; complete?: boolean } = {},
) {
  await start(e);
  const attempt = randomUUID(),
    budget = randomUUID(),
    artifact = randomUUID(),
    candidate = randomUUID();
  await fixture.admin.query(
    "INSERT INTO app.ai_attempts(id,request_id,scope_id,policy_version_id,attempt,currency_code) VALUES($1,$2,$3,$4,1,'USD')",
    [attempt, e.request, e.u.scope, e.u.policy],
  );
  await fixture.admin.query(
    "INSERT INTO app.ai_budget_windows(id,policy_key,policy_version_id,window_start,window_end,currency_code,limit_minor) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour','USD',1000)",
    [budget, 'photo:' + budget, e.u.policy],
  );
  await fixture.admin.query(
    "INSERT INTO app.ai_budget_reservations(budget_id,attempt_id,policy_version_id,currency_code,reserved_minor) VALUES($1,$2,$3,'USD',100)",
    [budget, attempt, e.u.policy],
  );
  await fixture.admin.query("UPDATE app.ai_analysis_requests SET state='running' WHERE id=$1", [
    e.request,
  ]);
  await fixture.admin.query(
    "UPDATE app.ai_attempts SET state='started',started_at=clock_timestamp() WHERE id=$1",
    [attempt],
  );
  await fixture.admin.query(
    "UPDATE app.ai_attempts SET state='succeeded',finished_at=clock_timestamp() WHERE id=$1",
    [attempt],
  );
  await fixture.admin.query("UPDATE app.ai_analysis_requests SET state='accepted' WHERE id=$1", [
    e.request,
  ]);
  await fixture.admin.query('BEGIN');
  try {
    await fixture.admin.query(
      `INSERT INTO app.ai_artifacts(id,scope_id,request_id,policy_version_id,attempt_id,input_digest,input_manifest,output,output_hash,validation_version,permission_revision,subject_permission_revision,invalidation_revision,source_count,valid_until,retain_until)
 SELECT $1,$2,$3,$4,$5,$6,$7,'{"fields":["synthetic-brand"]}',encode(sha256(convert_to('{"fields": ["synthetic-brand"]}','UTF8')),'hex'),'v1',permission_revision,subject_permission_revision,invalidation_revision,0,now()+interval '1 hour',now()+make_interval(hours=>$8)
 FROM app.ai_scope_guards WHERE scope_id=$2`,
      [
        artifact,
        e.u.scope,
        e.request,
        e.u.policy,
        attempt,
        e.hash,
        JSON.stringify(e.manifest),
        options.retainHours ?? 2,
      ],
    );
    if (options.complete !== false) {
      await fixture.admin.query(
        "UPDATE app.photo_extractions SET state='complete',artifact_id=$2,candidate_count=$3,result_xid=pg_current_xact_id(),completed_at=clock_timestamp() WHERE id=$1",
        [e.id, artifact, options.count ?? 1],
      );
      await fixture.admin.query(
        `INSERT INTO app.photo_field_candidates(id,extraction_id,upload_id,owner_subject_id,field_code,ordinal,raw_text,normalized_value,quality,region)
 VALUES($1,$2,$3,$4,'brand',0,'Synthetic Brand','Synthetic Brand','clear',$5)`,
        [
          candidate,
          e.id,
          e.u.id,
          e.u.owner,
          options.region ? JSON.stringify(options.region) : null,
        ],
      );
    }
    await fixture.admin.query('COMMIT');
  } catch (error) {
    await fixture.admin.query('ROLLBACK');
    throw error;
  }
  return { artifact, candidate };
}
async function confirm(
  u: Photo,
  candidate: string | null,
  origin = 'accepted_candidate',
  value = 'Synthetic Brand',
  revision = 1,
  field = 'brand',
) {
  await actor(reader, 'photo', u.owner);
  return reader.query(
    'INSERT INTO app.confirmed_photo_fields(upload_id,owner_subject_id,field_code,revision,candidate_id,origin,confirmed_value) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [u.id, u.owner, field, revision, candidate, origin, value],
  );
}
it('preserves all populated prior tables, ACLs, forced RLS and 39 history rows', async () => {
  expect(fixture.appliedPhotoImport).toBe(3);
  expect(fixture.photoImportBefore).toHaveLength(176);
  expect(fixture.photoImportAfter).toEqual(fixture.photoImportBefore);
  expect(fixture.photoImportBefore.find((x) => x.table === 'app.ai_policy_versions')?.count).toBe(
    1,
  );
  expect(fixture.photoImportAfterPermissions).toEqual(fixture.photoImportBeforePermissions);
  const h = (
    await fixture.admin.query(
      'SELECT position,id,sha256 FROM migration_meta.applied ORDER BY position',
    )
  ).rows;
  expect(h.slice(0, 39)).toEqual(fixture.photoImportBeforeHistory);
  expect(h).toHaveLength(42);
  expect(await fixture.installPhotoImport()).toBe(0);
  expect(
    (
      await fixture.admin.query(
        "SELECT code FROM app.code_values WHERE set_code='asset_purpose' AND code LIKE 'tire_photo_%' ORDER BY code",
      )
    ).rows,
  ).toEqual([{ code: 'tire_photo_original' }, { code: 'tire_photo_sanitized' }]);
});
it('rolls back a failed extension DDL without changing installed history', async () => {
  const source =
    'CREATE TABLE app.p2_failed_photo_probe(id int); SELECT missing_photo_contract_column;';
  await expect(
    migrateApplication(fixture.target, [
      ...photoImportSources().sources,
      {
        id: '0043_failed_photo_probe',
        source,
        sha256: createHash('sha256').update(source).digest('hex'),
      },
    ]),
  ).rejects.toThrow();
  expect(
    (await fixture.admin.query("SELECT to_regclass('app.p2_failed_photo_probe') AS relation"))
      .rows[0]!.relation,
  ).toBeNull();
  expect(await fixture.installPhotoImport()).toBe(0);
});
it('refuses a checksum drift on the prior installed extension', async () => {
  const sources = photoImportSources().sources.map((s, i) =>
    i === 41
      ? {
          ...s,
          source: s.source + '\n-- drift',
          sha256: createHash('sha256')
            .update(s.source + '\n-- drift')
            .digest('hex'),
        }
      : s,
  );
  await expect(migrateApplication(fixture.target, sources)).rejects.toThrow();
});
it.each([
  ['oversize bytes', { bytes: 10485761 }],
  ['unsupported HEIC', { mime: 'image/heic' }],
  ['pixel bomb', { width: 400001 }],
  ['unsaved retention', { hours: 25 }],
] as const)('rejects photo %s', async (_label, options) => {
  await deny(photo(options));
});
it('accepts JPEG PNG and WebP metadata without claiming actual byte validation', async () => {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp'])
    expect((await photo({ mime })).id).toBeTruthy();
});
it('bounds a batch to four live upload intents', async () => {
  const owner = (await fixture.owner()).identity.subjectId,
    batch = randomUUID();
  for (let i = 0; i < 4; i++) await photo({ owner, batch, ready: false });
  await deny(photo({ owner, batch, ready: false }));
});
it('requires the deferred upload owner to match both asset claims', async () => {
  const u = await photo();
  await worker.query('BEGIN');
  try {
    await worker.query(
      "INSERT INTO app.photo_asset_claims(asset_id,upload_id,owner_subject_id,kind) VALUES($1,$2,$3,'original')",
      [(await asset()).id, randomUUID(), u.owner],
    );
    await deny(worker.query('COMMIT'), '23503');
  } finally {
    await worker.query('ROLLBACK');
  }
});
it('cannot reuse an original asset for another owner or upload', async () => {
  const u = await photo();
  await deny(
    worker.query(
      "INSERT INTO app.photo_asset_claims(asset_id,upload_id,owner_subject_id,kind) VALUES($1,$2,$3,'original')",
      [u.original.id, randomUUID(), (await fixture.owner()).identity.subjectId],
    ),
    '23505',
  );
});
it('denies default P1 runtime access and direct owner reads of private asset pointers', async () => {
  const runtime = await fixture.connect('tt_p2_partner_runtime');
  await deny(runtime.query('SELECT * FROM app.tire_photo_uploads'), '42501');
  await deny(reader.query('SELECT original_asset_id FROM app.tire_photo_uploads'), '42501');
  await deny(reader.query('SELECT * FROM app.object_assets'), '42501');
});
it('isolates status by server-derived owner context', async () => {
  const u = await photo();
  await actor(reader, 'photo', u.owner);
  expect(
    (await reader.query('SELECT id FROM app.photo_owner_status WHERE id=$1', [u.id])).rowCount,
  ).toBe(1);
  await actor(reader, 'photo', (await fixture.owner()).identity.subjectId);
  expect(
    (await reader.query('SELECT id FROM app.photo_owner_status WHERE id=$1', [u.id])).rowCount,
  ).toBe(0);
});
it('requires a sanitized asset before ready and refuses state rewind', async () => {
  const u = await photo({ ready: false });
  await deny(worker.query("UPDATE app.tire_photo_uploads SET state='ready' WHERE id=$1", [u.id]));
  const ready = await photo();
  await deny(
    worker.query("UPDATE app.tire_photo_uploads SET state='pending' WHERE id=$1", [ready.id]),
  );
});
it('withdrawal blocks extraction and fresh confirmations', async () => {
  const u = await photo();
  await fixture.admin.query(
    "UPDATE app.ai_scope_guards SET processing_allowed=false,state='withdrawn',permission_revision=permission_revision+1 WHERE scope_id=$1",
    [u.scope],
  );
  await deny(extraction(u));
  await deny(confirm(u, null, 'manual', 'Manual Brand'));
});
it('owner permission revision invalidates image reads and writes', async () => {
  const u = await photo();
  await fixture.admin.query(
    'UPDATE app.subjects SET permission_revision=permission_revision+1 WHERE id=$1',
    [u.owner],
  );
  expect(
    (await fixture.admin.query('SELECT app.photo_current($1) AS current', [u.id])).rows[0]!.current,
  ).toBe(false);
  await deny(extraction(u));
});
it('quarantining an owned ready asset revokes legacy AI authority', async () => {
  const u = await photo();
  await fixture.admin.query("UPDATE app.object_assets SET state='quarantined' WHERE id=$1", [
    u.sanitized.id,
  ]);
  expect(
    (
      await fixture.admin.query(
        'SELECT processing_allowed,state FROM app.ai_scope_guards WHERE scope_id=$1',
        [u.scope],
      )
    ).rows,
  ).toEqual([{ processing_allowed: false, state: 'withdrawn' }]);
  await deny(extraction(u));
});
it('delete is terminal and cannot be undone by workers', async () => {
  const u = await photo();
  await worker.query("UPDATE app.tire_photo_uploads SET state='deleting' WHERE id=$1", [u.id]);
  await deny(worker.query("UPDATE app.tire_photo_uploads SET state='ready' WHERE id=$1", [u.id]));
  await actor(reader, 'photo', u.owner);
  expect(
    (await reader.query('SELECT id FROM app.photo_owner_status WHERE id=$1', [u.id])).rowCount,
  ).toBe(0);
});
it('requires owner evidence for one bounded saved-image choice', async () => {
  const u = await photo();
  await actor(reader, 'photo', u.owner);
  await reader.query(
    "UPDATE app.tire_photo_uploads SET saved_at=clock_timestamp(),save_notice_version='save-v1',save_evidence_hash=$2,expires_at=created_at+interval '30 days' WHERE id=$1",
    [u.id, digest()],
  );
  await deny(
    reader.query(
      "UPDATE app.tire_photo_uploads SET expires_at=expires_at+interval '1 second' WHERE id=$1",
      [u.id],
    ),
  );
  expect(
    (
      await fixture.admin.query(
        'SELECT saved_at IS NOT NULL AS saved FROM app.tire_photo_uploads WHERE id=$1',
        [u.id],
      )
    ).rows[0]!.saved,
  ).toBe(true);
});
it('workers cannot grant saved-image retention', async () => {
  const u = await photo();
  await deny(
    worker.query('UPDATE app.tire_photo_uploads SET saved_at=clock_timestamp() WHERE id=$1', [
      u.id,
    ]),
    '42501',
  );
});
it('rejects a queued extraction for another owner', async () => {
  const u = await photo(),
    e = await extraction(u);
  await deny(
    worker.query('UPDATE app.photo_extractions SET owner_subject_id=$2 WHERE id=$1', [
      e.id,
      (await fixture.owner()).identity.subjectId,
    ]),
    '42501',
  );
  await deny(
    fixture.admin.query('UPDATE app.photo_extractions SET owner_subject_id=$2 WHERE id=$1', [
      e.id,
      (await fixture.owner()).identity.subjectId,
    ]),
  );
});
it('refuses a second active extraction for the same upload', async () => {
  const u = await photo();
  await extraction(u);
  await deny(extraction(u), '23505');
});
it('requires the current durable-job lease token and generation', async () => {
  const e = await extraction(await photo());
  await start(e);
  await deny(
    worker.query('UPDATE app.photo_extractions SET lease_token=$2 WHERE id=$1', [
      e.id,
      randomUUID(),
    ]),
  );
});
it('cancellation blocks stale worker progress but permits terminal cancellation metadata', async () => {
  const e = await extraction(await photo());
  await fixture.admin.query("UPDATE app.job_runs SET state='cancelled' WHERE id=$1", [e.job]);
  await deny(
    worker.query(
      "UPDATE app.photo_extractions SET state='processing',lease_token=$2,lease_generation=1 WHERE id=$1",
      [e.id, randomUUID()],
    ),
  );
  await worker.query("UPDATE app.photo_extractions SET state='cancelled' WHERE id=$1", [e.id]);
});
it('accepts a complete current extraction and owner-confirmed candidate', async () => {
  const u = await photo(),
    e = await extraction(u),
    r = await result(e);
  await confirm(u, r.candidate);
  expect(
    (
      await reader.query(
        'SELECT confirmed_value FROM app.photo_current_confirmations WHERE upload_id=$1',
        [u.id],
      )
    ).rows,
  ).toEqual([{ confirmed_value: 'Synthetic Brand' }]);
  expect(
    (
      await reader.query(
        'SELECT normalized_value FROM app.photo_current_candidates WHERE upload_id=$1',
        [u.id],
      )
    ).rows,
  ).toEqual([{ normalized_value: 'Synthetic Brand' }]);
});
it('rejects artifact retention beyond its image lifetime', async () => {
  await deny(result(await extraction(await photo()), { retainHours: 25 }));
});
it('seals the complete candidate count at transaction commit', async () => {
  await deny(result(await extraction(await photo()), { count: 2 }));
});
it.each([
  { x: -0.1, y: 0, w: 0.2, h: 0.2 },
  { x: 0.9, y: 0, w: 0.2, h: 1 },
  { x: '0', y: 0, w: 1, h: 1 },
  { x: 0, y: 0, w: 1, h: 1, script: 'bad' },
])('rejects invalid image region %j', async (region) => {
  await deny(result(await extraction(await photo()), { region }));
});
it('forbids late candidate insertion and rewriting accepted history', async () => {
  const u = await photo(),
    e = await extraction(u),
    r = await result(e);
  await deny(
    worker.query(
      "INSERT INTO app.photo_field_candidates(extraction_id,upload_id,owner_subject_id,field_code,ordinal,normalized_value,quality) VALUES($1,$2,$3,'model',0,'X','clear')",
      [e.id, u.id, u.owner],
    ),
  );
  await deny(
    fixture.admin.query(
      "UPDATE app.photo_field_candidates SET normalized_value='Changed' WHERE id=$1",
      [r.candidate],
    ),
  );
  await confirm(u, r.candidate);
  await deny(
    fixture.admin.query(
      "UPDATE app.confirmed_photo_fields SET confirmed_value='Changed' WHERE upload_id=$1",
      [u.id],
    ),
  );
});
it('binds confirmation candidate to owner upload and exact field', async () => {
  const u = await photo(),
    v = await photo(),
    r = await result(await extraction(u));
  await deny(confirm(v, r.candidate), '23503');
  await deny(confirm(u, r.candidate, 'accepted_candidate', 'Synthetic Brand', 1, 'model'), '23503');
});
it('distinguishes accepted, corrected and manual origins', async () => {
  const u = await photo(),
    r = await result(await extraction(u));
  await deny(confirm(u, r.candidate, 'accepted_candidate', 'Changed'));
  await deny(confirm(u, r.candidate, 'corrected_candidate', 'Synthetic Brand'));
  await confirm(u, r.candidate, 'corrected_candidate', 'Owner Brand');
  await confirm(u, null, 'manual', 'Manual Model', 1, 'model');
  await confirm(u, r.candidate, 'accepted_candidate', 'Synthetic Brand', 2);
  await deny(confirm(u, r.candidate, 'accepted_candidate', 'Synthetic Brand', 2));
});
it('does not let a worker manufacture an owner confirmation', async () => {
  const u = await photo();
  await deny(
    worker.query(
      "INSERT INTO app.confirmed_photo_fields(upload_id,owner_subject_id,field_code,revision,origin,confirmed_value) VALUES($1,$2,'brand',1,'manual','X')",
      [u.id, u.owner],
    ),
    '42501',
  );
});
it('hides previously accepted AI and candidate results after asset revocation', async () => {
  const u = await photo(),
    r = await result(await extraction(u));
  await confirm(u, r.candidate);
  await fixture.admin.query("UPDATE app.object_assets SET state='deleting' WHERE id=$1", [
    u.original.id,
  ]);
  expect(
    (await fixture.admin.query('SELECT app.ai_artifact_current($1) AS current', [r.artifact]))
      .rows[0]!.current,
  ).toBe(false);
  expect(
    (await reader.query('SELECT id FROM app.photo_current_candidates WHERE upload_id=$1', [u.id]))
      .rowCount,
  ).toBe(0);
  expect(
    (
      await reader.query(
        'SELECT revision FROM app.photo_current_confirmations WHERE upload_id=$1',
        [u.id],
      )
    ).rowCount,
  ).toBe(0);
});

async function operator() {
  const id = randomUUID();
  await fixture.admin.query(
    "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$2,'active',now())",
    [id, 'synthetic-csv:' + id],
  );
  await fixture.admin.query(
    "INSERT INTO admin.staff_role_assignments(staff_id,role_id,granted_at) SELECT $1,id,now() FROM admin.roles WHERE code='data_operator'",
    [id],
  );
  return id;
}
async function template(
  uploader: string,
  columns: unknown = [{ name: 'brand', type: 'text', required: true }],
) {
  await actor(csv, 'csv', uploader);
  const id = randomUUID();
  await csv.query(
    `INSERT INTO admin.csv_template_versions(id,template_key,version,source_kind,schema_version,mapping_version,parser_revision,definition_hash,columns,max_bytes,max_rows,state,reviewed_by)
 VALUES($1,$2,1,'synthetic_catalog','s1','m1',$3,$4,$5,20971520,100000,'active',$6)`,
    [
      id,
      'synthetic_' + id.replaceAll('-', ''),
      'a'.repeat(40),
      digest(),
      JSON.stringify(columns),
      uploader,
    ],
  );
  return id;
}
async function intake(
  options: { datasetMismatch?: 'license' | 'kind' | 'checksum' | 'rejected' } = {},
) {
  const uploader = await operator(),
    reviewer = await operator(),
    t = await template(uploader),
    provider = randomUUID(),
    license = randomUUID(),
    id = randomUUID(),
    run = randomUUID(),
    job = randomUUID();
  const a = await asset('import_source', { mime: 'text/csv' }),
    packet = digest();
  await fixture.admin.query(
    "INSERT INTO app.data_providers(id,code,name,status) VALUES($1,$2,'Synthetic CSV source','active')",
    [provider, 'csv-' + provider],
  );
  await fixture.admin.query(
    `INSERT INTO app.data_licenses(id,provider_id,market,rights,effective_at,reviewed_at)
 VALUES($1,$2,'US','{"display":true,"cache":true,"derived":true,"snapshot":true,"api":true}',now()-interval '1 day',now())`,
    [license, provider],
  );
  const dataset = randomUUID(),
    datasetLicense = options.datasetMismatch === 'license' ? randomUUID() : license;
  if (datasetLicense !== license)
    await fixture.admin.query(
      `INSERT INTO app.data_licenses(id,provider_id,market,rights,effective_at,reviewed_at)
 VALUES($1,$2,'US','{"display":true,"cache":true,"derived":true,"snapshot":true,"api":true}',now()-interval '1 day',now())`,
      [datasetLicense, provider],
    );
  await fixture.admin.query(
    'INSERT INTO app.dataset_versions(id,provider_id,license_id,kind,external_version,checksum,status,effective_at,fetched_at,row_count) VALUES($1,$2,$3,$4,$1::uuid::text,$5,$6,now(),now(),0)',
    [
      dataset,
      provider,
      datasetLicense,
      options.datasetMismatch === 'kind' ? 'other_kind' : 'synthetic_catalog',
      options.datasetMismatch === 'checksum' ? digest() : packet,
      options.datasetMismatch === 'rejected' ? 'rejected' : 'staging',
    ],
  );
  const head =
    (await fixture.admin.query("SELECT revision FROM app.market_dataset_heads WHERE market='US'"))
      .rows[0]?.revision ?? 0;
  await fixture.admin.query(
    `INSERT INTO app.import_runs(id,provider_id,asset_id,status,started_at,upstream_run_key,mode,mapping_version,content_hash,schema_version,requested_by,expected_head_revision,dataset_version_id)
 VALUES($1,$2,$3,'registered',now(),$1::uuid::text,'manual','m1',$4,'s1',$5,$6,$7)`,
    [run, provider, a.id, packet, uploader, head, dataset],
  );
  await fixture.admin.query(
    "INSERT INTO app.job_runs(id,job_type,business_key,schema_version,resource_id,deadline_at) VALUES($1,'p2.csv.validate',$2::uuid::text,1,$2::uuid,now()+interval '1 hour')",
    [job, id],
  );
  await csv.query(
    `INSERT INTO admin.csv_intakes(id,template_id,run_id,job_id,provider_id,license_id,market,asset_id,raw_sha256,packet_sha256,uploader_id,expires_at)
 VALUES($1,$2,$3,$4,$5,$6,'US',$7,$8,$9,$10,now()+interval '29 days')`,
    [id, t, run, job, provider, license, a.id, a.hash, packet, uploader],
  );
  return { id, t, run, job, provider, license, a, packet, uploader, reviewer, head };
}
type Intake = Awaited<ReturnType<typeof intake>>;
async function preview(i: Intake) {
  await fixture.admin.query("UPDATE app.import_runs SET status='validated' WHERE id=$1", [i.run]);
  const ids: string[] = [];
  for (const kind of ['diff', 'validation']) {
    const a = await asset('import_evidence', { mime: 'text/csv' }),
      id = randomUUID();
    ids.push(id);
    await fixture.admin.query(
      "INSERT INTO app.import_artifacts(id,run_id,kind,asset_id,checksum,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day')",
      [id, i.run, kind, a.id, a.hash],
    );
  }
  return { diff: ids[0]!, validation: ids[1]! };
}
async function review(
  i: Intake,
  p: Awaited<ReturnType<typeof preview>>,
  options: {
    reviewer?: string;
    revision?: number;
    fence?: number;
    head?: number;
    diff?: string;
  } = {},
) {
  const reviewer = options.reviewer ?? i.reviewer,
    id = randomUUID();
  await actor(csv, 'csv', reviewer);
  const run = (
    await fixture.admin.query('SELECT revision,fence FROM app.import_runs WHERE id=$1', [i.run])
  ).rows[0]!;
  const role = (
    await fixture.admin.query('SELECT role_revision FROM admin.staff_identities WHERE id=$1', [
      reviewer,
    ])
  ).rows[0]!.role_revision;
  await csv.query(
    `INSERT INTO admin.csv_review_decisions(id,intake_id,run_revision,run_fence,expected_head_revision,diff_artifact_id,validation_artifact_id,reviewer_id,reviewer_role_revision,decision,reason_code)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved','synthetic_review')`,
    [
      id,
      i.id,
      options.revision ?? run.revision,
      options.fence ?? run.fence,
      options.head ?? i.head,
      options.diff ?? p.diff,
      p.validation,
      reviewer,
      role,
    ],
  );
  return id;
}
it('admits a private CSV against a versioned template and the existing run/job', async () => {
  const i = await intake();
  const s = (
    await csv.query(
      'SELECT status,validation_job_state,current FROM admin.csv_workflow_status WHERE id=$1',
      [i.id],
    )
  ).rows;
  expect(s).toEqual([{ status: 'registered', validation_job_state: 'pending', current: true }]);
  expect(i.a.hash).not.toBe(i.packet);
});
it.each(
  [
    [],
    [{ name: 'brand', type: 'text', required: true, sql: 'DROP TABLE' }],
    [{ name: 'brand', type: 'javascript', required: true }],
    [{ name: 'brand', type: 'text', required: 'yes' }],
    [
      { name: 'brand', type: 'text', required: true },
      { name: 'brand', type: 'text', required: false },
    ],
    [{ name: 'bad column', type: 'text', required: true }],
    [{ name: 'brand', type: 'decimal', required: true, unit: 'executable' }],
  ].map((columns) => ({ columns })),
)('rejects unsafe or ambiguous CSV template columns %j', async ({ columns }) => {
  const op = await operator();
  await deny(template(op, columns));
});
it('freezes template mappings and permits only retirement transitions', async () => {
  const op = await operator(),
    t = await template(op);
  await deny(
    fixture.admin.query("UPDATE admin.csv_template_versions SET mapping_version='m2' WHERE id=$1", [
      t,
    ]),
  );
  await csv.query("UPDATE admin.csv_template_versions SET state='retired' WHERE id=$1", [t]);
  await deny(csv.query("UPDATE admin.csv_template_versions SET state='active' WHERE id=$1", [t]));
});
it('requires a current authorized staff actor for template creation', async () => {
  const op = await operator();
  await fixture.admin.query("UPDATE admin.staff_identities SET status='disabled' WHERE id=$1", [
    op,
  ]);
  await deny(template(op));
});
it('records independent review without publishing or altering existing run status', async () => {
  const i = await intake(),
    p = await preview(i),
    r = await review(i, p);
  expect(
    (await csv.query('SELECT id FROM admin.csv_current_approvals WHERE id=$1', [r])).rowCount,
  ).toBe(1);
  expect(
    (await fixture.admin.query('SELECT status FROM app.import_runs WHERE id=$1', [i.run])).rows[0]!
      .status,
  ).toBe('validated');
  expect(
    (await fixture.admin.query('SELECT id FROM app.import_publications WHERE run_id=$1', [i.run]))
      .rowCount,
  ).toBe(0);
});
it('refuses uploader self-approval', async () => {
  const i = await intake(),
    p = await preview(i);
  await deny(review(i, p, { reviewer: i.uploader }));
});
it('refuses stale run revision and publication-head inputs', async () => {
  const i = await intake(),
    p = await preview(i);
  await deny(review(i, p, { revision: 999999 }));
  await deny(review(i, p, { head: Number(i.head) + 1 }));
  await deny(review(i, p, { fence: 999999 }));
});
it('refuses wrong-run and swapped evidence parents', async () => {
  const i = await intake(),
    p = await preview(i),
    j = await intake(),
    q = await preview(j);
  await deny(review(i, p, { diff: q.diff }));
  await deny(review(i, p, { diff: p.validation }));
});
it('review requires validated existing import status', async () => {
  const i = await intake(),
    p = await preview(i);
  await fixture.admin.query("UPDATE app.import_runs SET status='staging' WHERE id=$1", [i.run]);
  await deny(review(i, p));
});
it.each([
  'rights',
  'schema',
  'provider',
  'license_expired',
  'future_review',
  'retired_template',
  'job_cancelled',
  'asset_quarantined',
])('invalidates review after %s changes', async (kind) => {
  const i = await intake(),
    p = await preview(i),
    r = await review(i, p);
  if (kind === 'rights')
    await fixture.admin.query(
      "UPDATE app.data_licenses SET rights=jsonb_set(rights,'{api}','false') WHERE id=$1",
      [i.license],
    );
  if (kind === 'schema')
    await fixture.admin.query('UPDATE app.data_licenses SET rights_schema_version=2 WHERE id=$1', [
      i.license,
    ]);
  if (kind === 'provider')
    await fixture.admin.query("UPDATE app.data_providers SET status='disabled' WHERE id=$1", [
      i.provider,
    ]);
  if (kind === 'license_expired')
    await fixture.admin.query(
      "UPDATE app.data_licenses SET expires_at=now()-interval '1 second' WHERE id=$1",
      [i.license],
    );
  if (kind === 'future_review')
    await fixture.admin.query(
      "UPDATE app.data_licenses SET reviewed_at=now()+interval '1 hour' WHERE id=$1",
      [i.license],
    );
  if (kind === 'retired_template') {
    await actor(csv, 'csv', i.uploader);
    await csv.query("UPDATE admin.csv_template_versions SET state='retired' WHERE id=$1", [i.t]);
  }
  if (kind === 'job_cancelled')
    await fixture.admin.query("UPDATE app.job_runs SET state='cancelled' WHERE id=$1", [i.job]);
  if (kind === 'asset_quarantined')
    await fixture.admin.query("UPDATE app.object_assets SET state='quarantined' WHERE id=$1", [
      i.a.id,
    ]);
  await actor(csv, 'csv', i.reviewer);
  expect(
    (await csv.query('SELECT id FROM admin.csv_current_approvals WHERE id=$1', [r])).rowCount,
  ).toBe(0);
  await deny(review(i, p));
});
it.each(['license', 'kind', 'checksum', 'rejected'] as const)(
  'rejects CSV intake whose fixed dataset has mismatched %s',
  async (datasetMismatch) => {
    await deny(intake({ datasetMismatch }));
  },
);

it('role revocation immediately hides an existing approval', async () => {
  const i = await intake(),
    p = await preview(i),
    r = await review(i, p);
  await fixture.admin.query(
    'UPDATE admin.staff_role_assignments SET revoked_at=clock_timestamp() WHERE staff_id=$1',
    [i.reviewer],
  );
  await actor(csv, 'csv', i.uploader);
  expect(
    (await csv.query('SELECT id FROM admin.csv_current_approvals WHERE id=$1', [r])).rowCount,
  ).toBe(0);
});
it('run edits invalidate an approval and status comes from the same run', async () => {
  const i = await intake(),
    p = await preview(i),
    r = await review(i, p);
  await fixture.admin.query(
    'UPDATE app.import_runs SET revision=revision+1,accepted_count=2 WHERE id=$1',
    [i.run],
  );
  expect(
    (await csv.query('SELECT id FROM admin.csv_current_approvals WHERE id=$1', [r])).rowCount,
  ).toBe(0);
  expect(
    (await csv.query('SELECT accepted_count FROM admin.csv_workflow_status WHERE id=$1', [i.id]))
      .rows[0]!.accepted_count,
  ).toBe('2');
});
it('never grants new staff/worker roles publication or old import mutation authority', async () => {
  const w = await fixture.photoImportConnect('tt_p2_csv_worker');
  await deny(csv.query("UPDATE app.import_runs SET status='published'"), '42501');
  await deny(csv.query('INSERT INTO app.import_publications DEFAULT VALUES'), '42501');
  await deny(w.query('SELECT * FROM admin.csv_intakes'), '42501');
  await deny(w.query('UPDATE admin.csv_review_decisions SET reason_code=reason_code'), '42501');
});
it('forces RLS on all eight extension tables and uses restricted non-bypass identities', async () => {
  const rows = (
    await fixture.admin.query(
      "SELECT n.nspname||'.'||c.relname AS name,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname||'.'||c.relname=ANY($1)",
      [photoImportSources().manifest.tables],
    )
  ).rows;
  expect(rows).toHaveLength(8);
  expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
  const roles = (
    await fixture.admin.query(
      'SELECT rolname,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=ANY($1)',
      [photoImportRoles],
    )
  ).rows;
  expect(roles).toHaveLength(4);
  expect(
    roles.every((r) => !r.rolsuper && !r.rolbypassrls && !r.rolcreatedb && !r.rolcreaterole),
  ).toBe(true);
});

it('retained erasure barriers invalidate legacy AI artifact reads', async () => {
  const u = await photo(),
    r = await result(await extraction(u));
  await fixture.admin.query('INSERT INTO privacy.asset_barriers(asset_id) VALUES($1)', [
    u.sanitized.id,
  ]);
  expect(
    (await fixture.admin.query('SELECT app.ai_artifact_current($1) AS current', [r.artifact]))
      .rows[0]!.current,
  ).toBe(false);
});
it('expired owners cannot see photo status metadata', async () => {
  const u = await photo();
  await fixture.admin.query(
    "UPDATE app.subjects SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",
    [u.owner],
  );
  await actor(reader, 'photo', u.owner);
  expect(
    (await reader.query('SELECT id FROM app.photo_owner_status WHERE id=$1', [u.id])).rowCount,
  ).toBe(0);
});
it('cannot mark a photo complete without its accepted extraction', async () => {
  const u = await photo();
  await worker.query("UPDATE app.tire_photo_uploads SET state='processing' WHERE id=$1", [u.id]);
  await deny(
    worker.query("UPDATE app.tire_photo_uploads SET state='complete' WHERE id=$1", [u.id]),
  );
});
it('rejects a completed extraction forged directly from queued state', async () => {
  const e = await extraction(await photo());
  await deny(
    worker.query(
      "UPDATE app.photo_extractions SET state='complete',artifact_id=$2,candidate_count=0,result_xid=pg_current_xact_id(),completed_at=clock_timestamp() WHERE id=$1",
      [e.id, randomUUID()],
    ),
  );
});
it('CSV workflow rows remain private without a current staff actor', async () => {
  const w = await fixture.photoImportConnect('tt_p2_csv_worker');
  expect((await w.query('SELECT id FROM admin.csv_workflow_status')).rowCount).toBe(0);
});

it('keeps terminal extraction references bound to the same upload request and job', async () => {
  const e = await extraction(await photo()),
    other = await photo();
  await fixture.admin.query('DELETE FROM app.photo_extractions WHERE id=$1', [e.id]);
  await deny(
    worker.query(
      "INSERT INTO app.photo_extractions(id,upload_id,owner_subject_id,request_id,job_id,state) VALUES($1,$2,$3,$4,$5,'cancelled')",
      [e.id, other.id, other.owner, e.request, e.job],
    ),
  );
});
it('serializes competing owner confirmation revisions on the upload', async () => {
  const u = await photo(),
    second = await fixture.photoImportConnect('tt_p2_photo_runtime');
  await actor(reader, 'photo', u.owner);
  await actor(second, 'photo', u.owner);
  const query =
    "INSERT INTO app.confirmed_photo_fields(upload_id,owner_subject_id,field_code,revision,origin,confirmed_value) VALUES($1,$2,'brand',1,'manual','Owner Brand')";
  const outcomes = await Promise.allSettled([
    reader.query(query, [u.id, u.owner]),
    second.query(query, [u.id, u.owner]),
  ]);
  expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  const failure = outcomes.find((x) => x.status === 'rejected');
  expect(failure).toMatchObject({ reason: { code: '23514' } });
});
it('uses the owner confirmation index for bounded latest-field reads', async () => {
  const u = await photo();
  await actor(reader, 'photo', u.owner);
  await fixture.admin.query('BEGIN');
  try {
    await fixture.admin.query("SELECT set_config('tt.p2_photo_subject',$1,true)", [u.owner]);
    await fixture.admin.query(
      `INSERT INTO app.confirmed_photo_fields(upload_id,owner_subject_id,field_code,revision,origin,confirmed_value)
 SELECT $1,$2,'model',x,'manual','Synthetic model '||x FROM generate_series(1,1000) x`,
      [u.id, u.owner],
    );
    await fixture.admin.query('ANALYZE app.confirmed_photo_fields');
    const plan = (
      await fixture.admin.query(
        "EXPLAIN (ANALYZE,FORMAT JSON) SELECT revision FROM app.confirmed_photo_fields WHERE owner_subject_id=$1 AND upload_id=$2 AND field_code='model' ORDER BY revision DESC LIMIT 1",
        [u.owner, u.id],
      )
    ).rows[0]!['QUERY PLAN'];
    expect(JSON.stringify(plan)).toContain('Index');
    expect(
      (
        await fixture.admin.query(
          "SELECT revision FROM app.confirmed_photo_fields WHERE owner_subject_id=$1 AND upload_id=$2 AND field_code='model' ORDER BY revision DESC LIMIT 1",
          [u.owner, u.id],
        )
      ).rows,
    ).toEqual([{ revision: '1000' }]);
    console.log(
      'P2_PHOTO_QUERY_EVIDENCE ' +
        JSON.stringify({
          syntheticRows: 1000,
          returned: 1,
          indexed: true,
          productionSlaAccepted: false,
        }),
    );
  } finally {
    await fixture.admin.query('ROLLBACK');
  }
}, 15000);
it('records the local-only photo/import storage boundary', () => {
  console.log(
    'P2_PHOTO_IMPORT_SCHEMA_EVIDENCE ' +
      JSON.stringify({
        localMigrations: 3,
        newTables: 8,
        guardedViews: 5,
        preservedTables: 176,
        preservedMigrationPrefix: 39,
        expectedNewPurposeRows: 2,
        existingPermissionsPreserved: true,
        forcedRls: true,
        actualPostgreSQL: true,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        productionBootstrapChanged: false,
        actualPrivacyAcceptance: false,
        actualFileProcessing: false,
        actualSchemaAcceptance: false,
        productionActivation: false,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
});
it('does not substitute sanitized bytes for an original or vice versa', async () => {
  await deny(photo({ swapped: true }));
});
it('cannot persist a photo artifact without sealing its complete extraction', async () => {
  await deny(result(await extraction(await photo()), { complete: false }));
});
it('rejects removal of retention from an owned ready photo asset', async () => {
  const u = await photo();
  await deny(
    fixture.admin.query('UPDATE app.object_assets SET expires_at=NULL WHERE id=$1', [
      u.original.id,
    ]),
  );
});

it('expired owner context cannot bypass the guarded view through column grants', async () => {
  const u = await photo();
  await fixture.admin.query(
    "UPDATE app.subjects SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",
    [u.owner],
  );
  await actor(reader, 'photo', u.owner);
  expect(
    (await reader.query('SELECT id FROM app.tire_photo_uploads WHERE id=$1', [u.id])).rowCount,
  ).toBe(0);
});
it.each(['confirmation_first', 'withdrawal_first'])(
  'serializes owner confirmation against withdrawal: %s',
  async (order) => {
    const u = await photo(),
      mutator = await fixture.aiConnect('tt_p2_ai_staff');
    await actor(reader, 'photo', u.owner);
    let settled = false;
    const readerPid = (await reader.query('SELECT pg_backend_pid() AS pid')).rows[0]!.pid as number;
    const mutatorPid = (await mutator.query('SELECT pg_backend_pid() AS pid')).rows[0]!
      .pid as number;
    async function observeBlocked(waiter: number, holder: number) {
      let observed = false;
      for (let i = 0; i < 100 && !settled; i++) {
        const blockers = (
          await fixture.admin.query('SELECT pg_blocking_pids($1) AS pids', [waiter])
        ).rows[0]!.pids as number[];
        if (blockers.includes(holder)) {
          observed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observed).toBe(true);
      expect(settled).toBe(false);
    }
    const withdraw = () =>
      mutator.query(
        "UPDATE app.ai_scope_guards SET processing_allowed=false,state='withdrawn',permission_revision=permission_revision+1 WHERE scope_id=$1",
        [u.scope],
      );
    const confirmation = () => confirm(u, null, 'manual', 'Owner Brand');
    await reader.query('BEGIN');
    await mutator.query('BEGIN');
    try {
      if (order === 'confirmation_first') {
        await confirmation();
        const pending = withdraw().finally(() => {
          settled = true;
        });
        await observeBlocked(mutatorPid, readerPid);
        await reader.query('COMMIT');
        await pending;
        await mutator.query('COMMIT');
      } else {
        await withdraw();
        const pending = confirmation()
          .then(
            () => ({ accepted: true }),
            (e) => ({ accepted: false, code: (e as { code: string }).code }),
          )
          .finally(() => {
            settled = true;
          });
        await observeBlocked(readerPid, mutatorPid);
        await mutator.query('COMMIT');
        expect(await pending).toEqual({ accepted: false, code: '23514' });
        await reader.query('ROLLBACK');
      }
      expect(
        (
          await reader.query(
            'SELECT revision FROM app.photo_current_confirmations WHERE upload_id=$1',
            [u.id],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await reader.query('ROLLBACK');
      await mutator.query('ROLLBACK');
    }
  },
);
