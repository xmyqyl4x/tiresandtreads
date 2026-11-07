-- Opt-in local AI/photo rights and frozen presentation composition. No promotion/default activation.
CREATE TABLE privacy.ai_scope_marks(scope_hash text PRIMARY KEY CHECK(scope_hash ~ '^[a-f0-9]{64}$'),denied_through bigint NOT NULL CHECK(denied_through>0),permanent boolean NOT NULL,changed_at timestamptz NOT NULL DEFAULT statement_timestamp());
CREATE FUNCTION privacy.ai_scope_hash(scope uuid) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT encode(sha256(convert_to('ai-scope-v1:'||scope::text,'UTF8')),'hex') $$;
CREATE TABLE privacy.ai_erasure_jobs(
 id uuid PRIMARY KEY,linked_request uuid UNIQUE REFERENCES privacy.privacy_requests(id),command_hash text UNIQUE CHECK(command_hash ~ '^[a-f0-9]{64}$'),
 owner_id uuid REFERENCES app.subjects(id),target_id uuid,kind text NOT NULL CHECK(kind IN('scope','subject','report')),
 phase text NOT NULL CHECK(phase IN('journal','prepare','objects','providers','sql','done','blocked')),cursor_id uuid,
 failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 5),blocked_phase text,journal_record jsonb, journal_digest text CHECK(journal_digest ~ '^[a-f0-9]{64}$'),lease_token uuid,lease_generation bigint NOT NULL DEFAULT 0 CHECK(lease_generation>=0),lease_until timestamptz,
 inflight_kind text CHECK(inflight_kind IN('objects','providers')),inflight_id uuid,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 CHECK((lease_token IS NULL)=(lease_until IS NULL)),CHECK((inflight_kind IS NULL)=(inflight_id IS NULL)),CHECK((phase='done')=(owner_id IS NULL AND target_id IS NULL))
);
CREATE INDEX ai_erasure_pending_idx ON privacy.ai_erasure_jobs(phase,updated_at,id) WHERE phase NOT IN('done','blocked');
CREATE TABLE privacy.ai_erasure_targets(job_id uuid NOT NULL REFERENCES privacy.ai_erasure_jobs(id),scope_id uuid NOT NULL,capture_id uuid,done boolean NOT NULL DEFAULT false,PRIMARY KEY(job_id,scope_id));
CREATE TABLE privacy.ai_erasure_receipts(job_id uuid NOT NULL REFERENCES privacy.ai_erasure_jobs(id),kind text NOT NULL CHECK(kind IN('objects','providers')),resource_id uuid NOT NULL,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),PRIMARY KEY(job_id,kind,resource_id));
CREATE TABLE privacy.ai_provider_objects(id uuid PRIMARY KEY,scope_id uuid NOT NULL REFERENCES app.ai_reuse_scopes(id),attempt_id uuid NOT NULL REFERENCES app.ai_attempts(id),reference_key_version text NOT NULL,reference_hash text NOT NULL CHECK(reference_hash ~ '^[a-f0-9]{64}$'),provider text NOT NULL CHECK(provider ~ '^[a-z][a-z0-9_-]{0,63}$'),kind text NOT NULL CHECK(kind IN('file','response')),key_version text NOT NULL CHECK(length(key_version) BETWEEN 1 AND 100),ciphertext bytea NOT NULL CHECK(octet_length(ciphertext) BETWEEN 1 AND 16384),state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','erased')),created_at timestamptz NOT NULL DEFAULT statement_timestamp());
CREATE INDEX ai_provider_scope_idx ON privacy.ai_provider_objects(scope_id,id);
CREATE TRIGGER ai_provider_identity BEFORE UPDATE ON privacy.ai_provider_objects FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('id','scope_id','attempt_id','reference_key_version','reference_hash','provider','kind','key_version','ciphertext','created_at');
CREATE TABLE email.ai_delivery_bindings(send_id uuid PRIMARY KEY REFERENCES email.email_sends(id),selection jsonb NOT NULL CHECK(jsonb_typeof(selection)='object' AND octet_length(selection::text)<=32768),created_at timestamptz NOT NULL DEFAULT statement_timestamp());
CREATE TRIGGER ai_delivery_immutable BEFORE UPDATE ON email.ai_delivery_bindings FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE TABLE app.photo_save_plans(policy_id uuid PRIMARY KEY REFERENCES app.photo_upload_plans(policy_id),max_days integer NOT NULL CHECK(max_days BETWEEN 1 AND 30),notice_version text NOT NULL CHECK(length(notice_version) BETWEEN 1 AND 100),reviewed_by uuid NOT NULL REFERENCES admin.staff_identities(id),evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),reviewed_at timestamptz NOT NULL DEFAULT statement_timestamp());
CREATE TRIGGER photo_save_plan_immutable BEFORE UPDATE ON app.photo_save_plans FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
DO $$ DECLARE rel text; BEGIN FOREACH rel IN ARRAY ARRAY['privacy.ai_scope_marks','privacy.ai_erasure_jobs','privacy.ai_erasure_targets','privacy.ai_erasure_receipts','privacy.ai_provider_objects','email.ai_delivery_bindings','app.photo_save_plans'] LOOP
 EXECUTE 'ALTER TABLE '||rel||' ENABLE ROW LEVEL SECURITY';EXECUTE 'ALTER TABLE '||rel||' FORCE ROW LEVEL SECURITY';EXECUTE 'REVOKE ALL ON '||rel||' FROM PUBLIC';EXECUTE 'CREATE POLICY ai_lifecycle_migrator ON '||rel||' TO tt_app_migrator USING(true) WITH CHECK(true)';
END LOOP;END $$;
CREATE POLICY photo_save_plan_service ON app.photo_save_plans TO tt_p2_analysis_service USING(true) WITH CHECK(true);GRANT SELECT,INSERT ON app.photo_save_plans TO tt_p2_analysis_service;
CREATE FUNCTION app.ai_scope_erasure_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF (NEW.state='active' OR NEW.processing_allowed) AND EXISTS(SELECT 1 FROM privacy.ai_scope_marks m WHERE m.scope_hash=privacy.ai_scope_hash(NEW.scope_id) AND(m.permanent OR NEW.permission_revision<=m.denied_through)) THEN RAISE EXCEPTION 'Erased analysis identity cannot be reactivated' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER ai_scope_erasure BEFORE INSERT OR UPDATE ON app.ai_scope_guards FOR EACH ROW EXECUTE FUNCTION app.ai_scope_erasure_guard();
CREATE FUNCTION privacy.ai_erasure_fence(job uuid,token uuid,generation bigint) RETURNS privacy.ai_erasure_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j privacy.ai_erasure_jobs%ROWTYPE;BEGIN
 SELECT * INTO j FROM privacy.ai_erasure_jobs WHERE id=job;IF NOT FOUND OR j.owner_id IS NULL THEN RAISE EXCEPTION 'Erasure work unavailable' USING ERRCODE='23514';END IF;
 PERFORM app.ai_repository_subject(j.owner_id,false);
 SELECT * INTO j FROM privacy.ai_erasure_jobs WHERE id=job AND lease_token=token AND lease_generation=generation AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current erasure lease required' USING ERRCODE='23514';END IF;RETURN j;END $$;
CREATE FUNCTION privacy.ai_erasure_hold(job uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM privacy.ai_erasure_jobs j JOIN privacy.legal_holds h ON h.released_at IS NULL WHERE j.id=job AND(privacy.analysis_repository_hold(j.owner_id) OR h.subject_id=j.owner_id OR h.resource_id IN(j.id,j.linked_request,j.target_id) OR h.resource_id IN(
 SELECT t.scope_id FROM privacy.ai_erasure_targets t WHERE t.job_id=j.id UNION SELECT r.id FROM app.ai_analysis_requests r JOIN privacy.ai_erasure_targets t ON t.scope_id=r.scope_id WHERE t.job_id=j.id UNION SELECT a.id FROM app.ai_attempts a JOIN privacy.ai_erasure_targets t ON t.scope_id=a.scope_id WHERE t.job_id=j.id UNION SELECT a.id FROM app.ai_artifacts a JOIN privacy.ai_erasure_targets t ON t.scope_id=a.scope_id WHERE t.job_id=j.id UNION SELECT i.id FROM app.photo_service_intents i JOIN privacy.ai_erasure_targets t ON t.scope_id=i.scope_id WHERE t.job_id=j.id UNION SELECT i.original_id FROM app.photo_service_intents i JOIN privacy.ai_erasure_targets t ON t.scope_id=i.scope_id WHERE t.job_id=j.id UNION SELECT i.sanitized_id FROM app.photo_service_intents i JOIN privacy.ai_erasure_targets t ON t.scope_id=i.scope_id WHERE t.job_id=j.id UNION SELECT o.id FROM privacy.ai_provider_objects o JOIN privacy.ai_erasure_targets t ON t.scope_id=o.scope_id WHERE t.job_id=j.id)))
$$;
CREATE FUNCTION privacy.ai_erasure_begin_request(request uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record;BEGIN
 SELECT p.subject_id,w.target_kind,w.target_id,f.evidence_digest AS digest INTO r FROM privacy.privacy_requests p JOIN privacy.request_work w ON w.request_id=p.id JOIN privacy.fulfillment_steps f ON f.request_id=p.id AND f.store='journal' AND f.status='completed' WHERE p.id=request AND p.kind IN('delete','restrict') AND p.verified_at IS NOT NULL AND p.status IN('verified','processing','manual_review') AND w.target_kind IN('subject','report');
 IF NOT FOUND OR r.subject_id IS NULL OR r.target_id IS NULL THEN RETURN NULL;END IF;
 PERFORM app.ai_repository_subject(r.subject_id,false);
 INSERT INTO privacy.ai_erasure_jobs(id,linked_request,owner_id,target_id,kind,phase,journal_digest) VALUES(request,request,r.subject_id,r.target_id,r.target_kind,'prepare',r.digest) ON CONFLICT(linked_request) DO NOTHING;RETURN request;END $$;
CREATE FUNCTION privacy.ai_erasure_begin_scope(keys jsonb,scope uuid,command text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE who uuid; job uuid; rev bigint;BEGIN
 IF command !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Bound erasure command required' USING ERRCODE='23514';END IF;
 SELECT id INTO job FROM privacy.ai_erasure_jobs WHERE command_hash=command;IF FOUND THEN RETURN job;END IF;
 SELECT subject_id INTO who FROM app.ai_service_owner(keys);IF who IS NULL OR NOT EXISTS(SELECT 1 FROM app.ai_reuse_scopes WHERE id=scope AND owner_subject_id=who AND kind='owner') THEN RAISE EXCEPTION 'Owned analysis required' USING ERRCODE='23514';END IF;
 PERFORM app.ai_repository_scope(scope,false);
 UPDATE app.ai_scope_guards SET state='withdrawn',processing_allowed=false,permission_revision=permission_revision+1,updated_at=clock_timestamp() WHERE scope_id=scope RETURNING permission_revision INTO rev;
 INSERT INTO privacy.ai_scope_marks(scope_hash,denied_through,permanent) VALUES(privacy.ai_scope_hash(scope),rev,true) ON CONFLICT(scope_hash) DO UPDATE SET denied_through=greatest(ai_scope_marks.denied_through,EXCLUDED.denied_through),permanent=true,changed_at=clock_timestamp();
 job:=gen_random_uuid();INSERT INTO privacy.ai_erasure_jobs(id,command_hash,owner_id,target_id,kind,phase) VALUES(job,command,who,scope,'scope','journal');INSERT INTO privacy.ai_erasure_targets(job_id,scope_id,capture_id) VALUES(job,scope,(SELECT batch_id FROM app.photo_service_intents WHERE scope_id=scope));RETURN job;END $$;
CREATE FUNCTION privacy.ai_erasure_acquire(job uuid) RETURNS privacy.ai_erasure_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j privacy.ai_erasure_jobs%ROWTYPE;BEGIN
 SELECT * INTO j FROM privacy.ai_erasure_jobs WHERE id=job;IF NOT FOUND OR j.phase IN('done','blocked') THEN RETURN NULL;END IF;PERFORM app.ai_repository_subject(j.owner_id,false);
 UPDATE privacy.ai_erasure_jobs SET lease_token=gen_random_uuid(),lease_generation=lease_generation+1,lease_until=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE id=job AND(lease_token IS NULL OR lease_until<=clock_timestamp()) RETURNING * INTO j;RETURN j;END $$;
CREATE FUNCTION privacy.ai_erasure_journaled(job uuid,token uuid,generation bigint,digest text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j privacy.ai_erasure_jobs%ROWTYPE;BEGIN j:=privacy.ai_erasure_fence(job,token,generation);IF j.phase<>'journal' OR digest !~ '^[a-f0-9]{64}$' OR j.journal_record->>'digest' IS DISTINCT FROM digest THEN RAISE EXCEPTION 'Journal acknowledgment required' USING ERRCODE='23514';END IF;UPDATE privacy.ai_erasure_jobs SET phase='prepare',journal_digest=digest WHERE id=job;END $$;
CREATE FUNCTION privacy.ai_erasure_prepare(job uuid,token uuid,generation bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j privacy.ai_erasure_jobs%ROWTYPE; row record; n integer:=0; rev bigint;BEGIN
 j:=privacy.ai_erasure_fence(job,token,generation);IF j.phase<>'prepare' OR j.journal_digest IS NULL THEN RAISE EXCEPTION 'Journaled preparation required' USING ERRCODE='23514';END IF;
 FOR row IN SELECT s.id FROM app.ai_reuse_scopes s WHERE s.owner_subject_id=j.owner_id AND(j.cursor_id IS NULL OR s.id>j.cursor_id) AND(j.kind='subject' OR(j.kind='scope' AND s.id=j.target_id) OR(j.kind='report' AND(s.id IN(SELECT r.scope_id FROM app.ai_report_work w JOIN app.ai_analysis_requests r ON r.id=w.request_id WHERE w.report_id=j.target_id) OR s.id IN(SELECT authorization_scope_id FROM app.report_analysis_attachments WHERE report_id=j.target_id)))) ORDER BY s.id LIMIT 25 LOOP
  n:=n+1;PERFORM app.ai_repository_scope(row.id,false);
  UPDATE app.ai_scope_guards SET state='withdrawn',processing_allowed=false,permission_revision=permission_revision+1,updated_at=clock_timestamp() WHERE scope_id=row.id RETURNING permission_revision INTO rev;
  INSERT INTO privacy.ai_scope_marks(scope_hash,denied_through,permanent) VALUES(privacy.ai_scope_hash(row.id),rev,true) ON CONFLICT(scope_hash) DO UPDATE SET denied_through=greatest(ai_scope_marks.denied_through,EXCLUDED.denied_through),permanent=true,changed_at=clock_timestamp();
  INSERT INTO privacy.ai_erasure_targets(job_id,scope_id,capture_id) VALUES(job,row.id,(SELECT batch_id FROM app.photo_service_intents WHERE scope_id=row.id)) ON CONFLICT DO NOTHING;
  PERFORM app.ai_service_withdraw(row.id);
  PERFORM app.photo_service_remove(i.owner_id,i.id) FROM app.photo_service_intents i WHERE i.scope_id=row.id;
  UPDATE privacy.ai_erasure_jobs SET cursor_id=row.id WHERE id=job;
 END LOOP;
 IF n<25 THEN
  UPDATE email.email_sends SET dispatch_state='suppressed',revision=revision+1,updated_at=clock_timestamp() WHERE id IN(SELECT z.send_id FROM email.analysis_selections z JOIN app.report_analysis_attachments a ON(a.report_id,a.report_version,a.revision)=(z.report_id,z.report_version,z.attachment_revision) JOIN privacy.ai_erasure_targets t ON t.scope_id=a.authorization_scope_id WHERE t.job_id=job) AND dispatch_state IN('scheduled','dispatching');
  UPDATE privacy.ai_erasure_jobs SET phase='objects' WHERE id=job;
 END IF;END $$;

CREATE FUNCTION privacy.ai_erasure_asset_ids(job uuid) RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT i.original_id FROM app.photo_service_intents i JOIN privacy.ai_erasure_targets t ON t.scope_id=i.scope_id WHERE t.job_id=job
 UNION SELECT i.sanitized_id FROM app.photo_service_intents i JOIN privacy.ai_erasure_targets t ON t.scope_id=i.scope_id WHERE t.job_id=job
 UNION SELECT c.asset_id FROM app.photo_asset_claims c JOIN app.tire_photo_uploads u ON u.id=c.upload_id JOIN privacy.ai_erasure_targets t ON t.scope_id=u.scope_id WHERE t.job_id=job
 UNION SELECT r.asset_id FROM email.delivery_asset_reservations r JOIN email.analysis_selections z ON z.send_id=r.send_id JOIN app.report_analysis_attachments a ON(a.report_id,a.report_version,a.revision)=(z.report_id,z.report_version,z.attachment_revision) JOIN privacy.ai_erasure_targets t ON t.scope_id=a.authorization_scope_id WHERE t.job_id=job
$$;
CREATE FUNCTION privacy.ai_erasure_object(job uuid,token uuid,generation bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j privacy.ai_erasure_jobs%ROWTYPE;a app.object_assets%ROWTYPE;n integer;BEGIN
 j:=privacy.ai_erasure_fence(job,token,generation);IF j.phase<>'objects' OR privacy.ai_erasure_hold(job) THEN RAISE EXCEPTION 'Object erasure held' USING ERRCODE='23514';END IF;
 -- Fence future reservations as well as registered assets. The existing trigger serializes
 -- asset admission and barriers on the exact ID. Page fixed IDs before acknowledging objects.
 INSERT INTO privacy.asset_barriers(asset_id) SELECT x.id FROM(SELECT privacy.ai_erasure_asset_ids(job) AS id) x WHERE NOT EXISTS(SELECT 1 FROM privacy.asset_barriers b WHERE b.asset_id=x.id) ORDER BY x.id LIMIT 250 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;IF n>0 THEN RETURN jsonb_build_object('wait',true,'asset',NULL);END IF;
 -- A previously admitted pending delivery PUT gets the existing P1 45-second cooperative
 -- write window, unless its completed version is already visible. No remote fencing claim.
 IF EXISTS(SELECT 1 FROM app.object_assets o JOIN privacy.asset_barriers b ON b.asset_id=o.id WHERE o.id IN(SELECT privacy.ai_erasure_asset_ids(job)) AND o.purpose IN('report_pdf','email_payload') AND o.object_version IS NULL AND o.state<>'deleted' AND b.created_at+interval '45 seconds'>clock_timestamp()) THEN RETURN jsonb_build_object('wait',true,'asset',NULL);END IF;

 SELECT o.* INTO a FROM app.object_assets o WHERE o.id IN(SELECT privacy.ai_erasure_asset_ids(job)) AND(j.inflight_id IS NULL OR o.id=j.inflight_id) AND NOT EXISTS(SELECT 1 FROM privacy.ai_erasure_receipts r WHERE r.job_id=job AND r.kind='objects' AND r.resource_id=o.id)
 AND NOT EXISTS(SELECT 1 FROM app.photo_service_intents i WHERE o.id IN(i.original_id,i.sanitized_id) AND i.cleanup_after>clock_timestamp()) ORDER BY o.id LIMIT 1;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM app.object_assets o WHERE o.id IN(SELECT privacy.ai_erasure_asset_ids(job)) AND NOT EXISTS(SELECT 1 FROM privacy.ai_erasure_receipts r WHERE r.job_id=job AND r.kind='objects' AND r.resource_id=o.id)) THEN RETURN jsonb_build_object('wait',true,'asset',NULL);END IF;
  UPDATE privacy.ai_erasure_jobs SET phase='providers' WHERE id=job;RETURN jsonb_build_object('wait',false,'asset',NULL);
 END IF;
 INSERT INTO privacy.asset_barriers(asset_id) VALUES(a.id) ON CONFLICT DO NOTHING;
 UPDATE app.object_assets SET state='deleting',revision=revision+1,updated_at=clock_timestamp() WHERE id=a.id AND state NOT IN('deleting','deleted');
 SELECT * INTO a FROM app.object_assets WHERE id=a.id;
 UPDATE privacy.ai_erasure_jobs SET inflight_kind='objects',inflight_id=a.id WHERE id=job;
 RETURN jsonb_build_object('wait',false,'asset',to_jsonb(a)||jsonb_build_object('revision',a.revision::text,'size_bytes',a.size_bytes::text));END $$;
CREATE FUNCTION privacy.ai_erasure_provider(job uuid,token uuid,generation bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j privacy.ai_erasure_jobs%ROWTYPE;o record;BEGIN
 j:=privacy.ai_erasure_fence(job,token,generation);IF j.phase<>'providers' OR privacy.ai_erasure_hold(job) THEN RAISE EXCEPTION 'Provider erasure held' USING ERRCODE='23514';END IF;
 SELECT * INTO o FROM(
 SELECT p.id,p.provider,p.kind,p.key_version,encode(p.ciphertext,'hex') AS ciphertext FROM privacy.ai_provider_objects p JOIN privacy.ai_erasure_targets t ON t.scope_id=p.scope_id WHERE t.job_id=job AND p.state='pending'
 UNION SELECT s.id,s.provider,'email','p1-email',encode(convert_to(jsonb_build_object('provider',s.provider,'messageId',s.provider_message_id,'deliveryKey',s.provider_key)::text,'UTF8'),'hex') FROM email.email_sends s JOIN email.analysis_selections z ON z.send_id=s.id JOIN app.report_analysis_attachments a ON(a.report_id,a.report_version,a.revision)=(z.report_id,z.report_version,z.attachment_revision) JOIN privacy.ai_erasure_targets t ON t.scope_id=a.authorization_scope_id WHERE t.job_id=job AND s.claimed_at IS NOT NULL
 ) x WHERE(j.inflight_id IS NULL OR id=j.inflight_id) AND NOT EXISTS(SELECT 1 FROM privacy.ai_erasure_receipts r WHERE r.job_id=job AND r.kind='providers' AND r.resource_id=x.id) ORDER BY id LIMIT 1;
 IF NOT FOUND THEN UPDATE privacy.ai_erasure_jobs SET phase='sql' WHERE id=job;RETURN NULL;END IF;
 UPDATE privacy.ai_erasure_jobs SET inflight_kind='providers',inflight_id=o.id WHERE id=job;RETURN to_jsonb(o);END $$;
CREATE FUNCTION privacy.ai_erasure_receipt(job uuid,token uuid,generation bigint,store text,resource uuid,digest text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j privacy.ai_erasure_jobs%ROWTYPE;BEGIN
 j:=privacy.ai_erasure_fence(job,token,generation);IF(j.inflight_kind,j.inflight_id) IS DISTINCT FROM(store,resource) OR digest !~ '^[a-f0-9]{64}$' OR privacy.ai_erasure_hold(job) THEN RAISE EXCEPTION 'Admitted erasure receipt required' USING ERRCODE='23514';END IF;
 IF store='objects' THEN UPDATE app.object_assets SET state='deleted',deleted_at=coalesce(deleted_at,clock_timestamp()),revision=revision+1,updated_at=clock_timestamp() WHERE id=resource AND state='deleting';
 ELSE UPDATE privacy.ai_provider_objects SET state='erased' WHERE id=resource;END IF;
 INSERT INTO privacy.ai_erasure_receipts(job_id,kind,resource_id,digest) VALUES(job,store,resource,digest) ON CONFLICT DO NOTHING;
 IF j.linked_request IS NOT NULL THEN INSERT INTO privacy.erasure_receipts(request_id,store,resource_id,evidence_digest) SELECT j.linked_request,CASE WHEN store='objects' THEN 'objects' ELSE 'email' END,resource,digest WHERE store='objects' OR EXISTS(SELECT 1 FROM email.email_sends WHERE id=resource) ON CONFLICT DO NOTHING;END IF;
 UPDATE privacy.ai_erasure_jobs SET inflight_kind=NULL,inflight_id=NULL WHERE id=job;END $$;
CREATE FUNCTION privacy.ai_erasure_purge(job uuid,token uuid,generation bigint) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j privacy.ai_erasure_jobs%ROWTYPE;scope uuid;statement text;n bigint;BEGIN
 j:=privacy.ai_erasure_fence(job,token,generation);IF j.phase<>'sql' OR j.inflight_id IS NOT NULL OR privacy.ai_erasure_hold(job) THEN RAISE EXCEPTION 'SQL erasure held' USING ERRCODE='23514';END IF;
 SELECT scope_id INTO scope FROM privacy.ai_erasure_targets WHERE job_id=job AND NOT done ORDER BY scope_id LIMIT 1;
 IF NOT FOUND THEN
  IF j.kind IN('subject','report') THEN
   DELETE FROM email.ai_delivery_bindings WHERE send_id IN(SELECT s.id FROM email.email_sends s WHERE(j.kind='subject' AND(s.owner_subject_id=j.owner_id OR s.recipient_contact_id IN(SELECT id FROM privacy.contacts WHERE subject_id=j.owner_id))) OR(j.kind='report' AND s.report_id=j.target_id) ORDER BY s.id LIMIT 250);
   GET DIAGNOSTICS n=ROW_COUNT;IF n>0 THEN RETURN 'pending';END IF;
   DELETE FROM email.analysis_selections WHERE send_id IN(SELECT s.id FROM email.email_sends s WHERE(j.kind='subject' AND(s.owner_subject_id=j.owner_id OR s.recipient_contact_id IN(SELECT id FROM privacy.contacts WHERE subject_id=j.owner_id))) OR(j.kind='report' AND s.report_id=j.target_id) ORDER BY s.id LIMIT 250);
   GET DIAGNOSTICS n=ROW_COUNT;IF n>0 THEN RETURN 'pending';END IF;
  END IF;
  DELETE FROM app.photo_service_captures c WHERE c.id IN(SELECT id FROM app.photo_service_captures c WHERE c.owner_id=j.owner_id AND(j.kind='subject' OR c.id IN(SELECT capture_id FROM privacy.ai_erasure_targets WHERE job_id=job)) AND NOT EXISTS(SELECT 1 FROM app.photo_service_intents i WHERE i.batch_id=c.id) ORDER BY c.id LIMIT 25);
  GET DIAGNOSTICS n=ROW_COUNT;IF n>0 THEN RETURN 'pending';END IF;RETURN 'complete';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM app.ai_reuse_scopes WHERE id=scope) THEN UPDATE privacy.ai_erasure_targets SET done=true WHERE job_id=job AND scope_id=scope;RETURN 'pending';END IF;
 IF NOT EXISTS(SELECT 1 FROM app.ai_reuse_scopes WHERE id=scope AND owner_subject_id=j.owner_id) THEN RAISE EXCEPTION 'Erasure scope ownership mismatch' USING ERRCODE='23514';END IF;
 PERFORM app.ai_repository_scope(scope,false);PERFORM app.ai_service_withdraw(scope);
 IF EXISTS(SELECT 1 FROM app.ai_analysis_requests WHERE scope_id=scope AND state IN('queued','running')) THEN RETURN 'pending';END IF;
 -- New cleanup references can arrive after this job first passed providers. Revisit their
 -- physical work before deleting SQL, including after an authorized blocked-job retry.
 IF EXISTS(SELECT 1 FROM privacy.ai_provider_objects WHERE scope_id=scope AND state<>'erased') THEN UPDATE privacy.ai_erasure_jobs SET phase='providers' WHERE id=job;RETURN 'pending';END IF;
 IF EXISTS(SELECT 1 FROM app.ai_budget_reservations b JOIN app.ai_attempts a ON a.id=b.attempt_id WHERE a.scope_id=scope AND b.state IN('reserved','uncertain')) THEN RETURN 'charges';END IF;
 IF EXISTS(SELECT 1 FROM app.object_assets a WHERE a.id IN(SELECT privacy.ai_erasure_asset_ids(job)) AND(a.state<>'deleted' OR NOT EXISTS(SELECT 1 FROM privacy.ai_erasure_receipts r WHERE r.job_id=job AND r.kind='objects' AND r.resource_id=a.id))) THEN UPDATE privacy.ai_erasure_jobs SET phase='objects' WHERE id=job;RETURN 'pending';END IF;
 -- Closed, fixed statements only. Each leaf batch is bounded and can be replayed after restart.
 FOREACH statement IN ARRAY ARRAY[
 'DELETE FROM email.ai_delivery_bindings WHERE send_id IN(SELECT z.send_id FROM email.analysis_selections z JOIN app.report_analysis_attachments a ON(a.report_id,a.report_version,a.revision)=(z.report_id,z.report_version,z.attachment_revision) WHERE a.authorization_scope_id=$1 OR a.scope_id=$1 LIMIT 250)',
 'DELETE FROM email.analysis_selections WHERE send_id IN(SELECT z.send_id FROM email.analysis_selections z JOIN app.report_analysis_attachments a ON(a.report_id,a.report_version,a.revision)=(z.report_id,z.report_version,z.attachment_revision) WHERE a.authorization_scope_id=$1 OR a.scope_id=$1 LIMIT 250)',
 'DELETE FROM app.report_analysis_attachments WHERE (report_id,report_version,revision) IN(SELECT report_id,report_version,revision FROM app.report_analysis_attachments WHERE authorization_scope_id=$1 OR scope_id=$1 LIMIT 250)',
 'DELETE FROM app.confirmed_photo_fields WHERE (upload_id,field_code,revision) IN(SELECT c.upload_id,c.field_code,c.revision FROM app.confirmed_photo_fields c JOIN app.tire_photo_uploads u ON u.id=c.upload_id WHERE u.scope_id=$1 LIMIT 250)',
 'DELETE FROM app.photo_field_candidates WHERE id IN(SELECT c.id FROM app.photo_field_candidates c JOIN app.tire_photo_uploads u ON u.id=c.upload_id WHERE u.scope_id=$1 LIMIT 250)',
 'WITH gone AS(DELETE FROM app.photo_extractions WHERE id IN(SELECT e.id FROM app.photo_extractions e JOIN app.tire_photo_uploads u ON u.id=e.upload_id WHERE u.scope_id=$1 LIMIT 250) RETURNING job_id) DELETE FROM app.job_runs WHERE id IN(SELECT job_id FROM gone)',
 'WITH gone AS(DELETE FROM app.tire_photo_uploads WHERE id IN(SELECT id FROM app.tire_photo_uploads WHERE scope_id=$1 LIMIT 25) RETURNING id) DELETE FROM app.photo_asset_claims WHERE upload_id IN(SELECT id FROM gone)',
 'DELETE FROM app.photo_service_intents WHERE id IN(SELECT id FROM app.photo_service_intents WHERE scope_id=$1 LIMIT 25)',
 'DELETE FROM app.ai_execution_states WHERE request_id IN(SELECT x.request_id FROM app.ai_execution_states x JOIN app.ai_analysis_requests r ON r.id=x.request_id WHERE r.scope_id=$1 LIMIT 250)',
 'DELETE FROM app.ai_report_commands WHERE request_id IN(SELECT x.request_id FROM app.ai_report_commands x JOIN app.ai_analysis_requests r ON r.id=x.request_id WHERE r.scope_id=$1 LIMIT 250)',
 'WITH gone AS(DELETE FROM app.ai_report_work WHERE request_id IN(SELECT x.request_id FROM app.ai_report_work x JOIN app.ai_analysis_requests r ON r.id=x.request_id WHERE r.scope_id=$1 LIMIT 250) RETURNING job_id) DELETE FROM app.job_runs WHERE id IN(SELECT job_id FROM gone)',
 'DELETE FROM privacy.ai_provider_objects WHERE id IN(SELECT id FROM privacy.ai_provider_objects WHERE scope_id=$1 LIMIT 250)',
 'DELETE FROM app.ai_reuse_entries WHERE (scope_id,cache_key) IN(SELECT scope_id,cache_key FROM app.ai_reuse_entries WHERE scope_id=$1 LIMIT 250)',
 'DELETE FROM app.ai_artifact_sources WHERE (artifact_id,source_key) IN(SELECT x.artifact_id,x.source_key FROM app.ai_artifact_sources x JOIN app.ai_artifacts a ON a.id=x.artifact_id WHERE a.scope_id=$1 LIMIT 250)',
 'DELETE FROM app.ai_artifacts WHERE id IN(SELECT id FROM app.ai_artifacts WHERE scope_id=$1 LIMIT 250)',
 'DELETE FROM app.ai_budget_reservations WHERE id IN(SELECT b.id FROM app.ai_budget_reservations b JOIN app.ai_attempts a ON a.id=b.attempt_id WHERE a.scope_id=$1 LIMIT 250)',
 'DELETE FROM app.ai_attempts WHERE id IN(SELECT id FROM app.ai_attempts WHERE scope_id=$1 LIMIT 250)',
 'DELETE FROM app.ai_analysis_requests WHERE id IN(SELECT id FROM app.ai_analysis_requests WHERE scope_id=$1 LIMIT 250)'
 ] LOOP EXECUTE statement USING scope;GET DIAGNOSTICS n=ROW_COUNT;IF n>0 THEN RETURN 'pending';END IF;END LOOP;
 DELETE FROM app.ai_scope_guards WHERE scope_id=scope;DELETE FROM app.ai_reuse_scopes WHERE id=scope;
 UPDATE privacy.ai_erasure_targets SET done=true WHERE job_id=job AND scope_id=scope;RETURN 'pending';END $$;
CREATE FUNCTION privacy.ai_erasure_release(job uuid,token uuid,generation bigint,blocked boolean,failed boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j privacy.ai_erasure_jobs%ROWTYPE;BEGIN j:=privacy.ai_erasure_fence(job,token,generation);
 UPDATE privacy.ai_erasure_jobs SET blocked_phase=CASE WHEN blocked OR(failed AND failures>=4) THEN phase ELSE blocked_phase END,phase=CASE WHEN blocked OR(failed AND failures>=4) THEN 'blocked' ELSE phase END,failures=CASE WHEN failed THEN least(5,failures+1) ELSE 0 END,inflight_kind=CASE WHEN blocked THEN NULL ELSE inflight_kind END,inflight_id=CASE WHEN blocked THEN NULL ELSE inflight_id END,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=job;
 IF (blocked OR(failed AND j.failures>=4)) AND j.linked_request IS NOT NULL THEN UPDATE privacy.privacy_requests SET status='manual_review',revision=revision+1,updated_at=clock_timestamp() WHERE id=j.linked_request;UPDATE privacy.request_work SET last_error='downstream_unconfirmed' WHERE request_id=j.linked_request;END IF;END $$;
CREATE FUNCTION privacy.ai_erasure_finish(job uuid,token uuid,generation bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j privacy.ai_erasure_jobs%ROWTYPE;BEGIN j:=privacy.ai_erasure_fence(job,token,generation);
 IF j.phase<>'sql' OR j.inflight_id IS NOT NULL OR privacy.ai_erasure_hold(job) OR EXISTS(SELECT 1 FROM privacy.ai_erasure_targets WHERE job_id=job AND NOT done) THEN RAISE EXCEPTION 'Graph still pending' USING ERRCODE='23514';END IF;
 DELETE FROM privacy.ai_erasure_targets WHERE job_id=job;DELETE FROM privacy.ai_erasure_receipts WHERE job_id=job;
 UPDATE privacy.ai_erasure_jobs SET phase='done',owner_id=NULL,target_id=NULL,cursor_id=NULL,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=job;END $$;

CREATE INDEX ai_scope_erasure_hash_idx ON app.ai_reuse_scopes(privacy.ai_scope_hash(id));
CREATE INDEX ai_scope_erasure_page_idx ON app.ai_reuse_scopes(owner_subject_id,id);
CREATE FUNCTION app.ai_delivery_capture(send uuid,person uuid,report uuid,version integer,revision bigint,fallback text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;a app.ai_artifacts%ROWTYPE;old jsonb;BEGIN
 IF(revision IS NULL)=(fallback IS NULL) OR(fallback IS NOT NULL AND fallback NOT IN('not_requested','unavailable','declined','expired')) THEN RAISE EXCEPTION 'Explicit selection required' USING ERRCODE='23514';END IF;
 PERFORM app.ai_repository_send(person,send,report,version,revision);PERFORM set_config('tt.p2_ai_subject',person::text,true);
 IF revision IS NULL THEN result:=jsonb_build_object('schema',1,'mode','none','fallback',fallback);
 ELSE
  SELECT artifact.* INTO a FROM app.report_analysis_attachments x JOIN app.ai_artifacts artifact ON artifact.id=x.artifact_id WHERE x.report_id=report AND x.report_version=version AND x.revision=$5 AND x.owner_subject_id=person AND app.ai_attachment_readable(x.report_id,x.report_version,x.revision);
  IF NOT FOUND THEN RAISE EXCEPTION 'Selected AI attachment unavailable' USING ERRCODE='23514';END IF;
  result:=jsonb_build_object('schema',1,'mode','artifact','attachmentRevision',revision::text,'artifactHash',a.output_hash,'output',a.output);
 END IF;
 SELECT selection INTO old FROM email.ai_delivery_bindings WHERE send_id=send;IF FOUND THEN IF old<>result THEN RAISE EXCEPTION 'Frozen selection conflict' USING ERRCODE='23514';END IF;RETURN old;END IF;
 INSERT INTO email.analysis_selections(send_id,owner_subject_id,report_id,report_version,mode,attachment_revision,fallback_reason) VALUES(send,person,report,version,CASE WHEN revision IS NULL THEN 'none' ELSE 'artifact' END,revision,fallback);
 INSERT INTO email.ai_delivery_bindings(send_id,selection) VALUES(send,result);RETURN result;END $$;
CREATE FUNCTION app.ai_delivery_selection(send uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT b.selection FROM email.ai_delivery_bindings b JOIN email.email_sends s ON s.id=b.send_id WHERE b.send_id=send AND s.anonymized_at IS NULL $$;
CREATE FUNCTION app.ai_delivery_permitted(send uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE z email.analysis_selections%ROWTYPE;b jsonb;BEGIN
 SELECT * INTO z FROM email.analysis_selections WHERE send_id=send;IF NOT FOUND THEN RETURN false;END IF;
 PERFORM app.ai_repository_send(z.owner_subject_id,z.send_id,z.report_id,z.report_version,z.attachment_revision);PERFORM set_config('tt.p2_ai_subject',z.owner_subject_id::text,true);
 SELECT selection INTO b FROM email.ai_delivery_bindings WHERE send_id=send;IF NOT FOUND THEN RETURN false;END IF;
 IF z.mode='none' THEN RETURN b=jsonb_build_object('schema',1,'mode','none','fallback',z.fallback_reason);END IF;
 RETURN EXISTS(SELECT 1 FROM app.report_analysis_attachments x JOIN app.ai_artifacts a ON a.id=x.artifact_id WHERE(x.report_id,x.report_version,x.revision)=(z.report_id,z.report_version,z.attachment_revision) AND app.ai_attachment_readable(x.report_id,x.report_version,x.revision) AND b->>'artifactHash'=a.output_hash AND b->'output'=a.output);
END $$;
CREATE FUNCTION privacy.ai_erasure_marks(job uuid,token uuid,generation bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM privacy.ai_erasure_fence(job,token,generation);RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('hash',m.scope_hash,'revision',m.denied_through::text,'permanent',m.permanent) ORDER BY m.scope_hash) FROM privacy.ai_scope_marks m JOIN privacy.ai_erasure_targets t ON privacy.ai_scope_hash(t.scope_id)=m.scope_hash WHERE t.job_id=job),'[]');END $$;
CREATE FUNCTION privacy.ai_erasure_status(job uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT CASE WHEN phase='done' THEN 'complete' WHEN phase='blocked' THEN 'blocked' ELSE 'pending' END FROM privacy.ai_erasure_jobs WHERE id=job $$;
CREATE FUNCTION privacy.ai_erasure_pending() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT id FROM privacy.ai_erasure_jobs WHERE phase NOT IN('done','blocked') AND(lease_token IS NULL OR lease_until<=clock_timestamp()) ORDER BY updated_at,id LIMIT 25 $$;
CREATE FUNCTION privacy.ai_erasure_retry(request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM privacy.privacy_requests WHERE id=request AND status IN('verified','processing')) THEN RAISE EXCEPTION 'Reviewed P1 retry required' USING ERRCODE='23514';END IF;
 UPDATE privacy.ai_erasure_jobs SET phase=coalesce(blocked_phase,'prepare'),blocked_phase=NULL,failures=0 WHERE linked_request=request AND phase='blocked';END $$;
CREATE FUNCTION privacy.ai_erasure_replay(marks jsonb,receipt text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m jsonb;scope record;job uuid;command text;BEGIN
 IF receipt !~ '^[a-f0-9]{64}$' OR jsonb_typeof(marks)<>'array' OR jsonb_array_length(marks)>1000 OR octet_length(marks::text)>262144 THEN RAISE EXCEPTION 'Bounded signed marks required' USING ERRCODE='23514';END IF;
 FOR m IN SELECT * FROM jsonb_array_elements(marks) LOOP
  IF m-ARRAY['hash','revision','permanent']<>'{}' OR NOT(m ?& ARRAY['hash','revision','permanent']) OR m->>'hash' !~ '^[a-f0-9]{64}$' OR m->>'revision' !~ '^[1-9][0-9]{0,18}$' OR jsonb_typeof(m->'permanent')<>'boolean' THEN RAISE EXCEPTION 'Invalid erasure mark' USING ERRCODE='23514';END IF;
  INSERT INTO privacy.ai_scope_marks(scope_hash,denied_through,permanent) VALUES(m->>'hash',(m->>'revision')::bigint,(m->>'permanent')::boolean) ON CONFLICT(scope_hash) DO UPDATE SET denied_through=greatest(ai_scope_marks.denied_through,EXCLUDED.denied_through),permanent=ai_scope_marks.permanent OR EXCLUDED.permanent,changed_at=clock_timestamp();
 END LOOP;
 -- Replay only touches the supplied (bounded) identities; caller verifies the signed journal first.
 FOR scope IN SELECT s.id,s.owner_subject_id FROM app.ai_reuse_scopes s JOIN privacy.ai_scope_marks m ON m.scope_hash=privacy.ai_scope_hash(s.id) WHERE m.scope_hash IN(SELECT x->>'hash' FROM jsonb_array_elements(marks) x) ORDER BY s.owner_subject_id,s.id LOOP
  PERFORM app.ai_repository_scope(scope.id,false);UPDATE app.ai_scope_guards SET state='withdrawn',processing_allowed=false,permission_revision=permission_revision+1,updated_at=clock_timestamp() WHERE scope_id=scope.id;
  PERFORM app.ai_service_withdraw(scope.id);
  IF scope.owner_subject_id IS NOT NULL THEN
   command:=encode(sha256(convert_to('replay-erasure:'||scope.id::text,'UTF8')),'hex');job:=gen_random_uuid();
   INSERT INTO privacy.ai_erasure_jobs(id,command_hash,owner_id,target_id,kind,phase,journal_digest) VALUES(job,command,scope.owner_subject_id,scope.id,'scope','prepare',receipt) ON CONFLICT(command_hash) DO NOTHING RETURNING id INTO job;
   IF job IS NOT NULL THEN INSERT INTO privacy.ai_erasure_targets(job_id,scope_id,capture_id) VALUES(job,scope.id,(SELECT batch_id FROM app.photo_service_intents WHERE scope_id=scope.id));END IF;
  END IF;
 END LOOP;END $$;
CREATE FUNCTION app.ai_scope_erased(scope uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM privacy.ai_scope_marks WHERE scope_hash=privacy.ai_scope_hash(scope) AND permanent) $$;
CREATE FUNCTION app.ai_provider_register(resource uuid,scope uuid,attempt uuid,provider_name text,resource_kind text,version text,secret bytea,hashes jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old privacy.ai_provider_objects%ROWTYPE; h jsonb;BEGIN
 -- Cleanup metadata may arrive after withdrawal, but must precede final usage settlement.
 PERFORM app.ai_repository_scope(scope,false);
 IF jsonb_typeof(hashes)<>'array' OR jsonb_array_length(hashes) NOT BETWEEN 1 AND 4 OR octet_length(hashes::text)>2048 THEN RAISE EXCEPTION 'Bounded reference bindings required' USING ERRCODE='23514';END IF;
 FOR h IN SELECT * FROM jsonb_array_elements(hashes) LOOP
  IF h-ARRAY['keyVersion','digest']<>'{}' OR NOT(h ?& ARRAY['keyVersion','digest']) OR h->>'digest' !~ '^[a-f0-9]{64}$' OR h->>'keyVersion' !~ '^[A-Za-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'Invalid reference binding' USING ERRCODE='23514';END IF;
 END LOOP;
 SELECT * INTO old FROM privacy.ai_provider_objects WHERE id=resource;
 IF FOUND THEN
  IF (old.scope_id,old.attempt_id,old.provider,old.kind) IS DISTINCT FROM(scope,attempt,provider_name,resource_kind) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(hashes) x WHERE x->>'keyVersion'=old.reference_key_version AND x->>'digest'=old.reference_hash) THEN RAISE EXCEPTION 'Provider reference replay conflict' USING ERRCODE='23514';END IF;RETURN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM app.ai_reuse_scopes s JOIN app.ai_policy_versions p ON p.id=s.policy_version_id JOIN app.ai_attempts a ON a.scope_id=s.id WHERE s.id=scope AND s.kind='owner' AND p.provider=provider_name AND a.id=$3 AND a.state IN('started','uncertain')) THEN RAISE EXCEPTION 'Unsettled owned provider attempt required' USING ERRCODE='23514';END IF;
 h:=hashes->0;
 INSERT INTO privacy.ai_provider_objects(id,scope_id,attempt_id,provider,kind,key_version,ciphertext,reference_key_version,reference_hash) VALUES(resource,scope,attempt,provider_name,resource_kind,version,secret,h->>'keyVersion',h->>'digest');
 END $$;
CREATE FUNCTION privacy.ai_legacy_completion_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.status='completed' AND OLD.status<>'completed' AND NEW.kind IN('delete','restrict') AND(NEW.subject_id IS NOT NULL OR EXISTS(SELECT 1 FROM privacy.request_work WHERE request_id=NEW.id AND target_id IS NOT NULL)) AND NOT EXISTS(SELECT 1 FROM privacy.ai_erasure_jobs WHERE linked_request=NEW.id AND phase='done') THEN RAISE EXCEPTION 'Compose AI rights before completing P1 rights' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER ai_legacy_completion BEFORE UPDATE ON privacy.privacy_requests FOR EACH ROW EXECUTE FUNCTION privacy.ai_legacy_completion_guard();

CREATE FUNCTION privacy.ai_resource_owner(resource uuid) RETURNS SETOF uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT owner_subject_id FROM app.ai_reuse_scopes WHERE id=resource UNION SELECT owner_subject_id FROM app.ai_analysis_requests WHERE id=resource
 UNION SELECT s.owner_subject_id FROM app.ai_attempts a JOIN app.ai_reuse_scopes s ON s.id=a.scope_id WHERE a.id=resource
 UNION SELECT s.owner_subject_id FROM app.ai_artifacts a JOIN app.ai_reuse_scopes s ON s.id=a.scope_id WHERE a.id=resource
 UNION SELECT owner_subject_id FROM app.tire_photo_uploads WHERE id=resource UNION SELECT owner_id FROM app.photo_service_intents WHERE id=resource
 UNION SELECT owner_subject_id FROM app.photo_field_candidates WHERE id=resource UNION SELECT owner_subject_id FROM app.photo_asset_claims WHERE asset_id=resource
 UNION SELECT owner_id FROM app.photo_service_intents WHERE resource IN(original_id,sanitized_id)
 UNION SELECT s.owner_subject_id FROM privacy.ai_provider_objects p JOIN app.ai_reuse_scopes s ON s.id=p.scope_id WHERE p.id=resource
 UNION SELECT owner_id FROM privacy.ai_erasure_jobs WHERE id=resource
 UNION SELECT owner_subject_id FROM app.reports WHERE id=resource
 UNION SELECT s.owner_subject_id FROM email.email_sends s JOIN email.ai_delivery_bindings b ON b.send_id=s.id WHERE s.id=resource
$$;
CREATE FUNCTION privacy.ai_legal_hold_admission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE person uuid;known boolean;BEGIN
 IF NEW.released_at IS NOT NULL THEN RETURN NEW;END IF;
 known:=EXISTS(SELECT 1 FROM privacy.ai_resource_owner(NEW.resource_id));
 FOR person IN SELECT x FROM(SELECT privacy.ai_resource_owner(NEW.resource_id) AS x UNION SELECT NEW.subject_id) owners WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM app.ai_repository_subject(person,false);
  IF EXISTS(SELECT 1 FROM privacy.ai_erasure_jobs WHERE owner_id=person AND inflight_id IS NOT NULL) THEN RAISE EXCEPTION 'Erasure effect admitted; reconcile before accepting hold' USING ERRCODE='23514';END IF;
 END LOOP;
 IF (known OR NEW.resource_kind IN('ai_scope','ai_request','ai_attempt','ai_artifact','photo_upload','photo_candidate','provider_object')) AND NEW.resource_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM privacy.ai_resource_owner(NEW.resource_id)) THEN RAISE EXCEPTION 'Erased hold target unavailable' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM app.object_assets WHERE id=NEW.resource_id AND purpose IN('tire_photo_original','tire_photo_sanitized') AND state='deleted') THEN RAISE EXCEPTION 'Photo already erased' USING ERRCODE='23514';END IF;
 RETURN NEW;END $$;
CREATE TRIGGER ai_legal_hold_admission BEFORE INSERT OR UPDATE ON privacy.legal_holds FOR EACH ROW EXECUTE FUNCTION privacy.ai_legal_hold_admission();
CREATE FUNCTION privacy.ai_erasure_begin_expired(scope uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i app.photo_service_intents%ROWTYPE;job uuid;command text;rev bigint;BEGIN
 SELECT * INTO i FROM app.photo_service_intents WHERE scope_id=scope AND(expires_at<=clock_timestamp() OR state IN('deleted','rejected'));IF NOT FOUND THEN RAISE EXCEPTION 'Expired photo scope required' USING ERRCODE='23514';END IF;
 PERFORM app.ai_repository_scope(scope,false);command:=encode(sha256(convert_to('photo-expiry:'||scope::text,'UTF8')),'hex');SELECT id INTO job FROM privacy.ai_erasure_jobs WHERE command_hash=command;IF FOUND THEN RETURN job;END IF;
 UPDATE app.ai_scope_guards SET state='withdrawn',processing_allowed=false,permission_revision=permission_revision+1,updated_at=clock_timestamp() WHERE scope_id=scope RETURNING permission_revision INTO rev;
 INSERT INTO privacy.ai_scope_marks(scope_hash,denied_through,permanent) VALUES(privacy.ai_scope_hash(scope),rev,true) ON CONFLICT(scope_hash) DO UPDATE SET permanent=true,denied_through=greatest(ai_scope_marks.denied_through,EXCLUDED.denied_through);
 job:=gen_random_uuid();INSERT INTO privacy.ai_erasure_jobs(id,command_hash,owner_id,target_id,kind,phase) VALUES(job,command,i.owner_id,scope,'scope','journal');INSERT INTO privacy.ai_erasure_targets(job_id,scope_id,capture_id) VALUES(job,scope,i.batch_id);RETURN job;END $$;
CREATE FUNCTION privacy.ai_erasure_expired() RETURNS SETOF uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT i.scope_id FROM app.photo_service_intents i WHERE(i.expires_at<=clock_timestamp() OR i.state IN('deleted','rejected')) AND NOT EXISTS(SELECT 1 FROM privacy.ai_erasure_jobs j WHERE j.command_hash=encode(sha256(convert_to('photo-expiry:'||i.scope_id::text,'UTF8')),'hex')) ORDER BY i.expires_at,i.id LIMIT 25
$$;

DO $$ DECLARE name text;BEGIN
 SELECT conname INTO STRICT name FROM pg_constraint WHERE conrelid='app.photo_service_intents'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%expires_at%' AND pg_get_constraintdef(oid) LIKE '%24:00:00%';
 EXECUTE 'ALTER TABLE app.photo_service_intents DROP CONSTRAINT '||quote_ident(name);
END $$;
ALTER TABLE app.photo_service_intents ADD CONSTRAINT photo_service_intent_saved_retention CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 days');
CREATE OR REPLACE FUNCTION app.photo_intent_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.photo_upload_plans%ROWTYPE;
BEGIN
 PERFORM app.ai_repository_subject(NEW.owner_id,TG_OP='INSERT');
 IF TG_OP='INSERT' THEN
  IF NEW.expires_at>NEW.created_at+interval '24 hours' THEN RAISE EXCEPTION 'Unsaved image lifetime bounded' USING ERRCODE='23514';END IF;
  IF NEW.maintenance_after IS DISTINCT FROM NEW.created_at THEN RAISE EXCEPTION 'Initial maintenance schedule is server-owned' USING ERRCODE='23514';END IF;
  PERFORM app.ai_assert_scope(NEW.scope_id);
  SELECT * INTO p FROM app.photo_upload_plans WHERE policy_id=NEW.policy_id AND status='active' FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM app.photo_service_captures WHERE id=NEW.batch_id AND owner_id=NEW.owner_id AND policy_id=NEW.policy_id AND expires_at>clock_timestamp()) OR NEW.state<>'pending' OR NOT EXISTS(SELECT 1 FROM app.ai_reuse_scopes s JOIN app.ai_policy_versions v ON v.id=s.policy_version_id WHERE s.id=NEW.scope_id AND s.owner_subject_id=NEW.owner_id AND v.id=NEW.policy_id AND v.task='photo_extraction' AND v.status='active') OR NOT EXISTS(SELECT 1 FROM app.object_assets a WHERE a.id=NEW.original_id AND a.purpose='tire_photo_original' AND a.state='pending' AND a.sha256=NEW.sha256 AND a.size_bytes=NEW.size_bytes AND a.mime_type=NEW.mime AND a.expires_at>=NEW.expires_at) THEN RAISE EXCEPTION 'Reviewed photo plan, owner choice and private original required' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM app.photo_service_intents WHERE owner_id=NEW.owner_id AND created_at>=date_trunc('day',transaction_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=p.max_daily_uploads OR coalesce((SELECT sum(size_bytes) FROM app.photo_service_intents WHERE owner_id=NEW.owner_id AND created_at>=date_trunc('day',transaction_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)+NEW.size_bytes>p.max_daily_bytes OR (SELECT count(*) FROM app.photo_service_intents WHERE owner_id=NEW.owner_id AND batch_id=NEW.batch_id)>=4 OR (SELECT count(*) FROM app.photo_service_intents WHERE owner_id=NEW.owner_id AND state IN('pending','processing') AND grant_until>clock_timestamp())>=p.max_active_uploads THEN RAISE EXCEPTION 'Photo quota exceeded' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','lease','lease_until','cleanup_after','maintenance_after','expires_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','lease','lease_until','cleanup_after','maintenance_after','expires_at']) OR (NEW.state<>OLD.state AND NOT((OLD.state='pending' AND NEW.state IN('processing','deleting')) OR (OLD.state='processing' AND NEW.state IN('ready','rejected','deleting')) OR (OLD.state IN('ready','rejected') AND NEW.state='deleting') OR (OLD.state='deleting' AND NEW.state='deleted'))) THEN RAISE EXCEPTION 'Photo intent immutable or invalid transition' USING ERRCODE='23514';END IF;
  IF NEW.maintenance_after IS DISTINCT FROM OLD.maintenance_after AND(OLD.state='deleted' OR(OLD.state<>'deleting' AND OLD.expires_at>clock_timestamp()) OR OLD.maintenance_after>clock_timestamp() OR NEW.maintenance_after<=clock_timestamp() OR NEW.maintenance_after>clock_timestamp()+interval '60 seconds') THEN RAISE EXCEPTION 'Maintenance claims require due work and bounded retry time' USING ERRCODE='23514';END IF;
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at AND(OLD.state<>'ready' OR OLD.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM app.tire_photo_uploads u JOIN app.photo_save_plans sp ON sp.policy_id=NEW.policy_id WHERE u.id=NEW.id AND u.saved_at IS NOT NULL AND u.expires_at=NEW.expires_at AND u.save_notice_version=sp.notice_version AND NEW.expires_at<=NEW.created_at+make_interval(days=>sp.max_days))) THEN RAISE EXCEPTION 'Reviewed explicit save required' USING ERRCODE='23514';END IF;
  IF OLD.cleanup_after IS NOT NULL AND NEW.cleanup_after IS DISTINCT FROM OLD.cleanup_after THEN RAISE EXCEPTION 'Cleanup barrier immutable' USING ERRCODE='23514';END IF;
  IF NEW.state='processing' AND (OLD.state<>'processing' OR NEW.lease IS DISTINCT FROM OLD.lease OR NEW.lease_until IS DISTINCT FROM OLD.lease_until) AND (NEW.grant_until<=clock_timestamp() OR NEW.lease_until<=clock_timestamp() OR NEW.lease_until>clock_timestamp()+interval '60 seconds' OR (OLD.state='processing' AND OLD.lease_until>clock_timestamp())) THEN RAISE EXCEPTION 'Photo finalization needs a bounded exclusive lease' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION app.ai_photo_save(keys jsonb,upload uuid,notice text,evidence text) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE who uuid;i app.photo_service_intents%ROWTYPE;u app.tire_photo_uploads%ROWTYPE;p app.photo_save_plans%ROWTYPE;deadline timestamptz;BEGIN
 SELECT subject_id INTO who FROM app.ai_service_owner(keys);IF who IS NULL OR evidence !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Owned explicit save required' USING ERRCODE='23514';END IF;
 SELECT * INTO i FROM app.photo_service_intents WHERE id=upload AND owner_id=who;IF NOT FOUND OR i.state<>'ready' THEN RAISE EXCEPTION 'Ready photo required' USING ERRCODE='23514';END IF;
 PERFORM app.ai_repository_scope(i.scope_id,true);IF NOT app.photo_intent_current(i.id) THEN RAISE EXCEPTION 'Current photo required' USING ERRCODE='23514';END IF;
 SELECT * INTO p FROM app.photo_save_plans WHERE policy_id=i.policy_id AND notice_version=notice FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Reviewed save plan required' USING ERRCODE='23514';END IF;
 SELECT * INTO u FROM app.tire_photo_uploads WHERE id=upload;IF u.saved_at IS NOT NULL THEN IF u.save_notice_version<>notice OR u.save_evidence_hash<>evidence THEN RAISE EXCEPTION 'Save replay conflict' USING ERRCODE='23514';END IF;RETURN u.expires_at;END IF;
 deadline:=i.created_at+make_interval(days=>p.max_days);IF deadline<=clock_timestamp() THEN RAISE EXCEPTION 'Save deadline elapsed' USING ERRCODE='23514';END IF;
 UPDATE app.object_assets SET expires_at=deadline,revision=revision+1,updated_at=clock_timestamp() WHERE id IN(i.original_id,i.sanitized_id) AND state='ready';
 PERFORM set_config('tt.p2_photo_subject',who::text,true);
 UPDATE app.tire_photo_uploads SET saved_at=clock_timestamp(),save_notice_version=notice,save_evidence_hash=evidence,expires_at=deadline WHERE id=upload;
 UPDATE app.photo_service_intents SET expires_at=deadline WHERE id=upload;RETURN deadline;END $$;
-- All entry points are capabilities for trusted existing backends; no raw table grants.
DO $$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE(n.nspname='privacy' AND p.proname LIKE 'ai_%') OR(n.nspname='app' AND p.proname IN('ai_scope_erasure_guard','ai_delivery_capture','ai_delivery_selection','ai_delivery_permitted','ai_scope_erased','ai_provider_register','ai_photo_save')) LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.name||' FROM PUBLIC';END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION privacy.ai_erasure_begin_request(uuid),privacy.ai_erasure_acquire(uuid),privacy.ai_erasure_marks(uuid,uuid,bigint),privacy.ai_erasure_journaled(uuid,uuid,bigint,text),privacy.ai_erasure_prepare(uuid,uuid,bigint),privacy.ai_erasure_object(uuid,uuid,bigint),privacy.ai_erasure_provider(uuid,uuid,bigint),privacy.ai_erasure_receipt(uuid,uuid,bigint,text,uuid,text),privacy.ai_erasure_purge(uuid,uuid,bigint),privacy.ai_erasure_release(uuid,uuid,bigint,boolean,boolean),privacy.ai_erasure_finish(uuid,uuid,bigint),privacy.ai_erasure_status(uuid),privacy.ai_erasure_pending(),privacy.ai_erasure_retry(uuid),privacy.ai_erasure_replay(jsonb,text),privacy.ai_erasure_begin_expired(uuid),privacy.ai_erasure_expired() TO tt_privacy_runtime;
GRANT USAGE ON SCHEMA privacy TO tt_p2_analysis_service;
GRANT EXECUTE ON FUNCTION privacy.ai_erasure_begin_scope(jsonb,uuid,text),app.ai_scope_erased(uuid),app.ai_provider_register(uuid,uuid,uuid,text,text,text,bytea,jsonb),app.ai_photo_save(jsonb,uuid,text,text) TO tt_p2_analysis_service;
GRANT EXECUTE ON FUNCTION app.ai_delivery_capture(uuid,uuid,uuid,integer,bigint,text),app.ai_delivery_selection(uuid),app.ai_delivery_permitted(uuid) TO tt_private_runtime,tt_p2_analysis_service;

CREATE FUNCTION privacy.ai_erasure_journal(job uuid,token uuid,generation bigint,record jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j privacy.ai_erasure_jobs%ROWTYPE;BEGIN j:=privacy.ai_erasure_fence(job,token,generation);
 IF j.phase<>'journal' OR jsonb_typeof(record)<>'object' OR record-ARRAY['keyVersion','digest','document']<>'{}' OR NOT(record ?& ARRAY['keyVersion','digest','document']) OR record->>'digest' !~ '^[a-f0-9]{64}$' OR length(record->>'keyVersion') NOT BETWEEN 1 AND 100 OR octet_length(record::text)>32768 THEN RAISE EXCEPTION 'Bounded signed erasure record required' USING ERRCODE='23514';END IF;
 IF j.journal_record IS NULL THEN UPDATE privacy.ai_erasure_jobs SET journal_record=record WHERE id=job;RETURN record;END IF;RETURN j.journal_record;END $$;
REVOKE ALL ON FUNCTION privacy.ai_erasure_journal(uuid,uuid,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy.ai_erasure_journal(uuid,uuid,bigint,jsonb) TO tt_privacy_runtime;

CREATE FUNCTION privacy.ai_erasure_operator_retry(job uuid,actor uuid,evidence text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j privacy.ai_erasure_jobs%ROWTYPE; event uuid;BEGIN
 IF NOT privacy.authorized_operator(actor) OR evidence !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Authorized reviewed retry required' USING ERRCODE='23514';END IF;
 SELECT * INTO j FROM privacy.ai_erasure_jobs WHERE id=job;IF NOT FOUND OR j.linked_request IS NOT NULL OR j.phase<>'blocked' THEN RAISE EXCEPTION 'Blocked independent work required' USING ERRCODE='23514';END IF;
 PERFORM app.ai_repository_subject(j.owner_id,false);
 IF privacy.ai_erasure_hold(job) THEN RAISE EXCEPTION 'Erasure held' USING ERRCODE='23514';END IF;
 UPDATE privacy.ai_erasure_jobs SET phase=blocked_phase,blocked_phase=NULL,failures=0 WHERE id=job;
 INSERT INTO admin.audit_events(action,resource_kind,result,change_digest,field_names,occurred_at) VALUES('analysis.erasure_retry','analysis_erasure','approved',evidence,'["state","evidence"]',clock_timestamp()) RETURNING id INTO event;
 INSERT INTO admin.audit_identity_links(event_id,actor_staff_id) VALUES(event,actor);
END $$;
REVOKE ALL ON FUNCTION privacy.ai_erasure_operator_retry(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy.ai_erasure_operator_retry(uuid,uuid,text) TO tt_privacy_runtime;

GRANT EXECUTE ON FUNCTION privacy.ai_scope_hash(uuid) TO tt_p2_ai_runtime,tt_p2_ai_worker,tt_p2_ai_staff,tt_p2_analysis_service;
