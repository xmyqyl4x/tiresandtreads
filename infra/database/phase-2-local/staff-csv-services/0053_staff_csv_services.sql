-- Opt-in local CSV service composition. No default grants, provisioning or activation.
CREATE TABLE admin.csv_upload_commands(
 id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES admin.staff_identities(id),command_hash text NOT NULL CHECK(command_hash ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 template_id uuid NOT NULL REFERENCES admin.csv_template_versions(id),provider_id uuid NOT NULL,license_id uuid NOT NULL,market text NOT NULL REFERENCES app.markets(code),
 asset_id uuid NOT NULL UNIQUE,job_id uuid NOT NULL UNIQUE,raw_hash text NOT NULL CHECK(raw_hash ~ '^[a-f0-9]{64}$'),packet_hash text NOT NULL CHECK(packet_hash ~ '^[a-f0-9]{64}$'),registration jsonb NOT NULL CHECK(jsonb_typeof(registration)='object' AND octet_length(registration::text)<=16384),
 run_id uuid UNIQUE REFERENCES app.import_runs(id),phase text NOT NULL DEFAULT 'uploading' CHECK(phase IN('uploading','registered','prepared','rejected','cancelled','published')),
 publication_command text,publication_review uuid REFERENCES admin.csv_review_decisions(id),publication_bundle uuid REFERENCES app.dataset_bundles(id) DEFERRABLE INITIALLY DEFERRED,publication_actor uuid REFERENCES admin.staff_identities(id),publication_approval uuid REFERENCES admin.audit_events(id),publication_xid xid8,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(actor_id,command_hash),FOREIGN KEY(provider_id,license_id) REFERENCES app.data_licenses(provider_id,id),CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 days')
);
CREATE INDEX csv_commands_expiry_idx ON admin.csv_upload_commands(expires_at,id);
CREATE TABLE admin.csv_preview_commands(
 id uuid PRIMARY KEY,intake_id uuid NOT NULL REFERENCES admin.csv_upload_commands(id),command_hash text NOT NULL CHECK(command_hash ~ '^[a-f0-9]{64}$'),run_revision bigint NOT NULL CHECK(run_revision>0),run_fence bigint NOT NULL CHECK(run_fence>0),head_bundle uuid REFERENCES app.dataset_bundles(id),head_revision bigint NOT NULL CHECK(head_revision>=0),
 members jsonb NOT NULL CHECK(jsonb_typeof(members)='array' AND jsonb_array_length(members) BETWEEN 1 AND 16 AND octet_length(members::text)<=16384),
 diff_id uuid NOT NULL UNIQUE,validation_id uuid NOT NULL UNIQUE,diff_asset uuid NOT NULL UNIQUE,validation_asset uuid NOT NULL UNIQUE,complete boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(intake_id,command_hash),CHECK((head_bundle IS NULL)=(head_revision=0)),CHECK(diff_id<>validation_id AND diff_asset<>validation_asset)
);
DO $$ DECLARE rel text;BEGIN FOREACH rel IN ARRAY ARRAY['admin.csv_upload_commands','admin.csv_preview_commands'] LOOP EXECUTE 'ALTER TABLE '||rel||' ENABLE ROW LEVEL SECURITY';EXECUTE 'ALTER TABLE '||rel||' FORCE ROW LEVEL SECURITY';EXECUTE 'REVOKE ALL ON '||rel||' FROM PUBLIC';EXECUTE 'CREATE POLICY csv_service_migrator ON '||rel||' TO tt_app_migrator USING(true) WITH CHECK(true)';END LOOP;END $$;
CREATE FUNCTION admin.csv_service_actor(actor uuid,permission text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE revision bigint;BEGIN
 IF permission NOT IN('data.review','data.publish') THEN RAISE EXCEPTION 'Closed CSV permission required' USING ERRCODE='23514';END IF;
 SELECT role_revision INTO revision FROM admin.staff_identities WHERE id=actor AND status='active' FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Active CSV staff required' USING ERRCODE='23514';END IF;
 PERFORM a.staff_id FROM admin.staff_role_assignments a JOIN admin.roles r ON r.id=a.role_id WHERE a.staff_id=actor AND a.revoked_at IS NULL AND a.granted_at<=clock_timestamp() AND r.permissions ? permission FOR SHARE OF a,r;
 IF NOT FOUND THEN RAISE EXCEPTION 'CSV permission required' USING ERRCODE='23514';END IF;RETURN revision;END $$;
CREATE FUNCTION admin.csv_command_locks(actor uuid,command uuid,permission text) RETURNS admin.csv_upload_commands LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c admin.csv_upload_commands%ROWTYPE;BEGIN
 PERFORM admin.csv_service_actor(actor,permission);
 SELECT * INTO c FROM admin.csv_upload_commands WHERE id=command FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'CSV command unavailable' USING ERRCODE='23514';END IF;
 PERFORM id FROM admin.csv_template_versions WHERE id=c.template_id AND state='active' FOR SHARE;IF NOT FOUND OR c.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Current template and private upload required' USING ERRCODE='23514';END IF;
 PERFORM l.id FROM app.data_licenses l JOIN app.data_providers p ON p.id=l.provider_id WHERE l.id=c.license_id AND l.provider_id=c.provider_id FOR SHARE OF l,p;
 IF NOT admin.csv_license_current(c.provider_id,c.license_id,c.market) THEN RAISE EXCEPTION 'Current licensed CSV source required' USING ERRCODE='23514';END IF;
 RETURN c;END $$;
CREATE FUNCTION admin.csv_service_reserve(actor uuid,input jsonb) RETURNS admin.csv_upload_commands LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c admin.csv_upload_commands%ROWTYPE;t admin.csv_template_versions%ROWTYPE;BEGIN
 PERFORM admin.csv_service_actor(actor,'data.review');
 IF jsonb_typeof(input)<>'object' OR octet_length(input::text)>24576 OR input->>'commandHash' !~ '^[a-f0-9]{64}$' OR input->>'fingerprint' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Bounded CSV command required' USING ERRCODE='23514';END IF;
 SELECT * INTO t FROM admin.csv_template_versions WHERE id=(input->>'templateId')::uuid AND state='active' FOR SHARE;
 IF NOT FOUND OR t.max_bytes>16777216 OR (input->'registration'->>'expectedRows')::integer NOT BETWEEN 1 AND t.max_rows OR (input->'registration'->>'schemaVersion',input->'registration'->>'mappingVersion',input->'registration'->>'kind',input->'registration'->>'checksum',input->'registration'->>'providerId',input->'registration'->>'licenseId',input->'registration'->>'semantics') IS DISTINCT FROM(t.schema_version,t.mapping_version,t.source_kind,input->>'packetHash',input->>'providerId',input->>'licenseId','complete_snapshot') OR NOT admin.csv_license_current((input->>'providerId')::uuid,(input->>'licenseId')::uuid,input->>'market') THEN RAISE EXCEPTION 'Reviewed CSV template/source mismatch' USING ERRCODE='23514';END IF;
 INSERT INTO admin.csv_upload_commands(id,actor_id,command_hash,fingerprint,template_id,provider_id,license_id,market,asset_id,job_id,raw_hash,packet_hash,registration,expires_at) VALUES((input->>'id')::uuid,actor,input->>'commandHash',input->>'fingerprint',(input->>'templateId')::uuid,(input->>'providerId')::uuid,(input->>'licenseId')::uuid,input->>'market',(input->>'assetId')::uuid,(input->>'jobId')::uuid,input->>'rawHash',input->>'packetHash',input->'registration',(input->>'expiresAt')::timestamptz) ON CONFLICT(actor_id,command_hash) DO NOTHING;
 SELECT * INTO c FROM admin.csv_upload_commands WHERE actor_id=actor AND command_hash=input->>'commandHash' FOR UPDATE;
 IF c.fingerprint IS DISTINCT FROM input->>'fingerprint' OR c.id IS DISTINCT FROM(input->>'id')::uuid THEN RAISE EXCEPTION 'CSV command replay conflict' USING ERRCODE='23514';END IF;RETURN admin.csv_command_locks(actor,c.id,'data.review');END $$;
CREATE FUNCTION admin.csv_service_command(actor uuid,command uuid) RETURNS admin.csv_upload_commands LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RETURN admin.csv_command_locks(actor,command,'data.review');END $$;
CREATE FUNCTION admin.csv_service_bind(actor uuid,command uuid,run uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c admin.csv_upload_commands%ROWTYPE;r app.import_runs%ROWTYPE;BEGIN
 c:=admin.csv_command_locks(actor,command,'data.review');IF c.actor_id<>actor OR c.phase IN('cancelled','rejected','published') THEN RAISE EXCEPTION 'Owned current CSV upload required' USING ERRCODE='23514';END IF;
 SELECT * INTO r FROM app.import_runs WHERE id=run FOR UPDATE;
 IF NOT FOUND OR (r.provider_id,r.content_hash,r.mode,r.dataset_version_id) IS DISTINCT FROM(c.provider_id,c.packet_hash,'manual',(c.registration->>'id')::uuid) THEN RAISE EXCEPTION 'Matching P1 manual import required' USING ERRCODE='23514';END IF;
 IF c.run_id IS NOT NULL THEN IF c.run_id<>run THEN RAISE EXCEPTION 'CSV run replay conflict' USING ERRCODE='23514';END IF;RETURN;END IF;
 IF r.status<>'registered' THEN RAISE EXCEPTION 'Initial P1 registration required' USING ERRCODE='23514';END IF;
 UPDATE app.import_runs SET requested_by=actor,asset_id=c.asset_id,expected_head_revision=coalesce((SELECT revision FROM app.market_dataset_heads WHERE market=c.market),0),revision=revision+1,updated_at=clock_timestamp() WHERE id=run;
 INSERT INTO app.job_runs(id,job_type,business_key,schema_version,resource_id,deadline_at) VALUES(c.job_id,'p2.csv.validate',c.id::text,1,c.id,c.expires_at);
 PERFORM set_config('tt.p2_csv_actor',actor::text,true);
 INSERT INTO admin.csv_intakes(id,template_id,run_id,job_id,provider_id,license_id,market,asset_id,raw_sha256,packet_sha256,uploader_id,expires_at) VALUES(c.id,c.template_id,run,c.job_id,c.provider_id,c.license_id,c.market,c.asset_id,c.raw_hash,c.packet_hash,actor,c.expires_at);
 UPDATE admin.csv_upload_commands SET run_id=run,phase='registered' WHERE id=command;END $$;
CREATE FUNCTION admin.csv_service_prepared(actor uuid,command uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c admin.csv_upload_commands%ROWTYPE;r app.import_runs%ROWTYPE;BEGIN
 c:=admin.csv_command_locks(actor,command,'data.review');SELECT * INTO r FROM app.import_runs WHERE id=c.run_id FOR UPDATE;
 IF c.phase IN('cancelled','published','rejected') THEN RETURN;END IF;
 IF r.status='validated' AND r.rejected_count=0 AND r.accepted_count=(c.registration->>'expectedRows')::bigint THEN UPDATE admin.csv_upload_commands SET phase='prepared' WHERE id=command;UPDATE app.job_runs SET state='completed',revision=revision+1,updated_at=clock_timestamp() WHERE id=c.job_id;
 ELSIF r.rejected_count>0 AND r.lease_until IS NULL THEN UPDATE app.import_runs SET status='rejected',revision=revision+1,updated_at=clock_timestamp() WHERE id=r.id;UPDATE admin.csv_upload_commands SET phase='rejected' WHERE id=command;UPDATE app.job_runs SET state='failed',revision=revision+1,updated_at=clock_timestamp() WHERE id=c.job_id;END IF;END $$;
CREATE FUNCTION admin.csv_service_cancel(actor uuid,command uuid,evidence text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c admin.csv_upload_commands%ROWTYPE;event uuid;BEGIN
 c:=admin.csv_command_locks(actor,command,'data.review');IF c.phase='published' OR evidence !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Unpublished evidenced cancel required' USING ERRCODE='23514';END IF;
 IF c.phase='cancelled' THEN RETURN;END IF;
 UPDATE app.import_runs SET status='cancelled',fence=fence+1,lease_until=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=c.run_id AND status<>'published';
 UPDATE app.job_runs SET state='cancelled',lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=c.job_id AND state<>'cancelled';
 UPDATE admin.csv_upload_commands SET phase='cancelled' WHERE id=command;
 INSERT INTO admin.audit_events(action,resource_kind,result,change_digest,field_names,occurred_at) VALUES('csv.cancel','csv_intake','succeeded',evidence,'["state"]',clock_timestamp()) RETURNING id INTO event;INSERT INTO admin.audit_identity_links(event_id,actor_staff_id) VALUES(event,actor);END $$;

CREATE FUNCTION admin.csv_preview_value(preview uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT to_jsonb(p)||jsonb_build_object('run_revision',p.run_revision::text,'run_fence',p.run_fence::text,'head_revision',p.head_revision::text,'run_id',c.run_id,'expires_at',to_char(c.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) FROM admin.csv_preview_commands p JOIN admin.csv_upload_commands c ON c.id=p.intake_id WHERE p.id=preview
$$;
CREATE FUNCTION admin.csv_service_preview(actor uuid,command uuid,command_key text,preview uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c admin.csv_upload_commands%ROWTYPE;r app.import_runs%ROWTYPE;p admin.csv_preview_commands%ROWTYPE;h app.market_dataset_heads%ROWTYPE;t admin.csv_template_versions%ROWTYPE;members jsonb;BEGIN
 c:=admin.csv_command_locks(actor,command,'data.review');IF c.phase<>'prepared' THEN RAISE EXCEPTION 'Validated CSV required' USING ERRCODE='23514';END IF;
 SELECT * INTO r FROM app.import_runs WHERE id=c.run_id AND status='validated' AND rejected_count=0 FOR UPDATE;IF NOT FOUND OR r.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'Unleased validated P1 run required' USING ERRCODE='23514';END IF;
 SELECT * INTO h FROM app.market_dataset_heads WHERE market=c.market FOR SHARE;SELECT * INTO t FROM admin.csv_template_versions WHERE id=c.template_id;
 SELECT * INTO p FROM admin.csv_preview_commands WHERE intake_id=command AND command_hash=command_key FOR UPDATE;
 IF FOUND THEN IF NOT p.complete AND(p.run_revision,p.run_fence,p.head_revision,p.head_bundle) IS DISTINCT FROM(r.revision,r.fence,coalesce(h.revision,0),h.bundle_id) THEN RAISE EXCEPTION 'Stale preview; create a new review command' USING ERRCODE='23514';END IF;RETURN admin.csv_preview_value(p.id);END IF;
 SELECT jsonb_agg(x ORDER BY x->>'key') INTO members FROM(
  SELECT jsonb_build_object('key',m.component_key,'kind',d.kind,'datasetId',d.id) AS x FROM app.bundle_members m JOIN app.dataset_versions d ON d.id=m.dataset_version_id WHERE m.bundle_id=h.bundle_id AND m.component_key<>t.source_kind
  UNION ALL SELECT jsonb_build_object('key',t.source_kind,'kind',t.source_kind,'datasetId',r.dataset_version_id)
 ) plan;
 INSERT INTO admin.csv_preview_commands(id,intake_id,command_hash,run_revision,run_fence,head_bundle,head_revision,members,diff_id,validation_id,diff_asset,validation_asset) VALUES(preview,command,command_key,r.revision,r.fence,h.bundle_id,coalesce(h.revision,0),members,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
 RETURN admin.csv_preview_value(preview);END $$;
CREATE FUNCTION admin.csv_service_complete_preview(actor uuid,preview uuid,diff_hash text,validation_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p admin.csv_preview_commands%ROWTYPE;c admin.csv_upload_commands%ROWTYPE;r app.import_runs%ROWTYPE;h app.market_dataset_heads%ROWTYPE;BEGIN
 SELECT * INTO p FROM admin.csv_preview_commands WHERE id=preview;IF NOT FOUND THEN RAISE EXCEPTION 'Preview unavailable' USING ERRCODE='23514';END IF;c:=admin.csv_command_locks(actor,p.intake_id,'data.review');
 SELECT * INTO p FROM admin.csv_preview_commands WHERE id=preview FOR UPDATE;SELECT * INTO r FROM app.import_runs WHERE id=c.run_id FOR UPDATE;SELECT * INTO h FROM app.market_dataset_heads WHERE market=c.market FOR SHARE;
 IF p.complete THEN RETURN admin.csv_preview_value(preview);END IF;
 IF c.phase<>'prepared' OR r.status<>'validated' OR r.rejected_count<>0 OR r.lease_until>clock_timestamp() OR (p.run_revision,p.run_fence,p.head_bundle,p.head_revision) IS DISTINCT FROM(r.revision,r.fence,h.bundle_id,coalesce(h.revision,0)) THEN RAISE EXCEPTION 'Preview changed during private artifact storage' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM app.object_assets a WHERE a.id=p.diff_asset AND a.purpose='import_evidence' AND a.mime_type='application/json' AND a.sha256=diff_hash AND admin.csv_asset_current(a.id,c.expires_at)) OR NOT EXISTS(SELECT 1 FROM app.object_assets a WHERE a.id=p.validation_asset AND a.purpose='import_evidence' AND a.mime_type='application/json' AND a.sha256=validation_hash AND admin.csv_asset_current(a.id,c.expires_at)) THEN RAISE EXCEPTION 'Exact private preview artifacts required' USING ERRCODE='23514';END IF;
 INSERT INTO app.import_artifacts(id,run_id,kind,asset_id,checksum,expires_at) VALUES(p.diff_id,c.run_id,'diff',p.diff_asset,diff_hash,c.expires_at),(p.validation_id,c.run_id,'validation',p.validation_asset,validation_hash,c.expires_at);
 UPDATE app.import_runs SET expected_head_revision=p.head_revision,revision=revision+1,updated_at=clock_timestamp() WHERE id=c.run_id RETURNING * INTO r;
 UPDATE admin.csv_preview_commands SET complete=true,run_revision=r.revision WHERE id=preview;RETURN admin.csv_preview_value(preview);END $$;
CREATE FUNCTION admin.csv_service_review_basis(actor uuid,preview uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p admin.csv_preview_commands%ROWTYPE;c admin.csv_upload_commands%ROWTYPE;r app.import_runs%ROWTYPE;h app.market_dataset_heads%ROWTYPE;BEGIN
 SELECT * INTO p FROM admin.csv_preview_commands WHERE id=preview;IF NOT FOUND THEN RAISE EXCEPTION 'Preview unavailable' USING ERRCODE='23514';END IF;c:=admin.csv_command_locks(actor,p.intake_id,'data.review');
 SELECT * INTO p FROM admin.csv_preview_commands WHERE id=preview FOR SHARE;SELECT * INTO r FROM app.import_runs WHERE id=c.run_id FOR UPDATE;SELECT * INTO h FROM app.market_dataset_heads WHERE market=c.market FOR SHARE;
 IF NOT p.complete OR c.phase<>'prepared' OR (p.run_revision,p.run_fence,p.head_bundle,p.head_revision) IS DISTINCT FROM(r.revision,r.fence,h.bundle_id,coalesce(h.revision,0)) THEN RAISE EXCEPTION 'Current completed preview required' USING ERRCODE='23514';END IF;RETURN admin.csv_preview_value(preview);END $$;
CREATE FUNCTION admin.csv_service_publication(actor uuid,command uuid,review uuid,command_key text,bundle uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c admin.csv_upload_commands%ROWTYPE;d admin.csv_review_decisions%ROWTYPE;p admin.csv_preview_commands%ROWTYPE;r app.import_runs%ROWTYPE;h app.market_dataset_heads%ROWTYPE;role_revision bigint;approval uuid;digest text;BEGIN
 PERFORM admin.csv_service_actor(actor,'data.publish');SELECT * INTO c FROM admin.csv_upload_commands WHERE id=command FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'CSV command unavailable' USING ERRCODE='23514';END IF;
 IF c.phase='published' THEN
  IF(c.publication_command,c.publication_review,c.publication_bundle,c.publication_actor) IS DISTINCT FROM(command_key,review,bundle,actor) OR NOT EXISTS(SELECT 1 FROM app.import_publications WHERE run_id=c.run_id AND bundle_id=bundle AND actor_id=actor AND approval_record_id=c.publication_approval) THEN RAISE EXCEPTION 'CSV publication replay conflict' USING ERRCODE='23514';END IF;
  SELECT * INTO p FROM admin.csv_preview_commands WHERE intake_id=command AND diff_id=(SELECT diff_artifact_id FROM admin.csv_review_decisions WHERE id=review);
 ELSE
  c:=admin.csv_command_locks(actor,command,'data.publish');
  IF c.phase<>'prepared' OR c.actor_id=actor OR command_key !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Independent evidenced publisher required' USING ERRCODE='23514';END IF;
  SELECT * INTO r FROM app.import_runs WHERE id=c.run_id AND status='validated' FOR UPDATE;SELECT * INTO h FROM app.market_dataset_heads WHERE market=c.market FOR UPDATE;
  SELECT * INTO d FROM admin.csv_review_decisions WHERE id=review AND intake_id=command AND decision='approved' FOR SHARE;
  IF NOT FOUND OR d.reviewer_id IN(actor,c.actor_id) THEN RAISE EXCEPTION 'Independent CSV approval required' USING ERRCODE='23514';END IF;
  role_revision:=admin.csv_service_actor(d.reviewer_id,'data.review');
  SELECT * INTO p FROM admin.csv_preview_commands WHERE intake_id=command AND diff_id=d.diff_artifact_id AND validation_id=d.validation_artifact_id AND complete FOR SHARE;
  IF NOT FOUND OR d.reviewer_role_revision<>role_revision OR (d.run_revision,d.run_fence,d.expected_head_revision) IS DISTINCT FROM(r.revision,r.fence,coalesce(h.revision,0)) OR (p.run_revision,p.run_fence,p.head_bundle,p.head_revision) IS DISTINCT FROM(r.revision,r.fence,h.bundle_id,coalesce(h.revision,0)) OR NOT admin.csv_intake_current(command) OR r.expected_head_revision<>d.expected_head_revision OR r.rejected_count<>0 OR r.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'Stale or invalid CSV approval' USING ERRCODE='23514';END IF;
  IF NOT EXISTS(SELECT 1 FROM app.import_artifacts a WHERE a.id=d.diff_artifact_id AND a.run_id=c.run_id AND admin.csv_asset_current(a.asset_id,a.expires_at)) OR NOT EXISTS(SELECT 1 FROM app.import_artifacts a WHERE a.id=d.validation_artifact_id AND a.run_id=c.run_id AND admin.csv_asset_current(a.asset_id,a.expires_at)) THEN RAISE EXCEPTION 'Current CSV evidence required' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p.members) m WHERE m-ARRAY['key','kind','datasetId']<>'{}' OR NOT(m ?& ARRAY['key','kind','datasetId']) OR m->>'key' !~ '^[a-z][a-z0-9_-]{0,79}$' OR m->>'kind' !~ '^[a-z][a-z0-9_-]{0,79}$' OR m->>'datasetId' !~ '^[a-f0-9-]{36}$') THEN RAISE EXCEPTION 'Closed P1 bundle member identities required' USING ERRCODE='23514';END IF;
  -- Only whitespace-free market/component/UUID strings occur in this array. Removing SQL
  -- jsonb formatting spaces therefore matches P1 canonical JSON exactly without altering data.
  digest:=encode(sha256(convert_to(replace(jsonb_build_array(c.market,(SELECT jsonb_agg(jsonb_build_array(m->>'key',m->>'datasetId') ORDER BY m->>'key') FROM jsonb_array_elements(p.members) m))::text,' ',''),'UTF8')),'hex');
  approval:=gen_random_uuid();
  INSERT INTO admin.audit_events(id,action,resource_kind,result,occurred_at,change_digest,field_names) VALUES(approval,'import.publish','dataset_bundle','approved',clock_timestamp(),digest,'["review","bundle"]');
  INSERT INTO admin.audit_identity_links(event_id,actor_staff_id) VALUES(approval,actor);
  UPDATE admin.csv_upload_commands SET publication_command=command_key,publication_review=review,publication_bundle=bundle,publication_actor=actor,publication_approval=approval,publication_xid=pg_current_xact_id() WHERE id=command;
 END IF;
 RETURN jsonb_build_object('runId',c.run_id,'bundleId',bundle,'market',c.market,'head',CASE WHEN p.head_bundle IS NULL THEN NULL ELSE jsonb_build_object('bundleId',p.head_bundle,'revision',p.head_revision::text) END,'approvalId',coalesce(approval,c.publication_approval),'members',p.members,'published',c.phase='published');END $$;

CREATE FUNCTION admin.csv_publication_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c admin.csv_upload_commands%ROWTYPE;d admin.csv_review_decisions%ROWTYPE;p admin.csv_preview_commands%ROWTYPE;BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin.csv_intakes WHERE run_id=NEW.run_id) THEN RETURN NEW;END IF;
 SELECT * INTO c FROM admin.csv_upload_commands WHERE run_id=NEW.run_id FOR UPDATE;
 IF NOT FOUND OR c.phase<>'prepared' OR c.publication_xid IS DISTINCT FROM pg_current_xact_id() OR (c.publication_bundle,c.publication_actor,c.publication_approval) IS DISTINCT FROM(NEW.bundle_id,NEW.actor_id,NEW.approval_record_id) THEN RAISE EXCEPTION 'CSV review admission and P1 publication must share a transaction' USING ERRCODE='23514';END IF;
 PERFORM admin.csv_service_actor(NEW.actor_id,'data.publish');SELECT * INTO d FROM admin.csv_review_decisions WHERE id=c.publication_review;SELECT * INTO p FROM admin.csv_preview_commands WHERE intake_id=c.id AND diff_id=d.diff_artifact_id AND validation_id=d.validation_artifact_id;
 IF d.decision<>'approved' OR d.reviewer_id IN(NEW.actor_id,c.actor_id) OR admin.csv_service_actor(d.reviewer_id,'data.review')<>d.reviewer_role_revision OR NEW.previous_bundle_id IS DISTINCT FROM p.head_bundle OR NOT admin.csv_intake_current(c.id) OR NOT EXISTS(SELECT 1 FROM app.import_runs WHERE id=c.run_id AND status='validated' AND fence=d.run_fence+1 AND revision=d.run_revision+1 AND rejected_count=0) THEN RAISE EXCEPTION 'CSV approval changed before publication receipt' USING ERRCODE='23514';END IF;
 UPDATE admin.csv_upload_commands SET phase='published' WHERE id=c.id;RETURN NEW;END $$;
CREATE TRIGGER csv_service_publication_guard BEFORE INSERT ON app.import_publications FOR EACH ROW EXECUTE FUNCTION admin.csv_publication_guard();
-- Capability functions only: existing ingestion/publication roles keep their P1 ownership.
DO $$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='admin' AND(p.proname LIKE 'csv_service_%' OR p.proname IN('csv_command_locks','csv_preview_value','csv_publication_guard')) LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';END LOOP;END $$;
GRANT USAGE ON SCHEMA admin TO tt_ingest_runtime,tt_publish_runtime;
GRANT EXECUTE ON FUNCTION admin.csv_service_actor(uuid,text) TO tt_p2_csv_staff,tt_ingest_runtime,tt_publish_runtime;
GRANT EXECUTE ON FUNCTION admin.csv_service_reserve(uuid,jsonb),admin.csv_service_command(uuid,uuid),admin.csv_service_review_basis(uuid,uuid),admin.csv_service_cancel(uuid,uuid,text) TO tt_p2_csv_staff;
GRANT EXECUTE ON FUNCTION admin.csv_service_bind(uuid,uuid,uuid),admin.csv_service_prepared(uuid,uuid) TO tt_ingest_runtime;
GRANT EXECUTE ON FUNCTION admin.csv_service_preview(uuid,uuid,text,uuid),admin.csv_service_complete_preview(uuid,uuid,text,text),admin.csv_service_publication(uuid,uuid,uuid,text,uuid) TO tt_publish_runtime;

CREATE FUNCTION admin.csv_service_review_replay(actor uuid,review uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d admin.csv_review_decisions%ROWTYPE;BEGIN
 PERFORM admin.csv_service_actor(actor,'data.review');SELECT * INTO d FROM admin.csv_review_decisions WHERE id=review AND reviewer_id=actor;
 IF NOT FOUND THEN RETURN NULL;END IF;RETURN to_jsonb(d)||jsonb_build_object('run_revision',d.run_revision::text,'run_fence',d.run_fence::text,'expected_head_revision',d.expected_head_revision::text,'reviewer_role_revision',d.reviewer_role_revision::text);
END $$;
REVOKE ALL ON FUNCTION admin.csv_service_review_replay(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.csv_service_review_replay(uuid,uuid) TO tt_p2_csv_staff;
