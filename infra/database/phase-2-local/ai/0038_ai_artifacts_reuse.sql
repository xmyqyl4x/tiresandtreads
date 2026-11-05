CREATE TABLE app.ai_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scope_id uuid NOT NULL, request_id uuid NOT NULL, policy_version_id uuid NOT NULL, attempt_id uuid NOT NULL,
 input_digest text NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
 input_manifest jsonb NOT NULL CHECK(jsonb_typeof(input_manifest)='object' AND octet_length(input_manifest::text)<=65536),
 output jsonb NOT NULL CHECK(jsonb_typeof(output)='object' AND octet_length(output::text)<=65536),
 output_hash text NOT NULL CHECK(output_hash ~ '^[a-f0-9]{64}$'),
 validation_version text NOT NULL CHECK(length(btrim(validation_version)) BETWEEN 1 AND 100),
 permission_revision bigint NOT NULL CHECK(permission_revision>0),
 subject_permission_revision bigint CHECK(subject_permission_revision>0),
 invalidation_revision bigint NOT NULL CHECK(invalidation_revision>=0),
 source_count smallint NOT NULL CHECK(source_count BETWEEN 0 AND 64),
 generated_at timestamptz NOT NULL DEFAULT now(), valid_until timestamptz NOT NULL, retain_until timestamptz NOT NULL,
 created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 UNIQUE(id,scope_id), UNIQUE(id,scope_id,policy_version_id,input_digest), UNIQUE(request_id),
 FOREIGN KEY(request_id,scope_id,policy_version_id,input_digest,permission_revision,invalidation_revision) REFERENCES app.ai_analysis_requests(id,scope_id,policy_version_id,input_digest,permission_revision,invalidation_revision) ON DELETE RESTRICT,
 FOREIGN KEY(attempt_id,request_id,scope_id,policy_version_id) REFERENCES app.ai_attempts(id,request_id,scope_id,policy_version_id) ON DELETE RESTRICT,
 CHECK(valid_until>generated_at AND valid_until<=generated_at+interval '7 days' AND retain_until>=valid_until AND retain_until<=generated_at+interval '30 days')
);
CREATE INDEX ai_artifact_exact_idx ON app.ai_artifacts(scope_id,input_digest,generated_at DESC,id);
CREATE INDEX ai_artifact_expiry_idx ON app.ai_artifacts(valid_until,id);
CREATE INDEX ai_artifact_retention_idx ON app.ai_artifacts(retain_until,id);
CREATE INDEX ai_artifact_attempt_idx ON app.ai_artifacts(attempt_id);
CREATE TABLE app.ai_artifact_sources (
 artifact_id uuid NOT NULL REFERENCES app.ai_artifacts(id) ON DELETE RESTRICT,
 source_key text NOT NULL CHECK(length(btrim(source_key)) BETWEEN 1 AND 200),
 dataset_version_id uuid REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
 advice_fact_id uuid REFERENCES app.advice_facts(id) ON DELETE RESTRICT,
 claim_hash text NOT NULL CHECK(claim_hash ~ '^[a-f0-9]{64}$'),
 rights_valid_until timestamptz NOT NULL,
 PRIMARY KEY(artifact_id,source_key), CHECK(num_nonnulls(dataset_version_id,advice_fact_id)=1)
);
CREATE INDEX ai_source_dataset_idx ON app.ai_artifact_sources(dataset_version_id,artifact_id);
CREATE INDEX ai_source_advice_idx ON app.ai_artifact_sources(advice_fact_id,artifact_id);
CREATE INDEX ai_source_rights_idx ON app.ai_artifact_sources(rights_valid_until,artifact_id);
CREATE TABLE app.ai_reuse_entries (
 scope_id uuid NOT NULL, cache_key text NOT NULL CHECK(cache_key ~ '^[a-f0-9]{64}$'), policy_version_id uuid NOT NULL,
 artifact_id uuid, state text NOT NULL DEFAULT 'empty' CHECK(state IN ('empty','leased','ready','invalidated')),
 valid_until timestamptz, lease_holder uuid, lease_until timestamptz,
 fence bigint NOT NULL DEFAULT 0 CHECK(fence>=0), permission_revision bigint NOT NULL CHECK(permission_revision>0),
 invalidation_revision bigint NOT NULL CHECK(invalidation_revision>=0),
 PRIMARY KEY(scope_id,cache_key),
 FOREIGN KEY(scope_id,policy_version_id) REFERENCES app.ai_reuse_scopes(id,policy_version_id) ON DELETE RESTRICT,
 FOREIGN KEY(artifact_id,scope_id,policy_version_id,cache_key) REFERENCES app.ai_artifacts(id,scope_id,policy_version_id,input_digest) ON DELETE RESTRICT,
 CHECK((lease_holder IS NULL)=(lease_until IS NULL)), CHECK((state='leased')=(lease_holder IS NOT NULL)),
 CHECK((artifact_id IS NULL)=(valid_until IS NULL)), CHECK(state<>'ready' OR artifact_id IS NOT NULL)
);
CREATE INDEX ai_reuse_expiry_idx ON app.ai_reuse_entries(valid_until,scope_id,cache_key) WHERE artifact_id IS NOT NULL;
CREATE INDEX ai_reuse_lease_idx ON app.ai_reuse_entries(lease_until,scope_id,cache_key) WHERE state='leased';
CREATE INDEX ai_reuse_artifact_idx ON app.ai_reuse_entries(artifact_id);
CREATE TABLE app.report_analysis_attachments (
 report_id uuid NOT NULL, report_version integer NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 artifact_id uuid NOT NULL, scope_id uuid NOT NULL,
 owner_subject_id uuid NOT NULL,
 selection_kind text NOT NULL CHECK(selection_kind IN ('owner','shared')),
 authorization_scope_id uuid NOT NULL,
 authorization_permission_revision bigint NOT NULL CHECK(authorization_permission_revision>0),
 authorization_subject_revision bigint NOT NULL CHECK(authorization_subject_revision>0),
 attached_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(report_id,report_version,revision), UNIQUE(report_id,report_version,revision,owner_subject_id),
 FOREIGN KEY(report_id,report_version) REFERENCES app.report_versions(report_id,version) ON DELETE RESTRICT,
 FOREIGN KEY(report_id,owner_subject_id) REFERENCES app.reports(id,owner_subject_id) ON DELETE RESTRICT,
 FOREIGN KEY(artifact_id,scope_id) REFERENCES app.ai_artifacts(id,scope_id) ON DELETE RESTRICT,
 FOREIGN KEY(authorization_scope_id,owner_subject_id) REFERENCES app.ai_reuse_scopes(id,owner_subject_id) ON DELETE RESTRICT
);
CREATE INDEX ai_attachment_artifact_idx ON app.report_analysis_attachments(artifact_id);
CREATE INDEX ai_attachment_owner_idx ON app.report_analysis_attachments(owner_subject_id,report_id,report_version,revision);
CREATE INDEX ai_attachment_authorization_idx ON app.report_analysis_attachments(authorization_scope_id);
ALTER TABLE email.email_sends ADD CONSTRAINT p2_ai_send_report_uq UNIQUE(id,owner_subject_id,report_id,report_version);
CREATE TABLE email.analysis_selections (
 send_id uuid PRIMARY KEY, owner_subject_id uuid NOT NULL, report_id uuid NOT NULL, report_version integer NOT NULL,
 mode text NOT NULL CHECK(mode IN ('artifact','none')), attachment_revision bigint,
 fallback_reason text CHECK(fallback_reason IN ('not_requested','unavailable','declined','expired')),
 frozen_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(send_id,owner_subject_id,report_id,report_version) REFERENCES email.email_sends(id,owner_subject_id,report_id,report_version) ON DELETE RESTRICT,
 FOREIGN KEY(report_id,report_version,attachment_revision,owner_subject_id) REFERENCES app.report_analysis_attachments(report_id,report_version,revision,owner_subject_id) ON DELETE RESTRICT,
 CHECK((mode='artifact' AND attachment_revision IS NOT NULL AND fallback_reason IS NULL) OR (mode='none' AND attachment_revision IS NULL AND fallback_reason IS NOT NULL))
);
CREATE INDEX ai_selection_attachment_idx ON email.analysis_selections(report_id,report_version,attachment_revision,owner_subject_id);

CREATE FUNCTION app.ai_guard_artifact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.ai_analysis_requests%ROWTYPE; a app.ai_attempts%ROWTYPE; g app.ai_scope_guards%ROWTYPE; p app.ai_policy_versions%ROWTYPE;
BEGIN
 r:=app.ai_assert_request(NEW.request_id,true);
 g:=app.ai_assert_scope(r.scope_id);
 SELECT * INTO a FROM app.ai_attempts WHERE id=NEW.attempt_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI artifact attempt must already exist' USING ERRCODE='23503'; END IF;
 SELECT * INTO p FROM app.ai_policy_versions WHERE id=NEW.policy_version_id;
 IF NOT FOUND OR r.state<>'accepted' OR a.state<>'succeeded' OR r.expires_at<=clock_timestamp()
  OR (NEW.scope_id,NEW.policy_version_id,NEW.input_digest,NEW.input_manifest) IS DISTINCT FROM (r.scope_id,r.policy_version_id,r.input_digest,r.input_manifest)
  OR (a.request_id,a.scope_id,a.policy_version_id) IS DISTINCT FROM (r.id,r.scope_id,r.policy_version_id)
  OR NEW.permission_revision<>g.permission_revision OR NEW.subject_permission_revision IS DISTINCT FROM g.subject_permission_revision
  OR NEW.invalidation_revision<>g.invalidation_revision OR NEW.validation_version<>p.validator_version
  OR NEW.created_xid<>pg_current_xact_id() OR NEW.generated_at>clock_timestamp()
  OR NEW.output_hash<>encode(sha256(convert_to(NEW.output::text,'UTF8')),'hex') OR (p.task<>'photo_extraction' AND NEW.source_count=0)
 THEN RAISE EXCEPTION 'AI artifact requires current accepted scoped validation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_artifact_guard BEFORE INSERT ON app.ai_artifacts FOR EACH ROW EXECUTE FUNCTION app.ai_guard_artifact();
CREATE TRIGGER ai_artifact_immutable BEFORE UPDATE ON app.ai_artifacts FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE TRIGGER ai_source_immutable BEFORE UPDATE ON app.ai_artifact_sources FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE FUNCTION app.ai_guard_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.ai_artifacts%ROWTYPE;
BEGIN
 SELECT * INTO a FROM app.ai_artifacts WHERE id=NEW.artifact_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI artifact must already exist' USING ERRCODE='23503'; END IF;
 IF a.created_xid<>pg_current_xact_id() OR NEW.rights_valid_until<a.valid_until THEN
  RAISE EXCEPTION 'AI source set is sealed with the artifact and bounds its validity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_source_guard BEFORE INSERT ON app.ai_artifact_sources FOR EACH ROW EXECUTE FUNCTION app.ai_guard_source();
CREATE FUNCTION app.ai_check_source_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM app.ai_artifacts a WHERE a.id=NEW.id AND (a.source_count<>(SELECT count(*) FROM app.ai_artifact_sources s WHERE s.artifact_id=a.id) OR NOT app.ai_artifact_current(a.id))) THEN
  RAISE EXCEPTION 'AI artifact source set is incomplete' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ai_artifact_source_count AFTER INSERT ON app.ai_artifacts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.ai_check_source_count();
CREATE FUNCTION app.ai_artifact_current(artifact uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.ai_artifacts a JOIN app.ai_reuse_scopes s ON s.id=a.scope_id
 JOIN app.ai_policy_versions p ON p.id=a.policy_version_id JOIN app.ai_scope_guards g ON g.scope_id=s.id
 LEFT JOIN app.subjects person ON person.id=s.owner_subject_id
 WHERE a.id=artifact AND a.valid_until>clock_timestamp() AND a.retain_until>clock_timestamp() AND p.status='active'
  AND a.source_count=(SELECT count(*) FROM app.ai_artifact_sources count_sources WHERE count_sources.artifact_id=a.id)
  AND g.state='active' AND g.processing_allowed AND (a.permission_revision,a.invalidation_revision)=(g.permission_revision,g.invalidation_revision)
  AND (s.kind='shared' OR (person.status='active' AND person.permission_revision=a.subject_permission_revision AND g.subject_permission_revision=person.permission_revision AND (person.expires_at IS NULL OR person.expires_at>clock_timestamp())))
  AND NOT EXISTS(SELECT 1 FROM app.ai_artifact_sources x
   LEFT JOIN app.advice_facts fact ON fact.id=x.advice_fact_id
   LEFT JOIN app.catalog_sources eligible ON eligible.dataset_id=coalesce(x.dataset_version_id,fact.dataset_version_id)
   WHERE x.artifact_id=a.id AND (x.rights_valid_until<=clock_timestamp() OR eligible.dataset_id IS NULL
    OR eligible.rights->'ai_processing' IS DISTINCT FROM 'true'::jsonb
    OR eligible.rights->'cache' IS DISTINCT FROM 'true'::jsonb OR eligible.rights->'derived' IS DISTINCT FROM 'true'::jsonb OR eligible.rights->'snapshot' IS DISTINCT FROM 'true'::jsonb
    OR eligible.expires_at<=clock_timestamp()
    OR (x.advice_fact_id IS NOT NULL AND (fact.status<>'reviewed' OR fact.review_due_at<=clock_timestamp())))))
$$;
CREATE FUNCTION app.ai_claim_reuse(scope uuid,key text,holder uuid,seconds integer DEFAULT 30) RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g app.ai_scope_guards%ROWTYPE; e app.ai_reuse_entries%ROWTYPE; policy uuid;
BEGIN
 IF holder IS NULL OR seconds IS NULL OR seconds NOT BETWEEN 1 AND 120 OR key IS NULL OR key !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Invalid bounded AI lease identity' USING ERRCODE='23514'; END IF;
 g:=app.ai_assert_scope(scope);
 SELECT policy_version_id INTO policy FROM app.ai_reuse_scopes WHERE id=scope;
 INSERT INTO app.ai_reuse_entries(scope_id,cache_key,policy_version_id,permission_revision,invalidation_revision)
 VALUES(scope,key,policy,g.permission_revision,g.invalidation_revision) ON CONFLICT DO NOTHING;
 SELECT * INTO e FROM app.ai_reuse_entries WHERE scope_id=scope AND cache_key=key FOR UPDATE;
 IF e.lease_until>clock_timestamp() THEN RETURN NULL; END IF;
 UPDATE app.ai_reuse_entries SET state='leased',lease_holder=holder,lease_until=clock_timestamp()+make_interval(secs=>seconds),fence=fence+1,
 permission_revision=g.permission_revision,invalidation_revision=g.invalidation_revision WHERE scope_id=scope AND cache_key=key RETURNING fence INTO e.fence;
 RETURN e.fence;
END $$;
CREATE FUNCTION app.ai_publish_reuse(scope uuid,key text,holder uuid,generation bigint,artifact uuid) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g app.ai_scope_guards%ROWTYPE; e app.ai_reuse_entries%ROWTYPE; a app.ai_artifacts%ROWTYPE;
BEGIN
 g:=app.ai_assert_scope(scope);
 SELECT * INTO e FROM app.ai_reuse_entries WHERE scope_id=scope AND cache_key=key FOR UPDATE;
 IF NOT FOUND OR e.state<>'leased' OR e.lease_holder IS DISTINCT FROM holder OR e.fence IS DISTINCT FROM generation OR e.lease_until<=clock_timestamp()
  OR (e.permission_revision,e.invalidation_revision)<>(g.permission_revision,g.invalidation_revision) THEN RETURN false; END IF;
 SELECT * INTO a FROM app.ai_artifacts WHERE id=artifact FOR SHARE;
 IF NOT FOUND OR (a.scope_id,a.input_digest) IS DISTINCT FROM (scope,key) OR NOT app.ai_artifact_current(a.id) THEN RETURN false; END IF;
 UPDATE app.ai_reuse_entries SET state='ready',artifact_id=a.id,valid_until=a.valid_until,lease_holder=NULL,lease_until=NULL WHERE scope_id=scope AND cache_key=key;
 RETURN true;
END $$;
CREATE FUNCTION app.ai_guard_attachment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.ai_artifacts%ROWTYPE; s app.ai_reuse_scopes%ROWTYPE; p app.ai_policy_versions%ROWTYPE; r app.reports%ROWTYPE; g app.ai_scope_guards%ROWTYPE; hash text; bundle uuid;
BEGIN
 g:=app.ai_assert_scope(NEW.authorization_scope_id);
 IF NOT EXISTS(SELECT 1 FROM app.ai_reuse_scopes WHERE id=NEW.authorization_scope_id AND owner_subject_id=NEW.owner_subject_id AND kind='owner')
  OR NEW.authorization_permission_revision<>g.permission_revision OR NEW.authorization_subject_revision IS DISTINCT FROM g.subject_permission_revision THEN
  RAISE EXCEPTION 'Shared AI cannot substitute for owner authorization' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM app.reports WHERE id=NEW.report_id FOR SHARE;
 IF NOT FOUND OR r.owner_subject_id<>NEW.owner_subject_id OR r.current_version<>NEW.report_version OR r.status<>'active' OR r.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'AI attachment needs current owner report version' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM app.ai_artifacts WHERE id=NEW.artifact_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI attachment artifact must already exist' USING ERRCODE='23503'; END IF;
 SELECT * INTO s FROM app.ai_reuse_scopes WHERE id=a.scope_id;
 PERFORM app.ai_assert_scope(s.id);
 SELECT * INTO p FROM app.ai_policy_versions WHERE id=a.policy_version_id;
 IF NEW.scope_id<>s.id OR NEW.selection_kind<>s.kind OR p.task='photo_extraction' OR NOT app.ai_artifact_current(a.id)
  OR (s.kind='owner' AND (s.owner_subject_id<>NEW.owner_subject_id OR NEW.authorization_scope_id<>s.id)) THEN
  RAISE EXCEPTION 'AI attachment scope/output is unavailable' USING ERRCODE='23514'; END IF;
 IF s.kind='owner' THEN
  SELECT snapshot_hash,bundle_id INTO hash,bundle FROM app.report_versions WHERE report_id=r.id AND version=NEW.report_version;
  IF a.input_manifest->>'authoritative_hash' IS DISTINCT FROM hash OR a.input_manifest->>'bundle_id' IS DISTINCT FROM bundle::text THEN
   RAISE EXCEPTION 'AI attachment authoritative report inputs differ' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_attachment_guard BEFORE INSERT ON app.report_analysis_attachments FOR EACH ROW EXECUTE FUNCTION app.ai_guard_attachment();
CREATE TRIGGER ai_attachment_immutable BEFORE UPDATE ON app.report_analysis_attachments FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE FUNCTION email.ai_guard_selection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s email.email_sends%ROWTYPE; x app.report_analysis_attachments%ROWTYPE; g app.ai_scope_guards%ROWTYPE; r app.reports%ROWTYPE;
BEGIN
 SELECT * INTO s FROM email.email_sends WHERE id=NEW.send_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI send must already exist' USING ERRCODE='23503'; END IF;
 IF (s.owner_subject_id,s.report_id,s.report_version) IS DISTINCT FROM (NEW.owner_subject_id,NEW.report_id,NEW.report_version)
  OR s.dispatch_state<>'scheduled' OR s.payload_asset_id IS NOT NULL OR s.claimed_at IS NOT NULL
  OR EXISTS(SELECT 1 FROM email.delivery_snapshots WHERE send_id=NEW.send_id) THEN
  RAISE EXCEPTION 'AI selection must precede frozen delivery and match its report owner' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM app.reports WHERE id=NEW.report_id FOR SHARE;
 IF NOT FOUND OR r.owner_subject_id<>NEW.owner_subject_id OR r.status<>'active' OR r.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'AI selection requires an available owner report at freeze time' USING ERRCODE='23514'; END IF;
 IF NEW.mode='artifact' THEN
  SELECT * INTO x FROM app.report_analysis_attachments WHERE report_id=NEW.report_id AND report_version=NEW.report_version AND revision=NEW.attachment_revision FOR SHARE;
  IF NOT FOUND OR x.owner_subject_id<>NEW.owner_subject_id THEN RAISE EXCEPTION 'AI selection attachment must already exist for owner' USING ERRCODE='23503'; END IF;
  g:=app.ai_assert_scope(x.authorization_scope_id);
  IF g.permission_revision<>x.authorization_permission_revision OR g.subject_permission_revision IS DISTINCT FROM x.authorization_subject_revision OR NOT app.ai_artifact_current(x.artifact_id) THEN
   RAISE EXCEPTION 'AI selection authorization/output is stale' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_selection_guard BEFORE INSERT ON email.analysis_selections FOR EACH ROW EXECUTE FUNCTION email.ai_guard_selection();
CREATE TRIGGER ai_selection_immutable BEFORE UPDATE ON email.analysis_selections FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE FUNCTION app.ai_can_read_artifact(artifact uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.ai_artifacts a WHERE a.id=artifact AND app.ai_owner_scope(a.scope_id) AND app.ai_artifact_current(a.id))
$$;
CREATE FUNCTION app.ai_attachment_readable(report uuid,version integer,revision bigint) RETURNS boolean
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.report_analysis_attachments x
 JOIN app.ai_scope_guards g ON g.scope_id=x.authorization_scope_id JOIN app.reports r ON r.id=x.report_id
 JOIN app.subjects person ON person.id=x.owner_subject_id
 WHERE (x.report_id,x.report_version,x.revision)=($1,$2,$3) AND person.id=app.ai_current_subject()
 AND person.status='active' AND person.permission_revision=x.authorization_subject_revision
 AND (person.expires_at IS NULL OR person.expires_at>clock_timestamp())
 AND g.state='active' AND g.processing_allowed AND g.permission_revision=x.authorization_permission_revision
 AND g.subject_permission_revision=x.authorization_subject_revision AND r.status='active' AND r.expires_at>clock_timestamp()
 AND app.ai_artifact_current(x.artifact_id))
$$;
CREATE VIEW app.ai_report_analysis WITH (security_barrier=true) AS
 SELECT x.report_id,x.report_version,x.revision,x.selection_kind,a.output,a.generated_at,a.valid_until
 FROM app.report_analysis_attachments x JOIN app.ai_artifacts a ON a.id=x.artifact_id
 WHERE x.owner_subject_id=app.ai_current_subject() AND app.ai_attachment_readable(x.report_id,x.report_version,x.revision);
CREATE VIEW app.ai_current_reuse WITH (security_barrier=true) AS
 SELECT e.scope_id,e.cache_key,e.policy_version_id,e.artifact_id,e.valid_until,e.fence,a.output
 FROM app.ai_reuse_entries e JOIN app.ai_artifacts a ON a.id=e.artifact_id JOIN app.ai_scope_guards g ON g.scope_id=e.scope_id
 WHERE e.state IN ('ready','leased') AND e.valid_until>clock_timestamp()
 AND (e.permission_revision,e.invalidation_revision)=(g.permission_revision,g.invalidation_revision)
 AND app.ai_artifact_current(a.id);

-- Fixed local AI role policies and grants.
ALTER TABLE app.ai_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_artifacts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_artifacts FROM PUBLIC;
CREATE POLICY ai_artifacts_owner ON app.ai_artifacts TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_artifacts_worker ON app.ai_artifacts TO tt_p2_ai_worker USING(true) WITH CHECK(true);
CREATE POLICY ai_artifacts_reader ON app.ai_artifacts FOR SELECT TO tt_p2_ai_runtime USING(app.ai_can_read_artifact(id));
ALTER TABLE app.ai_artifact_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_artifact_sources FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_artifact_sources FROM PUBLIC;
CREATE POLICY ai_artifact_sources_owner ON app.ai_artifact_sources TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_artifact_sources_worker ON app.ai_artifact_sources TO tt_p2_ai_worker USING(true) WITH CHECK(true);
ALTER TABLE app.ai_reuse_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_reuse_entries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_reuse_entries FROM PUBLIC;
CREATE POLICY ai_reuse_entries_owner ON app.ai_reuse_entries TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_reuse_entries_worker ON app.ai_reuse_entries TO tt_p2_ai_worker USING(true) WITH CHECK(true);
ALTER TABLE app.report_analysis_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.report_analysis_attachments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.report_analysis_attachments FROM PUBLIC;
CREATE POLICY report_analysis_attachments_owner ON app.report_analysis_attachments TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY report_analysis_attachments_worker ON app.report_analysis_attachments TO tt_p2_ai_worker USING(true) WITH CHECK(true);
CREATE POLICY report_analysis_attachments_reader ON app.report_analysis_attachments FOR SELECT TO tt_p2_ai_runtime USING(owner_subject_id=app.ai_current_subject() AND app.ai_owner_scope(authorization_scope_id));
ALTER TABLE email.analysis_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE email.analysis_selections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON email.analysis_selections FROM PUBLIC;
CREATE POLICY analysis_selections_owner ON email.analysis_selections TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY analysis_selections_worker ON email.analysis_selections TO tt_p2_ai_worker USING(true) WITH CHECK(true);
REVOKE ALL ON FUNCTION app.ai_guard_artifact() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_guard_source() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_check_source_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_artifact_current(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_claim_reuse(uuid,text,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_publish_reuse(uuid,text,uuid,bigint,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_guard_attachment() FROM PUBLIC;
REVOKE ALL ON FUNCTION email.ai_guard_selection() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_can_read_artifact(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_attachment_readable(uuid,integer,bigint) FROM PUBLIC;
GRANT SELECT,INSERT ON app.ai_artifacts,app.ai_artifact_sources,app.report_analysis_attachments,email.analysis_selections TO tt_p2_ai_worker;
GRANT SELECT ON app.ai_reuse_entries,app.ai_current_reuse TO tt_p2_ai_worker;
REVOKE ALL ON app.ai_report_analysis,app.ai_current_reuse FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_claim_reuse(uuid,text,uuid,integer),app.ai_publish_reuse(uuid,text,uuid,bigint,uuid) TO tt_p2_ai_worker;
GRANT EXECUTE ON FUNCTION app.ai_artifact_current(uuid) TO tt_p2_ai_worker;
GRANT SELECT(id,request_id,output,generated_at,valid_until) ON app.ai_artifacts TO tt_p2_ai_runtime;
GRANT SELECT(report_id,report_version,revision,selection_kind,attached_at) ON app.report_analysis_attachments TO tt_p2_ai_runtime;
GRANT EXECUTE ON FUNCTION app.ai_can_read_artifact(uuid),app.ai_attachment_readable(uuid,integer,bigint) TO tt_p2_ai_runtime;
GRANT SELECT ON app.ai_report_analysis TO tt_p2_ai_runtime;
