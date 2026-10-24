-- P1-PR-006: durable identities, fenced leases and minimal audit evidence.
-- Payload allowlists are structural boundaries; owning services validate identifiers and recheck deletion/permission before work.

CREATE FUNCTION app.guard_identity_columns() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE column_name text;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    IF to_jsonb(OLD)->column_name IS DISTINCT FROM to_jsonb(NEW)->column_name THEN
      RAISE EXCEPTION 'Persisted identity is fixed' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TABLE app.idempotency_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_scope_hash bytea NOT NULL,
  operation text NOT NULL,
  key_hash bytea NOT NULL,
  body_hash bytea NOT NULL,
  canonical_version integer NOT NULL,
  state text NOT NULL,
  resource_kind text,
  resource_id uuid,
  result_status integer,
  safe_response jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT idempotency_requests_pk PRIMARY KEY (id),
  CONSTRAINT idempotency_requests_u1 UNIQUE (actor_scope_hash,operation,key_hash),
  CONSTRAINT idempotency_requests_actor_scope_hash_ck CHECK (octet_length(actor_scope_hash)=32),
  CONSTRAINT idempotency_requests_key_hash_ck CHECK (octet_length(key_hash)=32),
  CONSTRAINT idempotency_requests_body_hash_ck CHECK (octet_length(body_hash)=32),
  CONSTRAINT idempotency_requests_operation_ck CHECK (length(btrim(operation)) BETWEEN 1 AND 100),
  CONSTRAINT idempotency_requests_version_ck CHECK (canonical_version > 0),
  CONSTRAINT idempotency_requests_state_ck CHECK (state IN ('pending','completed','uncertain','expired')),
  CONSTRAINT idempotency_requests_resource_ck CHECK ((resource_kind IS NULL)=(resource_id IS NULL)),
  CONSTRAINT idempotency_requests_resource_kind_ck CHECK (length(btrim(resource_kind)) BETWEEN 1 AND 100),
  CONSTRAINT idempotency_requests_status_ck CHECK (result_status BETWEEN 200 AND 599),
  CONSTRAINT idempotency_requests_result_ck CHECK (state NOT IN ('completed','expired') OR result_status IS NOT NULL),
  CONSTRAINT idempotency_requests_response_ck CHECK (safe_response IS NULL OR (jsonb_typeof(safe_response)='object' AND octet_length(safe_response::text)<=1024 AND safe_response - ARRAY['schema_version','resource_id','status'] = '{}'::jsonb AND NOT jsonb_path_exists(safe_response, '$.* ? (@.type() == "object" || @.type() == "array")'))),
  CONSTRAINT idempotency_requests_ttl_ck CHECK (expires_at >= created_at + interval '7 days'),
  CONSTRAINT idempotency_requests_revision_ck CHECK (revision > 0),
  CONSTRAINT idempotency_requests_updated_ck CHECK (updated_at >= created_at)
);

CREATE INDEX idempotency_requests_expiry_idx ON app.idempotency_requests(expires_at,id) WHERE state IN ('completed','expired');

CREATE TABLE app.outbox (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  aggregate_kind text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  schema_version integer NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_owner text,
  lease_token uuid,
  lease_generation bigint NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT outbox_pk PRIMARY KEY (id),
  CONSTRAINT outbox_u1 UNIQUE (event_id),
  CONSTRAINT outbox_aggregate_kind_ck CHECK (length(btrim(aggregate_kind)) BETWEEN 1 AND 100),
  CONSTRAINT outbox_event_type_ck CHECK (length(btrim(event_type)) BETWEEN 1 AND 100),
  CONSTRAINT outbox_version_ck CHECK (schema_version > 0),
  CONSTRAINT outbox_payload_ck CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=4096 AND payload - ARRAY['resource_id','resource_kind','version','revision'] = '{}'::jsonb AND NOT jsonb_path_exists(payload, '$.* ? (@.type() == "object" || @.type() == "array")')),
  CONSTRAINT outbox_state_ck CHECK (state IN ('pending','leased','published','failed','cancelled')),
  CONSTRAINT outbox_retry_ck CHECK (attempts BETWEEN 0 AND 1000 AND lease_generation >= 0),
  CONSTRAINT outbox_lease_owner_ck CHECK (length(btrim(lease_owner)) BETWEEN 1 AND 100),
  CONSTRAINT outbox_lease_ck CHECK ((state='leased' AND num_nonnulls(lease_until,lease_owner,lease_token)=3 AND lease_generation>0 AND lease_until>updated_at) OR (state<>'leased' AND num_nonnulls(lease_until,lease_owner,lease_token)=0)),
  CONSTRAINT outbox_published_ck CHECK ((state='published')=(published_at IS NOT NULL) AND (published_at IS NULL OR published_at >= created_at)),
  CONSTRAINT outbox_revision_ck CHECK (revision > 0),
  CONSTRAINT outbox_updated_ck CHECK (updated_at >= created_at)
);

CREATE INDEX outbox_pending_idx ON app.outbox(available_at,id) WHERE state IN ('pending','failed');

CREATE INDEX outbox_lease_idx ON app.outbox(lease_until,id) WHERE lease_until IS NOT NULL;

CREATE INDEX outbox_aggregate_idx ON app.outbox(aggregate_kind,aggregate_id,id);

CREATE TABLE app.webhook_inbox (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  payload_digest bytea NOT NULL,
  raw_asset_id uuid,
  received_at timestamptz NOT NULL,
  signature_verified_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT webhook_inbox_pk PRIMARY KEY (id),
  CONSTRAINT webhook_inbox_u1 UNIQUE (provider,provider_event_id),
  CONSTRAINT webhook_inbox_provider_ck CHECK (length(btrim(provider)) BETWEEN 1 AND 100),
  CONSTRAINT webhook_inbox_provider_event_id_ck CHECK (length(btrim(provider_event_id)) BETWEEN 1 AND 200),
  CONSTRAINT webhook_inbox_payload_digest_ck CHECK (octet_length(payload_digest)=32),
  CONSTRAINT webhook_inbox_state_ck CHECK (state IN ('pending','processing','processed','quarantined','failed')),
  CONSTRAINT webhook_inbox_attempts_ck CHECK (attempts BETWEEN 0 AND 1000),
  CONSTRAINT webhook_inbox_last_error_code_ck CHECK (length(btrim(last_error_code)) BETWEEN 1 AND 100),
  CONSTRAINT webhook_inbox_signature_ck CHECK (signature_verified_at >= received_at),
  CONSTRAINT webhook_inbox_revision_ck CHECK (revision > 0),
  CONSTRAINT webhook_inbox_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT webhook_inbox_asset_fk FOREIGN KEY (raw_asset_id) REFERENCES app.object_assets(id) ON DELETE RESTRICT
);

CREATE INDEX webhook_inbox_asset_idx ON app.webhook_inbox(raw_asset_id);

CREATE INDEX webhook_inbox_pending_idx ON app.webhook_inbox(next_attempt_at,id) WHERE state IN ('pending','failed');

CREATE INDEX webhook_inbox_retention_idx ON app.webhook_inbox(received_at,id);

CREATE TABLE app.job_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  business_key text NOT NULL,
  schema_version integer NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  checkpoint jsonb,
  lease_until timestamptz,
  lease_token uuid,
  lease_generation bigint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT job_runs_pk PRIMARY KEY (id),
  CONSTRAINT job_runs_u1 UNIQUE (job_type,business_key),
  CONSTRAINT job_runs_job_type_ck CHECK (length(btrim(job_type)) BETWEEN 1 AND 100),
  CONSTRAINT job_runs_business_key_ck CHECK (length(btrim(business_key)) BETWEEN 1 AND 200),
  CONSTRAINT job_runs_version_ck CHECK (schema_version > 0),
  CONSTRAINT job_runs_state_ck CHECK (state IN ('pending','running','completed','failed','cancelled','manual_review')),
  CONSTRAINT job_runs_retry_ck CHECK (attempts BETWEEN 0 AND 1000 AND lease_generation>=0),
  CONSTRAINT job_runs_checkpoint_ck CHECK (jsonb_typeof(checkpoint)='object' AND octet_length(checkpoint::text) <= 65536),
  CONSTRAINT job_runs_last_error_code_ck CHECK (length(btrim(last_error_code)) BETWEEN 1 AND 100),
  CONSTRAINT job_runs_lease_ck CHECK ((state='running' AND num_nonnulls(lease_until,lease_token)=2 AND lease_generation>0 AND lease_until>updated_at) OR (state<>'running' AND num_nonnulls(lease_until,lease_token)=0)),
  CONSTRAINT job_runs_revision_ck CHECK (revision > 0),
  CONSTRAINT job_runs_updated_ck CHECK (updated_at >= created_at)
);

CREATE INDEX job_runs_pending_idx ON app.job_runs(next_attempt_at,id) WHERE state IN ('pending','failed');

CREATE INDEX job_runs_lease_idx ON app.job_runs(lease_until,id) WHERE lease_until IS NOT NULL;

CREATE TABLE admin.audit_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  action text NOT NULL,
  resource_kind text NOT NULL,
  result text NOT NULL,
  occurred_at timestamptz NOT NULL,
  change_digest text,
  field_names jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_pk PRIMARY KEY (id),
  CONSTRAINT audit_events_action_ck CHECK (length(btrim(action)) BETWEEN 1 AND 100),
  CONSTRAINT audit_events_resource_kind_ck CHECK (length(btrim(resource_kind)) BETWEEN 1 AND 100),
  CONSTRAINT audit_events_result_ck CHECK (result IN ('approved','denied','succeeded','failed','rejected')),
  CONSTRAINT audit_events_change_digest_ck CHECK (change_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT audit_events_fields_ck CHECK (CASE WHEN jsonb_typeof(field_names)='array' THEN jsonb_array_length(field_names)<=64 AND octet_length(field_names::text)<=4096 AND NOT jsonb_path_exists(field_names, '$[*] ? (@.type() != "string")') ELSE false END)
);

CREATE INDEX audit_events_occurred_idx ON admin.audit_events(occurred_at,id);

CREATE TRIGGER audit_events_immutable BEFORE UPDATE ON admin.audit_events FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();

CREATE TABLE admin.audit_identity_links (
  event_id uuid NOT NULL,
  actor_staff_id uuid,
  subject_id uuid,
  encrypted_context bytea,
  key_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_identity_links_pk PRIMARY KEY (event_id),
  CONSTRAINT audit_identity_links_envelope_ck CHECK ((encrypted_context IS NULL)=(key_version IS NULL)),
  CONSTRAINT audit_identity_links_encrypted_context_ck CHECK (octet_length(encrypted_context) BETWEEN 16 AND 65536),
  CONSTRAINT audit_identity_links_key_version_ck CHECK (length(btrim(key_version)) BETWEEN 1 AND 100),
  CONSTRAINT audit_identity_links_context_ck CHECK (num_nonnulls(actor_staff_id,subject_id,encrypted_context)>0),
  CONSTRAINT audit_identity_links_event_fk FOREIGN KEY (event_id) REFERENCES admin.audit_events(id) ON DELETE RESTRICT,
  CONSTRAINT audit_identity_links_actor_fk FOREIGN KEY (actor_staff_id) REFERENCES admin.staff_identities(id) ON DELETE RESTRICT,
  CONSTRAINT audit_identity_links_subject_fk FOREIGN KEY (subject_id) REFERENCES app.subjects(id) ON DELETE RESTRICT
);

CREATE INDEX audit_identity_links_actor_idx ON admin.audit_identity_links(actor_staff_id);

CREATE INDEX audit_identity_links_subject_idx ON admin.audit_identity_links(subject_id);

-- Resolve the previous migration's fail-closed placeholder only after the referenced table,
-- named FK and leading index exist. Existing NULL approvals remain valid and are not fabricated.
ALTER TABLE app.import_publications ADD CONSTRAINT import_publications_audit_fk
  FOREIGN KEY (approval_record_id) REFERENCES admin.audit_events(id) ON DELETE RESTRICT;
CREATE INDEX import_publications_audit_idx ON app.import_publications(approval_record_id);
ALTER TABLE app.import_publications DROP CONSTRAINT import_publications_audit_pending_ck;
COMMENT ON COLUMN app.import_publications.approval_record_id IS
  'Optional reviewed approval event; referential integrity enforced, authorization validated by publication service';
-- No runtime grants are introduced. Later repository/service cards add narrowly reviewed access.

CREATE TRIGGER idempotency_requests_identity BEFORE UPDATE ON app.idempotency_requests FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('actor_scope_hash','operation','key_hash','body_hash','canonical_version');

CREATE TRIGGER outbox_identity BEFORE UPDATE ON app.outbox FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('event_id','aggregate_kind','aggregate_id','event_type','schema_version','payload');

CREATE TRIGGER webhook_inbox_identity BEFORE UPDATE ON app.webhook_inbox FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('provider','provider_event_id','payload_digest','received_at','signature_verified_at');

CREATE TRIGGER job_runs_identity BEFORE UPDATE ON app.job_runs FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('job_type','business_key','schema_version');

CREATE TRIGGER report_capabilities_identity BEFORE UPDATE ON app.report_capabilities FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('report_id','report_version','scope','version_scope','token_hash','key_version');

CREATE TRIGGER download_grants_identity BEFORE UPDATE ON app.download_grants FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('asset_id','report_id','report_version','view_scope','owner_session_id','owner_subject_id','share_capability_id','share_version_binding','token_hash','key_version');

CREATE TRIGGER verification_challenges_identity BEFORE UPDATE ON privacy.verification_challenges FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('subject_id','purpose','token_hash','key_version','notice_id');

CREATE TRIGGER email_links_identity BEFORE UPDATE ON email.email_links FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('send_id','slot','purpose','approved_destination','token_hash','key_version');

CREATE TRIGGER send_receipts_identity BEFORE UPDATE ON email.send_receipts FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('send_id','provider','provider_key_digest','payload_digest');

CREATE TRIGGER send_attempts_identity BEFORE UPDATE ON email.send_attempts FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('send_id','attempt_no','started_at');

CREATE TRIGGER email_events_identity BEFORE UPDATE ON email.email_events FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('provider','provider_event_id','type','occurred_at','received_at','classification');

CREATE FUNCTION app.guard_lease_generation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.lease_generation < OLD.lease_generation OR
     (NEW.lease_token IS NOT NULL AND NEW.lease_token IS DISTINCT FROM OLD.lease_token AND NEW.lease_generation <= OLD.lease_generation) THEN
    RAISE EXCEPTION 'A new lease requires a newer fencing generation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_fence BEFORE UPDATE ON app.outbox FOR EACH ROW EXECUTE FUNCTION app.guard_lease_generation();
CREATE TRIGGER job_runs_fence BEFORE UPDATE ON app.job_runs FOR EACH ROW EXECUTE FUNCTION app.guard_lease_generation();
