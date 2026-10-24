-- P1-PR-006: report snapshots and explicitly scoped capabilities. No runtime grants.
-- Snapshot UPDATE is denied; only the migration owner can DELETE until a reviewed purge procedure exists.

ALTER TABLE app.owner_sessions ADD CONSTRAINT owner_sessions_id_subject_uq UNIQUE(id,subject_id);

CREATE TABLE app.reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_subject_id uuid NOT NULL,
  current_version integer,
  market text NOT NULL,
  locale text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  last_owner_activity_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT reports_pk PRIMARY KEY (id),
  CONSTRAINT reports_u1 UNIQUE (id,owner_subject_id),
  CONSTRAINT reports_status_ck CHECK (status IN ('draft','active','pending_deletion')),
  CONSTRAINT reports_current_ck CHECK (current_version > 0 AND (status <> 'active' OR current_version IS NOT NULL)),
  CONSTRAINT reports_lifetime_ck CHECK (expires_at > created_at AND last_owner_activity_at >= created_at),
  CONSTRAINT reports_revision_ck CHECK (revision > 0),
  CONSTRAINT reports_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT reports_owner_fk FOREIGN KEY (owner_subject_id) REFERENCES app.subjects(id) ON DELETE RESTRICT,
  CONSTRAINT reports_market_locale_fk FOREIGN KEY (market,locale) REFERENCES app.market_locales(market_code,locale_code) ON DELETE RESTRICT
);

CREATE INDEX reports_owner_idx ON app.reports(owner_subject_id);

CREATE INDEX reports_market_locale_idx ON app.reports(market,locale);

CREATE INDEX reports_history_idx ON app.reports(owner_subject_id,last_owner_activity_at DESC,id);

CREATE INDEX reports_expiry_idx ON app.reports(expires_at,id);

CREATE TABLE app.report_versions (
  report_id uuid NOT NULL,
  version integer NOT NULL,
  base_version integer,
  bundle_id uuid NOT NULL,
  rule_version_id uuid NOT NULL,
  engine_version text NOT NULL,
  schema_version integer NOT NULL,
  input_snapshot jsonb NOT NULL,
  output_snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_versions_pk PRIMARY KEY (report_id,version),
  CONSTRAINT report_versions_versions_ck CHECK (version > 0 AND schema_version > 0 AND (base_version IS NULL OR (base_version > 0 AND base_version < version))),
  CONSTRAINT report_versions_engine_version_ck CHECK (length(btrim(engine_version)) BETWEEN 1 AND 100),
  CONSTRAINT report_versions_snapshot_hash_ck CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT report_versions_input_snapshot_ck CHECK (jsonb_typeof(input_snapshot)='object' AND octet_length(input_snapshot::text) <= 65536),
  CONSTRAINT report_versions_output_snapshot_ck CHECK (jsonb_typeof(output_snapshot)='object' AND octet_length(output_snapshot::text) <= 524288),
  CONSTRAINT report_versions_report_fk FOREIGN KEY (report_id) REFERENCES app.reports(id) ON DELETE RESTRICT,
  CONSTRAINT report_versions_base_fk FOREIGN KEY (report_id,base_version) REFERENCES app.report_versions(report_id,version) ON DELETE RESTRICT,
  CONSTRAINT report_versions_bundle_fk FOREIGN KEY (bundle_id) REFERENCES app.dataset_bundles(id) ON DELETE RESTRICT,
  CONSTRAINT report_versions_rule_fk FOREIGN KEY (rule_version_id) REFERENCES app.rule_versions(id) ON DELETE RESTRICT
);

CREATE INDEX report_versions_base_idx ON app.report_versions(report_id,base_version);

CREATE INDEX report_versions_bundle_idx ON app.report_versions(bundle_id);

CREATE INDEX report_versions_rule_idx ON app.report_versions(rule_version_id);

CREATE TRIGGER report_versions_immutable BEFORE UPDATE ON app.report_versions FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();

ALTER TABLE app.reports ADD CONSTRAINT reports_current_version_fk FOREIGN KEY (id,current_version) REFERENCES app.report_versions(report_id,version) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX reports_current_version_idx ON app.reports(id,current_version);

CREATE TABLE app.report_drafts (
  report_id uuid NOT NULL,
  base_version integer NOT NULL,
  input jsonb NOT NULL,
  schema_version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT report_drafts_pk PRIMARY KEY (report_id),
  CONSTRAINT report_drafts_input_ck CHECK (jsonb_typeof(input)='object' AND octet_length(input::text) <= 65536),
  CONSTRAINT report_drafts_schema_ck CHECK (schema_version > 0),
  CONSTRAINT report_drafts_lifetime_ck CHECK (expires_at > updated_at AND expires_at <= updated_at + interval '7 days'),
  CONSTRAINT report_drafts_revision_ck CHECK (revision > 0),
  CONSTRAINT report_drafts_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT report_drafts_base_fk FOREIGN KEY (report_id,base_version) REFERENCES app.report_versions(report_id,version) ON DELETE RESTRICT
);

CREATE INDEX report_drafts_base_idx ON app.report_drafts(report_id,base_version);

CREATE INDEX report_drafts_expiry_idx ON app.report_drafts(expires_at,report_id);

CREATE TABLE app.report_items (
  report_id uuid NOT NULL,
  report_version integer NOT NULL,
  item_key text NOT NULL,
  sku_id uuid,
  kind text NOT NULL,
  rank smallint,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_items_pk PRIMARY KEY (report_id,report_version,item_key),
  CONSTRAINT report_items_item_key_ck CHECK (length(btrim(item_key)) BETWEEN 1 AND 200),
  CONSTRAINT report_items_kind_ck CHECK (kind IN ('picked','excluded')),
  CONSTRAINT report_items_rank_ck CHECK ((kind='picked' AND rank IS NOT NULL AND rank BETWEEN 1 AND 5) OR (kind='excluded' AND rank IS NULL)),
  CONSTRAINT report_items_snapshot_ck CHECK (jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text) <= 65536),
  CONSTRAINT report_items_version_fk FOREIGN KEY (report_id,report_version) REFERENCES app.report_versions(report_id,version) ON DELETE RESTRICT,
  CONSTRAINT report_items_sku_fk FOREIGN KEY (sku_id) REFERENCES app.tire_skus(id) ON DELETE RESTRICT
);

CREATE INDEX report_items_sku_idx ON app.report_items(sku_id);

CREATE TRIGGER report_items_immutable BEFORE UPDATE ON app.report_items FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();

CREATE UNIQUE INDEX report_items_pick_rank_uq ON app.report_items(report_id,report_version,rank) WHERE kind='picked';

CREATE TABLE app.comparisons (
  report_id uuid NOT NULL,
  report_version integer NOT NULL,
  revision bigint NOT NULL,
  scenario jsonb NOT NULL,
  schema_version integer NOT NULL,
  snapshot_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comparisons_pk PRIMARY KEY (report_id,report_version,revision),
  CONSTRAINT comparisons_version_ck CHECK (revision > 0 AND schema_version > 0),
  CONSTRAINT comparisons_scenario_ck CHECK (jsonb_typeof(scenario)='object' AND octet_length(scenario::text) <= 65536),
  CONSTRAINT comparisons_snapshot_hash_ck CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT comparisons_version_fk FOREIGN KEY (report_id,report_version) REFERENCES app.report_versions(report_id,version) ON DELETE RESTRICT
);

CREATE TRIGGER comparisons_immutable BEFORE UPDATE ON app.comparisons FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();

CREATE TABLE app.comparison_items (
  report_id uuid NOT NULL,
  report_version integer NOT NULL,
  comparison_revision bigint NOT NULL,
  slot smallint NOT NULL,
  source_key text NOT NULL,
  kind text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comparison_items_pk PRIMARY KEY (report_id,report_version,comparison_revision,slot),
  CONSTRAINT comparison_items_u1 UNIQUE (report_id,report_version,comparison_revision,source_key),
  CONSTRAINT comparison_items_slot_ck CHECK (slot BETWEEN 1 AND 4),
  CONSTRAINT comparison_items_source_key_ck CHECK (length(btrim(source_key)) BETWEEN 1 AND 200),
  CONSTRAINT comparison_items_kind_ck CHECK (kind IN ('catalog','quote')),
  CONSTRAINT comparison_items_snapshot_ck CHECK (jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text) <= 65536),
  CONSTRAINT comparison_items_comparison_fk FOREIGN KEY (report_id,report_version,comparison_revision) REFERENCES app.comparisons(report_id,report_version,revision) ON DELETE RESTRICT
);

CREATE TRIGGER comparison_items_immutable BEFORE UPDATE ON app.comparison_items FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();

CREATE TABLE app.shop_quotes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  source_key text NOT NULL,
  sku_id uuid,
  currency text NOT NULL,
  total_minor bigint NOT NULL,
  quantity smallint NOT NULL,
  basis text NOT NULL,
  observed_on date NOT NULL,
  components jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT shop_quotes_pk PRIMARY KEY (id),
  CONSTRAINT shop_quotes_u1 UNIQUE (report_id,source_key),
  CONSTRAINT shop_quotes_source_key_ck CHECK (length(btrim(source_key)) BETWEEN 1 AND 200),
  CONSTRAINT shop_quotes_cost_ck CHECK (total_minor BETWEEN 0 AND 1000000000000 AND quantity BETWEEN 1 AND 20),
  CONSTRAINT shop_quotes_basis_ck CHECK (basis IN ('per_tire','set','installed_set')),
  CONSTRAINT shop_quotes_components_ck CHECK (jsonb_typeof(components)='array' AND octet_length(components::text) <= 65536),
  CONSTRAINT shop_quotes_lifetime_ck CHECK (expires_at > created_at),
  CONSTRAINT shop_quotes_revision_ck CHECK (revision > 0),
  CONSTRAINT shop_quotes_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT shop_quotes_report_fk FOREIGN KEY (report_id) REFERENCES app.reports(id) ON DELETE RESTRICT,
  CONSTRAINT shop_quotes_sku_fk FOREIGN KEY (sku_id) REFERENCES app.tire_skus(id) ON DELETE RESTRICT,
  CONSTRAINT shop_quotes_currency_fk FOREIGN KEY (currency) REFERENCES app.currencies(code) ON DELETE RESTRICT
);

CREATE INDEX shop_quotes_sku_idx ON app.shop_quotes(sku_id);

CREATE INDEX shop_quotes_currency_idx ON app.shop_quotes(currency);

CREATE INDEX shop_quotes_history_idx ON app.shop_quotes(report_id,created_at,id);

CREATE INDEX shop_quotes_expiry_idx ON app.shop_quotes(expires_at,id);

CREATE TABLE app.report_capabilities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  report_version integer,
  scope text NOT NULL,
  version_scope text NOT NULL,
  version_binding integer GENERATED ALWAYS AS (coalesce(report_version,0)) STORED,
  token_hash bytea NOT NULL,
  key_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT report_capabilities_pk PRIMARY KEY (id),
  CONSTRAINT report_capabilities_u1 UNIQUE (key_version,token_hash),
  CONSTRAINT report_capabilities_u2 UNIQUE (report_id,id,version_binding),
  CONSTRAINT report_capabilities_digest_ck CHECK (octet_length(token_hash)=32),
  CONSTRAINT report_capabilities_key_version_ck CHECK (length(btrim(key_version)) BETWEEN 1 AND 100),
  CONSTRAINT report_capabilities_lifetime_ck CHECK (expires_at > created_at AND (revoked_at IS NULL OR revoked_at >= created_at)),
  CONSTRAINT report_capabilities_scope_ck CHECK (scope='view' AND ((version_scope='fixed' AND report_version IS NOT NULL) OR (version_scope='latest' AND report_version IS NULL))),
  CONSTRAINT report_capabilities_revision_ck CHECK (revision > 0),
  CONSTRAINT report_capabilities_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT report_capabilities_report_fk FOREIGN KEY (report_id) REFERENCES app.reports(id) ON DELETE RESTRICT,
  CONSTRAINT report_capabilities_version_fk FOREIGN KEY (report_id,report_version) REFERENCES app.report_versions(report_id,version) ON DELETE RESTRICT
);

CREATE INDEX report_capabilities_version_idx ON app.report_capabilities(report_id,report_version);

CREATE INDEX report_capabilities_expiry_idx ON app.report_capabilities(expires_at,id);

CREATE TABLE app.report_assets (
  asset_id uuid NOT NULL,
  report_id uuid NOT NULL,
  report_version integer NOT NULL,
  comparison_revision bigint,
  renderer_version text NOT NULL,
  locale text NOT NULL,
  view_scope text NOT NULL,
  render_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_assets_pk PRIMARY KEY (asset_id),
  CONSTRAINT report_assets_u1 UNIQUE (render_key),
  CONSTRAINT report_assets_u2 UNIQUE (asset_id,report_id,report_version,view_scope),
  CONSTRAINT report_assets_scope_ck CHECK (view_scope IN ('owner','shared')),
  CONSTRAINT report_assets_renderer_version_ck CHECK (length(btrim(renderer_version)) BETWEEN 1 AND 100),
  CONSTRAINT report_assets_render_key_ck CHECK (length(btrim(render_key)) BETWEEN 1 AND 200),
  CONSTRAINT report_assets_asset_fk FOREIGN KEY (asset_id) REFERENCES app.object_assets(id) ON DELETE RESTRICT,
  CONSTRAINT report_assets_version_fk FOREIGN KEY (report_id,report_version) REFERENCES app.report_versions(report_id,version) ON DELETE RESTRICT,
  CONSTRAINT report_assets_comparison_fk FOREIGN KEY (report_id,report_version,comparison_revision) REFERENCES app.comparisons(report_id,report_version,revision) ON DELETE RESTRICT,
  CONSTRAINT report_assets_locale_fk FOREIGN KEY (locale) REFERENCES app.locales(code) ON DELETE RESTRICT
);

CREATE INDEX report_assets_version_idx ON app.report_assets(report_id,report_version);

CREATE INDEX report_assets_comparison_idx ON app.report_assets(report_id,report_version,comparison_revision);

CREATE INDEX report_assets_locale_idx ON app.report_assets(locale);

CREATE TRIGGER report_assets_immutable BEFORE UPDATE ON app.report_assets FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();

CREATE TABLE app.download_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL,
  report_id uuid NOT NULL,
  report_version integer NOT NULL,
  view_scope text NOT NULL,
  owner_session_id uuid,
  owner_subject_id uuid,
  share_capability_id uuid,
  share_version_binding integer,
  token_hash bytea NOT NULL,
  key_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT download_grants_pk PRIMARY KEY (id),
  CONSTRAINT download_grants_u1 UNIQUE (key_version,token_hash),
  CONSTRAINT download_grants_digest_ck CHECK (octet_length(token_hash)=32),
  CONSTRAINT download_grants_key_version_ck CHECK (length(btrim(key_version)) BETWEEN 1 AND 100),
  CONSTRAINT download_grants_lifetime_ck CHECK (expires_at > created_at AND (revoked_at IS NULL OR revoked_at >= created_at)),
  CONSTRAINT download_grants_authority_ck CHECK ((owner_session_id IS NOT NULL AND owner_subject_id IS NOT NULL AND share_capability_id IS NULL AND share_version_binding IS NULL) OR (owner_session_id IS NULL AND owner_subject_id IS NULL AND share_capability_id IS NOT NULL AND share_version_binding IS NOT NULL AND share_version_binding IN (0,report_version) AND view_scope='shared')),
  CONSTRAINT download_grants_ttl_ck CHECK (expires_at <= created_at + interval '15 minutes'),
  CONSTRAINT download_grants_revision_ck CHECK (revision > 0),
  CONSTRAINT download_grants_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT download_grants_asset_fk FOREIGN KEY (asset_id,report_id,report_version,view_scope) REFERENCES app.report_assets(asset_id,report_id,report_version,view_scope) ON DELETE RESTRICT,
  CONSTRAINT download_grants_owner_fk FOREIGN KEY (report_id,owner_subject_id) REFERENCES app.reports(id,owner_subject_id) ON DELETE RESTRICT,
  CONSTRAINT download_grants_session_fk FOREIGN KEY (owner_session_id,owner_subject_id) REFERENCES app.owner_sessions(id,subject_id) ON DELETE RESTRICT,
  CONSTRAINT download_grants_share_fk FOREIGN KEY (report_id,share_capability_id,share_version_binding) REFERENCES app.report_capabilities(report_id,id,version_binding) ON DELETE RESTRICT
);

CREATE INDEX download_grants_asset_idx ON app.download_grants(asset_id,report_id,report_version,view_scope);

CREATE INDEX download_grants_owner_idx ON app.download_grants(report_id,owner_subject_id);

CREATE INDEX download_grants_session_idx ON app.download_grants(owner_session_id,owner_subject_id);

CREATE INDEX download_grants_share_idx ON app.download_grants(report_id,share_capability_id,share_version_binding);

CREATE INDEX download_grants_expiry_idx ON app.download_grants(expires_at,id);
