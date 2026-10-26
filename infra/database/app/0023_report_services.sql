-- P1-PR-019: scalar command receipts and explicitly chosen share comparison scope.
-- Tokens, input/output snapshots, contact information and notes remain forbidden in receipts.
ALTER TABLE app.idempotency_requests DROP CONSTRAINT idempotency_requests_response_ck;
ALTER TABLE app.idempotency_requests ADD CONSTRAINT idempotency_requests_response_ck CHECK (
 safe_response IS NULL OR (jsonb_typeof(safe_response)='object' AND octet_length(safe_response::text)<=1024
 AND safe_response - ARRAY['schema_version','resource_id','status','report_id','report_version','result_revision','token_key_version','expires_at']='{}'::jsonb
 AND NOT jsonb_path_exists(safe_response,'$.* ? (@.type() == "object" || @.type() == "array")')));
ALTER TABLE app.report_capabilities ADD COLUMN comparison_revision bigint;
ALTER TABLE app.report_capabilities ADD CONSTRAINT report_capabilities_comparison_scope_ck CHECK (comparison_revision IS NULL OR (report_version IS NOT NULL AND comparison_revision>0));
ALTER TABLE app.report_capabilities ADD CONSTRAINT report_capabilities_comparison_fk FOREIGN KEY(report_id,report_version,comparison_revision) REFERENCES app.comparisons(report_id,report_version,revision) ON DELETE RESTRICT;
CREATE INDEX report_capabilities_comparison_idx ON app.report_capabilities(report_id,report_version,comparison_revision);
CREATE TRIGGER report_capabilities_binding BEFORE UPDATE ON app.report_capabilities FOR EACH ROW
 EXECUTE FUNCTION app.guard_identity_columns('id','report_id','report_version','comparison_revision','scope','version_scope','token_hash','key_version','expires_at');
CREATE TABLE app.report_policy_heads (
 market text NOT NULL REFERENCES app.markets(code) ON DELETE RESTRICT,
 region_key text NOT NULL CHECK(region_key ~ '^[A-Z0-9_-]{1,80}$'),
 rule_version_id uuid NOT NULL REFERENCES app.rule_versions(id) ON DELETE RESTRICT,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(market,region_key)
);
CREATE INDEX report_policy_heads_rule_idx ON app.report_policy_heads(rule_version_id);
CREATE TRIGGER report_policy_heads_identity BEFORE UPDATE ON app.report_policy_heads FOR EACH ROW
 EXECUTE FUNCTION app.guard_identity_columns('market','region_key');
GRANT SELECT,INSERT,UPDATE ON app.report_policy_heads TO tt_publish_runtime;
CREATE VIEW app.report_policies WITH (security_barrier=true) AS
 SELECT r.id,r.version,r.document,r.reviewed_by,r.reviewed_at FROM app.rule_versions r
 JOIN app.report_policy_heads h ON h.rule_version_id=r.id AND h.market='US' AND h.region_key=r.document->>'regionKey'
 JOIN admin.staff_identities s ON s.id=r.reviewed_by
 WHERE r.kind='recommendation' AND r.status='published' AND r.schema_version=1
 AND r.reviewed_at<=statement_timestamp() AND s.status='active';
GRANT SELECT ON app.report_policies TO tt_catalog_runtime;
GRANT SELECT,INSERT,UPDATE ON privacy.quote_private_data TO tt_private_runtime;
-- Report consumers can verify existing source approvals/freshness without ingestion credentials.
GRANT USAGE ON SCHEMA app,admin TO tt_report_source_runtime;
GRANT SELECT ON app.source_connectors TO tt_report_source_runtime;
GRANT UPDATE(id) ON app.source_connectors TO tt_report_source_runtime;
GRANT SELECT(id,status) ON app.data_providers TO tt_report_source_runtime;
GRANT SELECT(id,provider_id,market,rights,rights_schema_version,effective_at,reviewed_at,expires_at) ON app.data_licenses TO tt_report_source_runtime;
GRANT SELECT(id,provider_id,license_id,status) ON app.dataset_versions TO tt_report_source_runtime;
GRANT SELECT(provider_id,kind,error_code,last_success_at,source_receipt,last_run_id) ON app.feed_health TO tt_report_source_runtime;
GRANT SELECT(id,dataset_version_id,status) ON app.import_runs TO tt_report_source_runtime;
GRANT SELECT(bundle_id,dataset_version_id) ON app.bundle_members TO tt_report_source_runtime;
GRANT SELECT(market,bundle_id) ON app.market_dataset_heads TO tt_report_source_runtime;
GRANT SELECT(id,action,resource_kind,result,occurred_at,change_digest) ON admin.audit_events TO tt_report_source_runtime;
GRANT EXECUTE ON FUNCTION app.lock_refresh_source(uuid,uuid) TO tt_report_source_runtime;
