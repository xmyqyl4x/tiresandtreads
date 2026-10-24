-- P1-PR-005: source-backed fitment, catalog, evidence, advice and recall facts.
-- Child dataset keys make same-revision ownership and publication locking explicit.

CREATE TABLE app.vehicles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  market text NOT NULL,
  model_year smallint NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  trim text NOT NULL,
  powertrain text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT vehicles_pk PRIMARY KEY (id),
  CONSTRAINT vehicles_u1 UNIQUE (dataset_version_id,id),
  CONSTRAINT vehicles_u2 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT vehicles_year_ck CHECK (model_year BETWEEN 1886 AND 2200),
  CONSTRAINT vehicles_labels_ck CHECK (length(make) BETWEEN 1 AND 200 AND length(model) BETWEEN 1 AND 200 AND length(trim) BETWEEN 1 AND 200),
  CONSTRAINT vehicles_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT vehicles_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT vehicles_market_fk FOREIGN KEY (market) REFERENCES app.markets(code) ON DELETE RESTRICT
);

CREATE INDEX vehicles_f2_idx ON app.vehicles(market);

CREATE INDEX vehicles_q1_idx ON app.vehicles(dataset_version_id,market,make,model,model_year,id);

CREATE TRIGGER vehicles_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.vehicles
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.fitment_configurations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  wheel_package text NOT NULL,
  verification_status text NOT NULL,
  approved_options jsonb NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT fitment_configurations_pk PRIMARY KEY (id),
  CONSTRAINT fitment_configurations_u1 UNIQUE (vehicle_id,wheel_package),
  CONSTRAINT fitment_configurations_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT fitment_configurations_u3 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT fitment_configurations_verification_ck CHECK (verification_status IN ('unverified','verified','rejected')),
  CONSTRAINT fitment_configurations_options_ck CHECK (jsonb_typeof(approved_options) = 'object' AND octet_length(approved_options::text) <= 16384),
  CONSTRAINT fitment_configurations_schema_ck CHECK (schema_version > 0),
  CONSTRAINT fitment_configurations_package_ck CHECK (length(wheel_package) BETWEEN 1 AND 200),
  CONSTRAINT fitment_configurations_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT fitment_configurations_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT fitment_configurations_vehicle_fk FOREIGN KEY (dataset_version_id,vehicle_id) REFERENCES app.vehicles(dataset_version_id,id) ON DELETE RESTRICT
);

CREATE INDEX fitment_configurations_f2_idx ON app.fitment_configurations(dataset_version_id,vehicle_id);

CREATE INDEX fitment_configurations_q1_idx ON app.fitment_configurations(vehicle_id);

CREATE TRIGGER fitment_configurations_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.fitment_configurations
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.fitment_axles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  configuration_id uuid NOT NULL,
  axle text NOT NULL,
  quantity smallint NOT NULL,
  size_code text NOT NULL,
  width_mm numeric,
  aspect_ratio numeric,
  rim_inches numeric NOT NULL,
  construction text NOT NULL,
  min_load_index smallint,
  min_speed_rank smallint,
  load_range text,
  xl_required boolean,
  run_flat_required boolean,
  unknown_constraints jsonb NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  CONSTRAINT fitment_axles_pk PRIMARY KEY (id),
  CONSTRAINT fitment_axles_u1 UNIQUE (configuration_id,axle),
  CONSTRAINT fitment_axles_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT fitment_axles_axle_ck CHECK (axle IN ('front','rear','all')),
  CONSTRAINT fitment_axles_quantity_ck CHECK (quantity BETWEEN 1 AND 16),
  CONSTRAINT fitment_axles_dimensions_ck CHECK ((width_mm IS NULL OR width_mm > 0 AND width_mm < 10000) AND (aspect_ratio IS NULL OR aspect_ratio > 0 AND aspect_ratio <= 200) AND rim_inches > 0 AND rim_inches < 1000),
  CONSTRAINT fitment_axles_load_ck CHECK (min_load_index BETWEEN 1 AND 1000),
  CONSTRAINT fitment_axles_speed_ck CHECK (min_speed_rank BETWEEN 0 AND 1000),
  CONSTRAINT fitment_axles_unknown_ck CHECK (jsonb_typeof(unknown_constraints)='array' AND jsonb_array_length(unknown_constraints) <= 64 AND NOT jsonb_path_exists(unknown_constraints, '$[*] ? (@.type() != "string")') AND octet_length(unknown_constraints::text) <= 4096),
  CONSTRAINT fitment_axles_schema_ck CHECK (schema_version > 0),
  CONSTRAINT fitment_axles_size_ck CHECK (length(size_code) BETWEEN 1 AND 80),
  CONSTRAINT fitment_axles_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT fitment_axles_configuration_fk FOREIGN KEY (dataset_version_id,configuration_id) REFERENCES app.fitment_configurations(dataset_version_id,id) ON DELETE RESTRICT
);

CREATE INDEX fitment_axles_f2_idx ON app.fitment_axles(dataset_version_id,configuration_id);

CREATE TRIGGER fitment_axles_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.fitment_axles
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.tire_models (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  brand text NOT NULL,
  model text NOT NULL,
  category text NOT NULL,
  seasonal_class text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT tire_models_pk PRIMARY KEY (id),
  CONSTRAINT tire_models_u1 UNIQUE (dataset_version_id,id),
  CONSTRAINT tire_models_u2 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT tire_models_labels_ck CHECK (length(brand) BETWEEN 1 AND 200 AND length(model) BETWEEN 1 AND 200 AND length(category) BETWEEN 1 AND 80 AND length(seasonal_class) BETWEEN 1 AND 80),
  CONSTRAINT tire_models_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT tire_models_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT
);

CREATE INDEX tire_models_q1_idx ON app.tire_models(dataset_version_id,brand,model,id);

CREATE TRIGGER tire_models_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.tire_models
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.tire_skus (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL,
  manufacturer_sku text NOT NULL,
  size_code text NOT NULL,
  construction text NOT NULL,
  load_index smallint,
  speed_rank smallint,
  load_range text,
  xl boolean,
  run_flat boolean,
  rim_inches numeric NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT tire_skus_pk PRIMARY KEY (id),
  CONSTRAINT tire_skus_u1 UNIQUE (dataset_version_id,manufacturer_sku),
  CONSTRAINT tire_skus_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT tire_skus_u3 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT tire_skus_load_ck CHECK (load_index BETWEEN 1 AND 1000),
  CONSTRAINT tire_skus_speed_ck CHECK (speed_rank BETWEEN 0 AND 1000),
  CONSTRAINT tire_skus_rim_ck CHECK (rim_inches > 0 AND rim_inches < 1000),
  CONSTRAINT tire_skus_status_ck CHECK (status IN ('unknown','active','discontinued')),
  CONSTRAINT tire_skus_labels_ck CHECK (length(manufacturer_sku) BETWEEN 1 AND 200 AND length(size_code) BETWEEN 1 AND 80),
  CONSTRAINT tire_skus_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT tire_skus_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT tire_skus_model_fk FOREIGN KEY (dataset_version_id,model_id) REFERENCES app.tire_models(dataset_version_id,id) ON DELETE RESTRICT
);

CREATE INDEX tire_skus_f2_idx ON app.tire_skus(dataset_version_id,model_id);

CREATE INDEX tire_skus_q1_idx ON app.tire_skus(model_id);

CREATE INDEX tire_skus_q2_idx ON app.tire_skus(dataset_version_id,size_code,construction,id);

CREATE TRIGGER tire_skus_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.tire_skus
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.market_availability (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sku_id uuid NOT NULL,
  market text NOT NULL,
  available boolean NOT NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT market_availability_pk PRIMARY KEY (id),
  CONSTRAINT market_availability_u1 UNIQUE (dataset_version_id,sku_id,market),
  CONSTRAINT market_availability_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT market_availability_u3 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT market_availability_times_ck CHECK (observed_at IS NULL OR expires_at IS NULL OR expires_at >= observed_at),
  CONSTRAINT market_availability_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT market_availability_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT market_availability_sku_fk FOREIGN KEY (sku_id) REFERENCES app.tire_skus(id) ON DELETE RESTRICT,
  CONSTRAINT market_availability_market_fk FOREIGN KEY (market) REFERENCES app.markets(code) ON DELETE RESTRICT
);

CREATE INDEX market_availability_f2_idx ON app.market_availability(sku_id);

CREATE INDEX market_availability_f3_idx ON app.market_availability(market);

CREATE INDEX market_availability_q1_idx ON app.market_availability(market,sku_id);

CREATE INDEX market_availability_q2_idx ON app.market_availability(expires_at,id);

CREATE TRIGGER market_availability_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.market_availability
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.evidence (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sku_id uuid,
  model_id uuid,
  metric_code text NOT NULL,
  numeric_value numeric,
  text_value text,
  missing_reason text,
  unit text,
  method text NOT NULL,
  source_url text NOT NULL,
  tested_at timestamptz,
  reviewed_at timestamptz NOT NULL,
  confidence text NOT NULL,
  applicability jsonb NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT evidence_pk PRIMARY KEY (id),
  CONSTRAINT evidence_u1 UNIQUE (dataset_version_id,id),
  CONSTRAINT evidence_u2 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT evidence_subject_ck CHECK (num_nonnulls(sku_id,model_id)=1),
  CONSTRAINT evidence_value_ck CHECK (num_nonnulls(numeric_value,text_value,missing_reason)=1 AND (text_value IS NULL OR length(btrim(text_value)) BETWEEN 1 AND 4000) AND (missing_reason IS NULL OR length(btrim(missing_reason)) BETWEEN 1 AND 200)),
  CONSTRAINT evidence_finite_ck CHECK (numeric_value > '-Infinity'::numeric AND numeric_value < 'Infinity'::numeric),
  CONSTRAINT evidence_applicability_ck CHECK (jsonb_typeof(applicability) = 'object' AND octet_length(applicability::text) <= 16384),
  CONSTRAINT evidence_schema_ck CHECK (schema_version > 0),
  CONSTRAINT evidence_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT evidence_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT evidence_sku_fk FOREIGN KEY (sku_id) REFERENCES app.tire_skus(id) ON DELETE RESTRICT,
  CONSTRAINT evidence_model_fk FOREIGN KEY (model_id) REFERENCES app.tire_models(id) ON DELETE RESTRICT,
  CONSTRAINT evidence_unit_fk FOREIGN KEY (unit) REFERENCES app.units(code) ON DELETE RESTRICT
);

CREATE INDEX evidence_f2_idx ON app.evidence(sku_id);

CREATE INDEX evidence_f3_idx ON app.evidence(model_id);

CREATE INDEX evidence_f4_idx ON app.evidence(unit);

CREATE INDEX evidence_q1_idx ON app.evidence(sku_id,metric_code);

CREATE INDEX evidence_q2_idx ON app.evidence(model_id,metric_code);

CREATE TRIGGER evidence_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.evidence
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.scores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sku_id uuid NOT NULL,
  evidence_bundle_id uuid NOT NULL,
  rule_version_id uuid NOT NULL,
  dimension text NOT NULL,
  value numeric,
  missing_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scores_pk PRIMARY KEY (id),
  CONSTRAINT scores_u1 UNIQUE (sku_id,evidence_bundle_id,rule_version_id,dimension),
  CONSTRAINT scores_value_ck CHECK (num_nonnulls(value,missing_reason)=1 AND (value IS NULL OR value BETWEEN 0 AND 100) AND (missing_reason IS NULL OR length(btrim(missing_reason)) BETWEEN 1 AND 200)),
  CONSTRAINT scores_sku_fk FOREIGN KEY (sku_id) REFERENCES app.tire_skus(id) ON DELETE RESTRICT,
  CONSTRAINT scores_evidence_bundle_fk FOREIGN KEY (evidence_bundle_id) REFERENCES app.dataset_bundles(id) ON DELETE RESTRICT,
  CONSTRAINT scores_rule_version_fk FOREIGN KEY (rule_version_id) REFERENCES app.rule_versions(id) ON DELETE RESTRICT
);

CREATE INDEX scores_f2_idx ON app.scores(evidence_bundle_id);

CREATE INDEX scores_f3_idx ON app.scores(rule_version_id);

CREATE TABLE app.prices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sku_id uuid NOT NULL,
  retailer_id uuid NOT NULL,
  market text NOT NULL,
  currency text NOT NULL,
  unit_price_minor bigint NOT NULL,
  quantity_basis text NOT NULL,
  observed_at timestamptz NOT NULL,
  valid_until timestamptz,
  tax_included boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT prices_pk PRIMARY KEY (id),
  CONSTRAINT prices_u1 UNIQUE (dataset_version_id,id),
  CONSTRAINT prices_u2 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT prices_amount_ck CHECK (unit_price_minor >= 0),
  CONSTRAINT prices_basis_ck CHECK (quantity_basis IN ('per_tire','per_axle','per_set')),
  CONSTRAINT prices_times_ck CHECK (observed_at IS NULL OR valid_until IS NULL OR valid_until >= observed_at),
  CONSTRAINT prices_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT prices_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT prices_sku_fk FOREIGN KEY (sku_id) REFERENCES app.tire_skus(id) ON DELETE RESTRICT,
  CONSTRAINT prices_retailer_fk FOREIGN KEY (retailer_id) REFERENCES app.retailers(id) ON DELETE RESTRICT,
  CONSTRAINT prices_market_fk FOREIGN KEY (market) REFERENCES app.markets(code) ON DELETE RESTRICT,
  CONSTRAINT prices_currency_fk FOREIGN KEY (currency) REFERENCES app.currencies(code) ON DELETE RESTRICT
);

CREATE INDEX prices_f2_idx ON app.prices(sku_id);

CREATE INDEX prices_f3_idx ON app.prices(retailer_id);

CREATE INDEX prices_f4_idx ON app.prices(market);

CREATE INDEX prices_f5_idx ON app.prices(currency);

CREATE INDEX prices_q1_idx ON app.prices(sku_id,market,observed_at DESC,id);

CREATE INDEX prices_q2_idx ON app.prices(valid_until,id);

CREATE TRIGGER prices_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.prices
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.price_components (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  price_id uuid NOT NULL,
  kind text NOT NULL,
  basis text NOT NULL,
  amount_kind text NOT NULL,
  low_minor bigint,
  high_minor bigint,
  rate numeric,
  included boolean NOT NULL,
  source_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  CONSTRAINT price_components_pk PRIMARY KEY (id),
  CONSTRAINT price_components_u1 UNIQUE (price_id,kind,basis),
  CONSTRAINT price_components_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT price_components_amount_ck CHECK ((amount_kind='fixed' AND low_minor IS NOT NULL AND high_minor IS NOT NULL AND low_minor >= 0 AND high_minor >= low_minor AND rate IS NULL AND basis IN ('per_tire','per_axle','per_order')) OR (amount_kind='percentage' AND low_minor IS NULL AND high_minor IS NULL AND rate IS NOT NULL AND rate BETWEEN 0 AND 1 AND basis IN ('tire_subtotal','taxable_subtotal','order_subtotal'))),
  CONSTRAINT price_components_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT price_components_price_fk FOREIGN KEY (dataset_version_id,price_id) REFERENCES app.prices(dataset_version_id,id) ON DELETE RESTRICT
);

CREATE INDEX price_components_f2_idx ON app.price_components(dataset_version_id,price_id);

CREATE TRIGGER price_components_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.price_components
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.climate_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  market text NOT NULL,
  region_key text NOT NULL,
  profile jsonb NOT NULL,
  method text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT climate_profiles_pk PRIMARY KEY (id),
  CONSTRAINT climate_profiles_u1 UNIQUE (dataset_version_id,market,region_key),
  CONSTRAINT climate_profiles_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT climate_profiles_u3 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT climate_profiles_profile_ck CHECK (jsonb_typeof(profile) = 'object' AND octet_length(profile::text) <= 16384),
  CONSTRAINT climate_profiles_schema_ck CHECK (schema_version > 0),
  CONSTRAINT climate_profiles_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT climate_profiles_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT climate_profiles_market_fk FOREIGN KEY (market) REFERENCES app.markets(code) ON DELETE RESTRICT
);

CREATE INDEX climate_profiles_f2_idx ON app.climate_profiles(market);

CREATE TRIGGER climate_profiles_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.climate_profiles
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.market_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  market text NOT NULL,
  region_key text NOT NULL,
  rule_code text NOT NULL,
  guidance jsonb NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  reviewed_at timestamptz NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT market_rules_pk PRIMARY KEY (id),
  CONSTRAINT market_rules_u1 UNIQUE (dataset_version_id,market,region_key,rule_code),
  CONSTRAINT market_rules_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT market_rules_u3 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT market_rules_guidance_ck CHECK (jsonb_typeof(guidance) = 'object' AND octet_length(guidance::text) <= 16384),
  CONSTRAINT market_rules_dates_ck CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT market_rules_schema_ck CHECK (schema_version > 0),
  CONSTRAINT market_rules_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT market_rules_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT market_rules_market_fk FOREIGN KEY (market) REFERENCES app.markets(code) ON DELETE RESTRICT
);

CREATE INDEX market_rules_f2_idx ON app.market_rules(market);

CREATE INDEX market_rules_q1_idx ON app.market_rules(market,region_key,effective_to);

CREATE TRIGGER market_rules_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.market_rules
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.vehicle_lookup_options (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  make_entity_id uuid NOT NULL,
  model_entity_id uuid NOT NULL,
  model_year smallint NOT NULL,
  vehicle_type text NOT NULL,
  market text NOT NULL,
  source_trim text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT vehicle_lookup_options_pk PRIMARY KEY (id),
  CONSTRAINT vehicle_lookup_options_u1 UNIQUE (dataset_version_id,id),
  CONSTRAINT vehicle_lookup_options_u2 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT vehicle_lookup_options_year_ck CHECK (model_year BETWEEN 1886 AND 2200),
  CONSTRAINT vehicle_lookup_options_entities_ck CHECK (make_entity_id <> model_entity_id),
  CONSTRAINT vehicle_lookup_options_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT vehicle_lookup_options_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT vehicle_lookup_options_make_entity_fk FOREIGN KEY (make_entity_id) REFERENCES app.domain_entities(id) ON DELETE RESTRICT,
  CONSTRAINT vehicle_lookup_options_model_entity_fk FOREIGN KEY (model_entity_id) REFERENCES app.domain_entities(id) ON DELETE RESTRICT,
  CONSTRAINT vehicle_lookup_options_market_fk FOREIGN KEY (market) REFERENCES app.markets(code) ON DELETE RESTRICT
);

CREATE INDEX vehicle_lookup_options_f2_idx ON app.vehicle_lookup_options(make_entity_id);

CREATE INDEX vehicle_lookup_options_f3_idx ON app.vehicle_lookup_options(model_entity_id);

CREATE INDEX vehicle_lookup_options_f4_idx ON app.vehicle_lookup_options(market);

CREATE INDEX vehicle_lookup_options_q1_idx ON app.vehicle_lookup_options(dataset_version_id,market,make_entity_id,model_year,model_entity_id);

CREATE TRIGGER vehicle_lookup_options_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.vehicle_lookup_options
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.vehicle_reference_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  lookup_option_id uuid NOT NULL,
  match_status text NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT vehicle_reference_links_pk PRIMARY KEY (id),
  CONSTRAINT vehicle_reference_links_u1 UNIQUE (dataset_version_id,vehicle_id,lookup_option_id),
  CONSTRAINT vehicle_reference_links_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT vehicle_reference_links_u3 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT vehicle_reference_links_status_ck CHECK (match_status IN ('reviewed','unresolved','rejected')),
  CONSTRAINT vehicle_reference_links_review_ck CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL) AND (match_status <> 'reviewed' OR reviewed_by IS NOT NULL)),
  CONSTRAINT vehicle_reference_links_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT vehicle_reference_links_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT vehicle_reference_links_vehicle_fk FOREIGN KEY (vehicle_id) REFERENCES app.vehicles(id) ON DELETE RESTRICT,
  CONSTRAINT vehicle_reference_links_lookup_option_fk FOREIGN KEY (lookup_option_id) REFERENCES app.vehicle_lookup_options(id) ON DELETE RESTRICT,
  CONSTRAINT vehicle_reference_links_reviewed_by_fk FOREIGN KEY (reviewed_by) REFERENCES admin.staff_identities(id) ON DELETE RESTRICT
);

CREATE INDEX vehicle_reference_links_f2_idx ON app.vehicle_reference_links(vehicle_id);

CREATE INDEX vehicle_reference_links_f3_idx ON app.vehicle_reference_links(lookup_option_id);

CREATE INDEX vehicle_reference_links_f4_idx ON app.vehicle_reference_links(reviewed_by);

CREATE TRIGGER vehicle_reference_links_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.vehicle_reference_links
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.tire_model_reference_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tire_model_id uuid NOT NULL,
  brand_entity_id uuid NOT NULL,
  manufacturer_entity_id uuid,
  match_status text NOT NULL,
  source_url text NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT tire_model_reference_links_pk PRIMARY KEY (id),
  CONSTRAINT tire_model_reference_links_u1 UNIQUE (dataset_version_id,tire_model_id,brand_entity_id),
  CONSTRAINT tire_model_reference_links_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT tire_model_reference_links_u3 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT tire_model_reference_links_status_ck CHECK (match_status IN ('reviewed','unresolved','rejected')),
  CONSTRAINT tire_model_reference_links_review_ck CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL) AND (match_status <> 'reviewed' OR reviewed_by IS NOT NULL)),
  CONSTRAINT tire_model_reference_links_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT tire_model_reference_links_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT tire_model_reference_links_tire_model_fk FOREIGN KEY (tire_model_id) REFERENCES app.tire_models(id) ON DELETE RESTRICT,
  CONSTRAINT tire_model_reference_links_brand_entity_fk FOREIGN KEY (brand_entity_id) REFERENCES app.domain_entities(id) ON DELETE RESTRICT,
  CONSTRAINT tire_model_reference_links_manufacturer_entity_fk FOREIGN KEY (manufacturer_entity_id) REFERENCES app.domain_entities(id) ON DELETE RESTRICT,
  CONSTRAINT tire_model_reference_links_reviewed_by_fk FOREIGN KEY (reviewed_by) REFERENCES admin.staff_identities(id) ON DELETE RESTRICT
);

CREATE INDEX tire_model_reference_links_f2_idx ON app.tire_model_reference_links(tire_model_id);

CREATE INDEX tire_model_reference_links_f3_idx ON app.tire_model_reference_links(brand_entity_id);

CREATE INDEX tire_model_reference_links_f4_idx ON app.tire_model_reference_links(manufacturer_entity_id);

CREATE INDEX tire_model_reference_links_f5_idx ON app.tire_model_reference_links(reviewed_by);

CREATE TRIGGER tire_model_reference_links_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.tire_model_reference_links
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.reference_code_values (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  system text NOT NULL,
  code text NOT NULL,
  locale text NOT NULL,
  label text NOT NULL,
  numeric_value numeric,
  unit text,
  meaning text NOT NULL,
  valid_from date,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT reference_code_values_pk PRIMARY KEY (id),
  CONSTRAINT reference_code_values_u1 UNIQUE (dataset_version_id,system,code,locale),
  CONSTRAINT reference_code_values_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT reference_code_values_u3 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT reference_code_values_dates_ck CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT reference_code_values_finite_ck CHECK (numeric_value > '-Infinity'::numeric AND numeric_value < 'Infinity'::numeric),
  CONSTRAINT reference_code_values_text_ck CHECK (length(system) BETWEEN 1 AND 80 AND length(code) BETWEEN 1 AND 80 AND length(label) BETWEEN 1 AND 200 AND length(meaning) BETWEEN 1 AND 4000),
  CONSTRAINT reference_code_values_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT reference_code_values_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT reference_code_values_locale_fk FOREIGN KEY (locale) REFERENCES app.locales(code) ON DELETE RESTRICT,
  CONSTRAINT reference_code_values_unit_fk FOREIGN KEY (unit) REFERENCES app.units(code) ON DELETE RESTRICT
);

CREATE INDEX reference_code_values_f2_idx ON app.reference_code_values(locale);

CREATE INDEX reference_code_values_f3_idx ON app.reference_code_values(unit);

CREATE TRIGGER reference_code_values_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.reference_code_values
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.advice_facts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  topic_key text NOT NULL,
  market text NOT NULL,
  locale text NOT NULL,
  claim text NOT NULL,
  applicability jsonb NOT NULL,
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL,
  review_due_at timestamptz NOT NULL,
  status text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT advice_facts_pk PRIMARY KEY (id),
  CONSTRAINT advice_facts_u1 UNIQUE (dataset_version_id,topic_key,market,locale),
  CONSTRAINT advice_facts_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT advice_facts_u3 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT advice_facts_review_ck CHECK (review_due_at > reviewed_at),
  CONSTRAINT advice_facts_status_ck CHECK (status IN ('draft','reviewed','withdrawn')),
  CONSTRAINT advice_facts_applicability_ck CHECK (jsonb_typeof(applicability) = 'object' AND octet_length(applicability::text) <= 16384),
  CONSTRAINT advice_facts_schema_ck CHECK (schema_version > 0),
  CONSTRAINT advice_facts_claim_ck CHECK (length(claim) BETWEEN 1 AND 8000),
  CONSTRAINT advice_facts_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT advice_facts_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT advice_facts_locale_fk FOREIGN KEY (market,locale) REFERENCES app.market_locales(market_code,locale_code) ON DELETE RESTRICT,
  CONSTRAINT advice_facts_reviewed_by_fk FOREIGN KEY (reviewed_by) REFERENCES admin.staff_identities(id) ON DELETE RESTRICT
);

CREATE INDEX advice_facts_f2_idx ON app.advice_facts(market,locale);

CREATE INDEX advice_facts_f3_idx ON app.advice_facts(reviewed_by);

CREATE INDEX advice_facts_q1_idx ON app.advice_facts(status,review_due_at,id);

CREATE TRIGGER advice_facts_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.advice_facts
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.advice_fact_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  fact_id uuid NOT NULL,
  source_url text NOT NULL,
  provider_id uuid NOT NULL,
  license_id uuid NOT NULL,
  locator text,
  retrieved_at timestamptz NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  CONSTRAINT advice_fact_sources_pk PRIMARY KEY (id),
  CONSTRAINT advice_fact_sources_u1 UNIQUE (fact_id,source_url,content_hash),
  CONSTRAINT advice_fact_sources_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT advice_fact_sources_hash_ck CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT advice_fact_sources_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT advice_fact_sources_fact_fk FOREIGN KEY (dataset_version_id,fact_id) REFERENCES app.advice_facts(dataset_version_id,id) ON DELETE RESTRICT,
  CONSTRAINT advice_fact_sources_license_fk FOREIGN KEY (provider_id,license_id) REFERENCES app.data_licenses(provider_id,id) ON DELETE RESTRICT
);

CREATE INDEX advice_fact_sources_f2_idx ON app.advice_fact_sources(dataset_version_id,fact_id);

CREATE INDEX advice_fact_sources_f3_idx ON app.advice_fact_sources(provider_id,license_id);

CREATE INDEX advice_fact_sources_q1_idx ON app.advice_fact_sources(license_id);

CREATE TRIGGER advice_fact_sources_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.advice_fact_sources
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.recalls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  authority text NOT NULL,
  recall_number text NOT NULL,
  announced_on date NOT NULL,
  status text NOT NULL,
  source_url text NOT NULL,
  summary text NOT NULL,
  product_type text NOT NULL,
  manufacturer_entity_id uuid,
  component_code text,
  consequence text,
  remedy text,
  manufacturer_campaign_number text,
  affected_count bigint,
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT recalls_pk PRIMARY KEY (id),
  CONSTRAINT recalls_u1 UNIQUE (dataset_version_id,authority,recall_number),
  CONSTRAINT recalls_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT recalls_u3 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT recalls_product_ck CHECK (product_type IN ('tire','vehicle','equipment','child_seat')),
  CONSTRAINT recalls_count_ck CHECK (affected_count >= 0),
  CONSTRAINT recalls_labels_ck CHECK (length(authority) BETWEEN 1 AND 80 AND length(recall_number) BETWEEN 1 AND 100 AND length(status) BETWEEN 1 AND 100),
  CONSTRAINT recalls_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT recalls_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT recalls_manufacturer_entity_fk FOREIGN KEY (manufacturer_entity_id) REFERENCES app.domain_entities(id) ON DELETE RESTRICT
);

CREATE INDEX recalls_f2_idx ON app.recalls(manufacturer_entity_id);

CREATE INDEX recalls_q1_idx ON app.recalls(authority,recall_number);

CREATE INDEX recalls_q2_idx ON app.recalls(source_updated_at,id);

CREATE TRIGGER recalls_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.recalls
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.recall_source_targets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recall_id uuid NOT NULL,
  target_key text NOT NULL,
  brand_name text,
  product_name text,
  size_text text,
  dot_pattern jsonb,
  manufactured_from date,
  manufactured_to date,
  source_details jsonb NOT NULL,
  match_status text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  CONSTRAINT recall_source_targets_pk PRIMARY KEY (id),
  CONSTRAINT recall_source_targets_u1 UNIQUE (recall_id,target_key),
  CONSTRAINT recall_source_targets_u2 UNIQUE (recall_id,id),
  CONSTRAINT recall_source_targets_u3 UNIQUE (dataset_version_id,id),
  CONSTRAINT recall_source_targets_dates_ck CHECK (manufactured_from IS NULL OR manufactured_to IS NULL OR manufactured_to >= manufactured_from),
  CONSTRAINT recall_source_targets_details_ck CHECK (jsonb_typeof(source_details) = 'object' AND octet_length(source_details::text) <= 16384),
  CONSTRAINT recall_source_targets_pattern_ck CHECK (jsonb_typeof(dot_pattern) = 'object' AND octet_length(dot_pattern::text) <= 16384),
  CONSTRAINT recall_source_targets_status_ck CHECK (match_status IN ('unresolved','conditional','reviewed','rejected')),
  CONSTRAINT recall_source_targets_schema_ck CHECK (schema_version > 0),
  CONSTRAINT recall_source_targets_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT recall_source_targets_recall_fk FOREIGN KEY (dataset_version_id,recall_id) REFERENCES app.recalls(dataset_version_id,id) ON DELETE RESTRICT
);

CREATE INDEX recall_source_targets_f2_idx ON app.recall_source_targets(dataset_version_id,recall_id);

CREATE INDEX recall_source_targets_q1_idx ON app.recall_source_targets(match_status,recall_id);

CREATE TRIGGER recall_source_targets_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.recall_source_targets
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.recall_targets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recall_id uuid NOT NULL,
  source_target_id uuid NOT NULL,
  sku_id uuid,
  model_id uuid,
  dot_match jsonb NOT NULL,
  match_status text NOT NULL,
  mapping_version text NOT NULL,
  reviewed_at timestamptz,
  reviewed_by uuid,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  CONSTRAINT recall_targets_pk PRIMARY KEY (id),
  CONSTRAINT recall_targets_u1 UNIQUE (dataset_version_id,id),
  CONSTRAINT recall_targets_subject_ck CHECK (num_nonnulls(sku_id,model_id)=1),
  CONSTRAINT recall_targets_match_ck CHECK (jsonb_typeof(dot_match) = 'object' AND octet_length(dot_match::text) <= 16384),
  CONSTRAINT recall_targets_status_ck CHECK (match_status IN ('conditional','reviewed','rejected')),
  CONSTRAINT recall_targets_review_ck CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL) AND (match_status <> 'reviewed' OR reviewed_by IS NOT NULL)),
  CONSTRAINT recall_targets_schema_ck CHECK (schema_version > 0),
  CONSTRAINT recall_targets_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT recall_targets_recall_fk FOREIGN KEY (dataset_version_id,recall_id) REFERENCES app.recalls(dataset_version_id,id) ON DELETE RESTRICT,
  CONSTRAINT recall_targets_source_fk FOREIGN KEY (recall_id,source_target_id) REFERENCES app.recall_source_targets(recall_id,id) ON DELETE RESTRICT,
  CONSTRAINT recall_targets_sku_fk FOREIGN KEY (sku_id) REFERENCES app.tire_skus(id) ON DELETE RESTRICT,
  CONSTRAINT recall_targets_model_fk FOREIGN KEY (model_id) REFERENCES app.tire_models(id) ON DELETE RESTRICT,
  CONSTRAINT recall_targets_reviewed_by_fk FOREIGN KEY (reviewed_by) REFERENCES admin.staff_identities(id) ON DELETE RESTRICT
);

CREATE INDEX recall_targets_f2_idx ON app.recall_targets(dataset_version_id,recall_id);

CREATE INDEX recall_targets_f3_idx ON app.recall_targets(recall_id,source_target_id);

CREATE INDEX recall_targets_f4_idx ON app.recall_targets(sku_id);

CREATE INDEX recall_targets_f5_idx ON app.recall_targets(model_id);

CREATE INDEX recall_targets_f6_idx ON app.recall_targets(reviewed_by);

CREATE INDEX recall_targets_q1_idx ON app.recall_targets(source_target_id);

CREATE TRIGGER recall_targets_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.recall_targets
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

-- Derived evidence scores are append-only; replacing a computation uses a new rule/bundle identity.
CREATE FUNCTION app.reject_history_change() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, app AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='History is append-only';
END;
$$;
CREATE TRIGGER scores_immutable BEFORE UPDATE OR DELETE ON app.scores
  FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
