-- Opt-in disposable P2 storage only. These roles are not in production bootstrap.
CREATE TABLE app.ai_policy_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task text NOT NULL CHECK(task IN ('report_analysis','generic_explanation','photo_extraction')),
 provider text NOT NULL CHECK(length(btrim(provider)) BETWEEN 1 AND 100),
 model_id text NOT NULL CHECK(length(btrim(model_id)) BETWEEN 1 AND 200),
 prompt_version text NOT NULL CHECK(length(btrim(prompt_version)) BETWEEN 1 AND 100),
 schema_version text NOT NULL CHECK(length(btrim(schema_version)) BETWEEN 1 AND 100),
 validator_version text NOT NULL CHECK(length(btrim(validator_version)) BETWEEN 1 AND 100),
 canonical_version text NOT NULL CHECK(length(btrim(canonical_version)) BETWEEN 1 AND 100),
 configuration_hash text NOT NULL UNIQUE CHECK(configuration_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','retired','blocked')),
 shared_allowed boolean NOT NULL DEFAULT false,
 shared_parameter_allowlist jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(shared_parameter_allowlist)='array'),
 template_key text CHECK(length(btrim(template_key)) BETWEEN 1 AND 100),
 reviewed_by uuid REFERENCES admin.staff_identities(id) ON DELETE RESTRICT,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((reviewed_by IS NULL)=(reviewed_at IS NULL)),
 CHECK(status NOT IN ('active','retired') OR reviewed_at IS NOT NULL),
 CHECK(NOT shared_allowed OR (task='generic_explanation' AND template_key IS NOT NULL AND reviewed_at IS NOT NULL
   AND jsonb_array_length(shared_parameter_allowlist) BETWEEN 1 AND 7
   AND shared_parameter_allowlist <@ '["climate_category","usage","tire_category","market","locale","season","question_code"]'::jsonb)),
 CHECK(shared_allowed OR shared_parameter_allowlist='[]'::jsonb)
);
CREATE INDEX ai_policy_reviewer_idx ON app.ai_policy_versions(reviewed_by);
CREATE TABLE app.ai_reuse_scopes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('owner','shared')),
 owner_subject_id uuid REFERENCES app.subjects(id) ON DELETE RESTRICT,
 scope_key text NOT NULL UNIQUE CHECK(length(btrim(scope_key)) BETWEEN 1 AND 200),
 policy_version_id uuid NOT NULL REFERENCES app.ai_policy_versions(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,policy_version_id), UNIQUE(id,owner_subject_id),
 CHECK((kind='owner')=(owner_subject_id IS NOT NULL))
);
CREATE INDEX ai_scopes_owner_idx ON app.ai_reuse_scopes(owner_subject_id,id);
CREATE INDEX ai_scopes_policy_idx ON app.ai_reuse_scopes(policy_version_id);
CREATE TABLE app.ai_scope_guards (
 scope_id uuid PRIMARY KEY REFERENCES app.ai_reuse_scopes(id) ON DELETE RESTRICT,
 permission_revision bigint NOT NULL DEFAULT 1 CHECK(permission_revision>0),
 invalidation_revision bigint NOT NULL DEFAULT 0 CHECK(invalidation_revision>=0),
 subject_permission_revision bigint CHECK(subject_permission_revision>0),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','withdrawn','deleting')),
 processing_allowed boolean NOT NULL DEFAULT false,
 notice_version text CHECK(length(btrim(notice_version)) BETWEEN 1 AND 100),
 choice_evidence_hash text CHECK(choice_evidence_hash ~ '^[a-f0-9]{64}$'),
 choice_recorded_at timestamptz,
 deletion_request_id uuid REFERENCES privacy.privacy_requests(id) ON DELETE RESTRICT,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(state='active' OR NOT processing_allowed),
 CHECK(NOT processing_allowed OR (notice_version IS NOT NULL AND choice_evidence_hash IS NOT NULL AND choice_recorded_at IS NOT NULL)),
 CHECK((state='deleting')=(deletion_request_id IS NOT NULL))
);
CREATE INDEX ai_guard_deletion_idx ON app.ai_scope_guards(deletion_request_id);
CREATE TABLE app.ai_analysis_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scope_id uuid NOT NULL,
 owner_subject_id uuid REFERENCES app.subjects(id) ON DELETE RESTRICT,
 policy_version_id uuid NOT NULL,
 input_digest text NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
 input_manifest jsonb NOT NULL CHECK(jsonb_typeof(input_manifest)='object' AND octet_length(input_manifest::text)<=65536),
 request_key text NOT NULL CHECK(length(btrim(request_key)) BETWEEN 1 AND 200),
 notice_version text NOT NULL CHECK(length(btrim(notice_version)) BETWEEN 1 AND 100),
 permission_revision bigint NOT NULL CHECK(permission_revision>0),
 subject_permission_revision bigint CHECK(subject_permission_revision>0),
 invalidation_revision bigint NOT NULL CHECK(invalidation_revision>=0),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','accepted','rejected','failed','uncertain','cancelled')),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(scope_id,request_key), UNIQUE(id,scope_id,policy_version_id,input_digest,permission_revision,invalidation_revision), UNIQUE(id,scope_id,policy_version_id),
 FOREIGN KEY(scope_id,policy_version_id) REFERENCES app.ai_reuse_scopes(id,policy_version_id) ON DELETE RESTRICT,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '2 minutes')
);
CREATE INDEX ai_request_owner_idx ON app.ai_analysis_requests(owner_subject_id,id);
CREATE INDEX ai_request_due_idx ON app.ai_analysis_requests(state,expires_at,id);
CREATE INDEX ai_request_scope_idx ON app.ai_analysis_requests(scope_id,input_digest,created_at DESC);
CREATE TABLE app.ai_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL, scope_id uuid NOT NULL, policy_version_id uuid NOT NULL,
 attempt smallint NOT NULL CHECK(attempt BETWEEN 1 AND 3),
 provider_request_id text CHECK(length(btrim(provider_request_id)) BETWEEN 1 AND 300),
 state text NOT NULL DEFAULT 'created' CHECK(state IN ('created','started','succeeded','failed','uncertain','cancelled')),
 input_tokens bigint CHECK(input_tokens>=0), output_tokens bigint CHECK(output_tokens>=0),
 cost_minor bigint CHECK(cost_minor>=0), currency_code text NOT NULL REFERENCES app.currencies(code) ON DELETE RESTRICT,
 cost_status text NOT NULL DEFAULT 'unknown' CHECK(cost_status IN ('unknown','estimated','reconciled')),
 started_at timestamptz, finished_at timestamptz,
 error_code text CHECK(error_code IN ('timeout','refused','invalid_output','provider_unavailable','cancelled','unknown_charge')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(request_id,attempt), UNIQUE(id,request_id,scope_id,policy_version_id), UNIQUE(id,policy_version_id,currency_code),
 FOREIGN KEY(request_id,scope_id,policy_version_id) REFERENCES app.ai_analysis_requests(id,scope_id,policy_version_id) ON DELETE RESTRICT,
 CHECK((cost_status='unknown')=(cost_minor IS NULL)),
 CHECK(started_at IS NULL OR started_at>=created_at),
 CHECK(finished_at IS NULL OR (started_at IS NOT NULL AND finished_at>=started_at)),
 CHECK(state NOT IN ('started','succeeded','failed','uncertain') OR started_at IS NOT NULL),
 CHECK(state NOT IN ('succeeded','failed') OR finished_at IS NOT NULL)
);
CREATE INDEX ai_attempt_scope_idx ON app.ai_attempts(scope_id,id);
CREATE INDEX ai_attempt_policy_idx ON app.ai_attempts(policy_version_id);

CREATE FUNCTION app.ai_guard_policy() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') OR
  (OLD.status<>NEW.status AND NOT ((OLD.status='draft' AND NEW.status IN ('active','blocked')) OR (OLD.status='active' AND NEW.status IN ('retired','blocked')) OR (OLD.status='retired' AND NEW.status='blocked')))
 THEN RAISE EXCEPTION 'Evaluated AI policy identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_policy_immutable BEFORE UPDATE ON app.ai_policy_versions FOR EACH ROW EXECUTE FUNCTION app.ai_guard_policy();
CREATE TRIGGER ai_scope_immutable BEFORE UPDATE ON app.ai_reuse_scopes FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE FUNCTION app.ai_guard_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.ai_policy_versions%ROWTYPE;
BEGIN
 SELECT * INTO p FROM app.ai_policy_versions WHERE id=NEW.policy_version_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI policy must already exist' USING ERRCODE='23503'; END IF;
 IF p.status<>'active' OR (NEW.kind='shared' AND (NOT p.shared_allowed OR p.task<>'generic_explanation')) THEN
  RAISE EXCEPTION 'AI scope requires its active reviewed policy' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_scope_policy BEFORE INSERT ON app.ai_reuse_scopes FOR EACH ROW EXECUTE FUNCTION app.ai_guard_scope();
CREATE FUNCTION app.ai_guard_permission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s app.ai_reuse_scopes%ROWTYPE; person uuid;
BEGIN
 SELECT * INTO s FROM app.ai_reuse_scopes WHERE id=NEW.scope_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI scope must already exist' USING ERRCODE='23503'; END IF;
 IF (s.kind='owner') IS DISTINCT FROM (NEW.subject_permission_revision IS NOT NULL) THEN
  RAISE EXCEPTION 'AI guard owner revision must match scope kind' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.scope_id<>OLD.scope_id OR NEW.permission_revision<OLD.permission_revision OR NEW.invalidation_revision<OLD.invalidation_revision
   OR (OLD.state='deleting' AND NEW IS DISTINCT FROM OLD)
   OR ((to_jsonb(NEW)-ARRAY['permission_revision','invalidation_revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['permission_revision','invalidation_revision','updated_at']) AND NEW.permission_revision<=OLD.permission_revision)
  THEN RAISE EXCEPTION 'AI permission changes require a new revision; deletion is terminal' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.deletion_request_id IS NOT NULL THEN
  SELECT subject_id INTO person FROM privacy.privacy_requests WHERE id=NEW.deletion_request_id AND kind='delete' FOR SHARE;
  IF NOT FOUND OR person IS DISTINCT FROM s.owner_subject_id OR person IS NULL THEN
   RAISE EXCEPTION 'AI deletion request must belong to scope owner' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_permission_guard BEFORE INSERT OR UPDATE ON app.ai_scope_guards FOR EACH ROW EXECUTE FUNCTION app.ai_guard_permission();
CREATE FUNCTION app.ai_assert_scope(scope uuid) RETURNS app.ai_scope_guards LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s app.ai_reuse_scopes%ROWTYPE; p app.ai_policy_versions%ROWTYPE; g app.ai_scope_guards%ROWTYPE; person app.subjects%ROWTYPE;
BEGIN
 SELECT * INTO s FROM app.ai_reuse_scopes WHERE id=scope;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI scope must already exist' USING ERRCODE='23503'; END IF;
 IF s.owner_subject_id IS NOT NULL THEN
  SELECT * INTO person FROM app.subjects WHERE id=s.owner_subject_id FOR SHARE;
  IF NOT FOUND OR person.status<>'active' OR (person.expires_at IS NOT NULL AND person.expires_at<=clock_timestamp()) THEN
   RAISE EXCEPTION 'AI owner is unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO p FROM app.ai_policy_versions WHERE id=s.policy_version_id FOR SHARE;
 IF NOT FOUND OR p.status<>'active' THEN RAISE EXCEPTION 'AI policy is unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO g FROM app.ai_scope_guards WHERE scope_id=scope FOR SHARE;
 IF NOT FOUND OR g.state<>'active' OR NOT g.processing_allowed OR (s.owner_subject_id IS NOT NULL AND g.subject_permission_revision IS DISTINCT FROM person.permission_revision) THEN
  RAISE EXCEPTION 'AI permission is unavailable' USING ERRCODE='23514'; END IF;
 RETURN g;
END $$;
CREATE FUNCTION app.ai_assert_request(request uuid,accepted boolean DEFAULT false) RETURNS app.ai_analysis_requests
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.ai_analysis_requests%ROWTYPE; g app.ai_scope_guards%ROWTYPE; chosen uuid;
BEGIN
 SELECT scope_id INTO chosen FROM app.ai_analysis_requests WHERE id=request;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI request must already exist' USING ERRCODE='23503'; END IF;
 g:=app.ai_assert_scope(chosen);
 SELECT * INTO r FROM app.ai_analysis_requests WHERE id=request FOR SHARE;
 IF NOT FOUND OR (r.permission_revision,r.invalidation_revision)<>(g.permission_revision,g.invalidation_revision)
  OR r.subject_permission_revision IS DISTINCT FROM g.subject_permission_revision OR r.notice_version<>g.notice_version
  OR r.expires_at<=clock_timestamp() OR (accepted AND r.state<>'accepted') OR (NOT accepted AND r.state NOT IN ('queued','running')) THEN
  RAISE EXCEPTION 'AI captured request authority is stale or unavailable' USING ERRCODE='23514'; END IF;
 RETURN r;
END $$;
CREATE FUNCTION app.ai_input_digest(scope uuid,policy uuid,canonical text,manifest jsonb) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('scope',scope,'policy',policy,'canonical',canonical,'input',manifest)::text,'UTF8')),'hex')
$$;
CREATE FUNCTION app.ai_guard_request() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s app.ai_reuse_scopes%ROWTYPE; p app.ai_policy_versions%ROWTYPE; g app.ai_scope_guards%ROWTYPE; param text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR
   (OLD.state<>NEW.state AND NOT ((OLD.state='queued' AND NEW.state IN ('running','cancelled','failed')) OR (OLD.state='running' AND NEW.state IN ('accepted','rejected','failed','uncertain','cancelled')) OR (OLD.state='uncertain' AND NEW.state IN ('accepted','failed','cancelled'))))
  THEN RAISE EXCEPTION 'AI request identity/state is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.state IN ('failed','cancelled','uncertain') THEN RETURN NEW; END IF;
 ELSIF NEW.state<>'queued' THEN RAISE EXCEPTION 'AI request must start queued' USING ERRCODE='23514';
 END IF;
 g:=app.ai_assert_scope(NEW.scope_id);
 SELECT * INTO s FROM app.ai_reuse_scopes WHERE id=NEW.scope_id;
 SELECT * INTO p FROM app.ai_policy_versions WHERE id=NEW.policy_version_id;
 IF NOT FOUND OR p.id IS DISTINCT FROM s.policy_version_id OR NEW.owner_subject_id IS DISTINCT FROM s.owner_subject_id
  OR NEW.permission_revision<>g.permission_revision OR NEW.subject_permission_revision IS DISTINCT FROM g.subject_permission_revision
  OR NEW.invalidation_revision<>g.invalidation_revision OR NEW.notice_version<>g.notice_version OR NEW.expires_at<=clock_timestamp()
 THEN RAISE EXCEPTION 'AI request scope/policy/permission mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.input_digest<>app.ai_input_digest(NEW.scope_id,p.id,p.canonical_version,NEW.input_manifest) THEN
  RAISE EXCEPTION 'AI exact input digest mismatch' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.input_manifest->'parameters') IS DISTINCT FROM 'object' OR
  (NEW.input_manifest-ARRAY['parameters','bundle_id','authoritative_hash','rule_version','advice_revision','sanitized_sha256'])<>'{}'::jsonb
 THEN RAISE EXCEPTION 'AI manifest must use bounded typed packet fields' USING ERRCODE='23514'; END IF;
 IF (p.task='photo_extraction' AND (s.kind<>'owner' OR jsonb_typeof(NEW.input_manifest->'sanitized_sha256') IS DISTINCT FROM 'string'
    OR (NEW.input_manifest->>'sanitized_sha256') !~ '^[a-f0-9]{64}$'))
  OR (p.task<>'photo_extraction' AND NEW.input_manifest ? 'sanitized_sha256') THEN
  RAISE EXCEPTION 'Photo AI requires an exact owner image hash; text tasks cannot carry images' USING ERRCODE='23514'; END IF;
 IF s.kind='shared' THEN
  IF NEW.input_manifest ? 'sanitized_sha256' THEN RAISE EXCEPTION 'Shared AI cannot contain an image' USING ERRCODE='23514'; END IF;
  FOR param IN SELECT jsonb_object_keys(NEW.input_manifest->'parameters') LOOP
   IF NOT (p.shared_parameter_allowlist ? param) OR jsonb_typeof(NEW.input_manifest->'parameters'->param) NOT IN ('string','null')
   THEN RAISE EXCEPTION 'Shared AI parameter is not allowlisted' USING ERRCODE='23514'; END IF;
   IF jsonb_typeof(NEW.input_manifest->'parameters'->param)='string' AND NOT (
    (param='climate_category' AND '["cold","mild","hot","wet","mixed"]'::jsonb ? (NEW.input_manifest->'parameters'->>param)) OR
    (param='usage' AND '["commute","highway","offroad","mixed"]'::jsonb ? (NEW.input_manifest->'parameters'->>param)) OR
    (param='tire_category' AND '["all_season","all_weather","winter","summer","touring","performance","light_truck"]'::jsonb ? (NEW.input_manifest->'parameters'->>param)) OR
    (param='market' AND '["US","CA"]'::jsonb ? (NEW.input_manifest->'parameters'->>param)) OR
    (param='locale' AND '["en-US","en-CA","fr-CA"]'::jsonb ? (NEW.input_manifest->'parameters'->>param)) OR
    (param='season' AND '["spring","summer","autumn","winter","all"]'::jsonb ? (NEW.input_manifest->'parameters'->>param)) OR
    (param='question_code' AND '["tradeoffs","installer_questions","care"]'::jsonb ? (NEW.input_manifest->'parameters'->>param))) THEN
    RAISE EXCEPTION 'Shared AI parameters must use reviewed nonpersonal codes' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_request_guard BEFORE INSERT OR UPDATE ON app.ai_analysis_requests FOR EACH ROW EXECUTE FUNCTION app.ai_guard_request();
CREATE FUNCTION app.ai_guard_attempt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.ai_analysis_requests%ROWTYPE;
BEGIN
 SELECT * INTO r FROM app.ai_analysis_requests WHERE id=NEW.request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI attempt request must already exist' USING ERRCODE='23503'; END IF;
 IF (NEW.scope_id,NEW.policy_version_id) IS DISTINCT FROM (r.scope_id,r.policy_version_id) THEN
  RAISE EXCEPTION 'AI attempt scope mismatch' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['state','provider_request_id','input_tokens','output_tokens','cost_minor','cost_status','started_at','finished_at','error_code']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['state','provider_request_id','input_tokens','output_tokens','cost_minor','cost_status','started_at','finished_at','error_code'])
  OR (OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at)
  OR (OLD.finished_at IS NOT NULL AND NEW.finished_at IS DISTINCT FROM OLD.finished_at)
  OR (OLD.provider_request_id IS NOT NULL AND NEW.provider_request_id IS DISTINCT FROM OLD.provider_request_id)
  OR (OLD.input_tokens IS NOT NULL AND NEW.input_tokens IS DISTINCT FROM OLD.input_tokens)
  OR (OLD.output_tokens IS NOT NULL AND NEW.output_tokens IS DISTINCT FROM OLD.output_tokens)
  OR (OLD.cost_status='reconciled' AND (NEW.cost_minor,NEW.cost_status) IS DISTINCT FROM (OLD.cost_minor,OLD.cost_status))
  OR (OLD.cost_status='estimated' AND NEW.cost_status='unknown')
  OR (OLD.state<>NEW.state AND NOT ((OLD.state='created' AND NEW.state IN ('started','cancelled')) OR (OLD.state='started' AND NEW.state IN ('succeeded','failed','uncertain')) OR (OLD.state='uncertain' AND NEW.state IN ('succeeded','failed')))))
 THEN RAISE EXCEPTION 'AI attempt identity/state cannot rewind' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW.state='started' AND OLD.state<>'started') THEN
  IF TG_OP='INSERT' AND (NEW.state<>'created' OR num_nonnulls(NEW.started_at,NEW.finished_at,NEW.provider_request_id,NEW.input_tokens,NEW.output_tokens,NEW.cost_minor,NEW.error_code)>0 OR NEW.cost_status<>'unknown') THEN
   RAISE EXCEPTION 'AI attempt must start unattempted' USING ERRCODE='23514'; END IF;
  PERFORM app.ai_assert_request(NEW.request_id,false);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_attempt_guard BEFORE INSERT OR UPDATE ON app.ai_attempts FOR EACH ROW EXECUTE FUNCTION app.ai_guard_attempt();
CREATE FUNCTION app.ai_current_subject() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT nullif(current_setting('tt.p2_ai_subject',true),'')::uuid
$$;
CREATE FUNCTION app.ai_owner_scope(scope uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.ai_reuse_scopes s JOIN app.subjects p ON p.id=s.owner_subject_id
 WHERE s.id=scope AND s.kind='owner' AND p.id=app.ai_current_subject() AND p.status='active'
 AND (p.expires_at IS NULL OR p.expires_at>statement_timestamp()))
$$;

-- Fixed local AI role policies and grants.
ALTER TABLE app.ai_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_policy_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_policy_versions FROM PUBLIC;
CREATE POLICY ai_policy_versions_owner ON app.ai_policy_versions TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_policy_versions_worker ON app.ai_policy_versions TO tt_p2_ai_worker USING(true) WITH CHECK(true);
CREATE POLICY ai_policy_versions_staff ON app.ai_policy_versions TO tt_p2_ai_staff USING(true) WITH CHECK(true);
ALTER TABLE app.ai_reuse_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_reuse_scopes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_reuse_scopes FROM PUBLIC;
CREATE POLICY ai_reuse_scopes_owner ON app.ai_reuse_scopes TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_reuse_scopes_worker ON app.ai_reuse_scopes TO tt_p2_ai_worker USING(true) WITH CHECK(true);
CREATE POLICY ai_reuse_scopes_staff ON app.ai_reuse_scopes TO tt_p2_ai_staff USING(true) WITH CHECK(true);
CREATE POLICY ai_reuse_scopes_reader ON app.ai_reuse_scopes FOR SELECT TO tt_p2_ai_runtime USING(app.ai_owner_scope(id));
ALTER TABLE app.ai_scope_guards ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_scope_guards FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_scope_guards FROM PUBLIC;
CREATE POLICY ai_scope_guards_owner ON app.ai_scope_guards TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_scope_guards_worker ON app.ai_scope_guards TO tt_p2_ai_worker USING(true) WITH CHECK(true);
CREATE POLICY ai_scope_guards_staff ON app.ai_scope_guards TO tt_p2_ai_staff USING(true) WITH CHECK(true);
CREATE POLICY ai_scope_guards_reader ON app.ai_scope_guards FOR SELECT TO tt_p2_ai_runtime USING(app.ai_owner_scope(scope_id));
ALTER TABLE app.ai_analysis_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_analysis_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_analysis_requests FROM PUBLIC;
CREATE POLICY ai_analysis_requests_owner ON app.ai_analysis_requests TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_analysis_requests_worker ON app.ai_analysis_requests TO tt_p2_ai_worker USING(true) WITH CHECK(true);
CREATE POLICY ai_analysis_requests_reader ON app.ai_analysis_requests FOR SELECT TO tt_p2_ai_runtime USING(app.ai_owner_scope(scope_id));
ALTER TABLE app.ai_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_attempts FROM PUBLIC;
CREATE POLICY ai_attempts_owner ON app.ai_attempts TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_attempts_worker ON app.ai_attempts TO tt_p2_ai_worker USING(true) WITH CHECK(true);
REVOKE ALL ON FUNCTION app.ai_guard_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_guard_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_guard_permission() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_assert_scope(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_assert_request(uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_input_digest(uuid,uuid,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_guard_request() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_guard_attempt() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_current_subject() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_owner_scope(uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA app,email,privacy TO tt_p2_ai_worker,tt_p2_ai_staff,tt_p2_ai_runtime;
GRANT SELECT,INSERT ON app.ai_policy_versions,app.ai_reuse_scopes TO tt_p2_ai_staff;
GRANT UPDATE(status) ON app.ai_policy_versions TO tt_p2_ai_staff;
GRANT SELECT,INSERT,UPDATE ON app.ai_scope_guards TO tt_p2_ai_staff;
GRANT SELECT ON app.ai_policy_versions,app.ai_reuse_scopes,app.ai_scope_guards TO tt_p2_ai_worker;
GRANT UPDATE ON app.ai_scope_guards TO tt_p2_ai_worker;
GRANT SELECT,INSERT,UPDATE ON app.ai_analysis_requests,app.ai_attempts TO tt_p2_ai_worker;
GRANT SELECT ON app.ai_reuse_scopes,app.ai_scope_guards TO tt_p2_ai_runtime;
GRANT SELECT(id,scope_id,state,created_at,expires_at) ON app.ai_analysis_requests TO tt_p2_ai_runtime;
GRANT EXECUTE ON FUNCTION app.ai_input_digest(uuid,uuid,text,jsonb) TO tt_p2_ai_worker;
GRANT EXECUTE ON FUNCTION app.ai_current_subject(),app.ai_owner_scope(uuid) TO tt_p2_ai_runtime;
