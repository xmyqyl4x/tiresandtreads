-- P1-PR-005: private staging, source health, checkpoints and publication metadata.
-- Operator-only schemas; fetching, validation, fencing and publication use cases follow at S3.

CREATE TABLE app.source_connectors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  kind text NOT NULL,
  allowed_origin text NOT NULL,
  allowed_path_prefix text NOT NULL,
  schema_version text NOT NULL,
  schedule_key text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT source_connectors_pk PRIMARY KEY (id),
  CONSTRAINT source_connectors_u1 UNIQUE (provider_id,kind),
  CONSTRAINT source_connectors_u2 UNIQUE (provider_id,id),
  CONSTRAINT source_connectors_status_ck CHECK (status IN ('active','disabled')),
  CONSTRAINT source_connectors_origin_ck CHECK (allowed_origin ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$' AND length(allowed_origin) <= 300),
  CONSTRAINT source_connectors_path_ck CHECK (allowed_path_prefix ~ '^/[A-Za-z0-9/_-]*$' AND length(allowed_path_prefix) <= 300),
  CONSTRAINT source_connectors_version_ck CHECK (length(schema_version) BETWEEN 1 AND 80 AND length(schedule_key) BETWEEN 1 AND 100),
  CONSTRAINT source_connectors_revision_ck CHECK (revision > 0 AND updated_at >= created_at),
  CONSTRAINT source_connectors_provider_fk FOREIGN KEY (provider_id) REFERENCES app.data_providers(id) ON DELETE RESTRICT
);

CREATE TABLE app.import_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  dataset_version_id uuid,
  asset_id uuid,
  status text NOT NULL,
  checkpoint jsonb,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  accepted_count bigint NOT NULL DEFAULT 0,
  rejected_count bigint NOT NULL DEFAULT 0,
  upstream_run_key text NOT NULL,
  connector_id uuid,
  mode text NOT NULL,
  mapping_version text NOT NULL,
  content_hash text NOT NULL,
  schema_version text NOT NULL,
  requested_by uuid,
  expected_head_revision bigint,
  lease_until timestamptz,
  fence bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT import_runs_pk PRIMARY KEY (id),
  CONSTRAINT import_runs_u1 UNIQUE (provider_id,upstream_run_key),
  CONSTRAINT import_runs_u2 UNIQUE (provider_id,id),
  CONSTRAINT import_runs_status_ck CHECK (status IN ('registered','fetching','staging','validated','rejected','publishing','published','failed','cancelled')),
  CONSTRAINT import_runs_mode_ck CHECK (mode IN ('full','incremental','manual')),
  CONSTRAINT import_runs_times_ck CHECK (started_at IS NULL OR finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT import_runs_counts_ck CHECK (accepted_count >= 0 AND rejected_count >= 0),
  CONSTRAINT import_runs_checkpoint_ck CHECK (jsonb_typeof(checkpoint) = 'object' AND octet_length(checkpoint::text) <= 16384),
  CONSTRAINT import_runs_hash_ck CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT import_runs_fence_ck CHECK (fence >= 0 AND (lease_until IS NULL OR fence > 0)),
  CONSTRAINT import_runs_head_ck CHECK (expected_head_revision >= 0),
  CONSTRAINT import_runs_key_ck CHECK (length(upstream_run_key) BETWEEN 1 AND 200 AND length(mapping_version) BETWEEN 1 AND 80 AND length(schema_version) BETWEEN 1 AND 80),
  CONSTRAINT import_runs_revision_ck CHECK (revision > 0 AND updated_at >= created_at),
  CONSTRAINT import_runs_provider_fk FOREIGN KEY (provider_id) REFERENCES app.data_providers(id) ON DELETE RESTRICT,
  CONSTRAINT import_runs_dataset_fk FOREIGN KEY (provider_id,dataset_version_id) REFERENCES app.dataset_versions(provider_id,id) ON DELETE RESTRICT,
  CONSTRAINT import_runs_asset_fk FOREIGN KEY (asset_id) REFERENCES app.object_assets(id) ON DELETE RESTRICT,
  CONSTRAINT import_runs_connector_fk FOREIGN KEY (provider_id,connector_id) REFERENCES app.source_connectors(provider_id,id) ON DELETE RESTRICT,
  CONSTRAINT import_runs_requested_by_fk FOREIGN KEY (requested_by) REFERENCES admin.staff_identities(id) ON DELETE RESTRICT
);

CREATE INDEX import_runs_f2_idx ON app.import_runs(provider_id,dataset_version_id);

CREATE INDEX import_runs_f3_idx ON app.import_runs(asset_id);

CREATE INDEX import_runs_f4_idx ON app.import_runs(provider_id,connector_id);

CREATE INDEX import_runs_f5_idx ON app.import_runs(requested_by);

CREATE INDEX import_runs_q1_idx ON app.import_runs(dataset_version_id);

CREATE INDEX import_runs_q2_idx ON app.import_runs(connector_id);

CREATE INDEX import_runs_q3_idx ON app.import_runs(status,started_at,id);

CREATE INDEX import_runs_q4_idx ON app.import_runs(lease_until,id);

CREATE INDEX import_runs_q5_idx ON app.import_runs(provider_id,content_hash,mapping_version);

CREATE TABLE app.feed_health (
  provider_id uuid NOT NULL,
  kind text NOT NULL,
  last_attempt_at timestamptz NOT NULL,
  last_success_at timestamptz,
  last_run_id uuid,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT feed_health_pk PRIMARY KEY (provider_id,kind),
  CONSTRAINT feed_health_times_ck CHECK (last_success_at IS NULL OR last_success_at <= last_attempt_at),
  CONSTRAINT feed_health_kind_ck CHECK (length(kind) BETWEEN 1 AND 80),
  CONSTRAINT feed_health_revision_ck CHECK (revision > 0 AND updated_at >= created_at),
  CONSTRAINT feed_health_provider_fk FOREIGN KEY (provider_id) REFERENCES app.data_providers(id) ON DELETE RESTRICT,
  CONSTRAINT feed_health_run_fk FOREIGN KEY (provider_id,last_run_id) REFERENCES app.import_runs(provider_id,id) ON DELETE RESTRICT
);

CREATE INDEX feed_health_f2_idx ON app.feed_health(provider_id,last_run_id);

CREATE INDEX feed_health_q1_idx ON app.feed_health(last_run_id);

CREATE INDEX feed_health_q2_idx ON app.feed_health(kind,last_success_at);

CREATE TABLE app.import_staging_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  row_number bigint NOT NULL,
  source_key text NOT NULL,
  normalized jsonb NOT NULL,
  validation_status text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_staging_rows_pk PRIMARY KEY (id),
  CONSTRAINT import_staging_rows_u1 UNIQUE (run_id,row_number),
  CONSTRAINT import_staging_rows_number_ck CHECK (row_number > 0),
  CONSTRAINT import_staging_rows_normalized_ck CHECK (jsonb_typeof(normalized) = 'object' AND octet_length(normalized::text) <= 65536),
  CONSTRAINT import_staging_rows_status_ck CHECK (validation_status IN ('pending','accepted','rejected','duplicate')),
  CONSTRAINT import_staging_rows_expires_ck CHECK (expires_at > created_at),
  CONSTRAINT import_staging_rows_source_ck CHECK (length(source_key) BETWEEN 1 AND 512),
  CONSTRAINT import_staging_rows_run_fk FOREIGN KEY (run_id) REFERENCES app.import_runs(id) ON DELETE RESTRICT
);

CREATE INDEX import_staging_rows_q1_idx ON app.import_staging_rows(run_id,validation_status,row_number);

CREATE INDEX import_staging_rows_q2_idx ON app.import_staging_rows(run_id,source_key);

CREATE INDEX import_staging_rows_q3_idx ON app.import_staging_rows(expires_at,id);

CREATE TABLE app.import_rejections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  record_key text NOT NULL,
  reason_code text NOT NULL,
  redacted_details jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_rejections_pk PRIMARY KEY (id),
  CONSTRAINT import_rejections_u1 UNIQUE (run_id,record_key,reason_code),
  CONSTRAINT import_rejections_details_ck CHECK (jsonb_typeof(redacted_details) = 'object' AND octet_length(redacted_details::text) <= 8192),
  CONSTRAINT import_rejections_expires_ck CHECK (expires_at > created_at),
  CONSTRAINT import_rejections_reason_ck CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,79}$' AND length(record_key) BETWEEN 1 AND 512),
  CONSTRAINT import_rejections_run_fk FOREIGN KEY (run_id) REFERENCES app.import_runs(id) ON DELETE RESTRICT
);

CREATE INDEX import_rejections_q1_idx ON app.import_rejections(expires_at,id);

CREATE TABLE app.import_artifacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  kind text NOT NULL,
  asset_id uuid NOT NULL,
  checksum text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_artifacts_pk PRIMARY KEY (id),
  CONSTRAINT import_artifacts_kind_ck CHECK (kind IN ('manifest','diff','validation','original')),
  CONSTRAINT import_artifacts_hash_ck CHECK (checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT import_artifacts_expires_ck CHECK (expires_at > created_at),
  CONSTRAINT import_artifacts_run_fk FOREIGN KEY (run_id) REFERENCES app.import_runs(id) ON DELETE RESTRICT,
  CONSTRAINT import_artifacts_asset_fk FOREIGN KEY (asset_id) REFERENCES app.object_assets(id) ON DELETE RESTRICT
);

CREATE INDEX import_artifacts_f1_idx ON app.import_artifacts(run_id);

CREATE INDEX import_artifacts_f2_idx ON app.import_artifacts(asset_id);

CREATE INDEX import_artifacts_q1_idx ON app.import_artifacts(expires_at,id);

-- No automated publisher is activated. Later policy review registers a bounded service actor.
INSERT INTO app.code_sets(code,description) VALUES ('import_service_actor','Reviewed import publisher service identities; empty until service activation');

CREATE TABLE app.import_publications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  bundle_id uuid NOT NULL,
  market text NOT NULL,
  bundle_status text NOT NULL DEFAULT 'published',
  previous_bundle_id uuid,
  actor_id uuid,
  service_actor_key text,
  service_actor_set text NOT NULL DEFAULT 'import_service_actor',
  approval_record_id uuid,
  published_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_publications_pk PRIMARY KEY (id),
  CONSTRAINT import_publications_u1 UNIQUE (run_id,market),
  CONSTRAINT import_publications_actor_ck CHECK (num_nonnulls(actor_id,service_actor_key)=1),
  CONSTRAINT import_publications_status_ck CHECK (bundle_status='published' AND service_actor_set='import_service_actor'),
  CONSTRAINT import_publications_audit_pending_ck CHECK (approval_record_id IS NULL),
  CONSTRAINT import_publications_run_fk FOREIGN KEY (run_id) REFERENCES app.import_runs(id) ON DELETE RESTRICT,
  CONSTRAINT import_publications_bundle_fk FOREIGN KEY (bundle_id,market,bundle_status) REFERENCES app.dataset_bundles(id,market,status) ON DELETE RESTRICT,
  CONSTRAINT import_publications_previous_fk FOREIGN KEY (previous_bundle_id,market) REFERENCES app.dataset_bundles(id,market) ON DELETE RESTRICT,
  CONSTRAINT import_publications_actor_fk FOREIGN KEY (actor_id) REFERENCES admin.staff_identities(id) ON DELETE RESTRICT,
  CONSTRAINT import_publications_service_actor_fk FOREIGN KEY (service_actor_set,service_actor_key) REFERENCES app.code_values(set_code,code) ON DELETE RESTRICT
);

CREATE INDEX import_publications_f2_idx ON app.import_publications(bundle_id,market,bundle_status);

CREATE INDEX import_publications_f3_idx ON app.import_publications(previous_bundle_id,market);

CREATE INDEX import_publications_f4_idx ON app.import_publications(actor_id);

CREATE INDEX import_publications_f5_idx ON app.import_publications(service_actor_set,service_actor_key);

CREATE INDEX import_publications_q1_idx ON app.import_publications(market,published_at,id);

-- P1-PR-006 must replace the fail-closed NULL check with the FK to admin.audit_events.
-- No dangling approval IDs can be stored during this stage of the database-first sequence.
COMMENT ON COLUMN app.import_publications.approval_record_id IS
  'P1-PR-006: add admin.audit_events FK before removing import_publications_audit_pending_ck';
CREATE TRIGGER import_publications_immutable BEFORE UPDATE OR DELETE ON app.import_publications
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
-- No runtime grants, importer executable, live source data or automatic publication introduced.
