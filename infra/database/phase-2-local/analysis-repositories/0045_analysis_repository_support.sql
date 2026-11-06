-- Opt-in local S2 adapters only; no default manifest or production lifecycle change.
CREATE FUNCTION app.ai_repository_subject(owner uuid,active boolean) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.subjects%ROWTYPE;
BEGIN
 SELECT * INTO p FROM app.subjects WHERE id=owner FOR UPDATE;
 IF NOT FOUND OR (active AND (p.status<>'active' OR (p.expires_at IS NOT NULL AND p.expires_at<=clock_timestamp()))) THEN
  RAISE EXCEPTION 'Analysis owner unavailable' USING ERRCODE='23514'; END IF;
 RETURN p.permission_revision;
END $$;
CREATE FUNCTION app.ai_repository_scope(scope uuid,current boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s app.ai_reuse_scopes%ROWTYPE;
BEGIN
 SELECT * INTO s FROM app.ai_reuse_scopes WHERE id=scope;
 IF NOT FOUND THEN RAISE EXCEPTION 'Analysis scope missing' USING ERRCODE='23503'; END IF;
 IF s.owner_subject_id IS NOT NULL THEN PERFORM app.ai_repository_subject(s.owner_subject_id,current); END IF;
 PERFORM 1 FROM app.ai_policy_versions WHERE id=s.policy_version_id FOR SHARE;
 PERFORM 1 FROM app.ai_scope_guards WHERE scope_id=scope FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Analysis authority missing' USING ERRCODE='23503'; END IF;
 IF current THEN PERFORM app.ai_assert_scope(scope); END IF;
END $$;
CREATE FUNCTION app.ai_repository_budget_locks(windows uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE found_count integer;
BEGIN
 IF cardinality(windows) NOT BETWEEN 1 AND 3 OR array_position(windows,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Bounded analysis budgets required' USING ERRCODE='23514'; END IF;
 PERFORM id FROM app.ai_budget_windows WHERE id=ANY(windows) ORDER BY id FOR UPDATE;
 GET DIAGNOSTICS found_count=ROW_COUNT;
 IF found_count<>cardinality(windows) THEN RAISE EXCEPTION 'Analysis budget missing or duplicate' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION app.ai_repository_attachment_root(owner uuid,authorization_scope uuid,artifact_scope uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE expected integer;
BEGIN
 PERFORM app.ai_repository_subject(owner,true);
 IF NOT EXISTS(SELECT 1 FROM app.ai_reuse_scopes WHERE id=authorization_scope AND owner_subject_id=owner AND kind='owner')
  OR NOT EXISTS(SELECT 1 FROM app.ai_reuse_scopes WHERE id=artifact_scope AND (owner_subject_id IS NULL OR owner_subject_id=owner)) THEN
  RAISE EXCEPTION 'Analysis attachment owner mismatch' USING ERRCODE='23514'; END IF;
 PERFORM p.id FROM app.ai_policy_versions p WHERE id IN(SELECT policy_version_id FROM app.ai_reuse_scopes WHERE id IN(authorization_scope,artifact_scope)) ORDER BY p.id FOR SHARE;
 PERFORM scope_id FROM app.ai_scope_guards WHERE scope_id IN(authorization_scope,artifact_scope) ORDER BY scope_id FOR UPDATE;
 GET DIAGNOSTICS expected=ROW_COUNT;
 IF expected<>(CASE WHEN authorization_scope=artifact_scope THEN 1 ELSE 2 END) THEN RAISE EXCEPTION 'Analysis attachment authority missing' USING ERRCODE='23514'; END IF;
 PERFORM app.ai_assert_scope(authorization_scope); PERFORM app.ai_assert_scope(artifact_scope);
END $$;
CREATE FUNCTION app.ai_repository_report(owner uuid,report uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.ai_repository_subject(owner,true);
 PERFORM 1 FROM app.reports WHERE id=report AND owner_subject_id=owner AND status='active' AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Analysis report unavailable' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION app.ai_repository_send(owner uuid,send uuid,report uuid,version integer,revision bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.report_analysis_attachments%ROWTYPE;
BEGIN
 PERFORM app.ai_repository_subject(owner,true);
 IF revision IS NOT NULL THEN
  SELECT * INTO a FROM app.report_analysis_attachments WHERE report_id=report AND report_version=version AND report_analysis_attachments.revision=$5;
  IF NOT FOUND OR a.owner_subject_id<>owner THEN RAISE EXCEPTION 'Analysis attachment unavailable' USING ERRCODE='23514'; END IF;
  PERFORM app.ai_repository_attachment_root(owner,a.authorization_scope_id,a.scope_id);
 END IF;
 PERFORM 1 FROM email.email_sends WHERE id=send AND owner_subject_id=owner AND report_id=report AND report_version=version FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Analysis send unavailable' USING ERRCODE='23514'; END IF;
 PERFORM app.ai_repository_report(owner,report);
END $$;
CREATE FUNCTION app.ai_repository_affected(kind text,source uuid,after_scope uuid,page_size integer) RETURNS TABLE(scope_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF kind NOT IN('dataset','advice') OR page_size NOT BETWEEN 1 AND 101 THEN RAISE EXCEPTION 'Invalid source page' USING ERRCODE='23514'; END IF;
 RETURN QUERY SELECT DISTINCT a.scope_id FROM app.ai_artifact_sources x JOIN app.ai_artifacts a ON a.id=x.artifact_id
 LEFT JOIN app.advice_facts f ON f.id=x.advice_fact_id
 WHERE ((kind='dataset' AND (x.dataset_version_id=source OR f.dataset_version_id=source)) OR (kind='advice' AND x.advice_fact_id=source))
 AND (after_scope IS NULL OR a.scope_id>after_scope) ORDER BY a.scope_id LIMIT page_size;
END $$;
CREATE FUNCTION app.photo_repository_root(owner uuid,upload uuid,job uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u app.tire_photo_uploads%ROWTYPE;
BEGIN
 IF app.photo_subject() IS DISTINCT FROM owner THEN RAISE EXCEPTION 'Photo context mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO u FROM app.tire_photo_uploads WHERE id=upload AND owner_subject_id=owner;
 IF NOT FOUND THEN RAISE EXCEPTION 'Photo unavailable' USING ERRCODE='23514'; END IF;
 PERFORM app.ai_repository_scope(u.scope_id,false);
 IF job IS NOT NULL THEN
  PERFORM 1 FROM app.job_runs WHERE id=job AND job_type='p2.photo.extract' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Photo job unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM 1 FROM app.tire_photo_uploads WHERE id=upload AND owner_subject_id=owner FOR UPDATE;
END $$;
CREATE FUNCTION app.photo_repository_cancel(owner uuid,extraction uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e app.photo_extractions%ROWTYPE;
BEGIN
 SELECT * INTO e FROM app.photo_extractions WHERE id=extraction AND owner_subject_id=owner;
 IF NOT FOUND THEN RAISE EXCEPTION 'Photo extraction unavailable' USING ERRCODE='23514'; END IF;
 PERFORM app.photo_repository_root(owner,e.upload_id,e.job_id);
 IF e.state='cancelled' THEN RETURN; END IF;
 IF e.state NOT IN('queued','processing') THEN RAISE EXCEPTION 'Photo extraction terminal' USING ERRCODE='23514'; END IF;
 UPDATE app.ai_analysis_requests SET state=CASE WHEN state='running' THEN 'uncertain' ELSE 'cancelled' END WHERE id=e.request_id AND state IN('queued','running');
 UPDATE app.ai_attempts SET state=CASE WHEN state='created' THEN 'cancelled' ELSE 'uncertain' END WHERE request_id=e.request_id AND state IN('created','started');
 UPDATE app.ai_budget_reservations b SET state='uncertain' FROM app.ai_attempts a WHERE b.attempt_id=a.id AND a.request_id=e.request_id AND a.started_at IS NOT NULL AND b.state='reserved';
 UPDATE app.job_runs SET state='cancelled',lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=e.job_id AND state NOT IN('completed','cancelled');
 UPDATE app.photo_extractions SET state='cancelled' WHERE id=e.id;
 IF app.photo_current(e.upload_id) THEN UPDATE app.tire_photo_uploads SET state='ready' WHERE id=e.upload_id AND state='processing'; END IF;
END $$;

REVOKE ALL ON FUNCTION app.ai_repository_subject(uuid,boolean),app.ai_repository_scope(uuid,boolean),app.ai_repository_budget_locks(uuid[]),app.ai_repository_attachment_root(uuid,uuid,uuid),app.ai_repository_report(uuid,uuid),app.ai_repository_send(uuid,uuid,uuid,integer,bigint),app.ai_repository_affected(text,uuid,uuid,integer),app.photo_repository_root(uuid,uuid,uuid),app.photo_repository_cancel(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_repository_subject(uuid,boolean),app.ai_repository_scope(uuid,boolean) TO tt_p2_ai_worker,tt_p2_ai_staff;
GRANT EXECUTE ON FUNCTION app.ai_repository_subject(uuid,boolean) TO tt_p2_photo_worker;
GRANT EXECUTE ON FUNCTION app.ai_repository_budget_locks(uuid[]),app.ai_repository_attachment_root(uuid,uuid,uuid),app.ai_repository_report(uuid,uuid),app.ai_repository_send(uuid,uuid,uuid,integer,bigint),app.ai_repository_affected(text,uuid,uuid,integer) TO tt_p2_ai_worker;
GRANT EXECUTE ON FUNCTION app.photo_repository_root(uuid,uuid,uuid) TO tt_p2_photo_worker,tt_p2_photo_runtime;
GRANT EXECUTE ON FUNCTION app.photo_repository_cancel(uuid,uuid) TO tt_p2_photo_worker;
GRANT SELECT(saved_at) ON app.tire_photo_uploads TO tt_p2_photo_runtime;

GRANT USAGE ON SCHEMA app TO tt_p2_photo_assets;
GRANT SELECT,INSERT ON app.object_assets TO tt_p2_photo_assets;
GRANT UPDATE(state,object_version,updated_at,revision,deleted_at) ON app.object_assets TO tt_p2_photo_assets;
CREATE POLICY photo_repository_assets ON app.object_assets TO tt_p2_photo_assets
 USING(purpose IN('tire_photo_original','tire_photo_sanitized')) WITH CHECK(purpose IN('tire_photo_original','tire_photo_sanitized'));

CREATE VIEW admin.csv_repository_evidence WITH(security_barrier=true) AS
 SELECT i.id AS intake_id,a.kind,a.id AS artifact_id,o.id,o.revision,o.object_key,o.mime_type,o.sha256,o.size_bytes,o.object_version,o.state
 FROM admin.csv_intakes i JOIN app.import_artifacts a ON a.run_id=i.run_id JOIN app.object_assets o ON o.id=a.asset_id
 WHERE admin.csv_staff_current(admin.csv_actor()) AND admin.csv_intake_current(i.id)
 AND a.kind IN('diff','validation') AND admin.csv_asset_current(o.id,a.expires_at) AND a.checksum=o.sha256;
GRANT SELECT ON admin.csv_repository_evidence TO tt_p2_csv_staff;

-- Verified P1 rights lease only. Subject roots precede the work row, as in P1.
CREATE FUNCTION privacy.analysis_repository_fence(request uuid,token uuid,generation bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE person uuid;
BEGIN
 SELECT r.subject_id INTO person FROM privacy.privacy_requests r JOIN privacy.request_work w ON w.request_id=r.id
 WHERE r.id=request AND r.kind IN('delete','restrict') AND r.verified_at IS NOT NULL AND r.status IN('verified','processing')
 AND w.target_kind='subject' AND w.target_id=r.subject_id;
 IF person IS NULL THEN RAISE EXCEPTION 'Analysis rights owner unavailable' USING ERRCODE='23514'; END IF;
 PERFORM app.ai_repository_subject(person,false);
 PERFORM 1 FROM privacy.request_work w WHERE w.request_id=request AND w.lease_token=token AND w.lease_generation=generation
 AND w.lease_until>clock_timestamp() AND w.barrier_until<=clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM privacy.fulfillment_steps f WHERE f.request_id=request AND f.store='journal' AND f.status='completed') THEN
 RAISE EXCEPTION 'Current journaled P1 rights lease required' USING ERRCODE='23514'; END IF;
 RETURN person;
END $$;
CREATE FUNCTION privacy.analysis_repository_restrict(request uuid,token uuid,generation bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE person uuid; scope_row record;
BEGIN
 person:=privacy.analysis_repository_fence(request,token,generation);
 IF (SELECT count(*) FROM (SELECT id FROM app.ai_reuse_scopes WHERE owner_subject_id=person LIMIT 101) b)>100 THEN
 RAISE EXCEPTION 'Analysis restriction requires bounded operator recovery' USING ERRCODE='54000'; END IF;
 IF (SELECT count(*) FROM (
 SELECT id FROM app.ai_analysis_requests WHERE owner_subject_id=person UNION ALL SELECT a.id FROM app.ai_attempts a JOIN app.ai_analysis_requests r ON r.id=a.request_id WHERE r.owner_subject_id=person
 UNION ALL SELECT b.id FROM app.ai_budget_reservations b JOIN app.ai_attempts a ON a.id=b.attempt_id JOIN app.ai_analysis_requests r ON r.id=a.request_id WHERE r.owner_subject_id=person
 UNION ALL SELECT id FROM app.tire_photo_uploads WHERE owner_subject_id=person UNION ALL SELECT id FROM app.photo_extractions WHERE owner_subject_id=person
 UNION ALL SELECT asset_id FROM app.photo_asset_claims WHERE owner_subject_id=person LIMIT 1001) bounded)>1000 THEN
 RAISE EXCEPTION 'Analysis restriction requires bounded operator recovery' USING ERRCODE='54000'; END IF;
 FOR scope_row IN SELECT id FROM app.ai_reuse_scopes WHERE owner_subject_id=person ORDER BY id LOOP PERFORM app.ai_repository_scope(scope_row.id,false); END LOOP;
 UPDATE app.ai_analysis_requests SET state=CASE WHEN state='running' THEN 'uncertain' ELSE 'cancelled' END
 WHERE owner_subject_id=person AND state IN('queued','running');
 UPDATE app.ai_attempts a SET state=CASE WHEN a.state='started' THEN 'uncertain' ELSE 'cancelled' END
 FROM app.ai_analysis_requests r WHERE r.id=a.request_id AND r.owner_subject_id=person AND a.state IN('created','started');
 UPDATE app.ai_budget_reservations b SET state='uncertain' FROM app.ai_attempts a,app.ai_analysis_requests r
 WHERE b.attempt_id=a.id AND a.request_id=r.id AND r.owner_subject_id=person AND a.started_at IS NOT NULL AND b.state='reserved';
 UPDATE app.job_runs j SET state='cancelled',lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=clock_timestamp()
 WHERE j.id IN(SELECT job_id FROM app.photo_extractions WHERE owner_subject_id=person) AND j.state NOT IN('completed','cancelled');
 UPDATE app.photo_extractions SET state='cancelled' WHERE owner_subject_id=person AND state IN('queued','processing');
 UPDATE app.ai_scope_guards g SET state='withdrawn',processing_allowed=false,permission_revision=permission_revision+1,updated_at=clock_timestamp()
 FROM app.ai_reuse_scopes s WHERE s.id=g.scope_id AND s.owner_subject_id=person AND (g.state='active' OR g.processing_allowed);
 IF EXISTS(SELECT 1 FROM privacy.privacy_requests WHERE id=request AND kind='delete') THEN
 UPDATE app.tire_photo_uploads SET state='deleting',deletion_request_id=request WHERE owner_subject_id=person AND state NOT IN('deleting','deleted');
 INSERT INTO privacy.asset_barriers(asset_id) SELECT asset_id FROM app.photo_asset_claims WHERE owner_subject_id=person ON CONFLICT DO NOTHING;
 UPDATE app.object_assets SET state='deleting',revision=revision+1,updated_at=clock_timestamp()
 WHERE id IN(SELECT asset_id FROM app.photo_asset_claims WHERE owner_subject_id=person) AND state NOT IN('deleting','deleted');
 END IF;
END $$;
CREATE FUNCTION privacy.analysis_repository_hold(person uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM privacy.legal_holds h WHERE h.released_at IS NULL AND
 (h.subject_id=person OR h.resource_id IN(SELECT id FROM app.ai_reuse_scopes WHERE owner_subject_id=person)
 OR h.resource_id IN(SELECT id FROM app.tire_photo_uploads WHERE owner_subject_id=person)
 OR h.resource_id IN(SELECT asset_id FROM app.photo_asset_claims WHERE owner_subject_id=person)
 OR h.resource_id IN(SELECT id FROM app.ai_analysis_requests WHERE owner_subject_id=person)
 OR h.resource_id IN(SELECT a.id FROM app.ai_artifacts a JOIN app.ai_reuse_scopes s ON s.id=a.scope_id WHERE s.owner_subject_id=person)
 OR h.resource_id IN(SELECT id FROM app.ai_attempts WHERE scope_id IN(SELECT id FROM app.ai_reuse_scopes WHERE owner_subject_id=person))
 OR h.resource_id IN(SELECT id FROM app.photo_extractions WHERE owner_subject_id=person)
 OR h.resource_id IN(SELECT id FROM app.photo_field_candidates WHERE owner_subject_id=person)
 OR h.resource_id IN(SELECT id FROM app.ai_budget_reservations WHERE attempt_id IN(SELECT id FROM app.ai_attempts WHERE scope_id IN(SELECT id FROM app.ai_reuse_scopes WHERE owner_subject_id=person)))
 OR h.resource_id IN(SELECT id FROM privacy.contacts WHERE subject_id=person)
 OR h.resource_id IN(SELECT id FROM email.email_sends WHERE owner_subject_id=person OR recipient_contact_id IN(SELECT id FROM privacy.contacts WHERE subject_id=person))
 OR h.resource_id IN(SELECT id FROM app.reports WHERE owner_subject_id=person)))
$$;
CREATE FUNCTION privacy.analysis_repository_assets(request uuid,token uuid,generation bigint,after_id uuid,page_size integer)
RETURNS SETOF app.object_assets LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE person uuid;
BEGIN
 person:=privacy.analysis_repository_fence(request,token,generation);
 IF page_size NOT BETWEEN 1 AND 101 OR NOT EXISTS(SELECT 1 FROM privacy.privacy_requests WHERE id=request AND kind='delete') OR privacy.analysis_repository_hold(person) OR EXISTS(SELECT 1 FROM privacy.legal_holds WHERE resource_id=request AND released_at IS NULL) THEN
 RAISE EXCEPTION 'Analysis object erasure unavailable' USING ERRCODE='23514'; END IF;
 RETURN QUERY SELECT a.* FROM app.object_assets a JOIN app.photo_asset_claims c ON c.asset_id=a.id
 WHERE c.owner_subject_id=person AND a.state IN('deleting','deleted') AND (after_id IS NULL OR a.id>after_id)
 AND NOT EXISTS(SELECT 1 FROM privacy.erasure_receipts e WHERE e.request_id=request AND e.store='objects' AND e.resource_id=a.id)
 ORDER BY a.id LIMIT page_size;
END $$;
CREATE FUNCTION privacy.analysis_repository_erase(request uuid,token uuid,generation bigint,scope uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE person uuid;
BEGIN
 person:=privacy.analysis_repository_fence(request,token,generation);
 IF NOT EXISTS(SELECT 1 FROM privacy.privacy_requests WHERE id=request AND kind='delete') OR privacy.analysis_repository_hold(person) OR EXISTS(SELECT 1 FROM privacy.legal_holds WHERE resource_id=request AND released_at IS NULL) THEN
 RAISE EXCEPTION 'Analysis SQL erasure unavailable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.ai_reuse_scopes WHERE id=scope) THEN RETURN true; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.ai_reuse_scopes WHERE id=scope AND owner_subject_id=person) THEN RAISE EXCEPTION 'Analysis erasure scope mismatch' USING ERRCODE='23514'; END IF;
 PERFORM app.ai_repository_scope(scope,false);
 IF EXISTS(SELECT 1 FROM app.ai_scope_guards WHERE scope_id=scope AND (state='active' OR processing_allowed)) THEN RAISE EXCEPTION 'Restrict analysis before SQL erasure' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.ai_budget_reservations b JOIN app.ai_attempts a ON a.id=b.attempt_id WHERE a.scope_id=scope AND b.state IN('reserved','uncertain')) THEN
 RAISE EXCEPTION 'Resolve analysis charges before SQL erasure' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM app.photo_asset_claims c JOIN app.tire_photo_uploads u ON u.id=c.upload_id JOIN app.object_assets a ON a.id=c.asset_id
 WHERE u.scope_id=scope AND (a.state<>'deleted' OR NOT EXISTS(SELECT 1 FROM privacy.erasure_receipts e WHERE e.request_id=request AND e.store='objects' AND e.resource_id=a.id))) THEN
 RAISE EXCEPTION 'P1 object receipts required before analysis SQL erasure' USING ERRCODE='23514'; END IF;
 -- Fail closed for large graphs; a future approved batch executor must design cursor durability.
 IF (SELECT count(*) FROM (
 SELECT id FROM app.ai_analysis_requests WHERE scope_id=scope UNION ALL SELECT id FROM app.ai_attempts WHERE scope_id=scope
 UNION ALL SELECT id FROM app.ai_artifacts WHERE scope_id=scope UNION ALL SELECT x.artifact_id FROM app.ai_artifact_sources x JOIN app.ai_artifacts a ON a.id=x.artifact_id WHERE a.scope_id=scope
 UNION ALL SELECT b.id FROM app.ai_budget_reservations b JOIN app.ai_attempts a ON a.id=b.attempt_id WHERE a.scope_id=scope
 UNION ALL SELECT scope_id FROM app.ai_reuse_entries WHERE scope_id=scope
 UNION ALL SELECT report_id FROM app.report_analysis_attachments WHERE scope_id=scope OR authorization_scope_id=scope
 UNION ALL SELECT z.send_id FROM email.analysis_selections z JOIN app.report_analysis_attachments a ON (a.report_id,a.report_version,a.revision)=(z.report_id,z.report_version,z.attachment_revision) WHERE a.scope_id=scope OR a.authorization_scope_id=scope
 UNION ALL SELECT id FROM app.tire_photo_uploads WHERE scope_id=scope
 UNION ALL SELECT e.id FROM app.photo_extractions e JOIN app.tire_photo_uploads u ON u.id=e.upload_id WHERE u.scope_id=scope
 UNION ALL SELECT c.asset_id FROM app.photo_asset_claims c JOIN app.tire_photo_uploads u ON u.id=c.upload_id WHERE u.scope_id=scope
 UNION ALL SELECT c.upload_id FROM app.confirmed_photo_fields c JOIN app.tire_photo_uploads u ON u.id=c.upload_id WHERE u.scope_id=scope
 UNION ALL SELECT c.id FROM app.photo_field_candidates c JOIN app.tire_photo_uploads u ON u.id=c.upload_id WHERE u.scope_id=scope
 LIMIT 1001) bounded)>1000 THEN RAISE EXCEPTION 'Analysis graph requires bounded operator recovery' USING ERRCODE='54000'; END IF;
 DELETE FROM email.analysis_selections z WHERE z.owner_subject_id=person AND (z.report_id,z.report_version,z.attachment_revision) IN
 (SELECT report_id,report_version,revision FROM app.report_analysis_attachments WHERE scope_id=scope OR authorization_scope_id=scope);
 DELETE FROM app.report_analysis_attachments WHERE scope_id=scope OR authorization_scope_id=scope;
 DELETE FROM app.confirmed_photo_fields WHERE upload_id IN(SELECT id FROM app.tire_photo_uploads WHERE scope_id=scope);
 DELETE FROM app.photo_field_candidates WHERE upload_id IN(SELECT id FROM app.tire_photo_uploads WHERE scope_id=scope);
 DELETE FROM app.photo_extractions WHERE upload_id IN(SELECT id FROM app.tire_photo_uploads WHERE scope_id=scope);
 DELETE FROM app.photo_asset_claims WHERE upload_id IN(SELECT id FROM app.tire_photo_uploads WHERE scope_id=scope);
 DELETE FROM app.tire_photo_uploads WHERE scope_id=scope;
 DELETE FROM app.ai_reuse_entries WHERE scope_id=scope;
 DELETE FROM app.ai_artifact_sources WHERE artifact_id IN(SELECT id FROM app.ai_artifacts WHERE scope_id=scope);
 DELETE FROM app.ai_artifacts WHERE scope_id=scope;
 -- Terminal reservation deletion intentionally preserves historical spent counters (0043).
 DELETE FROM app.ai_budget_reservations WHERE attempt_id IN(SELECT id FROM app.ai_attempts WHERE scope_id=scope);
 DELETE FROM app.ai_attempts WHERE scope_id=scope;
 DELETE FROM app.ai_analysis_requests WHERE scope_id=scope;
 DELETE FROM app.ai_scope_guards WHERE scope_id=scope;
 DELETE FROM app.ai_reuse_scopes WHERE id=scope;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION privacy.analysis_repository_fence(uuid,uuid,bigint),privacy.analysis_repository_restrict(uuid,uuid,bigint),privacy.analysis_repository_hold(uuid),privacy.analysis_repository_assets(uuid,uuid,bigint,uuid,integer),privacy.analysis_repository_erase(uuid,uuid,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy.analysis_repository_restrict(uuid,uuid,bigint),privacy.analysis_repository_assets(uuid,uuid,bigint,uuid,integer),privacy.analysis_repository_erase(uuid,uuid,bigint,uuid) TO tt_privacy_runtime;
