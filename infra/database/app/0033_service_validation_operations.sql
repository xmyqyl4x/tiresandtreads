-- Bounded, identity-free S3 operational inspection. No service or provider is activated.
CREATE INDEX request_work_ready_idx ON privacy.request_work(next_attempt_at,request_id);
CREATE INDEX request_work_notification_idx ON privacy.request_work(proof_expires_at,request_id) WHERE notified_at IS NULL;
CREATE INDEX recovery_commands_health_idx ON admin.recovery_commands(state,created_at,id);
CREATE INDEX recovery_commands_unsettled_age_idx ON admin.recovery_commands(created_at,id) WHERE state IN ('unknown','executing');
CREATE INDEX callback_health_age_idx ON app.webhook_inbox(received_at,id) WHERE provider='resend' AND state IN ('pending','failed');
CREATE INDEX analytics_health_age_idx ON analytics.dirty_days(requested_at,day) WHERE completed_revision<requested_revision;
CREATE VIEW admin.service_health WITH(security_barrier=true) AS
 SELECT 'privacy_work'::text AS code,count(*)::integer AS queued,min(at) AS oldest_at,statement_timestamp() AS sampled_at,NULL::integer AS capacity FROM (
 SELECT w.next_attempt_at AS at FROM privacy.request_work w JOIN privacy.privacy_requests r ON r.id=w.request_id WHERE r.status IN ('verified','processing') AND w.next_attempt_at<=statement_timestamp() ORDER BY w.next_attempt_at,w.request_id LIMIT 1001)s
 UNION ALL SELECT 'privacy_notifications',count(*)::integer,min(at),statement_timestamp(),NULL::integer FROM (
 SELECT r.created_at AS at FROM privacy.request_work w JOIN privacy.privacy_requests r ON r.id=w.request_id WHERE r.status='pending' AND w.notified_at IS NULL AND w.proof_expires_at>statement_timestamp() ORDER BY r.created_at,r.id LIMIT 1001)s
 UNION ALL SELECT 'privacy_overdue',count(*)::integer,min(at),statement_timestamp(),NULL::integer FROM (
 SELECT due_at AS at FROM privacy.privacy_requests WHERE status IN ('verified','processing','manual_review') AND due_at<=statement_timestamp() ORDER BY due_at,id LIMIT 1001)s
 UNION ALL SELECT 'deliveries',count(*)::integer,min(at),statement_timestamp(),NULL::integer FROM (
 SELECT send_after AS at FROM email.email_sends WHERE dispatch_state='scheduled' AND send_after<=statement_timestamp() ORDER BY send_after,id LIMIT 1001)s
 UNION ALL SELECT 'uncertain_mail',count(*)::integer,min(at),statement_timestamp(),NULL::integer FROM (
 SELECT updated_at AS at FROM email.email_sends WHERE dispatch_state IN ('uncertain','manual_review') ORDER BY updated_at,id LIMIT 1001)s
 UNION ALL SELECT 'callbacks',count(*)::integer,min(at),statement_timestamp(),NULL::integer FROM (
 SELECT received_at AS at FROM app.webhook_inbox WHERE provider='resend' AND state IN ('pending','failed') ORDER BY received_at,id LIMIT 1001)s
 UNION ALL SELECT 'analytics',count(*)::integer,min(at),statement_timestamp(),NULL::integer FROM (
 SELECT requested_at AS at FROM analytics.dirty_days WHERE completed_revision<requested_revision ORDER BY requested_at,day LIMIT 1001)s
 UNION ALL SELECT 'outbox',count(*)::integer,min(at),statement_timestamp(),NULL::integer FROM (
 SELECT available_at AS at FROM app.outbox WHERE state IN ('pending','failed') ORDER BY available_at,id LIMIT 1001)s
 UNION ALL SELECT 'recovery_unknown',count(*)::integer,min(at),statement_timestamp(),NULL::integer FROM (
 SELECT created_at AS at FROM admin.recovery_commands WHERE state='unknown' OR (state='executing' AND created_at<statement_timestamp()-interval '10 seconds') ORDER BY created_at,id LIMIT 1001)s
 UNION ALL SELECT 'quota_capacity',used_rows,NULL::timestamptz,statement_timestamp(),max_rows FROM app.rate_limit_capacity WHERE singleton;
GRANT SELECT ON admin.service_health TO tt_operations_runtime;
