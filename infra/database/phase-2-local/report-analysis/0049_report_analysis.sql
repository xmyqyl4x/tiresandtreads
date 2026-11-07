-- Opt-in local report services. A trusted server capability; no production role/CLI change.
CREATE TABLE app.ai_report_work (
 request_id uuid PRIMARY KEY REFERENCES app.ai_analysis_requests(id) ON DELETE RESTRICT,
 owner_subject_id uuid NOT NULL REFERENCES app.subjects(id) ON DELETE RESTRICT,
 report_id uuid NOT NULL, report_version integer NOT NULL,
 expected_attachment bigint NOT NULL CHECK(expected_attachment>=0),
 job_id uuid UNIQUE REFERENCES app.job_runs(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 FOREIGN KEY(report_id,report_version) REFERENCES app.report_versions(report_id,version) ON DELETE RESTRICT
);
CREATE INDEX ai_report_work_owner_idx ON app.ai_report_work(owner_subject_id,request_id);
CREATE INDEX ai_report_work_report_idx ON app.ai_report_work(report_id,report_version,request_id);
ALTER TABLE app.ai_report_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_report_work FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_report_work_owner ON app.ai_report_work TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_report_work_service ON app.ai_report_work TO tt_p2_analysis_service USING(true) WITH CHECK(true);
REVOKE ALL ON app.ai_report_work FROM PUBLIC;
GRANT SELECT,INSERT ON app.ai_report_work TO tt_p2_analysis_service;
GRANT UPDATE(job_id) ON app.ai_report_work TO tt_p2_analysis_service;

CREATE FUNCTION app.ai_service_owner(keys jsonb) RETURNS TABLE(session_id uuid,subject_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE matches uuid[]; who uuid; token uuid;
BEGIN
 IF jsonb_typeof(keys)<>'array' OR jsonb_array_length(keys) NOT BETWEEN 1 AND 4 OR EXISTS(
 SELECT 1 FROM jsonb_array_elements(keys) k WHERE jsonb_typeof(k)<>'object' OR NOT (k ?& ARRAY['key_version','digest']) OR k-ARRAY['key_version','digest']<>'{}' OR k->>'key_version' !~ '^[A-Za-z0-9_-]{1,100}$' OR k->>'digest' !~ '^[a-f0-9]{64}$') THEN
 RAISE EXCEPTION 'Bounded owner keys required' USING ERRCODE='23514';END IF;
 SELECT array_agg(o.id) INTO matches FROM app.owner_sessions o JOIN app.subjects p ON p.id=o.subject_id
 JOIN jsonb_to_recordset(keys) k(key_version text,digest text) ON o.key_version=k.key_version AND o.token_hash=decode(k.digest,'hex')
 WHERE o.revoked_at IS NULL AND o.expires_at>clock_timestamp() AND p.status='active' AND (p.expires_at IS NULL OR p.expires_at>clock_timestamp());
 IF cardinality(matches) IS DISTINCT FROM 1 THEN RETURN;END IF;
 token:=matches[1];SELECT o.subject_id INTO who FROM app.owner_sessions o WHERE o.id=token;
 PERFORM app.ai_repository_subject(who,true);
 PERFORM 1 FROM app.owner_sessions o WHERE o.id=token AND o.revoked_at IS NULL AND o.expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RETURN;END IF;
 RETURN QUERY SELECT token,who;
END $$;

CREATE FUNCTION app.ai_service_evidence(person uuid,report uuid,version integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v app.report_versions%ROWTYPE; r app.reports%ROWTYPE; refs jsonb; sources jsonb; subject_revision bigint;
BEGIN
 subject_revision:=app.ai_repository_subject(person,true);
 SELECT * INTO r FROM app.reports WHERE id=report AND owner_subject_id=person AND current_version=version AND status='active' AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO v FROM app.report_versions WHERE report_id=report AND report_versions.version=$3;
 IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM 1 FROM app.market_dataset_heads WHERE market=r.market AND bundle_id=v.bundle_id FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM app.rule_versions WHERE id=v.rule_version_id AND status='published' AND reviewed_at IS NOT NULL) THEN RETURN NULL;END IF;
 refs:=v.output_snapshot->'evidence'->'sources';
 IF jsonb_typeof(refs) IS DISTINCT FROM 'array' OR jsonb_array_length(refs) NOT BETWEEN 1 AND 16 THEN RETURN NULL;END IF;
 PERFORM p.id FROM app.data_providers p WHERE p.id IN(SELECT provider_id FROM app.dataset_versions WHERE id IN(SELECT (x->>'datasetId')::uuid FROM jsonb_array_elements(refs) x)) ORDER BY p.id FOR SHARE;
 PERFORM l.id FROM app.data_licenses l WHERE l.id IN(SELECT license_id FROM app.dataset_versions WHERE id IN(SELECT (x->>'datasetId')::uuid FROM jsonb_array_elements(refs) x)) ORDER BY l.id FOR SHARE;
 PERFORM d.id FROM app.dataset_versions d WHERE d.id IN(SELECT (x->>'datasetId')::uuid FROM jsonb_array_elements(refs) x) ORDER BY d.id FOR SHARE;
 SELECT jsonb_agg(jsonb_build_object('id',s."datasetId",'validUntil',least(s."validUntil",eligible.expires_at,r.expires_at)) ORDER BY s."datasetId") INTO sources
 FROM jsonb_to_recordset(refs) s("datasetId" uuid,"validUntil" timestamptz)
 JOIN app.catalog_members member ON member.bundle_id=v.bundle_id AND member.market=r.market AND member.dataset_version_id=s."datasetId"
 JOIN app.catalog_sources eligible ON eligible.dataset_id=s."datasetId" AND eligible.market=r.market
 WHERE s."validUntil">clock_timestamp() AND eligible.rights->'ai_processing'='true'::jsonb AND eligible.rights->'cache'='true'::jsonb AND eligible.rights->'derived'='true'::jsonb AND eligible.rights->'snapshot'='true'::jsonb;
 IF sources IS NULL OR jsonb_array_length(sources)<>jsonb_array_length(refs) THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('market',r.market,'locale',r.locale,'snapshotHash',v.snapshot_hash,'bundleId',v.bundle_id,'ruleVersion',v.rule_version_id,'engineVersion',v.engine_version,'input',v.input_snapshot,'output',v.output_snapshot,'sources',sources,'subjectRevision',subject_revision::text,'attachmentRevision',(SELECT coalesce(max(revision),0)::text FROM app.report_analysis_attachments WHERE report_id=report AND report_version=version));
END $$;

CREATE FUNCTION app.ai_service_work_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.ai_analysis_requests%ROWTYPE; evidence jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
 IF (to_jsonb(NEW)-'job_id') IS DISTINCT FROM (to_jsonb(OLD)-'job_id') OR OLD.job_id IS NOT NULL OR NEW.job_id IS NULL THEN RAISE EXCEPTION 'Analysis work identity immutable' USING ERRCODE='23514';END IF;
 ELSE
 SELECT * INTO r FROM app.ai_analysis_requests WHERE id=NEW.request_id;
 IF NOT FOUND OR r.owner_subject_id IS DISTINCT FROM NEW.owner_subject_id OR r.state<>'queued' OR NEW.job_id IS NOT NULL THEN RAISE EXCEPTION 'Analysis work owner mismatch' USING ERRCODE='23514';END IF;
 PERFORM app.ai_repository_scope(r.scope_id,true);
 evidence:=app.ai_service_evidence(NEW.owner_subject_id,NEW.report_id,NEW.report_version);
 IF evidence IS NULL OR r.input_manifest->>'authoritative_hash' IS DISTINCT FROM evidence->>'snapshotHash' OR r.input_manifest->>'bundle_id' IS DISTINCT FROM evidence->>'bundleId' OR NEW.expected_attachment::text IS DISTINCT FROM evidence->>'attachmentRevision'
 OR NOT EXISTS(SELECT 1 FROM app.ai_policy_versions WHERE id=r.policy_version_id AND task='report_analysis' AND status='active') THEN RAISE EXCEPTION 'Analysis work evidence mismatch' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.job_runs WHERE id=NEW.job_id AND job_type='ai.report-analysis' AND resource_id=NEW.request_id AND schema_version=1) THEN RAISE EXCEPTION 'Analysis job binding mismatch' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_report_work_identity BEFORE INSERT OR UPDATE ON app.ai_report_work FOR EACH ROW EXECUTE FUNCTION app.ai_service_work_guard();

CREATE FUNCTION app.ai_service_current(request uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.ai_analysis_requests%ROWTYPE; w app.ai_report_work%ROWTYPE; e jsonb;
BEGIN
 SELECT * INTO r FROM app.ai_analysis_requests WHERE id=request;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM app.ai_repository_scope(r.scope_id,false);
 IF NOT EXISTS(SELECT 1 FROM app.ai_scope_guards g JOIN app.subjects p ON p.id=r.owner_subject_id JOIN app.ai_policy_versions policy ON policy.id=r.policy_version_id WHERE g.scope_id=r.scope_id AND g.state='active' AND g.processing_allowed AND policy.status='active' AND g.permission_revision=r.permission_revision AND g.invalidation_revision=r.invalidation_revision AND p.permission_revision=r.subject_permission_revision AND p.status='active' AND g.subject_permission_revision=p.permission_revision) THEN RETURN false;END IF;
 SELECT * INTO w FROM app.ai_report_work WHERE request_id=request;
 IF NOT FOUND THEN RETURN false;END IF;
 e:=app.ai_service_evidence(w.owner_subject_id,w.report_id,w.report_version);
 RETURN e IS NOT NULL AND r.input_manifest->>'authoritative_hash'=e->>'snapshotHash' AND r.input_manifest->>'bundle_id'=e->>'bundleId';
END $$;
CREATE FUNCTION app.ai_service_withdraw(scope uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE affected uuid[];
BEGIN
 PERFORM app.ai_repository_scope(scope,false);
 IF NOT EXISTS(SELECT 1 FROM app.ai_scope_guards WHERE scope_id=scope AND NOT processing_allowed AND state='withdrawn') THEN RAISE EXCEPTION 'Processing choice must be withdrawn first' USING ERRCODE='23514';END IF;
 SELECT array_agg(id ORDER BY id) INTO affected FROM (SELECT id FROM app.ai_analysis_requests WHERE scope_id=scope AND state IN('queued','running') LIMIT 1001) a;
 IF cardinality(affected)>1000 THEN RAISE EXCEPTION 'Bounded withdrawal required' USING ERRCODE='54000';END IF;
 PERFORM app.ai_repository_uncertain_budgets(coalesce(affected,'{}'::uuid[]));
 UPDATE app.ai_analysis_requests SET state=CASE WHEN state='running' THEN 'uncertain' ELSE 'cancelled' END WHERE id=ANY(affected);
 UPDATE app.ai_attempts SET state=CASE WHEN state='started' THEN 'uncertain' ELSE 'cancelled' END WHERE request_id=ANY(affected) AND state IN('created','started');
 UPDATE app.job_runs SET state='cancelled',revision=revision+1,updated_at=clock_timestamp() WHERE id IN(SELECT job_id FROM app.ai_report_work WHERE request_id=ANY(affected)) AND state IN('pending','failed');
END $$;
REVOKE ALL ON FUNCTION app.ai_service_owner(jsonb),app.ai_service_evidence(uuid,uuid,integer),app.ai_service_work_guard(),app.ai_service_current(uuid),app.ai_service_withdraw(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_service_owner(jsonb),app.ai_service_evidence(uuid,uuid,integer),app.ai_service_current(uuid),app.ai_service_withdraw(uuid) TO tt_p2_analysis_service;
-- Only these local jobs are admitted to the trusted service capability.
GRANT SELECT,INSERT,UPDATE ON app.job_runs TO tt_p2_analysis_service;
CREATE POLICY ai_service_jobs ON app.job_runs TO tt_p2_analysis_service USING(job_type='ai.report-analysis') WITH CHECK(job_type='ai.report-analysis' AND resource_id IN(SELECT request_id FROM app.ai_report_work));
