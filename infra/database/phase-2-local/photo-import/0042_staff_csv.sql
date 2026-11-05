CREATE FUNCTION admin.csv_columns_valid(columns jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(columns)='array' AND jsonb_array_length(columns) BETWEEN 1 AND 100 THEN
 NOT EXISTS(SELECT 1 FROM jsonb_array_elements(columns) c WHERE jsonb_typeof(c)<>'object'
 OR NOT c ?& ARRAY['name','type','required'] OR c-ARRAY['name','type','required','unit']<>'{}'
 OR coalesce(c->>'name','') !~ '^[a-z][a-z0-9_]{0,63}$'
 OR c->>'type' NOT IN ('text','integer','decimal','boolean','date','https_url')
 OR jsonb_typeof(c->'type')<>'string' OR jsonb_typeof(c->'required')<>'boolean'
 OR (c ? 'unit' AND (jsonb_typeof(c->'unit')<>'string' OR c->>'unit' NOT IN ('none','mm','inch','minor_currency','percent'))))
 AND (SELECT count(*)=count(DISTINCT c->>'name') FROM jsonb_array_elements(columns) c)
 ELSE false END
$$;
CREATE TABLE admin.csv_template_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_key text NOT NULL CHECK(template_key ~ '^[a-z][a-z0-9_]{0,63}$'),
 version integer NOT NULL CHECK(version>0), source_kind text NOT NULL CHECK(length(btrim(source_kind)) BETWEEN 1 AND 80),
 schema_version text NOT NULL CHECK(length(btrim(schema_version)) BETWEEN 1 AND 80),
 mapping_version text NOT NULL CHECK(length(btrim(mapping_version)) BETWEEN 1 AND 80),
 parser_revision text NOT NULL CHECK(parser_revision ~ '^[a-f0-9]{40}$'),
 definition_hash text NOT NULL CHECK(definition_hash ~ '^[a-f0-9]{64}$'),
 columns jsonb NOT NULL CHECK(admin.csv_columns_valid(columns)),
 max_bytes integer NOT NULL CHECK(max_bytes BETWEEN 1 AND 20971520),
 max_rows integer NOT NULL CHECK(max_rows BETWEEN 1 AND 100000),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','active','retired')),
 reviewed_by uuid NOT NULL REFERENCES admin.staff_identities(id), reviewed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(template_key,version)
);
CREATE INDEX csv_template_reviewer_idx ON admin.csv_template_versions(reviewed_by);
CREATE TABLE admin.csv_intakes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid NOT NULL REFERENCES admin.csv_template_versions(id),
 run_id uuid NOT NULL UNIQUE REFERENCES app.import_runs(id), job_id uuid NOT NULL UNIQUE REFERENCES app.job_runs(id),
 provider_id uuid NOT NULL, license_id uuid NOT NULL, market text NOT NULL REFERENCES app.markets(code),
 asset_id uuid NOT NULL UNIQUE REFERENCES app.object_assets(id), raw_sha256 text NOT NULL CHECK(raw_sha256 ~ '^[a-f0-9]{64}$'),
 packet_sha256 text NOT NULL CHECK(packet_sha256 ~ '^[a-f0-9]{64}$'),
 uploader_id uuid NOT NULL REFERENCES admin.staff_identities(id), created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 FOREIGN KEY(provider_id,license_id) REFERENCES app.data_licenses(provider_id,id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 days')
);
CREATE INDEX csv_intake_owner_idx ON admin.csv_intakes(uploader_id,created_at DESC,id);
CREATE INDEX csv_intake_template_idx ON admin.csv_intakes(template_id,id);
CREATE INDEX csv_intake_license_idx ON admin.csv_intakes(provider_id,license_id);
CREATE INDEX csv_intake_expiry_idx ON admin.csv_intakes(expires_at,id);
CREATE TABLE admin.csv_review_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), intake_id uuid NOT NULL REFERENCES admin.csv_intakes(id),
 run_revision bigint NOT NULL CHECK(run_revision>0), run_fence bigint NOT NULL CHECK(run_fence>=0),
 expected_head_revision bigint NOT NULL CHECK(expected_head_revision>=0),
 diff_artifact_id uuid NOT NULL REFERENCES app.import_artifacts(id),
 validation_artifact_id uuid NOT NULL REFERENCES app.import_artifacts(id),
 reviewer_id uuid NOT NULL REFERENCES admin.staff_identities(id), reviewer_role_revision bigint NOT NULL CHECK(reviewer_role_revision>0),
 decision text NOT NULL CHECK(decision IN ('approved','rejected')), reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
 reviewed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(intake_id,run_revision,run_fence,reviewer_id)
);
CREATE INDEX csv_review_intake_idx ON admin.csv_review_decisions(intake_id,reviewed_at DESC,id);
CREATE INDEX csv_review_staff_idx ON admin.csv_review_decisions(reviewer_id,id);
CREATE INDEX csv_review_diff_idx ON admin.csv_review_decisions(diff_artifact_id);
CREATE INDEX csv_review_validation_idx ON admin.csv_review_decisions(validation_artifact_id);
CREATE FUNCTION admin.csv_actor() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT nullif(current_setting('tt.p2_csv_actor',true),'')::uuid
$$;
-- Eligibility before publication; deliberately does not pretend a staging dataset is published.
CREATE FUNCTION admin.csv_license_current(provider uuid,license uuid,market_code text) RETURNS boolean
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.data_licenses l JOIN app.data_providers p ON p.id=l.provider_id
 WHERE l.id=license AND l.provider_id=provider AND l.market=market_code AND p.status='active'
 AND l.rights_schema_version=1 AND l.reviewed_at<=clock_timestamp() AND l.effective_at<=clock_timestamp()
 AND (l.expires_at IS NULL OR l.expires_at>clock_timestamp())
 AND l.rights @> '{"display":true,"cache":true,"derived":true,"snapshot":true,"api":true}'::jsonb)
$$;
CREATE FUNCTION admin.csv_asset_current(asset uuid,until_at timestamptz) RETURNS boolean
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.object_assets a WHERE a.id=asset AND a.state='ready'
 AND a.purpose IN ('import_source','import_evidence') AND a.expires_at>=until_at AND until_at>clock_timestamp()
 AND a.object_version IS NOT NULL AND a.key_version IS NOT NULL AND a.sha256 IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM privacy.asset_barriers b WHERE b.asset_id=a.id))
$$;
CREATE FUNCTION admin.csv_intake_current(intake uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM admin.csv_intakes i JOIN admin.csv_template_versions t ON t.id=i.template_id JOIN app.import_runs r ON r.id=i.run_id
 JOIN app.object_assets a ON a.id=i.asset_id
 WHERE i.id=intake AND i.expires_at>clock_timestamp() AND t.state='active'
 AND admin.csv_asset_current(i.asset_id,i.expires_at) AND admin.csv_license_current(i.provider_id,i.license_id,i.market)
 AND a.sha256=i.raw_sha256 AND r.asset_id=i.asset_id AND r.provider_id=i.provider_id AND r.requested_by=i.uploader_id
 AND r.content_hash=i.packet_sha256 AND r.schema_version=t.schema_version AND r.mapping_version=t.mapping_version AND r.mode='manual'
 AND r.status NOT IN ('cancelled','failed','rejected')
 AND EXISTS(SELECT 1 FROM app.job_runs j WHERE j.id=i.job_id AND j.job_type='p2.csv.validate' AND j.resource_id=i.id
 AND j.schema_version=1 AND j.state NOT IN ('cancelled','failed','manual_review') AND j.deadline_at>clock_timestamp()))
$$;
CREATE FUNCTION admin.csv_guard_template() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT admin.authorize_operations(admin.csv_actor(),'data.review') THEN RAISE EXCEPTION 'CSV template actor unavailable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.reviewed_by<>admin.csv_actor() OR NEW.reviewed_at>clock_timestamp() OR NEW.reviewed_at<clock_timestamp()-interval '10 minutes' THEN
   RAISE EXCEPTION 'CSV template reviewer mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state')
   OR NOT ((OLD.state='draft' AND NEW.state IN ('active','retired')) OR (OLD.state='active' AND NEW.state='retired'))
  THEN RAISE EXCEPTION 'CSV template versions are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER csv_template_guard BEFORE INSERT OR UPDATE ON admin.csv_template_versions FOR EACH ROW EXECUTE FUNCTION admin.csv_guard_template();
CREATE FUNCTION admin.csv_guard_intake() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t admin.csv_template_versions%ROWTYPE; r app.import_runs%ROWTYPE; a app.object_assets%ROWTYPE; j app.job_runs%ROWTYPE;
BEGIN
 IF NEW.uploader_id IS DISTINCT FROM admin.csv_actor() OR NOT admin.authorize_operations(admin.csv_actor(),'data.review') THEN
  RAISE EXCEPTION 'CSV intake actor unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO t FROM admin.csv_template_versions WHERE id=NEW.template_id FOR SHARE;
 SELECT * INTO r FROM app.import_runs WHERE id=NEW.run_id FOR SHARE;
 SELECT * INTO a FROM app.object_assets WHERE id=NEW.asset_id FOR SHARE;
 SELECT * INTO j FROM app.job_runs WHERE id=NEW.job_id FOR SHARE;
 IF t.state IS DISTINCT FROM 'active' OR r.status IS DISTINCT FROM 'registered' OR r.mode IS DISTINCT FROM 'manual'
  OR (r.provider_id,r.asset_id,r.requested_by,r.content_hash,r.mapping_version,r.schema_version) IS DISTINCT FROM
    (NEW.provider_id,NEW.asset_id,NEW.uploader_id,NEW.packet_sha256,t.mapping_version,t.schema_version)
  OR a.purpose IS DISTINCT FROM 'import_source' OR a.mime_type NOT IN ('text/csv','application/csv')
  OR a.sha256 IS DISTINCT FROM NEW.raw_sha256 OR a.size_bytes NOT BETWEEN 1 AND t.max_bytes
  OR NOT admin.csv_asset_current(a.id,NEW.expires_at) OR NOT admin.csv_license_current(NEW.provider_id,NEW.license_id,NEW.market)
  OR j.job_type IS DISTINCT FROM 'p2.csv.validate' OR j.schema_version IS DISTINCT FROM 1 OR j.resource_id IS DISTINCT FROM NEW.id
  OR j.state IS DISTINCT FROM 'pending' OR j.deadline_at>NEW.expires_at OR j.deadline_at<=clock_timestamp() OR NEW.created_at>clock_timestamp()
 THEN RAISE EXCEPTION 'CSV intake requires matching existing private import records' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER csv_intake_guard BEFORE INSERT ON admin.csv_intakes FOR EACH ROW EXECUTE FUNCTION admin.csv_guard_intake();
CREATE TRIGGER csv_intake_immutable BEFORE UPDATE ON admin.csv_intakes FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE FUNCTION admin.csv_guard_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i admin.csv_intakes%ROWTYPE; r app.import_runs%ROWTYPE; head bigint; revision bigint; artifact record;
BEGIN
 SELECT * INTO i FROM admin.csv_intakes WHERE id=NEW.intake_id FOR UPDATE;
 SELECT * INTO r FROM app.import_runs WHERE id=i.run_id FOR SHARE;
 SELECT h.revision INTO head FROM app.market_dataset_heads h WHERE market=i.market FOR SHARE;
 SELECT s.role_revision INTO revision FROM admin.staff_identities s WHERE id=NEW.reviewer_id FOR SHARE;
 IF NEW.reviewer_id IS DISTINCT FROM admin.csv_actor() OR NEW.reviewer_id=i.uploader_id
  OR NOT admin.authorize_operations(NEW.reviewer_id,'data.review') OR NEW.reviewer_role_revision IS DISTINCT FROM revision
  OR NOT admin.csv_intake_current(i.id) OR r.status IS DISTINCT FROM 'validated'
  OR (NEW.run_revision,NEW.run_fence,NEW.expected_head_revision) IS DISTINCT FROM (r.revision,r.fence,coalesce(head,0))
  OR r.expected_head_revision IS DISTINCT FROM NEW.expected_head_revision
  OR NEW.reviewed_at>clock_timestamp() OR NEW.reviewed_at<clock_timestamp()-interval '10 minutes'
 THEN RAISE EXCEPTION 'CSV review requires independent current actor, run and publication head' USING ERRCODE='23514'; END IF;
 FOR artifact IN SELECT * FROM app.import_artifacts WHERE id IN (NEW.diff_artifact_id,NEW.validation_artifact_id) FOR SHARE LOOP
  IF artifact.run_id<>r.id OR (artifact.id=NEW.diff_artifact_id AND artifact.kind<>'diff')
   OR (artifact.id=NEW.validation_artifact_id AND artifact.kind<>'validation')
   OR NOT admin.csv_asset_current(artifact.asset_id,artifact.expires_at)
   OR artifact.checksum IS DISTINCT FROM (SELECT sha256 FROM app.object_assets WHERE id=artifact.asset_id)
  THEN RAISE EXCEPTION 'CSV review evidence mismatch' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF NEW.diff_artifact_id=NEW.validation_artifact_id OR
  (SELECT count(*) FROM app.import_artifacts WHERE id IN (NEW.diff_artifact_id,NEW.validation_artifact_id))<>2
 THEN RAISE EXCEPTION 'CSV review requires both existing evidence artifacts' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER csv_review_guard BEFORE INSERT ON admin.csv_review_decisions FOR EACH ROW EXECUTE FUNCTION admin.csv_guard_review();
CREATE TRIGGER csv_review_immutable BEFORE UPDATE ON admin.csv_review_decisions FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE FUNCTION admin.csv_staff_current(actor uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT admin.authorize_operations(actor,'data.review')
$$;
CREATE VIEW admin.csv_workflow_status WITH (security_barrier=true) AS
 SELECT i.id,i.run_id,i.template_id,r.status,r.accepted_count,r.rejected_count,j.state AS validation_job_state,
 i.expires_at,admin.csv_intake_current(i.id) AS current
 FROM admin.csv_intakes i JOIN app.import_runs r ON r.id=i.run_id JOIN app.job_runs j ON j.id=i.job_id
 WHERE admin.csv_staff_current(admin.csv_actor());
CREATE VIEW admin.csv_current_approvals WITH (security_barrier=true) AS
 SELECT d.* FROM admin.csv_review_decisions d JOIN admin.csv_intakes i ON i.id=d.intake_id JOIN app.import_runs r ON r.id=i.run_id
 JOIN admin.staff_identities s ON s.id=d.reviewer_id
 WHERE admin.csv_staff_current(admin.csv_actor()) AND d.decision='approved'
 AND admin.csv_staff_current(d.reviewer_id) AND s.role_revision=d.reviewer_role_revision
 AND admin.csv_intake_current(i.id) AND r.status='validated' AND (r.revision,r.fence)=(d.run_revision,d.run_fence)
 AND r.expected_head_revision=d.expected_head_revision
 AND coalesce((SELECT revision FROM app.market_dataset_heads WHERE market=i.market),0)=d.expected_head_revision
 AND NOT EXISTS(SELECT 1 FROM app.import_artifacts a WHERE a.id IN (d.diff_artifact_id,d.validation_artifact_id)
 AND (a.run_id<>r.id OR NOT admin.csv_asset_current(a.asset_id,a.expires_at)
 OR a.checksum IS DISTINCT FROM (SELECT sha256 FROM app.object_assets WHERE id=a.asset_id)));

-- Fixed, local-only roles. Existing privileges and policy remain unchanged.
DO $$
DECLARE relation text; role_name text; fun record;
BEGIN
 FOREACH relation IN ARRAY ARRAY['app.photo_asset_claims','app.tire_photo_uploads','app.photo_extractions','app.photo_field_candidates','app.confirmed_photo_fields',
 'admin.csv_template_versions','admin.csv_intakes','admin.csv_review_decisions'] LOOP
  EXECUTE 'ALTER TABLE '||relation||' ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE '||relation||' FORCE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON '||relation||' FROM PUBLIC';
  EXECUTE 'CREATE POLICY local_migrator ON '||relation||' TO tt_app_migrator USING(true) WITH CHECK(true)';
  IF relation LIKE 'app.%' THEN role_name:='tt_p2_photo_worker'; ELSE role_name:='tt_p2_csv_staff'; END IF;
  EXECUTE 'CREATE POLICY local_internal ON '||relation||' TO '||role_name||' USING(true) WITH CHECK(true)';
 END LOOP;
 -- Only functions introduced by these three migrations; no old ACL rewrites.
 FOR fun IN SELECT p.oid::regprocedure AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='app' AND p.proname LIKE 'photo_%') OR (n.nspname='admin' AND p.proname LIKE 'csv_%') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||fun.name||' FROM PUBLIC';
 END LOOP;
END $$;
CREATE POLICY photo_owner_confirm ON app.confirmed_photo_fields FOR INSERT TO tt_p2_photo_runtime WITH CHECK(owner_subject_id=app.photo_subject());
CREATE POLICY photo_owner_save ON app.tire_photo_uploads TO tt_p2_photo_runtime USING(app.photo_active_owner(owner_subject_id)) WITH CHECK(app.photo_active_owner(owner_subject_id));
GRANT USAGE ON SCHEMA app TO tt_p2_photo_worker,tt_p2_photo_runtime;
GRANT USAGE ON SCHEMA admin TO tt_p2_csv_staff,tt_p2_csv_worker;
GRANT SELECT,INSERT ON app.photo_asset_claims,app.tire_photo_uploads,app.photo_extractions,app.photo_field_candidates TO tt_p2_photo_worker;
GRANT UPDATE(state,sanitized_asset_id,deletion_request_id) ON app.tire_photo_uploads TO tt_p2_photo_worker;
GRANT UPDATE(state,lease_generation,lease_token,artifact_id,candidate_count,result_xid,completed_at) ON app.photo_extractions TO tt_p2_photo_worker;
GRANT INSERT ON app.confirmed_photo_fields TO tt_p2_photo_runtime;
GRANT SELECT(id,owner_subject_id,created_at,expires_at) ON app.tire_photo_uploads TO tt_p2_photo_runtime;
GRANT UPDATE(saved_at,save_notice_version,save_evidence_hash,expires_at) ON app.tire_photo_uploads TO tt_p2_photo_runtime;
GRANT SELECT ON app.photo_owner_status,app.photo_current_candidates,app.photo_current_confirmations TO tt_p2_photo_runtime;
GRANT EXECUTE ON FUNCTION app.photo_subject(),app.photo_active_owner(uuid) TO tt_p2_photo_runtime;
GRANT EXECUTE ON FUNCTION app.photo_owner_current(uuid),app.photo_extraction_current(uuid) TO tt_p2_photo_runtime;
GRANT SELECT,INSERT ON admin.csv_template_versions,admin.csv_intakes,admin.csv_review_decisions TO tt_p2_csv_staff;
GRANT UPDATE(state) ON admin.csv_template_versions TO tt_p2_csv_staff;
GRANT SELECT ON admin.csv_workflow_status,admin.csv_current_approvals TO tt_p2_csv_staff;
-- Worker receives a fixed metadata status view only; no table mutation or publication grant.
GRANT SELECT ON admin.csv_workflow_status TO tt_p2_csv_worker;
GRANT EXECUTE ON FUNCTION admin.csv_actor() TO tt_p2_csv_staff,tt_p2_csv_worker;
GRANT EXECUTE ON FUNCTION admin.csv_columns_valid(jsonb) TO tt_p2_csv_staff;
GRANT EXECUTE ON FUNCTION admin.csv_staff_current(uuid),admin.csv_intake_current(uuid),admin.csv_asset_current(uuid,timestamptz) TO tt_p2_csv_staff,tt_p2_csv_worker;

