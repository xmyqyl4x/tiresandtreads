CREATE TABLE app.photo_extractions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), upload_id uuid NOT NULL, owner_subject_id uuid NOT NULL,
 request_id uuid NOT NULL UNIQUE REFERENCES app.ai_analysis_requests(id), job_id uuid NOT NULL UNIQUE REFERENCES app.job_runs(id),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','complete','rejected','failed','cancelled')),
 lease_generation bigint, lease_token uuid, artifact_id uuid UNIQUE REFERENCES app.ai_artifacts(id),
 candidate_count smallint CHECK(candidate_count BETWEEN 0 AND 40), result_xid xid8,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(id,upload_id,owner_subject_id),
 FOREIGN KEY(upload_id,owner_subject_id) REFERENCES app.tire_photo_uploads(id,owner_subject_id),
 CHECK((state='complete')=(artifact_id IS NOT NULL)),
 CHECK((state='complete')=(num_nonnulls(candidate_count,result_xid,completed_at)=3)),
 CHECK((lease_generation IS NULL)=(lease_token IS NULL)),
 CHECK(lease_generation IS NULL OR lease_generation>0), CHECK(state<>'processing' OR lease_token IS NOT NULL)
);
CREATE UNIQUE INDEX photo_extraction_active_idx ON app.photo_extractions(upload_id) WHERE state IN ('queued','processing');
CREATE INDEX photo_extraction_owner_idx ON app.photo_extractions(owner_subject_id,upload_id,id);
CREATE TABLE app.photo_field_candidates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), extraction_id uuid NOT NULL, upload_id uuid NOT NULL, owner_subject_id uuid NOT NULL,
 field_code text NOT NULL CHECK(field_code IN ('brand','model','tire_size','load_index','speed_rating','dot_tin','date_code','seasonal_marking','run_flat_marking')),
 ordinal smallint NOT NULL CHECK(ordinal BETWEEN 0 AND 3),
 raw_text text CHECK(length(raw_text) BETWEEN 1 AND 512),
 normalized_value text CHECK(length(btrim(normalized_value)) BETWEEN 1 AND 512),
 unknown_reason text CHECK(unknown_reason IN ('unreadable','not_visible','ambiguous','unsupported')),
 quality text NOT NULL CHECK(quality IN ('clear','uncertain','unknown')),
 region jsonb,
 UNIQUE(extraction_id,field_code,ordinal), UNIQUE(id,upload_id,owner_subject_id,field_code),
 FOREIGN KEY(extraction_id,upload_id,owner_subject_id) REFERENCES app.photo_extractions(id,upload_id,owner_subject_id),
 CHECK((normalized_value IS NULL)=(unknown_reason IS NOT NULL)), CHECK((quality='unknown')=(unknown_reason IS NOT NULL))
);
CREATE INDEX photo_candidate_upload_idx ON app.photo_field_candidates(upload_id,field_code,id);
CREATE TABLE app.confirmed_photo_fields (
 upload_id uuid NOT NULL, owner_subject_id uuid NOT NULL, field_code text NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), candidate_id uuid,
 origin text NOT NULL CHECK(origin IN ('accepted_candidate','corrected_candidate','manual')),
 confirmed_value text NOT NULL CHECK(length(btrim(confirmed_value)) BETWEEN 1 AND 512),
 confirmed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(upload_id,field_code,revision),
 FOREIGN KEY(upload_id,owner_subject_id) REFERENCES app.tire_photo_uploads(id,owner_subject_id),
 FOREIGN KEY(candidate_id,upload_id,owner_subject_id,field_code) REFERENCES app.photo_field_candidates(id,upload_id,owner_subject_id,field_code),
 CHECK(field_code IN ('brand','model','tire_size','load_index','speed_rating','dot_tin','date_code','seasonal_marking','run_flat_marking')),
 CHECK((origin='manual')=(candidate_id IS NULL))
);
CREATE INDEX photo_confirmation_owner_idx ON app.confirmed_photo_fields(owner_subject_id,upload_id,field_code,revision DESC);
CREATE INDEX photo_confirmation_candidate_idx ON app.confirmed_photo_fields(candidate_id);
CREATE FUNCTION app.photo_guard_extraction() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u app.tire_photo_uploads%ROWTYPE; r app.ai_analysis_requests%ROWTYPE; j app.job_runs%ROWTYPE; a app.ai_artifacts%ROWTYPE;
BEGIN
 SELECT * INTO u FROM app.tire_photo_uploads WHERE id=NEW.upload_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Photo upload missing' USING ERRCODE='23503'; END IF;
 SELECT * INTO r FROM app.ai_analysis_requests WHERE id=NEW.request_id FOR SHARE;
 SELECT * INTO j FROM app.job_runs WHERE id=NEW.job_id FOR SHARE;
 IF NEW.owner_subject_id<>u.owner_subject_id OR r.scope_id IS DISTINCT FROM u.scope_id
  OR j.job_type IS DISTINCT FROM 'p2.photo.extract' OR j.schema_version IS DISTINCT FROM 1 OR j.resource_id IS DISTINCT FROM NEW.id
  OR NEW.created_at>clock_timestamp() THEN
  RAISE EXCEPTION 'Extraction identity requires its owned request and job' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.upload_id,NEW.owner_subject_id,NEW.request_id,NEW.job_id,NEW.created_at) IS DISTINCT FROM
   (OLD.id,OLD.upload_id,OLD.owner_subject_id,OLD.request_id,OLD.job_id,OLD.created_at)
   OR OLD.state NOT IN ('queued','processing') OR (OLD.state='processing' AND NEW.state='queued')
  THEN RAISE EXCEPTION 'Extraction identity/result is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.state IN ('cancelled','failed','rejected') THEN
  IF NEW.artifact_id IS NOT NULL OR NEW.candidate_count IS NOT NULL OR NEW.result_xid IS NOT NULL OR NEW.completed_at IS NOT NULL
  THEN RAISE EXCEPTION 'No terminal extraction payload' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NOT app.photo_current(u.id) OR NEW.owner_subject_id<>u.owner_subject_id OR r.scope_id IS DISTINCT FROM u.scope_id
  OR j.job_type IS DISTINCT FROM 'p2.photo.extract' OR j.schema_version IS DISTINCT FROM 1 OR j.resource_id IS DISTINCT FROM NEW.id
  OR j.state IN ('cancelled','failed','manual_review','completed') OR j.deadline_at<=clock_timestamp()
  OR j.deadline_at>r.expires_at OR j.deadline_at>u.expires_at
  OR r.input_manifest->>'sanitized_sha256' IS DISTINCT FROM (SELECT sha256 FROM app.object_assets WHERE id=u.sanitized_asset_id)
 THEN RAISE EXCEPTION 'Extraction requires its current owned image, request and job' USING ERRCODE='23514'; END IF;
 IF NEW.state='queued' THEN
  IF TG_OP<>'INSERT' OR NEW.lease_token IS NOT NULL OR NEW.candidate_count IS NOT NULL OR NEW.result_xid IS NOT NULL OR NEW.completed_at IS NOT NULL
   OR j.state<>'pending' OR r.state<>'queued' THEN RAISE EXCEPTION 'Invalid queued extraction' USING ERRCODE='23514'; END IF;
 ELSE
  IF j.state<>'running' OR j.lease_until<=clock_timestamp() OR (NEW.lease_generation,NEW.lease_token) IS DISTINCT FROM (j.lease_generation,j.lease_token)
  THEN RAISE EXCEPTION 'Stale extraction job lease' USING ERRCODE='23514'; END IF;
  IF NEW.state='complete' THEN
   SELECT * INTO a FROM app.ai_artifacts WHERE id=NEW.artifact_id FOR SHARE;
   IF a.request_id IS DISTINCT FROM r.id OR NOT app.ai_artifact_current(a.id)
    OR a.retain_until>u.expires_at OR a.valid_until>u.expires_at OR NEW.result_xid<>pg_current_xact_id()
    OR NEW.completed_at>clock_timestamp() OR NEW.completed_at<NEW.created_at
   THEN RAISE EXCEPTION 'Extraction result requires current image-bounded artifact' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.artifact_id IS NOT NULL OR NEW.candidate_count IS NOT NULL OR NEW.result_xid IS NOT NULL OR NEW.completed_at IS NOT NULL
   THEN RAISE EXCEPTION 'Unfinished extraction has no payload' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER photo_extraction_guard BEFORE INSERT OR UPDATE ON app.photo_extractions FOR EACH ROW EXECUTE FUNCTION app.photo_guard_extraction();
CREATE FUNCTION app.photo_guard_completion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.state='complete' AND NOT EXISTS(SELECT 1 FROM app.photo_extractions e WHERE e.upload_id=NEW.id AND e.owner_subject_id=NEW.owner_subject_id
  AND e.state='complete' AND app.ai_artifact_current(e.artifact_id)) THEN
  RAISE EXCEPTION 'Photo completion requires accepted extraction' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER photo_upload_completion BEFORE UPDATE ON app.tire_photo_uploads FOR EACH ROW EXECUTE FUNCTION app.photo_guard_completion();
CREATE FUNCTION app.photo_guard_artifact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u app.tire_photo_uploads%ROWTYPE;
BEGIN
 IF EXISTS(SELECT 1 FROM app.ai_policy_versions WHERE id=NEW.policy_version_id AND task='photo_extraction') THEN
  SELECT u0.* INTO u FROM app.photo_extractions e JOIN app.tire_photo_uploads u0 ON u0.id=e.upload_id
   WHERE e.request_id=NEW.request_id AND e.state='processing' FOR SHARE OF u0;
  IF NOT FOUND OR NOT app.photo_current(u.id) OR NEW.retain_until>u.expires_at OR NEW.valid_until>u.expires_at
   OR NEW.input_manifest->>'sanitized_sha256' IS DISTINCT FROM (SELECT sha256 FROM app.object_assets WHERE id=u.sanitized_asset_id)
  THEN RAISE EXCEPTION 'Photo artifact requires owned sanitized image provenance' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p2_photo_artifact_guard BEFORE INSERT ON app.ai_artifacts FOR EACH ROW EXECUTE FUNCTION app.photo_guard_artifact();
CREATE FUNCTION app.photo_check_artifact_seal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM app.ai_policy_versions WHERE id=NEW.policy_version_id AND task='photo_extraction')
  AND NOT EXISTS(SELECT 1 FROM app.photo_extractions e WHERE e.request_id=NEW.request_id AND e.artifact_id=NEW.id AND e.state='complete'
   AND e.result_xid=pg_current_xact_id() AND e.candidate_count=(SELECT count(*) FROM app.photo_field_candidates c WHERE c.extraction_id=e.id)) THEN
  RAISE EXCEPTION 'Photo artifact must commit with its sealed extraction' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER p2_photo_artifact_seal AFTER INSERT ON app.ai_artifacts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.photo_check_artifact_seal();
CREATE FUNCTION app.photo_guard_candidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e app.photo_extractions%ROWTYPE; x numeric; y numeric; w numeric; h numeric;
BEGIN
 SELECT * INTO e FROM app.photo_extractions WHERE id=NEW.extraction_id FOR SHARE;
 IF NOT FOUND OR e.state<>'complete' OR e.result_xid<>pg_current_xact_id() OR NOT app.photo_current(e.upload_id) THEN
  RAISE EXCEPTION 'Candidate set is sealed with completed extraction' USING ERRCODE='23514'; END IF;
 IF NEW.region IS NOT NULL THEN
  IF jsonb_typeof(NEW.region)<>'object' OR NOT NEW.region ?& ARRAY['x','y','w','h']
   OR NEW.region-ARRAY['x','y','w','h']<>'{}' OR EXISTS(SELECT 1 FROM jsonb_each(NEW.region) WHERE jsonb_typeof(value)<>'number')
  THEN RAISE EXCEPTION 'Invalid candidate region' USING ERRCODE='23514'; END IF;
  x:=(NEW.region->>'x')::numeric; y:=(NEW.region->>'y')::numeric; w:=(NEW.region->>'w')::numeric; h:=(NEW.region->>'h')::numeric;
  IF x<0 OR y<0 OR w<=0 OR h<=0 OR x+w>1 OR y+h>1 THEN RAISE EXCEPTION 'Invalid candidate region bounds' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER photo_candidate_guard BEFORE INSERT ON app.photo_field_candidates FOR EACH ROW EXECUTE FUNCTION app.photo_guard_candidate();
CREATE TRIGGER photo_candidate_immutable BEFORE UPDATE ON app.photo_field_candidates FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE FUNCTION app.photo_check_candidate_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM app.photo_extractions e WHERE e.id=NEW.id AND e.state='complete'
  AND e.candidate_count<>(SELECT count(*) FROM app.photo_field_candidates c WHERE c.extraction_id=e.id))
 THEN RAISE EXCEPTION 'Extraction candidate set is incomplete' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER photo_candidate_count AFTER INSERT OR UPDATE ON app.photo_extractions DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION app.photo_check_candidate_count();
CREATE FUNCTION app.photo_guard_confirmation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.photo_field_candidates%ROWTYPE; next_revision bigint; scope uuid;
BEGIN
 SELECT scope_id INTO scope FROM app.tire_photo_uploads WHERE id=NEW.upload_id AND owner_subject_id=NEW.owner_subject_id FOR UPDATE;
 IF NOT FOUND OR app.photo_subject() IS DISTINCT FROM NEW.owner_subject_id THEN
  RAISE EXCEPTION 'Confirmation owner mismatch' USING ERRCODE='23514';
 END IF;
 PERFORM app.ai_assert_scope(scope);
 IF NOT app.photo_current(NEW.upload_id)
  OR NEW.confirmed_at>clock_timestamp() OR NEW.confirmed_at<clock_timestamp()-interval '10 minutes'
 THEN RAISE EXCEPTION 'Confirmation requires current explicit owner context' USING ERRCODE='23514'; END IF;
 SELECT coalesce(max(revision),0)+1 INTO next_revision FROM app.confirmed_photo_fields WHERE upload_id=NEW.upload_id AND field_code=NEW.field_code;
 IF NEW.revision<>next_revision THEN RAISE EXCEPTION 'Confirmation revision is stale' USING ERRCODE='23514'; END IF;
 IF NEW.candidate_id IS NOT NULL THEN
  SELECT * INTO c FROM app.photo_field_candidates WHERE id=NEW.candidate_id;
  IF NOT FOUND OR c.normalized_value IS NULL OR (NEW.origin='accepted_candidate') IS DISTINCT FROM (NEW.confirmed_value=c.normalized_value)
   OR NOT EXISTS(SELECT 1 FROM app.photo_extractions e WHERE e.id=c.extraction_id AND app.ai_artifact_current(e.artifact_id))
  THEN RAISE EXCEPTION 'Confirmation candidate is unavailable or origin mismatches' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER photo_confirmation_guard BEFORE INSERT ON app.confirmed_photo_fields FOR EACH ROW EXECUTE FUNCTION app.photo_guard_confirmation();
CREATE TRIGGER photo_confirmation_immutable BEFORE UPDATE ON app.confirmed_photo_fields FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE FUNCTION app.photo_owner_current(upload uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.tire_photo_uploads WHERE id=upload AND owner_subject_id=app.photo_subject() AND app.photo_current(id))
$$;
CREATE FUNCTION app.photo_extraction_current(extraction uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.photo_extractions e WHERE e.id=extraction AND app.photo_owner_current(e.upload_id) AND app.ai_artifact_current(e.artifact_id))
$$;
CREATE VIEW app.photo_owner_status WITH (security_barrier=true) AS
 SELECT id,owner_subject_id,state,created_at,expires_at,saved_at FROM app.tire_photo_uploads u
 WHERE owner_subject_id=app.photo_subject() AND state NOT IN ('deleting','deleted')
 AND expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM app.subjects p WHERE p.id=u.owner_subject_id AND p.status='active' AND (p.expires_at IS NULL OR p.expires_at>clock_timestamp()));
CREATE VIEW app.photo_current_candidates WITH (security_barrier=true) AS
 SELECT c.* FROM app.photo_field_candidates c JOIN app.photo_extractions e ON e.id=c.extraction_id
 WHERE c.owner_subject_id=app.photo_subject() AND app.photo_extraction_current(e.id);
CREATE VIEW app.photo_current_confirmations WITH (security_barrier=true) AS
 SELECT c.* FROM app.confirmed_photo_fields c WHERE c.owner_subject_id=app.photo_subject() AND app.photo_owner_current(c.upload_id)
 AND c.revision=(SELECT max(x.revision) FROM app.confirmed_photo_fields x WHERE x.upload_id=c.upload_id AND x.field_code=c.field_code);

