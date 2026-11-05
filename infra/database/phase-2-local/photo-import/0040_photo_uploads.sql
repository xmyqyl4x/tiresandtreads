-- Opt-in local storage. No production role/bootstrap discovery.
INSERT INTO app.code_values(set_code,code,label) VALUES
 ('asset_purpose','tire_photo_original','Private original tire photo'),
 ('asset_purpose','tire_photo_sanitized','Private sanitized tire photo');
CREATE TABLE app.photo_asset_claims (
 asset_id uuid PRIMARY KEY REFERENCES app.object_assets(id),
 upload_id uuid NOT NULL, owner_subject_id uuid NOT NULL REFERENCES app.subjects(id),
 kind text NOT NULL CHECK(kind IN ('original','sanitized')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(asset_id,upload_id,owner_subject_id), UNIQUE(upload_id,kind)
);
CREATE TABLE app.tire_photo_uploads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_subject_id uuid NOT NULL REFERENCES app.subjects(id),
 capture_batch_id uuid NOT NULL, scope_id uuid NOT NULL UNIQUE,
 original_asset_id uuid NOT NULL UNIQUE, sanitized_asset_id uuid UNIQUE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','quarantined','ready','processing','complete','rejected','deleting','deleted')),
 width integer NOT NULL CHECK(width>0), height integer NOT NULL CHECK(height>0),
 permission_revision bigint NOT NULL CHECK(permission_revision>0), invalidation_revision bigint NOT NULL CHECK(invalidation_revision>=0),
 subject_permission_revision bigint NOT NULL CHECK(subject_permission_revision>0),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 saved_at timestamptz, save_notice_version text CHECK(length(btrim(save_notice_version)) BETWEEN 1 AND 100),
 save_evidence_hash text CHECK(save_evidence_hash ~ '^[a-f0-9]{64}$'),
 deletion_request_id uuid REFERENCES privacy.privacy_requests(id),
 UNIQUE(id,owner_subject_id),
 FOREIGN KEY(scope_id,owner_subject_id) REFERENCES app.ai_reuse_scopes(id,owner_subject_id),
 FOREIGN KEY(original_asset_id,id,owner_subject_id) REFERENCES app.photo_asset_claims(asset_id,upload_id,owner_subject_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(sanitized_asset_id,id,owner_subject_id) REFERENCES app.photo_asset_claims(asset_id,upload_id,owner_subject_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(width::bigint*height::bigint<=40000000),
 CHECK(expires_at>created_at AND expires_at<=created_at+CASE WHEN saved_at IS NULL THEN interval '24 hours' ELSE interval '30 days' END),
 CHECK(num_nonnulls(saved_at,save_notice_version,save_evidence_hash) IN (0,3)),
 CHECK(saved_at IS NULL OR (saved_at>=created_at AND saved_at<expires_at)),
 CHECK(sanitized_asset_id IS NULL OR sanitized_asset_id<>original_asset_id),
 CHECK(state NOT IN ('ready','processing','complete') OR sanitized_asset_id IS NOT NULL)
);
ALTER TABLE app.photo_asset_claims ADD FOREIGN KEY(upload_id,owner_subject_id)
 REFERENCES app.tire_photo_uploads(id,owner_subject_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX photo_upload_owner_page_idx ON app.tire_photo_uploads(owner_subject_id,created_at DESC,id);
CREATE INDEX photo_upload_batch_idx ON app.tire_photo_uploads(owner_subject_id,capture_batch_id,state);
CREATE INDEX photo_upload_retention_idx ON app.tire_photo_uploads(expires_at,id) WHERE state<>'deleted';
CREATE INDEX photo_upload_deletion_idx ON app.tire_photo_uploads(deletion_request_id);
CREATE INDEX photo_claim_upload_idx ON app.photo_asset_claims(upload_id,owner_subject_id);
CREATE FUNCTION app.photo_subject() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT nullif(current_setting('tt.p2_photo_subject',true),'')::uuid
$$;
CREATE FUNCTION app.photo_active_owner(owner_id uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.subjects p WHERE p.id=owner_id AND p.id=app.photo_subject() AND p.status='active'
 AND (p.expires_at IS NULL OR p.expires_at>clock_timestamp()))
$$;
CREATE FUNCTION app.photo_asset_ok(asset uuid,expected_purpose text,until_at timestamptz,ready boolean) RETURNS boolean
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.object_assets a WHERE a.id=asset AND a.purpose=expected_purpose
 AND a.mime_type IN ('image/jpeg','image/png','image/webp') AND a.size_bytes BETWEEN 1 AND 10485760
 AND a.expires_at>=until_at AND a.expires_at>clock_timestamp()
 AND a.state IN ('pending','quarantined','ready') AND (NOT ready OR (a.state='ready' AND a.sha256 IS NOT NULL AND a.object_version IS NOT NULL AND a.key_version IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM privacy.asset_barriers b WHERE b.asset_id=a.id))
$$;
CREATE FUNCTION app.photo_current(upload uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.tire_photo_uploads u JOIN app.ai_scope_guards g ON g.scope_id=u.scope_id
 JOIN app.ai_reuse_scopes s ON s.id=u.scope_id JOIN app.ai_policy_versions p ON p.id=s.policy_version_id
 JOIN app.subjects person ON person.id=u.owner_subject_id
 WHERE u.id=upload AND u.state IN ('ready','processing','complete') AND u.expires_at>clock_timestamp()
 AND person.status='active' AND (person.expires_at IS NULL OR person.expires_at>clock_timestamp())
 AND person.permission_revision=u.subject_permission_revision AND g.subject_permission_revision=person.permission_revision
 AND g.state='active' AND g.processing_allowed AND (g.permission_revision,g.invalidation_revision)=(u.permission_revision,u.invalidation_revision)
 AND p.status='active' AND p.task='photo_extraction'
 AND app.photo_asset_ok(u.original_asset_id,'tire_photo_original',u.expires_at,true)
 AND app.photo_asset_ok(u.sanitized_asset_id,'tire_photo_sanitized',u.expires_at,true))
$$;
CREATE FUNCTION app.photo_guard_claim() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.object_assets a WHERE a.id=NEW.asset_id AND a.purpose='tire_photo_'||NEW.kind
 AND a.state IN ('pending','quarantined','ready')) THEN
 RAISE EXCEPTION 'Photo claim purpose unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER photo_claim_guard BEFORE INSERT ON app.photo_asset_claims FOR EACH ROW EXECUTE FUNCTION app.photo_guard_claim();
CREATE TRIGGER photo_claim_immutable BEFORE UPDATE ON app.photo_asset_claims FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE FUNCTION app.photo_guard_upload() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE g app.ai_scope_guards%ROWTYPE; person uuid;
BEGIN
 -- Owner lock serializes batch admission and precedes the shared AI permission lock.
 PERFORM id FROM app.subjects WHERE id=NEW.owner_subject_id FOR UPDATE;
 IF TG_OP='INSERT' THEN
  g:=app.ai_assert_scope(NEW.scope_id);
  IF NEW.created_at>clock_timestamp() OR NEW.saved_at IS NOT NULL OR NEW.state<>'pending'
   OR NOT EXISTS(SELECT 1 FROM app.ai_reuse_scopes s JOIN app.ai_policy_versions p ON p.id=s.policy_version_id
    WHERE s.id=NEW.scope_id AND s.owner_subject_id=NEW.owner_subject_id AND p.task='photo_extraction')
   OR (NEW.permission_revision,NEW.invalidation_revision,NEW.subject_permission_revision) IS DISTINCT FROM
    (g.permission_revision,g.invalidation_revision,g.subject_permission_revision)
   OR (SELECT count(*) FROM app.tire_photo_uploads WHERE owner_subject_id=NEW.owner_subject_id AND capture_batch_id=NEW.capture_batch_id AND state<>'deleted')>=4
  THEN RAISE EXCEPTION 'Photo admission requires current owner choice and bounded batch' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','sanitized_asset_id','expires_at','saved_at','save_notice_version','save_evidence_hash','deletion_request_id'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','sanitized_asset_id','expires_at','saved_at','save_notice_version','save_evidence_hash','deletion_request_id'])
   OR (OLD.sanitized_asset_id IS NOT NULL AND NEW.sanitized_asset_id IS DISTINCT FROM OLD.sanitized_asset_id)
   OR (NEW.state<>OLD.state AND NOT ((OLD.state='pending' AND NEW.state IN ('quarantined','rejected','deleting'))
    OR (OLD.state='quarantined' AND NEW.state IN ('ready','rejected','deleting'))
    OR (OLD.state='ready' AND NEW.state IN ('processing','quarantined','deleting'))
    OR (OLD.state='processing' AND NEW.state IN ('complete','ready','rejected','deleting'))
    OR (OLD.state IN ('complete','rejected') AND NEW.state='deleting') OR (OLD.state='deleting' AND NEW.state='deleted')))
   OR (OLD.saved_at IS NOT NULL AND (NEW.saved_at,NEW.save_notice_version,NEW.save_evidence_hash,NEW.expires_at)
    IS DISTINCT FROM (OLD.saved_at,OLD.save_notice_version,OLD.save_evidence_hash,OLD.expires_at))
   OR (NEW.expires_at IS DISTINCT FROM OLD.expires_at AND NEW.saved_at IS NULL)
   OR (OLD.saved_at IS NULL AND NEW.saved_at IS NOT NULL AND (app.photo_subject() IS DISTINCT FROM NEW.owner_subject_id
    OR NOT app.photo_current(OLD.id) OR NEW.saved_at>clock_timestamp() OR NEW.saved_at<clock_timestamp()-interval '10 minutes'))
  THEN RAISE EXCEPTION 'Photo identity, save choice or lifecycle is invalid' USING ERRCODE='23514'; END IF;
  IF NEW.state IN ('ready','processing','complete') THEN
   g:=app.ai_assert_scope(NEW.scope_id);
   IF (NEW.permission_revision,NEW.invalidation_revision,NEW.subject_permission_revision) IS DISTINCT FROM
    (g.permission_revision,g.invalidation_revision,g.subject_permission_revision) THEN
    RAISE EXCEPTION 'Photo choice is stale' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF NEW.deletion_request_id IS NOT NULL THEN
  SELECT subject_id INTO person FROM privacy.privacy_requests WHERE id=NEW.deletion_request_id AND kind='delete' FOR SHARE;
  IF person IS DISTINCT FROM NEW.owner_subject_id THEN RAISE EXCEPTION 'Wrong photo deletion owner' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.state NOT IN ('rejected','deleting','deleted') AND
  (NOT app.photo_asset_ok(NEW.original_asset_id,'tire_photo_original',NEW.expires_at,NEW.state IN ('ready','processing','complete'))
   OR (NEW.sanitized_asset_id IS NOT NULL AND NOT app.photo_asset_ok(NEW.sanitized_asset_id,'tire_photo_sanitized',NEW.expires_at,true)))
 THEN RAISE EXCEPTION 'Photo assets are unavailable or exceed bounds' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.state IN ('rejected','deleting','deleted') OR (OLD.state='ready' AND NEW.state='quarantined')) THEN
  UPDATE app.ai_scope_guards SET state='withdrawn',processing_allowed=false,permission_revision=permission_revision+1,updated_at=clock_timestamp()
   WHERE scope_id=NEW.scope_id AND state='active';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER photo_upload_guard BEFORE INSERT OR UPDATE ON app.tire_photo_uploads FOR EACH ROW EXECUTE FUNCTION app.photo_guard_upload();
-- Physical asset revocation also invalidates the existing AI authority, including legacy AI views.
CREATE FUNCTION app.photo_asset_revoked() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF (NEW.state IN ('deleting','deleted','quarantined') AND OLD.state='ready') OR NEW.expires_at<OLD.expires_at THEN
  UPDATE app.ai_scope_guards g SET state='withdrawn',processing_allowed=false,permission_revision=g.permission_revision+1,updated_at=clock_timestamp()
   FROM app.photo_asset_claims c JOIN app.tire_photo_uploads u ON u.id=c.upload_id
   WHERE c.asset_id=NEW.id AND g.scope_id=u.scope_id AND g.state='active';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER p2_photo_asset_revoke AFTER UPDATE ON app.object_assets FOR EACH ROW EXECUTE FUNCTION app.photo_asset_revoked();
CREATE FUNCTION app.photo_erasure_barrier() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE app.ai_scope_guards g SET state='withdrawn',processing_allowed=false,permission_revision=g.permission_revision+1,updated_at=clock_timestamp()
 FROM app.photo_asset_claims c JOIN app.tire_photo_uploads u ON u.id=c.upload_id
 WHERE c.asset_id=NEW.asset_id AND g.scope_id=u.scope_id AND g.state='active';
 RETURN NEW;
END $$;
CREATE TRIGGER p2_photo_erasure AFTER INSERT ON privacy.asset_barriers FOR EACH ROW EXECUTE FUNCTION app.photo_erasure_barrier();

