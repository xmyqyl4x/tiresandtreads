-- Explicit local opt-in only. No role assignment, provider activation or default promotion.
INSERT INTO admin.roles(code,permissions,policy_version) VALUES
 ('ai_observer','["ai.observe"]','p2-local-operations-v1'),
 ('ai_operator','["ai.observe","ai.control"]','p2-local-operations-v1'),
 ('photo_observer','["photo.observe"]','p2-local-operations-v1');
CREATE FUNCTION app.authorize_ai_operator(actor uuid,subject text,permission text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF permission NOT IN('ai.observe','ai.control','photo.observe') THEN RETURN false;END IF;
 PERFORM 1 FROM admin.staff_identities s WHERE s.id=actor AND s.provider_subject=subject AND s.status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM 1 FROM admin.staff_role_assignments a JOIN admin.roles r ON r.id=a.role_id WHERE a.staff_id=actor AND a.revoked_at IS NULL AND a.granted_at<=clock_timestamp() AND r.permissions ? permission FOR SHARE OF a,r;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION app.authorize_ai_operator(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.authorize_ai_operator(uuid,text,text) TO tt_p2_analysis_service;
CREATE TABLE admin.ai_operation_commands(
 id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES admin.staff_identities(id),operation text NOT NULL CHECK(operation IN('disable','resume')),
 target_id uuid NOT NULL,input_digest text NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN('executing','succeeded','refused','unknown')),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),finished_at timestamptz,
 CHECK((state='executing')=(finished_at IS NULL)),CHECK(finished_at IS NULL OR finished_at>=created_at)
);
CREATE INDEX ai_operation_actor_idx ON admin.ai_operation_commands(actor_id,id);
CREATE FUNCTION admin.guard_ai_operation_command() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['state','finished_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','finished_at']) OR OLD.state<>'executing' OR NEW.state='executing' THEN RAISE EXCEPTION 'Operation identity and terminal receipt are immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION admin.guard_ai_operation_command() FROM PUBLIC;
CREATE TRIGGER ai_operation_identity BEFORE UPDATE ON admin.ai_operation_commands FOR EACH ROW EXECUTE FUNCTION admin.guard_ai_operation_command();
ALTER TABLE admin.ai_operation_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.ai_operation_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON admin.ai_operation_commands FROM PUBLIC;
CREATE POLICY ai_operation_owner ON admin.ai_operation_commands TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_operation_service ON admin.ai_operation_commands TO tt_p2_analysis_service USING(true) WITH CHECK(true);
GRANT USAGE ON SCHEMA admin TO tt_p2_analysis_service;
GRANT SELECT,INSERT ON admin.ai_operation_commands TO tt_p2_analysis_service;
GRANT UPDATE(state,finished_at) ON admin.ai_operation_commands TO tt_p2_analysis_service;
CREATE INDEX ai_request_operations_window_idx ON app.ai_analysis_requests(created_at DESC,id DESC);
CREATE INDEX ai_attempt_operations_window_idx ON app.ai_attempts(created_at DESC,id DESC);
CREATE INDEX photo_confirmation_operations_window_idx ON app.confirmed_photo_fields(confirmed_at DESC,upload_id,field_code);
-- These bounded metadata projections grant no private images, field values, prompts or identities.
CREATE FUNCTION app.photo_operations_confirmations(since timestamptz,until timestamptz) RETURNS TABLE(origin text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT c.origin FROM app.confirmed_photo_fields c WHERE c.confirmed_at>=since AND c.confirmed_at<until ORDER BY c.confirmed_at DESC,c.upload_id,c.field_code,c.revision DESC LIMIT 5001
$$;
CREATE FUNCTION privacy.ai_operations_purge_health() RETURNS TABLE(phase text,updated_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT j.phase,j.updated_at FROM privacy.ai_erasure_jobs j WHERE j.phase<>'done' ORDER BY j.updated_at,j.id LIMIT 5001
$$;
REVOKE ALL ON FUNCTION app.photo_operations_confirmations(timestamptz,timestamptz),privacy.ai_operations_purge_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.photo_operations_confirmations(timestamptz,timestamptz),privacy.ai_operations_purge_health() TO tt_p2_analysis_service;
