ALTER TABLE analytics.events ADD COLUMN collection_scope text NOT NULL DEFAULT 'analytics' CHECK(length(btrim(collection_scope)) BETWEEN 1 AND 200);
ALTER TABLE analytics.daily_metrics ADD COLUMN valid_until timestamptz NOT NULL DEFAULT '-infinity';
CREATE TABLE analytics.processing_restrictions (
 subject_id uuid NOT NULL REFERENCES app.subjects(id) ON DELETE RESTRICT,
 scope_key text NOT NULL CHECK(length(btrim(scope_key)) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(subject_id,scope_key)
);
CREATE INDEX processing_restrictions_due_idx ON analytics.processing_restrictions(created_at,subject_id,scope_key);
CREATE TABLE analytics.replay_barriers (
 event_id uuid PRIMARY KEY,
 expires_at timestamptz NOT NULL
);
CREATE INDEX replay_barriers_expiry_idx ON analytics.replay_barriers(expires_at,event_id);
GRANT SELECT,INSERT,DELETE ON analytics.replay_barriers TO tt_analytics_runtime;
GRANT UPDATE(event_id) ON analytics.replay_barriers TO tt_analytics_runtime;
CREATE TRIGGER replay_barriers_immutable BEFORE UPDATE ON analytics.replay_barriers FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE FUNCTION analytics.withdraw_processing() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.purpose='analytics' AND NEW.status<>'confirmed' AND EXISTS(SELECT 1 FROM analytics.events WHERE subject_id=NEW.subject_id AND collection_scope=NEW.scope_key) THEN
  INSERT INTO analytics.processing_restrictions(subject_id,scope_key) VALUES(NEW.subject_id,NEW.scope_key) ON CONFLICT DO NOTHING;
  PERFORM analytics.invalidate_days(ARRAY(SELECT DISTINCT event_day FROM analytics.events WHERE subject_id=NEW.subject_id AND collection_scope=NEW.scope_key),true);
 END IF;
 IF TG_OP='UPDATE' AND NEW.purpose='analytics' AND NEW.status='confirmed' AND (NEW.policy_version IS DISTINCT FROM OLD.policy_version OR NEW.expires_at IS DISTINCT FROM OLD.expires_at) THEN
  PERFORM analytics.invalidate_days(ARRAY(SELECT DISTINCT event_day FROM analytics.events WHERE subject_id=NEW.subject_id AND collection_scope=NEW.scope_key),true);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consent_analytics_withdrawal AFTER INSERT OR UPDATE ON privacy.consent_state FOR EACH ROW EXECUTE FUNCTION analytics.withdraw_processing();
CREATE OR REPLACE VIEW analytics.visible_daily_metrics WITH(security_barrier=true) AS
 SELECT m.day,m.metric_code,m.market,m.dimension_key,m.value,m.generation,m.computed_at,m.definition_version,d.requested_revision,d.completed_revision
 FROM analytics.daily_metrics m JOIN analytics.dirty_days d ON d.day=m.day
 WHERE NOT d.privacy_blocked AND m.generation=d.completed_revision AND m.valid_until>clock_timestamp();
SELECT analytics.invalidate_days(ARRAY(SELECT day FROM analytics.dirty_days),true);
GRANT SELECT,INSERT,DELETE ON analytics.processing_restrictions TO tt_analytics_runtime;
GRANT SELECT ON analytics.processing_restrictions TO tt_private_runtime;
GRANT USAGE ON SCHEMA analytics TO tt_private_runtime;
CREATE FUNCTION analytics.suppress_processing() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE scopes text[];
BEGIN
 IF NEW.lifted_at IS NULL AND NEW.effective_at<=clock_timestamp() AND (NEW.expires_at IS NULL OR NEW.expires_at>clock_timestamp()) THEN
  scopes:=ARRAY(SELECT DISTINCT collection_scope FROM analytics.events WHERE subject_id=NEW.subject_id AND (NEW.scope_key IN ('analytics','all-analytics') OR collection_scope=NEW.scope_key));
  INSERT INTO analytics.processing_restrictions(subject_id,scope_key) SELECT NEW.subject_id,unnest(scopes) ON CONFLICT DO NOTHING;
  PERFORM analytics.invalidate_days(ARRAY(SELECT DISTINCT event_day FROM analytics.events WHERE subject_id=NEW.subject_id AND collection_scope=ANY(scopes)),true);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER suppressions_analytics_restriction AFTER INSERT OR UPDATE ON privacy.suppressions FOR EACH ROW EXECUTE FUNCTION analytics.suppress_processing();
CREATE VIEW analytics.current_permissions WITH(security_barrier=true) AS
 SELECT p.subject_id,p.purpose,p.scope_key,p.status,p.expires_at,p.policy_version,p.effective_at,
 least(p.expires_at,(SELECT min(s.effective_at) FROM privacy.suppressions s WHERE s.subject_id=p.subject_id AND s.scope_key IN ('analytics','all-analytics',p.scope_key) AND s.lifted_at IS NULL AND s.effective_at>statement_timestamp() AND (s.expires_at IS NULL OR s.expires_at>s.effective_at))) AS valid_until
 FROM privacy.consent_state p WHERE p.purpose='analytics' AND p.status='confirmed'
 AND NOT EXISTS(SELECT 1 FROM privacy.suppressions s WHERE s.subject_id=p.subject_id AND s.scope_key IN ('analytics','all-analytics',p.scope_key) AND s.lifted_at IS NULL AND s.effective_at<=statement_timestamp() AND (s.expires_at IS NULL OR s.expires_at>statement_timestamp()));
GRANT SELECT ON analytics.current_permissions TO tt_analytics_runtime;
CREATE INDEX daily_metrics_validity_idx ON analytics.daily_metrics(valid_until,day);

CREATE TABLE app.rate_limit_capacity (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 max_rows integer NOT NULL CHECK(max_rows BETWEEN 1 AND 1000000),
 used_rows integer NOT NULL CHECK(used_rows BETWEEN 0 AND max_rows)
);
INSERT INTO app.rate_limit_capacity(singleton,max_rows,used_rows) SELECT true,100000,count(*)::integer FROM app.rate_limit_buckets;
CREATE FUNCTION app.guard_quota_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  UPDATE app.rate_limit_capacity SET used_rows=used_rows+1 WHERE singleton AND used_rows<max_rows;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quota storage capacity exhausted' USING ERRCODE='54000'; END IF;
 ELSE UPDATE app.rate_limit_capacity SET used_rows=used_rows-1 WHERE singleton; END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER rate_buckets_capacity_insert AFTER INSERT ON app.rate_limit_buckets FOR EACH ROW EXECUTE FUNCTION app.guard_quota_capacity();
CREATE TRIGGER rate_buckets_capacity_delete AFTER DELETE ON app.rate_limit_buckets FOR EACH ROW EXECUTE FUNCTION app.guard_quota_capacity();
INSERT INTO app.rate_limit_policies(policy_key,policy_version,window_seconds,limit_value) VALUES('report_ip','1',10,3),('analytics_ip','1',60,60);
-- Collection and seeded policies remain disabled until their actual transport/activation gates.
INSERT INTO admin.roles(code,permissions,policy_version) VALUES('operations_read','["operations.read"]','1');
CREATE VIEW admin.runtime_health WITH(security_barrier=true) AS
 SELECT statement_timestamp() AS sampled_at,
 (SELECT count(*)::integer FROM(SELECT 1 FROM analytics.dirty_days WHERE completed_revision<requested_revision LIMIT 1001)s) AS analytics_pending,
 (SELECT count(*)::integer FROM(SELECT 1 FROM email.email_sends WHERE dispatch_state='scheduled' LIMIT 1001)s) AS sends_queued,
 (SELECT count(*)::integer FROM(SELECT 1 FROM email.email_sends WHERE dispatch_state IN ('uncertain','manual_review') LIMIT 1001)s) AS sends_uncertain,
 (SELECT count(*)::integer FROM(SELECT 1 FROM app.outbox WHERE state IN ('pending','failed') LIMIT 1001)s) AS outbox_pending,
 c.used_rows AS quota_rows,c.max_rows AS quota_capacity FROM app.rate_limit_capacity c WHERE c.singleton;
GRANT SELECT ON admin.runtime_health TO tt_operations_runtime;
