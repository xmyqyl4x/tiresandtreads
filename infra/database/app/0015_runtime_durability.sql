-- S3 runtime owns bounded scheduling. Existing identities and applied migrations stay fixed.
ALTER TABLE app.job_runs ADD COLUMN deadline_at timestamptz;
UPDATE app.job_runs SET deadline_at=created_at+interval '1 day';
ALTER TABLE app.job_runs ALTER COLUMN deadline_at SET NOT NULL;
ALTER TABLE app.job_runs ALTER COLUMN deadline_at SET DEFAULT (now()+interval '1 day');
ALTER TABLE app.job_runs ADD CONSTRAINT job_runs_deadline_ck CHECK (deadline_at>created_at AND deadline_at<=created_at+interval '1 day');
ALTER TABLE app.job_runs ADD COLUMN resource_id uuid;
-- Historical jobs have no fabricated resource; new adapter registrations require it.
CREATE TRIGGER job_runs_runtime_identity BEFORE UPDATE ON app.job_runs FOR EACH ROW
  EXECUTE FUNCTION app.guard_identity_columns('deadline_at','resource_id');
ALTER TABLE app.outbox DROP CONSTRAINT outbox_state_ck;
ALTER TABLE app.outbox ADD CONSTRAINT outbox_state_ck CHECK (state IN ('pending','leased','published','failed','cancelled','quarantined'));
GRANT SELECT,INSERT,UPDATE ON app.job_runs,app.idempotency_requests TO tt_private_runtime;
-- Private worker is the narrow composed workflow role; no catalog publication, DDL, staff or CMS grants.
CREATE FUNCTION app.guard_asset_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT (NEW.state=OLD.state OR
    (OLD.state='pending' AND NEW.state IN ('ready','quarantined','deleting')) OR
    (OLD.state='ready' AND NEW.state IN ('quarantined','deleting')) OR
    (OLD.state='quarantined' AND NEW.state='deleting') OR
    (OLD.state='deleting' AND NEW.state='deleted')) THEN
    RAISE EXCEPTION 'Invalid asset lifecycle' USING ERRCODE='23514';
  END IF;
  IF OLD.state<>'ready' AND NEW.state='ready' AND (NEW.object_version IS NULL OR NEW.key_version IS NULL) THEN
    RAISE EXCEPTION 'Ready assets require versioned encryption' USING ERRCODE='23514';
  END IF;
  IF OLD.object_version IS NOT NULL AND NEW.object_version IS DISTINCT FROM OLD.object_version THEN
    RAISE EXCEPTION 'Asset version is fixed' USING ERRCODE='23514';
  END IF;
  IF (OLD.sha256 IS NOT NULL AND NEW.sha256 IS DISTINCT FROM OLD.sha256) OR
     (OLD.size_bytes IS NOT NULL AND NEW.size_bytes IS DISTINCT FROM OLD.size_bytes) OR
     (OLD.key_version IS NOT NULL AND NEW.key_version IS DISTINCT FROM OLD.key_version) THEN
    RAISE EXCEPTION 'Asset evidence is fixed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER object_assets_lifecycle BEFORE UPDATE ON app.object_assets FOR EACH ROW EXECUTE FUNCTION app.guard_asset_lifecycle();
CREATE TRIGGER object_assets_identity BEFORE UPDATE ON app.object_assets FOR EACH ROW
  EXECUTE FUNCTION app.guard_identity_columns('id','purpose','bucket','object_key','mime_type');
