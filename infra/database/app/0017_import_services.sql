-- P1-PR-015: fenced service operations and immutable rollback event receipts.
-- Column-only read access supports replay without exposing other outbox state.
GRANT SELECT (event_id,aggregate_id,event_type,payload) ON app.outbox TO tt_publish_runtime;
CREATE INDEX import_staging_rows_diff_idx ON app.import_staging_rows(run_id,source_key) WHERE validation_status='accepted';
