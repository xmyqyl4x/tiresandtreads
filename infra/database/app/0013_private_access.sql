-- Trusted private workflow process only; public/catalog/CMS roles gain no access.
-- This role composes private repositories on one transaction connection. Service authorization
-- remains mandatory. It cannot publish datasets, read storage keys, administer staff or purge history.
GRANT USAGE ON SCHEMA app,privacy,email TO tt_private_runtime;
GRANT SELECT,INSERT,UPDATE ON app.subjects,app.owner_sessions,app.reports,app.report_drafts,app.shop_quotes,
  app.report_capabilities,app.download_grants,app.outbox,app.webhook_inbox,
  privacy.contacts,privacy.consent_state,privacy.suppressions,
  privacy.report_private_data,privacy.privacy_requests,privacy.fulfillment_steps,
  email.email_sends,email.send_attempts,email.send_receipts TO tt_private_runtime;
GRANT SELECT,INSERT ON app.report_versions,app.report_items,app.comparisons,app.comparison_items,app.report_assets,
  privacy.contact_lookups,privacy.consent_events,privacy.subject_links,privacy.deletion_markers TO tt_private_runtime;
GRANT DELETE ON app.report_drafts TO tt_private_runtime;
GRANT SELECT(id,status) ON app.dataset_bundles,app.rule_versions TO tt_private_runtime;
GRANT SELECT ON privacy.notices,email.template_versions TO tt_private_runtime;
GRANT SELECT(id,purpose,state,expires_at,sha256,size_bytes,mime_type) ON app.object_assets TO tt_private_runtime;
GRANT EXECUTE ON FUNCTION privacy.valid_purposes(jsonb) TO tt_private_runtime;
CREATE INDEX reports_owner_cursor_idx ON app.reports(owner_subject_id,id);
CREATE INDEX shop_quotes_report_cursor_idx ON app.shop_quotes(report_id,id);
-- Owner and identity bindings must not be reassigned during rotation or revision updates.
CREATE TRIGGER owner_sessions_identity BEFORE UPDATE ON app.owner_sessions FOR EACH ROW
  EXECUTE FUNCTION app.guard_identity_columns('id','subject_id','token_hash','key_version');
CREATE TRIGGER reports_owner_identity BEFORE UPDATE ON app.reports FOR EACH ROW
  EXECUTE FUNCTION app.guard_identity_columns('id','owner_subject_id');
CREATE TRIGGER contacts_subject_identity BEFORE UPDATE ON privacy.contacts FOR EACH ROW
  EXECUTE FUNCTION app.guard_identity_columns('id','subject_id');
