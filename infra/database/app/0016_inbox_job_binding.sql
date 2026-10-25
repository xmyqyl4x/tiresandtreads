-- Index the actual unqueued receipt set; recovery must not scan an entire scheduled backlog.
ALTER TABLE app.job_runs ADD CONSTRAINT job_runs_resource_uq UNIQUE(id,resource_id);
ALTER TABLE app.webhook_inbox ADD COLUMN job_id uuid;
ALTER TABLE app.webhook_inbox ADD CONSTRAINT webhook_inbox_job_fk
  FOREIGN KEY(job_id,id) REFERENCES app.job_runs(id,resource_id) ON DELETE RESTRICT;
CREATE INDEX webhook_inbox_job_idx ON app.webhook_inbox(job_id,id);
UPDATE app.webhook_inbox i SET job_id=j.id FROM app.job_runs j
  WHERE j.job_type='inbox.process' AND j.business_key=i.id::text AND j.resource_id=i.id;
CREATE INDEX webhook_inbox_unqueued_idx ON app.webhook_inbox(next_attempt_at,id)
  WHERE state IN ('pending','failed') AND job_id IS NULL;
CREATE INDEX webhook_inbox_processing_idx ON app.webhook_inbox(id) WHERE state='processing';
CREATE FUNCTION app.guard_inbox_job_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.job_id IS NOT NULL AND NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    RAISE EXCEPTION 'Inbox job binding is fixed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER webhook_inbox_job_binding BEFORE UPDATE ON app.webhook_inbox FOR EACH ROW EXECUTE FUNCTION app.guard_inbox_job_binding();
