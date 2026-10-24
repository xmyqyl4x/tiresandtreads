-- P1-PR-007: purpose-scoped events, privacy invalidation and bounded quotas. No runtime grants or optional cache.

INSERT INTO app.code_sets(code,description) VALUES
('analytics_event','Reviewed event vocabulary; collection remains disabled'),
('analytics_metric','Internal aggregate metric vocabulary'),
('analytics_dimension','Bounded non-identifying dimensions');
INSERT INTO app.code_values(set_code,code,label) VALUES
('analytics_event','public_page_view','Public page view'),('analytics_event','assessment_started','Assessment started'),
('analytics_event','report_viewed','Report viewed'),('analytics_event','comparison_saved','Comparison saved'),
('analytics_event','delivery_requested','Delivery requested'),
('analytics_metric','events','Accepted events'),('analytics_metric','sessions','Distinct sessions per day'),
('analytics_dimension','all','All'),('analytics_dimension','web','Web'),('analytics_dimension','app','App'),('analytics_dimension','mcp','MCP');

CREATE TABLE analytics.events (
  id uuid NOT NULL CONSTRAINT analytics_events_pk PRIMARY KEY,
  subject_id uuid NOT NULL,
  session_ref uuid,
  event_name text NOT NULL,
  event_set text NOT NULL DEFAULT 'analytics_event',
  schema_version integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  event_day date GENERATED ALWAYS AS ((received_at AT TIME ZONE 'UTC')::date) STORED,
  market text NOT NULL,
  locale text NOT NULL,
  route_template text NOT NULL,
  channel text NOT NULL,
  permission_revision bigint NOT NULL,
  policy_version text NOT NULL,
  props jsonb NOT NULL,
  payload_digest bytea NOT NULL,
  bot_classification text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_subject_fk FOREIGN KEY(subject_id) REFERENCES app.subjects(id) ON DELETE RESTRICT,
  CONSTRAINT events_name_fk FOREIGN KEY(event_set,event_name) REFERENCES app.code_values(set_code,code) ON DELETE RESTRICT,
  CONSTRAINT events_market_locale_fk FOREIGN KEY(market,locale) REFERENCES app.market_locales(market_code,locale_code) ON DELETE RESTRICT,
  CONSTRAINT events_versions_ck CHECK(event_set='analytics_event' AND schema_version>0 AND permission_revision>0 AND length(btrim(policy_version)) BETWEEN 1 AND 100),
  CONSTRAINT events_route_ck CHECK(route_template IN ('/','/assess','/reports/:report','/compare/:report','/learn/:slug','/guides/:slug','/glossary/:slug','/tires/models/:slug','/tires/sizes/:slug')),
  CONSTRAINT events_channel_ck CHECK(channel IN ('web','app','mcp')),
  CONSTRAINT events_props_ck CHECK(jsonb_typeof(props)='object' AND octet_length(props::text)<=4096 AND props-ARRAY['step','outcome']='{}'::jsonb AND (NOT props ? 'step' OR props->'step' IN ('"start"','"vehicle"','"tires"','"conditions"','"results"')) AND (NOT props ? 'outcome' OR props->'outcome' IN ('"success"','"denied"','"failed"'))),
  CONSTRAINT events_digest_ck CHECK(octet_length(payload_digest)=32),
  CONSTRAINT events_bot_ck CHECK(bot_classification IN ('unknown','internal','suspected_bot','not_flagged')),
  CONSTRAINT events_times_ck CHECK(occurred_at BETWEEN received_at-interval '24 hours' AND received_at+interval '5 minutes' AND expires_at>received_at AND expires_at<=received_at+interval '13 months')
);
CREATE INDEX events_subject_idx ON analytics.events(subject_id,id);
CREATE INDEX events_name_idx ON analytics.events(event_set,event_name);
CREATE INDEX events_market_locale_idx ON analytics.events(market,locale);
CREATE INDEX events_day_idx ON analytics.events(event_day,event_name,market,id);
CREATE INDEX events_expiry_idx ON analytics.events(expires_at,id);
CREATE TRIGGER events_immutable BEFORE UPDATE ON analytics.events FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();

CREATE TABLE analytics.dirty_days (
  day date NOT NULL,
  requested_revision bigint NOT NULL,
  completed_revision bigint NOT NULL DEFAULT 0,
  privacy_revision bigint NOT NULL DEFAULT 0,
  privacy_blocked boolean NOT NULL DEFAULT false,
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT dirty_days_pk PRIMARY KEY (day),
  CONSTRAINT dirty_days_generations_ck CHECK (requested_revision>0 AND completed_revision BETWEEN 0 AND requested_revision AND privacy_revision BETWEEN 0 AND requested_revision),
  CONSTRAINT dirty_days_completed_ck CHECK ((completed_revision=0)=(completed_at IS NULL)),
  CONSTRAINT dirty_days_privacy_ck CHECK (privacy_blocked OR completed_revision>=privacy_revision),
  CONSTRAINT dirty_days_lease_ck CHECK ((lease_token IS NULL)=(lease_until IS NULL) AND (lease_until IS NULL OR lease_until>updated_at)),
  CONSTRAINT dirty_days_attempts_ck CHECK (attempts BETWEEN 0 AND 1000),
  CONSTRAINT dirty_days_last_error_code_ck CHECK (length(btrim(last_error_code)) BETWEEN 1 AND 100),
  CONSTRAINT dirty_days_revision_ck CHECK (revision > 0),
  CONSTRAINT dirty_days_updated_ck CHECK (updated_at >= created_at)
);

CREATE INDEX dirty_days_pending_idx ON analytics.dirty_days(next_attempt_at,day) WHERE completed_revision<requested_revision;

CREATE INDEX dirty_days_lease_idx ON analytics.dirty_days(lease_until,day) WHERE lease_until IS NOT NULL;

CREATE FUNCTION analytics.guard_day_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.requested_revision<OLD.requested_revision OR NEW.completed_revision<OLD.completed_revision OR NEW.privacy_revision<OLD.privacy_revision THEN RAISE EXCEPTION 'Analytics revisions cannot regress' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dirty_days_revision BEFORE UPDATE ON analytics.dirty_days FOR EACH ROW EXECUTE FUNCTION analytics.guard_day_revision();

CREATE TABLE analytics.daily_metrics (
  day date NOT NULL,
  metric_code text NOT NULL,
  metric_set text NOT NULL DEFAULT 'analytics_metric',
  market text NOT NULL,
  dimension_key text NOT NULL,
  dimension_set text NOT NULL DEFAULT 'analytics_dimension',
  value bigint NOT NULL,
  generation bigint NOT NULL,
  computed_at timestamptz NOT NULL,
  definition_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_metrics_pk PRIMARY KEY (day,metric_code,market,dimension_key),
  CONSTRAINT daily_metrics_registries_ck CHECK (metric_set='analytics_metric' AND dimension_set='analytics_dimension'),
  CONSTRAINT daily_metrics_value_ck CHECK (value>=0 AND generation>0),
  CONSTRAINT daily_metrics_definition_version_ck CHECK (length(btrim(definition_version)) BETWEEN 1 AND 100),
  CONSTRAINT daily_metrics_day_fk FOREIGN KEY (day) REFERENCES analytics.dirty_days(day) ON DELETE RESTRICT,
  CONSTRAINT daily_metrics_metric_fk FOREIGN KEY (metric_set,metric_code) REFERENCES app.code_values(set_code,code) ON DELETE RESTRICT,
  CONSTRAINT daily_metrics_dimension_fk FOREIGN KEY (dimension_set,dimension_key) REFERENCES app.code_values(set_code,code) ON DELETE RESTRICT,
  CONSTRAINT daily_metrics_market_fk FOREIGN KEY (market) REFERENCES app.markets(code) ON DELETE RESTRICT
);

CREATE INDEX daily_metrics_metric_idx ON analytics.daily_metrics(metric_set,metric_code);

CREATE INDEX daily_metrics_dimension_idx ON analytics.daily_metrics(dimension_set,dimension_key);

CREATE INDEX daily_metrics_market_idx ON analytics.daily_metrics(market);

CREATE VIEW analytics.visible_daily_metrics WITH (security_barrier=true) AS
SELECT m.day,m.metric_code,m.market,m.dimension_key,m.value,m.generation,m.computed_at,m.definition_version,d.requested_revision,d.completed_revision
FROM analytics.daily_metrics m JOIN analytics.dirty_days d ON d.day=m.day
WHERE NOT d.privacy_blocked AND m.generation=d.completed_revision;
-- Default-deny view. Future dashboard role gets this aggregate projection, never raw events.

CREATE TABLE app.rate_limit_policies (
  policy_key text NOT NULL,
  policy_version text NOT NULL,
  window_seconds integer NOT NULL,
  limit_value integer NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_limit_policies_pk PRIMARY KEY (policy_key,policy_version,window_seconds),
  CONSTRAINT rate_limit_policies_u1 UNIQUE (policy_key,policy_version,window_seconds,limit_value),
  CONSTRAINT rate_limit_policies_policy_key_ck CHECK (length(btrim(policy_key)) BETWEEN 1 AND 100),
  CONSTRAINT rate_limit_policies_policy_version_ck CHECK (length(btrim(policy_version)) BETWEEN 1 AND 100),
  CONSTRAINT rate_limit_policies_bounds_ck CHECK (window_seconds BETWEEN 1 AND 86400 AND limit_value BETWEEN 1 AND 1000000)
);

CREATE TRIGGER rate_limit_policies_identity BEFORE UPDATE ON app.rate_limit_policies FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('policy_key','policy_version','window_seconds','limit_value');
INSERT INTO app.rate_limit_policies(policy_key,policy_version,window_seconds,limit_value) VALUES
('report_email','1',3600,3),('report_email','1',86400,10),('report_ip','1',3600,10);
-- These reviewed launch bounds are disabled until the limiter service is authorized.

CREATE TABLE app.rate_limit_buckets (
  policy_key text NOT NULL,
  policy_version text NOT NULL,
  key_version text NOT NULL,
  principal_hmac bytea NOT NULL,
  window_start timestamptz NOT NULL,
  window_seconds integer NOT NULL,
  limit_value integer NOT NULL,
  used integer NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_limit_buckets_pk PRIMARY KEY (policy_key,policy_version,key_version,principal_hmac,window_start,window_seconds),
  CONSTRAINT rate_limit_buckets_key_version_ck CHECK (length(btrim(key_version)) BETWEEN 1 AND 100),
  CONSTRAINT rate_limit_buckets_principal_hmac_ck CHECK (octet_length(principal_hmac)=32),
  CONSTRAINT rate_limit_buckets_quota_ck CHECK (used BETWEEN 0 AND limit_value),
  CONSTRAINT rate_limit_buckets_window_ck CHECK (window_seconds>0 AND mod(extract(epoch from window_start),window_seconds)=0),
  CONSTRAINT rate_limit_buckets_expiry_ck CHECK (expires_at>window_start+make_interval(secs=>window_seconds) AND expires_at<=window_start+interval '48 hours'),
  CONSTRAINT rate_limit_buckets_policy_fk FOREIGN KEY (policy_key,policy_version,window_seconds,limit_value) REFERENCES app.rate_limit_policies(policy_key,policy_version,window_seconds,limit_value) ON DELETE RESTRICT
);

CREATE INDEX rate_limit_buckets_policy_idx ON app.rate_limit_buckets(policy_key,policy_version,window_seconds,limit_value);

CREATE INDEX rate_limit_buckets_expiry_idx ON app.rate_limit_buckets(expires_at);
