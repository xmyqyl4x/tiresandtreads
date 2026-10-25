-- Refresh workers need approval verification fields, never the complete audit row.
REVOKE SELECT ON admin.audit_events FROM tt_ingest_runtime;
GRANT SELECT(id,action,resource_kind,result,occurred_at,change_digest) ON admin.audit_events TO tt_ingest_runtime;
