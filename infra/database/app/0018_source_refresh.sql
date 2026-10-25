-- P1-PR-016: reviewed connector definitions and fenced, durable refresh metadata.
-- Legacy connectors/health rows have no reviewed policy and cannot establish freshness.
ALTER TABLE app.source_connectors ADD COLUMN license_id uuid,
 ADD COLUMN configuration jsonb, ADD COLUMN approval_record_id uuid, ADD COLUMN reviewed_by uuid,
 ADD CONSTRAINT source_connectors_license_fk FOREIGN KEY(provider_id,license_id) REFERENCES app.data_licenses(provider_id,id),
 ADD CONSTRAINT source_connectors_approval_fk FOREIGN KEY(approval_record_id) REFERENCES admin.audit_events(id),
 ADD CONSTRAINT source_connectors_reviewer_fk FOREIGN KEY(reviewed_by) REFERENCES admin.staff_identities(id),
 ADD CONSTRAINT source_connectors_configuration_ck CHECK(configuration IS NULL OR (jsonb_typeof(configuration)='object' AND octet_length(configuration::text)<=2048));
CREATE INDEX source_connectors_license_idx ON app.source_connectors(provider_id,license_id);
CREATE INDEX source_connectors_approval_idx ON app.source_connectors(approval_record_id);
CREATE INDEX source_connectors_reviewer_idx ON app.source_connectors(reviewed_by);
ALTER TABLE app.feed_health ADD COLUMN lease_token uuid, ADD COLUMN lease_until timestamptz,
 ADD COLUMN fence bigint NOT NULL DEFAULT 0, ADD COLUMN next_check_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN source_receipt jsonb, ADD COLUMN last_full_at timestamptz, ADD COLUMN failure_count integer NOT NULL DEFAULT 0,
 ADD CONSTRAINT feed_health_fence_ck CHECK(fence>=0 AND ((lease_token IS NULL AND lease_until IS NULL) OR (lease_token IS NOT NULL AND lease_until IS NOT NULL AND fence>0))),
 ADD CONSTRAINT feed_health_receipt_ck CHECK(source_receipt IS NULL OR (jsonb_typeof(source_receipt)='object' AND octet_length(source_receipt::text)<=8192)),
 ADD CONSTRAINT feed_health_failures_ck CHECK(failure_count>=0);
CREATE INDEX feed_health_due_idx ON app.feed_health(next_check_at,provider_id,kind);
GRANT USAGE ON SCHEMA admin TO tt_ingest_runtime;
GRANT SELECT ON admin.audit_events TO tt_ingest_runtime;
GRANT SELECT(id,status) ON admin.staff_identities TO tt_ingest_runtime;
GRANT INSERT ON app.source_connectors TO tt_ingest_runtime;
GRANT UPDATE(id) ON app.source_connectors TO tt_ingest_runtime;
GRANT INSERT ON app.feed_health TO tt_ingest_runtime;
GRANT INSERT ON app.outbox TO tt_ingest_runtime;
GRANT UPDATE(last_attempt_at,last_success_at,last_run_id,error_code,updated_at,revision,lease_token,lease_until,fence,next_check_at,source_receipt,last_full_at,failure_count) ON app.feed_health TO tt_ingest_runtime;
ALTER TABLE app.recall_source_targets ADD COLUMN do_not_drive boolean, ADD COLUMN park_outside boolean;
CREATE OR REPLACE VIEW app.catalog_recall_source_targets WITH(security_barrier=true) AS
 SELECT f.id,f.recall_id,f.target_key,f.brand_name,f.product_name,f.size_text,f.dot_pattern,f.manufactured_from,f.manufactured_to,f.match_status,f.schema_version,f.created_at,f.dataset_version_id,f.do_not_drive,f.park_outside
 FROM app.recall_source_targets f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE FUNCTION app.lock_refresh_source(provider uuid,license uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM p.id FROM app.data_providers p WHERE p.id=provider FOR SHARE;
 PERFORM l.id FROM app.data_licenses l WHERE l.id=license AND l.provider_id=provider FOR SHARE;
END $$;
GRANT EXECUTE ON FUNCTION app.lock_refresh_source(uuid,uuid) TO tt_ingest_runtime;
