-- S3 services: masked operations, independently reviewed commercial policy and immutable reports.
CREATE FUNCTION admin.authorize_operations(actor uuid, permission text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF permission NOT IN ('commercial.manage','affiliate.manage','revenue.import','revenue.read','mail.recover','privacy.review','data.review','seo.publish') THEN RETURN false; END IF;
 PERFORM id FROM admin.staff_identities WHERE id=actor AND status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM a.staff_id FROM admin.staff_role_assignments a JOIN admin.roles r ON r.id=a.role_id
 WHERE a.staff_id=actor AND a.revoked_at IS NULL AND r.permissions ? permission FOR SHARE OF a,r;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION admin.authorize_operations(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.authorize_operations(uuid,text) TO tt_staff_service_runtime,tt_commercial_runtime;
INSERT INTO admin.roles(code,permissions,policy_version) VALUES
 ('commercial_operator','["commercial.manage","affiliate.manage","revenue.import","revenue.read"]','p1-commercial-v1'),
 ('revenue_analyst','["revenue.read"]','p1-commercial-v1'),
 ('support_operator','["mail.recover"]','p1-commercial-v1'),
 ('data_operator','["data.review"]','p1-commercial-v1');
-- No identities or assignments are provisioned by this migration.
CREATE TABLE admin.recovery_commands (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES admin.staff_identities(id),
 kind text NOT NULL CHECK(kind IN ('mail_reconcile','callback_replay','privacy_retry')),
 input_digest text NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('executing','succeeded','failed','unknown')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz,
 CHECK((state='executing')=(finished_at IS NULL))
);
CREATE INDEX recovery_commands_actor_idx ON admin.recovery_commands(actor_id,id);
CREATE TRIGGER recovery_commands_identity BEFORE UPDATE ON admin.recovery_commands FOR EACH ROW
 EXECUTE FUNCTION app.guard_identity_columns('id','actor_id','kind','input_digest','created_at');
CREATE TABLE admin.affiliate_check_bindings (
 check_id uuid PRIMARY KEY REFERENCES admin.affiliate_link_checks(id),
 link_revision bigint NOT NULL CHECK(link_revision>0),
 destination_hash text NOT NULL CHECK(destination_hash ~ '^[a-f0-9]{64}$')
);
CREATE TRIGGER affiliate_check_bindings_immutable BEFORE UPDATE OR DELETE ON admin.affiliate_check_bindings
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE TABLE admin.ad_metric_observations (
 metric_id uuid PRIMARY KEY REFERENCES admin.ad_daily_metrics(id),
 viewable_impressions bigint CHECK(viewable_impressions>=0),
 consent_requests bigint CHECK(consent_requests>=0),
 total_requests bigint CHECK(total_requests>=0),
 latency_samples bigint CHECK(latency_samples>0),
 latency_total_ms bigint CHECK(latency_total_ms>=0),
 CHECK((consent_requests IS NULL)=(total_requests IS NULL) AND consent_requests<=total_requests),
 CHECK((latency_samples IS NULL)=(latency_total_ms IS NULL))
);
CREATE UNIQUE INDEX ad_metric_financial_grain_idx ON admin.ad_daily_metrics(import_id,day,dimension_key,currency);
CREATE TRIGGER ad_metric_observations_immutable BEFORE UPDATE OR DELETE ON admin.ad_metric_observations
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE FUNCTION admin.guard_ad_observation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE parent text; impressions bigint;
BEGIN
 SELECT i.state,m.impressions INTO parent,impressions FROM admin.ad_daily_metrics m JOIN admin.ad_report_imports i ON i.id=m.import_id WHERE m.id=NEW.metric_id FOR SHARE OF i;
 IF parent='approved' OR NEW.viewable_impressions>impressions THEN RAISE EXCEPTION 'Invalid or frozen observation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ad_observation_guard BEFORE INSERT ON admin.ad_metric_observations FOR EACH ROW EXECUTE FUNCTION admin.guard_ad_observation();
CREATE VIEW admin.staff_mail_queue AS SELECT id,dispatch_state AS state,created_at AS due_at FROM email.email_sends WHERE dispatch_state IN ('uncertain','manual_review','failed');
CREATE VIEW admin.staff_callback_queue AS SELECT id,state,next_attempt_at AS due_at FROM app.webhook_inbox WHERE provider='resend' AND state IN ('pending','failed','quarantined');
CREATE VIEW admin.staff_import_queue AS SELECT id,status AS state,started_at AS due_at FROM app.import_runs WHERE status NOT IN ('published','cancelled');
CREATE VIEW admin.staff_privacy_queue AS SELECT id,status AS state,due_at FROM privacy.privacy_requests WHERE status NOT IN ('completed','rejected');
CREATE VIEW admin.staff_seo_queue AS SELECT id,status AS state,created_at AS due_at FROM admin.seo_findings WHERE status='open';
CREATE VIEW admin.commercial_policy WITH(security_barrier=true) AS
 SELECT c.version,c.value,COALESCE(a.status='verified' AND a.verified_at IS NOT NULL AND ac.status='published',false)
 AND EXISTS(SELECT 1 FROM app.public_configuration p WHERE p.advertising AND p.issued_at<=clock_timestamp() AND p.expires_at>clock_timestamp()) AS network_ready
 FROM admin.configuration_versions c LEFT JOIN admin.ad_network_accounts a ON a.id=(c.value->>'accountId')::uuid
 LEFT JOIN admin.configuration_versions ac ON ac.id=a.configuration_id
 WHERE c.key='commercial_policy' AND c.status='published' AND c.version=(SELECT max(version) FROM admin.configuration_versions WHERE key='commercial_policy' AND status='published');
CREATE VIEW admin.commercial_brands AS SELECT brand_key,market FROM admin.ad_brand_blocks;
CREATE VIEW admin.commercial_affiliates WITH(security_barrier=true) AS
 SELECT l.link_key,l.market,l.destination,r.approved_origin,c.checked_at
 FROM admin.affiliate_links l JOIN app.retailers r ON r.id=l.retailer_id
 CROSS JOIN LATERAL (SELECT ch.id,ch.result,ch.expires_at,ch.checked_at FROM admin.affiliate_link_checks ch WHERE ch.link_id=l.id ORDER BY ch.checked_at DESC,ch.id DESC LIMIT 1) c
 JOIN admin.affiliate_check_bindings b ON b.check_id=c.id AND b.link_revision=l.revision AND b.destination_hash=encode(sha256(convert_to(l.destination,'UTF8')),'hex')
 WHERE l.status='active' AND r.status='active' AND c.result='valid' AND c.expires_at>clock_timestamp()
 AND EXISTS(SELECT 1 FROM admin.affiliate_applications ap JOIN app.object_assets t ON t.id=ap.approved_terms_asset_id WHERE ap.retailer_id=l.retailer_id AND ap.status='approved' AND t.state='ready');
CREATE VIEW admin.commercial_revenue WITH(security_barrier=true) AS
 SELECT i.account_id,i.source_revision,i.source_generation,i.fetched_at,m.day,m.dimension_key,m.currency,m.impressions,m.eligible_requests,m.revenue_minor,m.revenue_status,
 o.viewable_impressions,o.consent_requests,o.total_requests,o.latency_samples,o.latency_total_ms
 FROM admin.ad_daily_metrics m JOIN admin.ad_report_imports i ON i.id=m.import_id LEFT JOIN admin.ad_metric_observations o ON o.metric_id=m.id
 WHERE i.state='approved' AND NOT EXISTS(SELECT 1 FROM admin.ad_report_imports newer WHERE newer.account_id=i.account_id AND newer.state='approved' AND m.day BETWEEN newer.period_start AND newer.period_end AND newer.source_generation>i.source_generation);
GRANT USAGE ON SCHEMA admin TO tt_staff_service_runtime,tt_commercial_runtime,tt_public_runtime;
GRANT SELECT ON admin.staff_mail_queue,admin.staff_callback_queue,admin.staff_import_queue,admin.staff_privacy_queue,admin.staff_seo_queue TO tt_staff_service_runtime;
GRANT SELECT,INSERT,UPDATE ON admin.recovery_commands TO tt_staff_service_runtime;
GRANT INSERT ON admin.audit_events,admin.audit_identity_links TO tt_staff_service_runtime,tt_commercial_runtime;
GRANT SELECT(id) ON admin.audit_events TO tt_staff_service_runtime,tt_commercial_runtime;
GRANT SELECT,INSERT ON admin.configuration_versions,admin.affiliate_link_checks,admin.affiliate_check_bindings,admin.ad_daily_metrics,admin.ad_metric_observations TO tt_commercial_runtime;
GRANT SELECT,INSERT,UPDATE ON admin.affiliate_links,admin.ad_slots,admin.ad_brand_blocks,admin.ad_report_imports TO tt_commercial_runtime;
GRANT SELECT,UPDATE(id) ON admin.ad_network_accounts TO tt_commercial_runtime;
GRANT USAGE ON SCHEMA app TO tt_commercial_runtime;
GRANT SELECT ON app.retailers,admin.affiliate_applications TO tt_commercial_runtime;
GRANT SELECT(id,state) ON app.object_assets TO tt_commercial_runtime;
GRANT SELECT ON admin.commercial_revenue TO tt_commercial_runtime;
GRANT SELECT ON admin.commercial_policy,admin.commercial_brands,admin.commercial_affiliates TO tt_public_runtime,tt_commercial_runtime;
GRANT SELECT ON app.public_pages,app.public_configuration TO tt_commercial_runtime;
CREATE TRIGGER ad_network_account_identity BEFORE UPDATE ON admin.ad_network_accounts FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('id');
