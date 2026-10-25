-- Ordered public publication receipts and narrow process credentials. No live collection is enabled.
CREATE TABLE app.content_publications (
  content_key text NOT NULL CHECK(length(btrim(content_key)) BETWEEN 1 AND 200),
  locale text NOT NULL,
  market text NOT NULL,
  generation bigint NOT NULL CHECK(generation>0),
  content_id uuid REFERENCES app.published_content(id) ON DELETE RESTRICT,
  checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),
  published_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK(expires_at>published_at),
  PRIMARY KEY(content_key,locale,market,generation),
  FOREIGN KEY(market,locale) REFERENCES app.market_locales(market_code,locale_code) ON DELETE RESTRICT
);
CREATE INDEX content_publications_content_idx ON app.content_publications(content_id);
CREATE INDEX content_publications_market_idx ON app.content_publications(market,locale);
CREATE TRIGGER content_publications_immutable BEFORE UPDATE OR DELETE ON app.content_publications
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE TABLE app.content_publication_heads (
  content_key text NOT NULL,
  locale text NOT NULL,
  market text NOT NULL,
  generation bigint NOT NULL,
  PRIMARY KEY(content_key,locale,market),
  FOREIGN KEY(content_key,locale,market,generation) REFERENCES app.content_publications(content_key,locale,market,generation) ON DELETE RESTRICT
);
CREATE VIEW app.current_public_content WITH(security_barrier=true) AS
 SELECT h.content_key,h.locale,h.market,p.public_dto,p.content_hash
 FROM app.content_publication_heads h JOIN app.content_publications r USING(content_key,locale,market,generation)
 JOIN app.published_content p ON p.id=r.content_id
 WHERE r.published_at<=clock_timestamp() AND r.expires_at>clock_timestamp();
CREATE INDEX content_publication_heads_receipt_idx ON app.content_publication_heads(content_key,locale,market,generation);
CREATE TRIGGER subjects_identity BEFORE UPDATE ON app.subjects FOR EACH ROW
 EXECUTE FUNCTION app.guard_identity_columns('id');

CREATE TABLE app.public_configurations (
  version integer PRIMARY KEY CHECK(version>0),
  configuration_id uuid NOT NULL UNIQUE REFERENCES admin.configuration_versions(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '24 hours'),
  analytics boolean NOT NULL,
  advertising boolean NOT NULL,
  checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$')
);
CREATE TRIGGER public_configurations_immutable BEFORE UPDATE OR DELETE ON app.public_configurations
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE VIEW app.public_configuration WITH(security_barrier=true) AS
 SELECT version,issued_at,expires_at,analytics,advertising,checksum FROM app.public_configurations
 WHERE version=(SELECT max(version) FROM app.public_configurations);

CREATE VIEW admin.staff_projection WITH(security_barrier=true) AS
 SELECT s.id,s.status,ARRAY(SELECT r.code FROM admin.staff_role_assignments a JOIN admin.roles r ON r.id=a.role_id WHERE a.staff_id=s.id AND a.revoked_at IS NULL ORDER BY r.code) AS roles
 FROM admin.staff_identities s;
CREATE VIEW admin.configuration_projection WITH(security_barrier=true) AS
 SELECT key,version,status FROM admin.configuration_versions;
CREATE VIEW admin.affiliate_projection WITH(security_barrier=true) AS
 SELECT l.link_key,l.market,l.destination,c.checked_at FROM admin.affiliate_links l
 CROSS JOIN LATERAL (SELECT checked_at,result,expires_at FROM admin.affiliate_link_checks WHERE link_id=l.id ORDER BY checked_at DESC,id DESC LIMIT 1) c
 WHERE l.status='active' AND c.result='valid' AND c.expires_at>clock_timestamp();
CREATE VIEW admin.ad_slot_projection WITH(security_barrier=true) AS
 SELECT s.slot_key,s.route_class,(s.status='active' AND c.status='published') AS active
 FROM admin.ad_slots s JOIN admin.configuration_versions c ON c.id=s.configuration_id;
-- This is a column-only public projection, with no hidden row predicate. Allow indexed LIMIT pushdown.
CREATE VIEW admin.seo_projection AS
 SELECT id,public_path,canonical_path,index_status,review_due_at FROM admin.seo_page_registry;
CREATE VIEW admin.search_projection WITH(security_barrier=true) AS
 SELECT page_id,day,source,clicks,impressions,position_sum FROM admin.search_daily_metrics;

-- Subject restrictions and aggregate hiding commit together, including restrictions made by PR-011.
CREATE FUNCTION analytics.invalidate_days(days date[], privacy_change boolean) RETURNS void
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d date;
BEGIN
 FOR d IN SELECT DISTINCT unnest(days) ORDER BY 1 LOOP
  INSERT INTO analytics.dirty_days(day,requested_revision,privacy_revision,privacy_blocked,requested_at,next_attempt_at)
  VALUES(d,1,CASE WHEN privacy_change THEN 1 ELSE 0 END,privacy_change,clock_timestamp(),clock_timestamp())
  ON CONFLICT(day) DO UPDATE SET requested_revision=analytics.dirty_days.requested_revision+1,
    privacy_revision=CASE WHEN privacy_change THEN analytics.dirty_days.requested_revision+1 ELSE analytics.dirty_days.privacy_revision END,
    privacy_blocked=analytics.dirty_days.privacy_blocked OR privacy_change,
    requested_at=clock_timestamp(),updated_at=clock_timestamp(),revision=analytics.dirty_days.revision+1,
    lease_token=CASE WHEN analytics.dirty_days.lease_until>clock_timestamp() THEN analytics.dirty_days.lease_token END,
    lease_until=CASE WHEN analytics.dirty_days.lease_until>clock_timestamp() THEN analytics.dirty_days.lease_until END;
 END LOOP;
END $$;
CREATE FUNCTION analytics.restrict_subject() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.status<>'active' AND OLD.status IS DISTINCT FROM NEW.status THEN
  PERFORM analytics.invalidate_days(ARRAY(SELECT DISTINCT event_day FROM analytics.events WHERE subject_id=NEW.id),true);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subjects_analytics_restriction AFTER UPDATE OF status ON app.subjects FOR EACH ROW EXECUTE FUNCTION analytics.restrict_subject();

GRANT USAGE ON SCHEMA app,admin TO tt_content_runtime;
GRANT SELECT,INSERT ON app.published_content,app.content_publications,app.public_configurations TO tt_content_runtime;
GRANT INSERT,SELECT(id) ON admin.configuration_versions TO tt_content_runtime;
GRANT SELECT,INSERT,UPDATE ON app.content_publication_heads TO tt_content_runtime;
GRANT SELECT(id,status) ON admin.staff_identities TO tt_content_runtime;
GRANT USAGE ON SCHEMA app TO tt_public_runtime;
GRANT SELECT ON app.current_public_content,app.public_configuration TO tt_public_runtime;
GRANT USAGE ON SCHEMA app,admin,analytics TO tt_operations_runtime;
GRANT SELECT ON admin.staff_projection,admin.configuration_projection,admin.affiliate_projection,admin.ad_slot_projection,admin.seo_projection,admin.search_projection,admin.current_ad_daily_metrics,analytics.visible_daily_metrics TO tt_operations_runtime;
GRANT USAGE ON SCHEMA app,privacy,analytics TO tt_analytics_runtime;
GRANT SELECT(id,status,permission_revision,expires_at),UPDATE(id) ON app.subjects TO tt_analytics_runtime;
GRANT SELECT(subject_id,purpose,scope_key,status,expires_at,policy_version,effective_at) ON privacy.consent_state TO tt_analytics_runtime;
GRANT SELECT,INSERT,DELETE ON analytics.events,analytics.daily_metrics TO tt_analytics_runtime;
-- Immutable-event trigger still rejects UPDATE; this column privilege permits row locks for purge.
GRANT UPDATE(id) ON analytics.events TO tt_analytics_runtime;
GRANT SELECT,INSERT,UPDATE ON analytics.dirty_days TO tt_analytics_runtime;
GRANT EXECUTE ON FUNCTION analytics.invalidate_days(date[],boolean) TO tt_analytics_runtime;
GRANT USAGE ON SCHEMA app TO tt_limiter_runtime;
-- Row-lock privilege on an immutable identity column; the existing trigger forbids changing it.
GRANT SELECT,UPDATE(policy_key) ON app.rate_limit_policies TO tt_limiter_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.rate_limit_buckets TO tt_limiter_runtime;
