-- P1-PR-007: public projections, configuration, SEO and advertising operations. No runtime grants.

CREATE TABLE app.published_content (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  content_key text NOT NULL,
  cms_revision text NOT NULL,
  locale text NOT NULL,
  market text NOT NULL,
  public_dto jsonb NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  content_hash text NOT NULL,
  published_at timestamptz NOT NULL,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT published_content_pk PRIMARY KEY (id),
  CONSTRAINT published_content_u1 UNIQUE (content_key,cms_revision,locale,market),
  CONSTRAINT published_content_content_key_ck CHECK (length(btrim(content_key)) BETWEEN 1 AND 200),
  CONSTRAINT published_content_cms_revision_ck CHECK (length(btrim(cms_revision)) BETWEEN 1 AND 200),
  CONSTRAINT published_content_public_dto_ck CHECK (jsonb_typeof(public_dto)='object' AND octet_length(public_dto::text) <= 262144),
  CONSTRAINT published_content_schema_ck CHECK (schema_version>0),
  CONSTRAINT published_content_content_hash_ck CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT published_content_lifetime_ck CHECK (valid_until IS NULL OR valid_until>published_at),
  CONSTRAINT published_content_market_locale_fk FOREIGN KEY (market,locale) REFERENCES app.market_locales(market_code,locale_code) ON DELETE RESTRICT
);

CREATE INDEX published_content_market_locale_idx ON app.published_content(market,locale);

CREATE INDEX published_content_public_idx ON app.published_content(locale,market,content_key);

CREATE INDEX published_content_expiry_idx ON app.published_content(valid_until,id) WHERE valid_until IS NOT NULL;

CREATE TRIGGER published_content_immutable BEFORE UPDATE ON app.published_content FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();

CREATE TABLE admin.configuration_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  version integer NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  value jsonb NOT NULL,
  status text NOT NULL,
  published_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuration_versions_pk PRIMARY KEY (id),
  CONSTRAINT configuration_versions_u1 UNIQUE (key,version),
  CONSTRAINT configuration_versions_u2 UNIQUE (id,key,status),
  CONSTRAINT configuration_versions_key_ck CHECK (length(btrim(key)) BETWEEN 1 AND 100),
  CONSTRAINT configuration_versions_versions_ck CHECK (version>0 AND schema_version>0),
  CONSTRAINT configuration_versions_value_ck CHECK (jsonb_typeof(value)='object' AND octet_length(value::text) <= 65536),
  CONSTRAINT configuration_versions_status_ck CHECK (status IN ('draft','reviewed','published','rejected')),
  CONSTRAINT configuration_versions_published_ck CHECK ((status='published')=(published_at IS NOT NULL) AND (status NOT IN ('reviewed','published') OR reviewed_by IS NOT NULL)),
  CONSTRAINT configuration_versions_reviewer_fk FOREIGN KEY (reviewed_by) REFERENCES admin.staff_identities(id) ON DELETE RESTRICT
);

CREATE INDEX configuration_versions_reviewer_idx ON admin.configuration_versions(reviewed_by);

CREATE TRIGGER configuration_versions_immutable BEFORE UPDATE ON admin.configuration_versions FOR EACH ROW WHEN (OLD.status='published') EXECUTE FUNCTION app.reject_history_change();

CREATE TABLE admin.feature_states (
  key text NOT NULL,
  configuration_id uuid NOT NULL,
  configuration_status text NOT NULL DEFAULT 'published',
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT feature_states_pk PRIMARY KEY (key),
  CONSTRAINT feature_states_published_ck CHECK (configuration_status='published'),
  CONSTRAINT feature_states_revision_ck CHECK (revision > 0),
  CONSTRAINT feature_states_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT feature_states_configuration_fk FOREIGN KEY (configuration_id,key,configuration_status) REFERENCES admin.configuration_versions(id,key,status) ON DELETE RESTRICT
);

CREATE INDEX feature_states_configuration_idx ON admin.feature_states(configuration_id,key,configuration_status);

CREATE TABLE admin.affiliate_applications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  retailer_id uuid NOT NULL,
  network text NOT NULL,
  status text NOT NULL,
  submitted_at timestamptz,
  review_after timestamptz,
  approved_terms_asset_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT affiliate_applications_pk PRIMARY KEY (id),
  CONSTRAINT affiliate_applications_network_ck CHECK (length(btrim(network)) BETWEEN 1 AND 100),
  CONSTRAINT affiliate_applications_status_ck CHECK (status IN ('draft','submitted','approved','rejected','suspended')),
  CONSTRAINT affiliate_applications_approval_ck CHECK (status<>'approved' OR (submitted_at IS NOT NULL AND approved_terms_asset_id IS NOT NULL)),
  CONSTRAINT affiliate_applications_revision_ck CHECK (revision > 0),
  CONSTRAINT affiliate_applications_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT affiliate_applications_retailer_fk FOREIGN KEY (retailer_id) REFERENCES app.retailers(id) ON DELETE RESTRICT,
  CONSTRAINT affiliate_applications_terms_fk FOREIGN KEY (approved_terms_asset_id) REFERENCES app.object_assets(id) ON DELETE RESTRICT
);

CREATE INDEX affiliate_applications_retailer_idx ON admin.affiliate_applications(retailer_id);

CREATE INDEX affiliate_applications_terms_idx ON admin.affiliate_applications(approved_terms_asset_id);

CREATE INDEX affiliate_applications_review_idx ON admin.affiliate_applications(review_after,id);

CREATE TABLE admin.affiliate_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  retailer_id uuid NOT NULL,
  link_key text NOT NULL,
  destination text NOT NULL,
  market text NOT NULL,
  status text NOT NULL,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT affiliate_links_pk PRIMARY KEY (id),
  CONSTRAINT affiliate_links_u1 UNIQUE (link_key),
  CONSTRAINT affiliate_links_link_key_ck CHECK (length(btrim(link_key)) BETWEEN 1 AND 100),
  CONSTRAINT affiliate_links_destination_ck CHECK (destination ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]]*)?$' AND destination !~ '[\\]' AND length(destination)<=2048),
  CONSTRAINT affiliate_links_status_ck CHECK (status IN ('draft','active','disabled')),
  CONSTRAINT affiliate_links_revision_ck CHECK (revision > 0),
  CONSTRAINT affiliate_links_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT affiliate_links_retailer_fk FOREIGN KEY (retailer_id) REFERENCES app.retailers(id) ON DELETE RESTRICT,
  CONSTRAINT affiliate_links_market_fk FOREIGN KEY (market) REFERENCES app.markets(code) ON DELETE RESTRICT
);

CREATE INDEX affiliate_links_retailer_idx ON admin.affiliate_links(retailer_id);

CREATE INDEX affiliate_links_market_idx ON admin.affiliate_links(market);

CREATE TABLE admin.affiliate_link_checks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL,
  checked_at timestamptz NOT NULL,
  result text NOT NULL,
  http_status integer,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_link_checks_pk PRIMARY KEY (id),
  CONSTRAINT affiliate_link_checks_result_ck CHECK (result IN ('valid','redirected','blocked','unavailable','invalid')),
  CONSTRAINT affiliate_link_checks_http_ck CHECK (http_status BETWEEN 100 AND 599),
  CONSTRAINT affiliate_link_checks_expiry_ck CHECK (expires_at>checked_at),
  CONSTRAINT affiliate_link_checks_link_fk FOREIGN KEY (link_id) REFERENCES admin.affiliate_links(id) ON DELETE RESTRICT
);

CREATE INDEX affiliate_link_checks_link_idx ON admin.affiliate_link_checks(link_id);

CREATE INDEX affiliate_link_checks_latest_idx ON admin.affiliate_link_checks(link_id,checked_at DESC,id);

CREATE INDEX affiliate_link_checks_expiry_idx ON admin.affiliate_link_checks(expires_at,id);

CREATE TRIGGER affiliate_link_checks_immutable BEFORE UPDATE ON admin.affiliate_link_checks FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();

CREATE TABLE admin.ad_slots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slot_key text NOT NULL,
  route_class text NOT NULL,
  configuration_id uuid NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT ad_slots_pk PRIMARY KEY (id),
  CONSTRAINT ad_slots_u1 UNIQUE (slot_key),
  CONSTRAINT ad_slots_slot_ck CHECK (slot_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT ad_slots_route_ck CHECK (route_class IN ('education','glossary','tire_model','tire_size')),
  CONSTRAINT ad_slots_status_ck CHECK (status IN ('disabled','reviewed','active')),
  CONSTRAINT ad_slots_revision_ck CHECK (revision > 0),
  CONSTRAINT ad_slots_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT ad_slots_configuration_fk FOREIGN KEY (configuration_id) REFERENCES admin.configuration_versions(id) ON DELETE RESTRICT
);

CREATE INDEX ad_slots_configuration_idx ON admin.ad_slots(configuration_id);

CREATE TABLE admin.ad_brand_blocks (
  brand_key text NOT NULL,
  market text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT ad_brand_blocks_pk PRIMARY KEY (brand_key,market),
  CONSTRAINT ad_brand_blocks_brand_key_ck CHECK (length(btrim(brand_key)) BETWEEN 1 AND 100),
  CONSTRAINT ad_brand_blocks_reason_ck CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  CONSTRAINT ad_brand_blocks_revision_ck CHECK (revision > 0),
  CONSTRAINT ad_brand_blocks_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT ad_brand_blocks_market_fk FOREIGN KEY (market) REFERENCES app.markets(code) ON DELETE RESTRICT
);

CREATE INDEX ad_brand_blocks_market_idx ON admin.ad_brand_blocks(market);

CREATE FUNCTION admin.is_public_content_path(value text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
SELECT length(value)<=500 AND (value='/' OR value ~ '^/(learn|guides|glossary)/[a-z0-9]+(-[a-z0-9]+)*$' OR value ~ '^/tires/(models|sizes)/[a-z0-9]+(-[a-z0-9]+)*$')
$$;

CREATE TABLE admin.seo_page_registry (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  public_path text NOT NULL,
  locale text NOT NULL,
  market text NOT NULL,
  content_key text,
  page_class text NOT NULL,
  owner_staff_id uuid NOT NULL,
  review_due_at timestamptz NOT NULL,
  index_status text NOT NULL,
  canonical_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT seo_page_registry_pk PRIMARY KEY (id),
  CONSTRAINT seo_page_registry_u1 UNIQUE (public_path,locale),
  CONSTRAINT seo_page_registry_public_path_ck CHECK (admin.is_public_content_path(public_path) AND admin.is_public_content_path(canonical_path)),
  CONSTRAINT seo_page_registry_class_ck CHECK ((page_class='home' AND public_path='/') OR (page_class='education' AND public_path ~ '^/(learn|guides)/') OR (page_class='glossary' AND public_path ~ '^/glossary/') OR (page_class='tire_model' AND public_path ~ '^/tires/models/') OR (page_class='tire_size' AND public_path ~ '^/tires/sizes/')),
  CONSTRAINT seo_page_registry_content_key_ck CHECK (length(btrim(content_key)) BETWEEN 1 AND 200),
  CONSTRAINT seo_page_registry_index_ck CHECK (index_status IN ('draft','eligible','noindex','removed')),
  CONSTRAINT seo_page_registry_revision_ck CHECK (revision > 0),
  CONSTRAINT seo_page_registry_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT seo_page_registry_market_locale_fk FOREIGN KEY (market,locale) REFERENCES app.market_locales(market_code,locale_code) ON DELETE RESTRICT,
  CONSTRAINT seo_page_registry_owner_fk FOREIGN KEY (owner_staff_id) REFERENCES admin.staff_identities(id) ON DELETE RESTRICT
);

CREATE INDEX seo_page_registry_market_locale_idx ON admin.seo_page_registry(market,locale);

CREATE INDEX seo_page_registry_owner_idx ON admin.seo_page_registry(owner_staff_id);

CREATE INDEX seo_page_registry_review_idx ON admin.seo_page_registry(review_due_at,id);

CREATE TABLE admin.seo_audit_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  crawler_version text NOT NULL,
  state text NOT NULL,
  page_count bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT seo_audit_runs_pk PRIMARY KEY (id),
  CONSTRAINT seo_audit_runs_crawler_version_ck CHECK (length(btrim(crawler_version)) BETWEEN 1 AND 100),
  CONSTRAINT seo_audit_runs_state_ck CHECK (state IN ('pending','running','completed','failed')),
  CONSTRAINT seo_audit_runs_count_ck CHECK (page_count BETWEEN 0 AND 1000000),
  CONSTRAINT seo_audit_runs_finished_ck CHECK ((state IN ('completed','failed'))=(finished_at IS NOT NULL) AND (finished_at IS NULL OR finished_at>=started_at)),
  CONSTRAINT seo_audit_runs_revision_ck CHECK (revision > 0),
  CONSTRAINT seo_audit_runs_updated_ck CHECK (updated_at >= created_at)
);

CREATE INDEX seo_audit_runs_retention_idx ON admin.seo_audit_runs(started_at,id);

CREATE TABLE admin.seo_findings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  page_id uuid NOT NULL,
  rule_code text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL,
  owner_staff_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT seo_findings_pk PRIMARY KEY (id),
  CONSTRAINT seo_findings_u1 UNIQUE (run_id,page_id,rule_code),
  CONSTRAINT seo_findings_rule_code_ck CHECK (length(btrim(rule_code)) BETWEEN 1 AND 100),
  CONSTRAINT seo_findings_severity_ck CHECK (severity IN ('info','warning','error')),
  CONSTRAINT seo_findings_status_ck CHECK (status IN ('open','resolved','waived')),
  CONSTRAINT seo_findings_revision_ck CHECK (revision > 0),
  CONSTRAINT seo_findings_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT seo_findings_run_fk FOREIGN KEY (run_id) REFERENCES admin.seo_audit_runs(id) ON DELETE RESTRICT,
  CONSTRAINT seo_findings_page_fk FOREIGN KEY (page_id) REFERENCES admin.seo_page_registry(id) ON DELETE RESTRICT,
  CONSTRAINT seo_findings_owner_fk FOREIGN KEY (owner_staff_id) REFERENCES admin.staff_identities(id) ON DELETE RESTRICT
);

CREATE INDEX seo_findings_page_idx ON admin.seo_findings(page_id);

CREATE INDEX seo_findings_owner_idx ON admin.seo_findings(owner_staff_id);

CREATE INDEX seo_findings_queue_idx ON admin.seo_findings(status,severity,id);

CREATE TABLE admin.search_daily_metrics (
  page_id uuid NOT NULL,
  day date NOT NULL,
  source text NOT NULL,
  clicks bigint NOT NULL,
  impressions bigint NOT NULL,
  position_sum numeric,
  source_revision text NOT NULL,
  fetched_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT search_daily_metrics_pk PRIMARY KEY (page_id,day,source),
  CONSTRAINT search_daily_metrics_source_ck CHECK (source IN ('search_console','bing_webmaster')),
  CONSTRAINT search_daily_metrics_counts_ck CHECK (clicks>=0 AND impressions>=0),
  CONSTRAINT search_daily_metrics_position_ck CHECK (position_sum BETWEEN 0 AND 1000000000000000 AND position_sum<>'NaN'::numeric),
  CONSTRAINT search_daily_metrics_source_revision_ck CHECK (length(btrim(source_revision)) BETWEEN 1 AND 200),
  CONSTRAINT search_daily_metrics_revision_ck CHECK (revision > 0),
  CONSTRAINT search_daily_metrics_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT search_daily_metrics_page_fk FOREIGN KEY (page_id) REFERENCES admin.seo_page_registry(id) ON DELETE RESTRICT
);

CREATE INDEX search_daily_metrics_retention_idx ON admin.search_daily_metrics(day);

CREATE TABLE admin.ad_network_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  network text NOT NULL,
  external_account_id text NOT NULL,
  status text NOT NULL,
  verified_at timestamptz,
  configuration_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT ad_network_accounts_pk PRIMARY KEY (id),
  CONSTRAINT ad_network_accounts_u1 UNIQUE (network,external_account_id),
  CONSTRAINT ad_network_accounts_network_ck CHECK (length(btrim(network)) BETWEEN 1 AND 100),
  CONSTRAINT ad_network_accounts_external_id_ck CHECK (external_account_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT ad_network_accounts_status_ck CHECK (status IN ('pending','verified','suspended','disabled')),
  CONSTRAINT ad_network_accounts_verified_ck CHECK (status<>'verified' OR verified_at IS NOT NULL),
  CONSTRAINT ad_network_accounts_revision_ck CHECK (revision > 0),
  CONSTRAINT ad_network_accounts_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT ad_network_accounts_configuration_fk FOREIGN KEY (configuration_id) REFERENCES admin.configuration_versions(id) ON DELETE RESTRICT
);

CREATE INDEX ad_network_accounts_configuration_idx ON admin.ad_network_accounts(configuration_id);

CREATE TABLE admin.ad_report_imports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  source_revision text NOT NULL,
  source_generation bigint NOT NULL,
  checksum text NOT NULL,
  state text NOT NULL,
  fetched_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_report_imports_pk PRIMARY KEY (id),
  CONSTRAINT ad_report_imports_u1 UNIQUE (account_id,period_start,period_end,source_revision),
  CONSTRAINT ad_report_imports_u2 UNIQUE (account_id,source_generation),
  CONSTRAINT ad_report_imports_period_ck CHECK (period_end>=period_start AND period_end-period_start<=366),
  CONSTRAINT ad_report_imports_source_revision_ck CHECK (length(btrim(source_revision)) BETWEEN 1 AND 200),
  CONSTRAINT ad_report_imports_generation_ck CHECK (source_generation>0),
  CONSTRAINT ad_report_imports_checksum_ck CHECK (checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ad_report_imports_state_ck CHECK (state IN ('staging','validated','approved','rejected')),
  CONSTRAINT ad_report_imports_account_fk FOREIGN KEY (account_id) REFERENCES admin.ad_network_accounts(id) ON DELETE RESTRICT
);

CREATE INDEX ad_report_imports_current_idx ON admin.ad_report_imports(account_id,source_generation DESC) WHERE state='approved';

CREATE INDEX ad_report_imports_retention_idx ON admin.ad_report_imports(period_end,id);

CREATE TABLE admin.ad_daily_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL,
  day date NOT NULL,
  dimension_key text NOT NULL,
  page_id uuid,
  slot_id uuid,
  currency text NOT NULL,
  impressions bigint NOT NULL,
  eligible_requests bigint,
  revenue_minor bigint NOT NULL,
  revenue_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_daily_metrics_pk PRIMARY KEY (id),
  CONSTRAINT ad_daily_metrics_u1 UNIQUE (import_id,day,dimension_key,currency,revenue_status),
  CONSTRAINT ad_daily_metrics_dimension_ck CHECK ((dimension_key='all' AND page_id IS NULL AND slot_id IS NULL) OR (page_id IS NOT NULL AND slot_id IS NULL AND dimension_key='page:'||page_id::text) OR (page_id IS NULL AND slot_id IS NOT NULL AND dimension_key='slot:'||slot_id::text)),
  CONSTRAINT ad_daily_metrics_counts_ck CHECK (impressions>=0 AND eligible_requests>=0),
  CONSTRAINT ad_daily_metrics_revenue_ck CHECK (revenue_minor BETWEEN -1000000000000 AND 1000000000000 AND revenue_status IN ('estimated','finalized')),
  CONSTRAINT ad_daily_metrics_import_fk FOREIGN KEY (import_id) REFERENCES admin.ad_report_imports(id) ON DELETE RESTRICT,
  CONSTRAINT ad_daily_metrics_page_fk FOREIGN KEY (page_id) REFERENCES admin.seo_page_registry(id) ON DELETE RESTRICT,
  CONSTRAINT ad_daily_metrics_slot_fk FOREIGN KEY (slot_id) REFERENCES admin.ad_slots(id) ON DELETE RESTRICT,
  CONSTRAINT ad_daily_metrics_currency_fk FOREIGN KEY (currency) REFERENCES app.currencies(code) ON DELETE RESTRICT
);

CREATE INDEX ad_daily_metrics_page_idx ON admin.ad_daily_metrics(page_id);

CREATE INDEX ad_daily_metrics_slot_idx ON admin.ad_daily_metrics(slot_id);

CREATE INDEX ad_daily_metrics_currency_idx ON admin.ad_daily_metrics(currency);

CREATE INDEX ad_daily_metrics_retention_idx ON admin.ad_daily_metrics(day,id);

CREATE FUNCTION admin.guard_ad_metric() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,admin AS $$
DECLARE parent admin.ad_report_imports; parent_id uuid;
BEGIN
  FOR parent_id IN SELECT DISTINCT v FROM unnest(CASE WHEN TG_OP='INSERT' THEN ARRAY[NEW.import_id] WHEN TG_OP='DELETE' THEN ARRAY[OLD.import_id] ELSE ARRAY[OLD.import_id,NEW.import_id] END) v ORDER BY v LOOP
    SELECT * INTO parent FROM admin.ad_report_imports WHERE id=parent_id FOR SHARE;
    IF parent.state='approved' THEN RAISE EXCEPTION 'Approved report metrics are immutable' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO parent FROM admin.ad_report_imports WHERE id=NEW.import_id;
  IF NEW.day NOT BETWEEN parent.period_start AND parent.period_end THEN RAISE EXCEPTION 'Metric day outside report period' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ad_daily_metrics_guard BEFORE INSERT OR UPDATE OR DELETE ON admin.ad_daily_metrics FOR EACH ROW EXECUTE FUNCTION admin.guard_ad_metric();
CREATE FUNCTION admin.guard_ad_report() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF (TG_OP='INSERT' AND NEW.state='approved') OR (TG_OP<>'INSERT' AND OLD.state='approved') THEN
    RAISE EXCEPTION 'Stage reports before approval; approved identity is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND ROW(OLD.account_id,OLD.period_start,OLD.period_end,OLD.source_revision,OLD.source_generation,OLD.checksum) IS DISTINCT FROM ROW(NEW.account_id,NEW.period_start,NEW.period_end,NEW.source_revision,NEW.source_generation,NEW.checksum) THEN
    RAISE EXCEPTION 'Report snapshot identity is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ad_report_imports_guard BEFORE INSERT OR UPDATE OR DELETE ON admin.ad_report_imports FOR EACH ROW EXECUTE FUNCTION admin.guard_ad_report();
CREATE VIEW admin.current_ad_daily_metrics WITH (security_barrier=true) AS
SELECT i.account_id,i.source_revision,i.source_generation,m.day,m.dimension_key,m.currency,m.impressions,m.eligible_requests,m.revenue_minor,m.revenue_status
FROM admin.ad_daily_metrics m JOIN admin.ad_report_imports i ON i.id=m.import_id
WHERE i.state='approved' AND NOT EXISTS (
 SELECT 1 FROM admin.ad_report_imports newer WHERE newer.account_id=i.account_id AND newer.state='approved'
 AND m.day BETWEEN newer.period_start AND newer.period_end AND newer.source_generation>i.source_generation
);
-- Each import is a complete period snapshot, not a delta. Missing dimensions in its successor disappear.
-- Source-generation ordering and provider revision semantics are assigned by the later import service.
