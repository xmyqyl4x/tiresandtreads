-- Opt-in private photo services. No default runtime or production role/bootstrap promotion.
CREATE TABLE app.photo_upload_plans(
 policy_id uuid PRIMARY KEY REFERENCES app.ai_policy_versions(id),max_daily_uploads integer NOT NULL CHECK(max_daily_uploads BETWEEN 1 AND 100),max_daily_bytes bigint NOT NULL CHECK(max_daily_bytes BETWEEN 1 AND 1073741824),max_active_uploads integer NOT NULL CHECK(max_active_uploads BETWEEN 1 AND 4),max_daily_captures integer NOT NULL CHECK(max_daily_captures BETWEEN 1 AND 100),
 status text NOT NULL CHECK(status IN('active','blocked')),reviewed_by uuid NOT NULL REFERENCES admin.staff_identities(id),reviewed_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TRIGGER photo_plan_identity BEFORE UPDATE ON app.photo_upload_plans FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('policy_id','max_daily_uploads','max_daily_bytes','max_active_uploads','max_daily_captures','reviewed_by','reviewed_at');
CREATE TABLE app.photo_service_captures(
 id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES app.subjects(id),policy_id uuid NOT NULL REFERENCES app.photo_upload_plans(policy_id),command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9_-]{16,128}$'),created_at timestamptz NOT NULL DEFAULT statement_timestamp(),expires_at timestamptz NOT NULL DEFAULT statement_timestamp()+interval '24 hours',UNIQUE(owner_id,command_key),UNIQUE(id,owner_id,policy_id),CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours')
);
CREATE INDEX photo_capture_owner_day_idx ON app.photo_service_captures(owner_id,created_at,id);
CREATE TRIGGER photo_capture_immutable BEFORE UPDATE ON app.photo_service_captures FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
ALTER TABLE app.photo_service_captures ENABLE ROW LEVEL SECURITY;ALTER TABLE app.photo_service_captures FORCE ROW LEVEL SECURITY;REVOKE ALL ON app.photo_service_captures FROM PUBLIC;
CREATE POLICY photo_captures_migrator ON app.photo_service_captures TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY photo_captures_service ON app.photo_service_captures TO tt_p2_analysis_service USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON app.photo_service_captures TO tt_p2_analysis_service;
CREATE FUNCTION app.photo_capture_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cap integer;
BEGIN
 PERFORM app.ai_repository_subject(NEW.owner_id,true);
 SELECT p.max_daily_captures INTO cap FROM app.photo_upload_plans p JOIN app.ai_policy_versions v ON v.id=p.policy_id WHERE p.policy_id=NEW.policy_id AND p.status='active' AND v.status='active' AND v.task='photo_extraction' FOR SHARE OF p,v;
 IF cap IS NULL OR(SELECT count(*) FROM app.photo_service_captures WHERE owner_id=NEW.owner_id AND created_at>=date_trunc('day',transaction_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=cap THEN RAISE EXCEPTION 'Reviewed photo capture quota unavailable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER photo_capture_guard BEFORE INSERT ON app.photo_service_captures FOR EACH ROW EXECUTE FUNCTION app.photo_capture_guard();
REVOKE ALL ON FUNCTION app.photo_capture_guard() FROM PUBLIC;
CREATE TABLE app.photo_service_intents(
 id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES app.subjects(id),scope_id uuid NOT NULL UNIQUE REFERENCES app.ai_reuse_scopes(id),policy_id uuid NOT NULL REFERENCES app.ai_policy_versions(id),batch_id uuid NOT NULL,
 command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9_-]{16,128}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),grant_hash text NOT NULL CHECK(grant_hash ~ '^[a-f0-9]{64}$'),
 original_id uuid NOT NULL UNIQUE REFERENCES app.object_assets(id),sanitized_id uuid NOT NULL UNIQUE,
 mime text NOT NULL CHECK(mime IN('image/jpeg','image/png','image/webp')),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processing','ready','rejected','deleting','deleted')),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),grant_until timestamptz NOT NULL DEFAULT statement_timestamp()+interval '10 minutes',expires_at timestamptz NOT NULL DEFAULT statement_timestamp()+interval '24 hours',
 cleanup_after timestamptz,lease uuid,lease_until timestamptz,FOREIGN KEY(batch_id,owner_id,policy_id) REFERENCES app.photo_service_captures(id,owner_id,policy_id),UNIQUE(owner_id,command_key),CHECK((state='processing')=(lease IS NOT NULL)),CHECK((lease IS NULL)=(lease_until IS NULL)),CHECK(grant_until>created_at AND grant_until<=created_at+interval '10 minutes'),CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours'),CHECK(original_id<>sanitized_id)
);
CREATE INDEX photo_intent_owner_day_idx ON app.photo_service_intents(owner_id,created_at,id);
CREATE INDEX photo_intent_batch_idx ON app.photo_service_intents(owner_id,batch_id,state);
CREATE INDEX photo_intent_expiry_idx ON app.photo_service_intents(expires_at,id) WHERE state<>'deleted';
CREATE FUNCTION app.photo_intent_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.photo_upload_plans%ROWTYPE;
BEGIN
 PERFORM app.ai_repository_subject(NEW.owner_id,TG_OP='INSERT');
 IF TG_OP='INSERT' THEN
  PERFORM app.ai_assert_scope(NEW.scope_id);
  SELECT * INTO p FROM app.photo_upload_plans WHERE policy_id=NEW.policy_id AND status='active' FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM app.photo_service_captures WHERE id=NEW.batch_id AND owner_id=NEW.owner_id AND policy_id=NEW.policy_id AND expires_at>clock_timestamp()) OR NEW.state<>'pending' OR NOT EXISTS(SELECT 1 FROM app.ai_reuse_scopes s JOIN app.ai_policy_versions v ON v.id=s.policy_version_id WHERE s.id=NEW.scope_id AND s.owner_subject_id=NEW.owner_id AND v.id=NEW.policy_id AND v.task='photo_extraction' AND v.status='active') OR NOT EXISTS(SELECT 1 FROM app.object_assets a WHERE a.id=NEW.original_id AND a.purpose='tire_photo_original' AND a.state='pending' AND a.sha256=NEW.sha256 AND a.size_bytes=NEW.size_bytes AND a.mime_type=NEW.mime AND a.expires_at>=NEW.expires_at) THEN RAISE EXCEPTION 'Reviewed photo plan, owner choice and private original required' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM app.photo_service_intents WHERE owner_id=NEW.owner_id AND created_at>=date_trunc('day',transaction_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=p.max_daily_uploads OR coalesce((SELECT sum(size_bytes) FROM app.photo_service_intents WHERE owner_id=NEW.owner_id AND created_at>=date_trunc('day',transaction_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)+NEW.size_bytes>p.max_daily_bytes OR (SELECT count(*) FROM app.photo_service_intents WHERE owner_id=NEW.owner_id AND batch_id=NEW.batch_id)>=4 OR (SELECT count(*) FROM app.photo_service_intents WHERE owner_id=NEW.owner_id AND state IN('pending','processing') AND grant_until>clock_timestamp())>=p.max_active_uploads THEN RAISE EXCEPTION 'Photo quota exceeded' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','lease','lease_until','cleanup_after']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','lease','lease_until','cleanup_after']) OR (NEW.state<>OLD.state AND NOT((OLD.state='pending' AND NEW.state IN('processing','deleting')) OR (OLD.state='processing' AND NEW.state IN('ready','rejected','deleting')) OR (OLD.state IN('ready','rejected') AND NEW.state='deleting') OR (OLD.state='deleting' AND NEW.state='deleted'))) THEN RAISE EXCEPTION 'Photo intent immutable or invalid transition' USING ERRCODE='23514';END IF;
  IF OLD.cleanup_after IS NOT NULL AND NEW.cleanup_after IS DISTINCT FROM OLD.cleanup_after THEN RAISE EXCEPTION 'Cleanup barrier immutable' USING ERRCODE='23514';END IF;
  IF NEW.state='processing' AND (NEW.grant_until<=clock_timestamp() OR NEW.lease_until<=clock_timestamp() OR NEW.lease_until>clock_timestamp()+interval '60 seconds' OR (OLD.state='processing' AND OLD.lease_until>clock_timestamp())) THEN RAISE EXCEPTION 'Photo finalization needs a bounded exclusive lease' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER photo_intent_guard BEFORE INSERT OR UPDATE ON app.photo_service_intents FOR EACH ROW EXECUTE FUNCTION app.photo_intent_guard();
ALTER TABLE app.photo_upload_plans ENABLE ROW LEVEL SECURITY;ALTER TABLE app.photo_upload_plans FORCE ROW LEVEL SECURITY;REVOKE ALL ON app.photo_upload_plans FROM PUBLIC;
CREATE POLICY photo_plans_migrator ON app.photo_upload_plans TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY photo_plans_service ON app.photo_upload_plans TO tt_p2_analysis_service USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON app.photo_upload_plans TO tt_p2_analysis_service;
ALTER TABLE app.photo_service_intents ENABLE ROW LEVEL SECURITY;ALTER TABLE app.photo_service_intents FORCE ROW LEVEL SECURITY;REVOKE ALL ON app.photo_service_intents FROM PUBLIC;
CREATE POLICY photo_intents_migrator ON app.photo_service_intents TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY photo_intents_service ON app.photo_service_intents TO tt_p2_analysis_service USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON app.photo_service_intents TO tt_p2_analysis_service;
REVOKE ALL ON FUNCTION app.photo_intent_guard() FROM PUBLIC;
CREATE FUNCTION app.photo_intent_current(upload uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.photo_service_intents i JOIN app.ai_reuse_scopes s ON s.id=i.scope_id JOIN app.ai_scope_guards g ON g.scope_id=i.scope_id JOIN app.ai_policy_versions p ON p.id=i.policy_id JOIN app.subjects person ON person.id=i.owner_id WHERE i.id=upload AND i.state IN('pending','processing','ready') AND i.expires_at>clock_timestamp() AND s.owner_subject_id=i.owner_id AND s.policy_version_id=i.policy_id AND g.state='active' AND g.processing_allowed AND g.subject_permission_revision=person.permission_revision AND person.status='active' AND(person.expires_at IS NULL OR person.expires_at>clock_timestamp()) AND p.status='active' AND p.task='photo_extraction' AND NOT EXISTS(SELECT 1 FROM privacy.asset_barriers b WHERE b.asset_id IN(i.original_id,i.sanitized_id)))
$$;
REVOKE ALL ON FUNCTION app.photo_intent_current(uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.photo_intent_current(uuid) TO tt_p2_analysis_service;
CREATE POLICY photo_service_jobs ON app.job_runs TO tt_p2_analysis_service USING(job_type='p2.photo.extract') WITH CHECK(job_type='p2.photo.extract');
CREATE FUNCTION app.photo_service_remove(person uuid,upload uuid) RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i app.photo_service_intents%ROWTYPE;e record;
BEGIN
 SELECT * INTO i FROM app.photo_service_intents WHERE id=upload AND owner_id=person;IF NOT FOUND THEN RAISE EXCEPTION 'Photo unavailable' USING ERRCODE='23514';END IF;
 PERFORM app.ai_repository_scope(i.scope_id,false);
 UPDATE app.ai_scope_guards SET processing_allowed=false,state='withdrawn',permission_revision=permission_revision+1,updated_at=clock_timestamp() WHERE scope_id=i.scope_id AND state='active';
 PERFORM set_config('tt.p2_photo_subject',person::text,true);
 FOR e IN SELECT id FROM app.photo_extractions WHERE upload_id=upload AND state IN('queued','processing') ORDER BY id LIMIT 1 LOOP PERFORM app.photo_repository_cancel(person,e.id);END LOOP;
 UPDATE app.tire_photo_uploads SET state='deleting' WHERE id=upload AND state NOT IN('deleting','deleted');
 UPDATE app.photo_service_intents SET state='deleting',cleanup_after=coalesce(cleanup_after,CASE WHEN state='processing' THEN greatest(lease_until,clock_timestamp())+interval '10 seconds' ELSE clock_timestamp() END),lease=NULL,lease_until=NULL WHERE id=upload AND state<>'deleted';
 IF privacy.analysis_repository_hold(person) OR EXISTS(SELECT 1 FROM app.photo_service_intents WHERE id=upload AND cleanup_after>clock_timestamp()) THEN RETURN '{}'::uuid[];END IF;
 RETURN ARRAY(SELECT id FROM app.object_assets WHERE id IN(i.original_id,i.sanitized_id) ORDER BY id);
END $$;
REVOKE ALL ON FUNCTION app.photo_service_remove(uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.photo_service_remove(uuid,uuid) TO tt_p2_analysis_service;

CREATE FUNCTION app.photo_service_deleted(person uuid,upload uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i app.photo_service_intents%ROWTYPE;
BEGIN
 SELECT * INTO i FROM app.photo_service_intents WHERE id=upload AND owner_id=person;IF NOT FOUND THEN RETURN false;END IF;
 PERFORM app.ai_repository_scope(i.scope_id,false);
 IF i.state='deleted' THEN RETURN true;END IF;
 IF i.state<>'deleting' OR i.cleanup_after>clock_timestamp() OR privacy.analysis_repository_hold(person) OR EXISTS(SELECT 1 FROM app.object_assets WHERE id IN(i.original_id,i.sanitized_id) AND state<>'deleted') THEN RETURN false;END IF;
 UPDATE app.tire_photo_uploads SET state='deleted' WHERE id=upload AND state='deleting';
 UPDATE app.photo_service_intents SET state='deleted' WHERE id=upload;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.photo_service_deleted(uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.photo_service_deleted(uuid,uuid) TO tt_p2_analysis_service;

-- Read current image/request authority without granting raw photo authority helpers.
CREATE FUNCTION app.photo_service_work_current(request uuid,upload uuid,sha text) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.photo_extractions e JOIN app.ai_analysis_requests a ON a.id=e.request_id JOIN app.tire_photo_uploads u ON u.id=e.upload_id JOIN app.ai_scope_guards g ON g.scope_id=a.scope_id JOIN app.object_assets image ON image.id=u.sanitized_asset_id WHERE e.request_id=request AND e.upload_id=upload AND u.scope_id=a.scope_id AND app.photo_intent_current(u.id) AND app.photo_current(u.id) AND(a.permission_revision,a.subject_permission_revision,a.invalidation_revision)=(g.permission_revision,g.subject_permission_revision,g.invalidation_revision) AND a.input_manifest->>'sanitized_sha256'=sha AND image.sha256=sha)
$$;
REVOKE ALL ON FUNCTION app.photo_service_work_current(uuid,uuid,text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.photo_service_work_current(uuid,uuid,text) TO tt_p2_analysis_service;

-- Narrow negative cleanup: never publishes, clears accepted work, or cancels a newer job generation.
CREATE FUNCTION app.photo_service_failed(request uuid,token uuid,generation bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e app.photo_extractions%ROWTYPE;a app.ai_analysis_requests%ROWTYPE;j app.job_runs%ROWTYPE;
BEGIN
 SELECT * INTO e FROM app.photo_extractions WHERE request_id=request;IF NOT FOUND THEN RETURN;END IF;
 PERFORM set_config('tt.p2_photo_subject',e.owner_subject_id::text,true);
 PERFORM app.photo_repository_root(e.owner_subject_id,e.upload_id,e.job_id);
 SELECT * INTO e FROM app.photo_extractions WHERE id=e.id;
 SELECT * INTO a FROM app.ai_analysis_requests WHERE id=request FOR UPDATE;
 SELECT * INTO j FROM app.job_runs WHERE id=e.job_id;
 IF e.state NOT IN('queued','processing') OR a.state='accepted' THEN RETURN;END IF;
 IF NOT(a.state NOT IN('queued','running','accepted') OR a.expires_at<=clock_timestamp() OR(a.state='running' AND token IS NOT NULL AND j.lease_generation=generation AND(j.lease_token=token OR j.state IN('completed','cancelled')))) THEN RETURN;END IF;
 PERFORM app.photo_repository_cancel(e.owner_subject_id,e.id);
 UPDATE app.ai_reuse_entries r SET state='invalidated',lease_holder=NULL,lease_until=NULL,fence=r.fence+1
 FROM app.ai_execution_states x WHERE x.request_id=request AND r.scope_id=a.scope_id AND r.cache_key=a.input_digest AND r.state='leased' AND r.lease_holder=x.lease_holder AND r.fence=x.reuse_fence;
END $$;
REVOKE ALL ON FUNCTION app.photo_service_failed(uuid,uuid,bigint) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.photo_service_failed(uuid,uuid,bigint) TO tt_p2_analysis_service;

-- Same immutable image/scope only. Current scope locking coalesces concurrent misses before enqueue.
CREATE FUNCTION app.photo_service_reusable(person uuid,upload uuid) RETURNS TABLE(request_id uuid,request_state text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i app.photo_service_intents%ROWTYPE;pending record;
BEGIN
 SELECT * INTO i FROM app.photo_service_intents WHERE id=upload AND owner_id=person;IF NOT FOUND THEN RETURN;END IF;
 PERFORM app.ai_repository_scope(i.scope_id,false);
 IF i.state<>'ready' OR NOT app.photo_intent_current(upload) THEN RETURN;END IF;
 FOR pending IN SELECT e.request_id FROM app.photo_extractions e JOIN app.ai_analysis_requests a ON a.id=e.request_id WHERE e.upload_id=upload AND e.state IN('queued','processing') AND(a.state NOT IN('queued','running','accepted') OR a.expires_at<=clock_timestamp()) ORDER BY e.id LIMIT 1 LOOP
  PERFORM app.photo_service_failed(pending.request_id,NULL,NULL);
 END LOOP;
 RETURN QUERY SELECT a.id,a.state FROM app.photo_extractions e JOIN app.ai_analysis_requests a ON a.id=e.request_id JOIN app.tire_photo_uploads u ON u.id=e.upload_id JOIN app.object_assets image ON image.id=u.sanitized_asset_id WHERE e.upload_id=upload AND e.owner_subject_id=person AND a.scope_id=i.scope_id AND a.policy_version_id=i.policy_id AND app.photo_service_work_current(a.id,upload,image.sha256) AND((e.state IN('queued','processing') AND a.state IN('queued','running') AND a.expires_at>clock_timestamp()) OR(e.state='complete' AND a.state='accepted' AND EXISTS(SELECT 1 FROM app.ai_artifacts artifact WHERE artifact.request_id=a.id AND app.ai_artifact_current(artifact.id)))) ORDER BY a.created_at DESC,a.id LIMIT 1;
END $$;
REVOKE ALL ON FUNCTION app.photo_service_reusable(uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION app.photo_service_reusable(uuid,uuid) TO tt_p2_analysis_service;
