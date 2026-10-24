-- P1-PR-005: source ownership, immutable revisions and canonical identities.
-- No production source rights or launch coverage are implied by these empty schemas.

CREATE TABLE app.data_providers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT data_providers_pk PRIMARY KEY (id),
  CONSTRAINT data_providers_u1 UNIQUE (code),
  CONSTRAINT data_providers_status_ck CHECK (status IN ('active','disabled')),
  CONSTRAINT data_providers_identity_ck CHECK (length(code) BETWEEN 1 AND 80 AND length(name) BETWEEN 1 AND 200),
  CONSTRAINT data_providers_revision_ck CHECK (revision > 0 AND updated_at >= created_at)
);

CREATE TABLE app.data_licenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  market text NOT NULL,
  rights jsonb NOT NULL,
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  reviewed_at timestamptz NOT NULL,
  agreement_asset_id uuid,
  rights_schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_licenses_pk PRIMARY KEY (id),
  CONSTRAINT data_licenses_u1 UNIQUE (provider_id,id),
  CONSTRAINT data_licenses_times_ck CHECK (effective_at IS NULL OR expires_at IS NULL OR expires_at >= effective_at),
  CONSTRAINT data_licenses_rights_ck CHECK (jsonb_typeof(rights) = 'object' AND octet_length(rights::text) <= 16384 AND rights ?& ARRAY['display','cache','derived','snapshot','api'] AND jsonb_typeof(rights->'display')='boolean' AND jsonb_typeof(rights->'cache')='boolean' AND jsonb_typeof(rights->'derived')='boolean' AND jsonb_typeof(rights->'snapshot')='boolean' AND jsonb_typeof(rights->'api')='boolean'),
  CONSTRAINT data_licenses_schema_ck CHECK (rights_schema_version > 0),
  CONSTRAINT data_licenses_provider_fk FOREIGN KEY (provider_id) REFERENCES app.data_providers(id) ON DELETE RESTRICT,
  CONSTRAINT data_licenses_market_fk FOREIGN KEY (market) REFERENCES app.markets(code) ON DELETE RESTRICT,
  CONSTRAINT data_licenses_agreement_asset_fk FOREIGN KEY (agreement_asset_id) REFERENCES app.object_assets(id) ON DELETE RESTRICT
);

CREATE INDEX data_licenses_f2_idx ON app.data_licenses(market);

CREATE INDEX data_licenses_f3_idx ON app.data_licenses(agreement_asset_id);

CREATE INDEX data_licenses_q1_idx ON app.data_licenses(expires_at,id);

CREATE TABLE app.dataset_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  license_id uuid NOT NULL,
  kind text NOT NULL,
  external_version text NOT NULL,
  checksum text NOT NULL,
  status text NOT NULL,
  effective_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL,
  published_at timestamptz,
  row_count bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dataset_versions_pk PRIMARY KEY (id),
  CONSTRAINT dataset_versions_u1 UNIQUE (provider_id,kind,external_version),
  CONSTRAINT dataset_versions_u2 UNIQUE (provider_id,id),
  CONSTRAINT dataset_versions_status_ck CHECK (status IN ('staging','validated','published','rejected')),
  CONSTRAINT dataset_versions_hash_ck CHECK (checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT dataset_versions_count_ck CHECK (row_count >= 0),
  CONSTRAINT dataset_versions_identity_ck CHECK (length(kind) BETWEEN 1 AND 80 AND length(external_version) BETWEEN 1 AND 200),
  CONSTRAINT dataset_versions_published_ck CHECK ((status='published') = (published_at IS NOT NULL) AND (published_at IS NULL OR published_at >= fetched_at)),
  CONSTRAINT dataset_versions_provider_fk FOREIGN KEY (provider_id) REFERENCES app.data_providers(id) ON DELETE RESTRICT,
  CONSTRAINT dataset_versions_license_fk FOREIGN KEY (provider_id,license_id) REFERENCES app.data_licenses(provider_id,id) ON DELETE RESTRICT
);

CREATE INDEX dataset_versions_f2_idx ON app.dataset_versions(provider_id,license_id);

CREATE INDEX dataset_versions_q1_idx ON app.dataset_versions(license_id);

CREATE INDEX dataset_versions_q2_idx ON app.dataset_versions(status,fetched_at,id);

-- Row locks serialize source edits with publication, including INSERT and moving a row.
CREATE FUNCTION app.guard_dataset_row() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, app AS $$
DECLARE item record; old_id uuid; new_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_id := OLD.dataset_version_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_id := NEW.dataset_version_id; END IF;
  FOR item IN SELECT id,status FROM app.dataset_versions
    WHERE id = ANY(ARRAY[old_id,new_id]) ORDER BY id FOR SHARE
  LOOP
    IF item.status = 'published' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Published dataset rows are immutable';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION app.guard_published_record() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, app AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.status = 'published' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Published records are immutable';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status = 'published' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stage records before publication';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dataset_versions_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.dataset_versions
  FOR EACH ROW EXECUTE FUNCTION app.guard_published_record();

CREATE TABLE app.dataset_bundles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  market text NOT NULL,
  manifest_hash text NOT NULL,
  status text NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dataset_bundles_pk PRIMARY KEY (id),
  CONSTRAINT dataset_bundles_u1 UNIQUE (manifest_hash),
  CONSTRAINT dataset_bundles_u2 UNIQUE (id,market),
  CONSTRAINT dataset_bundles_u3 UNIQUE (id,market,status),
  CONSTRAINT dataset_bundles_hash_ck CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT dataset_bundles_status_ck CHECK (status IN ('staging','validated','published','rejected')),
  CONSTRAINT dataset_bundles_published_ck CHECK ((status='published') = (published_at IS NOT NULL)),
  CONSTRAINT dataset_bundles_market_fk FOREIGN KEY (market) REFERENCES app.markets(code) ON DELETE RESTRICT
);

CREATE INDEX dataset_bundles_f1_idx ON app.dataset_bundles(market);

CREATE TABLE app.bundle_members (
  bundle_id uuid NOT NULL,
  component_key text NOT NULL,
  dataset_version_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bundle_members_pk PRIMARY KEY (bundle_id,component_key),
  CONSTRAINT bundle_members_key_ck CHECK (length(component_key) BETWEEN 1 AND 160),
  CONSTRAINT bundle_members_bundle_fk FOREIGN KEY (bundle_id) REFERENCES app.dataset_bundles(id) ON DELETE RESTRICT,
  CONSTRAINT bundle_members_dataset_version_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT
);

CREATE INDEX bundle_members_f2_idx ON app.bundle_members(dataset_version_id);

CREATE TABLE app.market_dataset_heads (
  market text NOT NULL,
  bundle_id uuid NOT NULL,
  bundle_status text NOT NULL DEFAULT 'published',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT market_dataset_heads_pk PRIMARY KEY (market),
  CONSTRAINT market_dataset_heads_status_ck CHECK (bundle_status='published'),
  CONSTRAINT market_dataset_heads_revision_ck CHECK (revision > 0 AND updated_at >= created_at),
  CONSTRAINT market_dataset_heads_market_fk FOREIGN KEY (market) REFERENCES app.markets(code) ON DELETE RESTRICT,
  CONSTRAINT market_dataset_heads_bundle_fk FOREIGN KEY (bundle_id,market,bundle_status) REFERENCES app.dataset_bundles(id,market,status) ON DELETE RESTRICT
);

CREATE INDEX market_dataset_heads_f2_idx ON app.market_dataset_heads(bundle_id,market,bundle_status);

CREATE FUNCTION app.guard_bundle_member() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, app AS $$
DECLARE item record; old_id uuid; new_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_id := OLD.bundle_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_id := NEW.bundle_id; END IF;
  FOR item IN SELECT id,status FROM app.dataset_bundles
    WHERE id = ANY(ARRAY[old_id,new_id]) ORDER BY id FOR SHARE
  LOOP
    IF item.status = 'published' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Published bundle members are immutable';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION app.guard_bundle_publication() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, app AS $$
DECLARE item record; members integer := 0;
BEGIN
  IF NEW.status = 'published' THEN
    FOR item IN SELECT d.id,d.status FROM app.dataset_versions d
      JOIN app.bundle_members m ON m.dataset_version_id=d.id
      WHERE m.bundle_id=NEW.id ORDER BY d.id FOR SHARE OF d
    LOOP
      members := members + 1;
      IF item.status <> 'published' THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Bundle contains an unpublished dataset';
      END IF;
    END LOOP;
    IF members = 0 THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Bundle has no members'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bundle_members_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.bundle_members
  FOR EACH ROW EXECUTE FUNCTION app.guard_bundle_member();
CREATE TRIGGER dataset_bundles_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.dataset_bundles
  FOR EACH ROW EXECUTE FUNCTION app.guard_published_record();
CREATE TRIGGER dataset_bundles_publish BEFORE UPDATE ON app.dataset_bundles
  FOR EACH ROW EXECUTE FUNCTION app.guard_bundle_publication();

CREATE TABLE app.domain_entities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  stable_key text NOT NULL,
  status text NOT NULL,
  merged_into_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT domain_entities_pk PRIMARY KEY (id),
  CONSTRAINT domain_entities_u1 UNIQUE (stable_key),
  CONSTRAINT domain_entities_kind_ck CHECK (kind IN ('company','brand','plant','vehicle_make','vehicle_model')),
  CONSTRAINT domain_entities_status_ck CHECK (status IN ('active','inactive','merged')),
  CONSTRAINT domain_entities_merge_ck CHECK (merged_into_id IS DISTINCT FROM id AND ((status='merged') = (merged_into_id IS NOT NULL))),
  CONSTRAINT domain_entities_key_ck CHECK (length(stable_key) BETWEEN 1 AND 200),
  CONSTRAINT domain_entities_revision_ck CHECK (revision > 0 AND updated_at >= created_at),
  CONSTRAINT domain_entities_merged_into_fk FOREIGN KEY (merged_into_id) REFERENCES app.domain_entities(id) ON DELETE RESTRICT
);

CREATE INDEX domain_entities_f1_idx ON app.domain_entities(merged_into_id);

CREATE TABLE app.domain_entity_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  display_name text NOT NULL,
  country_code text,
  official_url text,
  valid_from date,
  valid_to date,
  review_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT domain_entity_versions_pk PRIMARY KEY (id),
  CONSTRAINT domain_entity_versions_u1 UNIQUE (dataset_version_id,entity_id),
  CONSTRAINT domain_entity_versions_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT domain_entity_versions_u3 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT domain_entity_versions_dates_ck CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT domain_entity_versions_review_ck CHECK (review_status IN ('unreviewed','reviewed','rejected')),
  CONSTRAINT domain_entity_versions_name_ck CHECK (length(display_name) BETWEEN 1 AND 300),
  CONSTRAINT domain_entity_versions_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT domain_entity_versions_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT domain_entity_versions_entity_fk FOREIGN KEY (entity_id) REFERENCES app.domain_entities(id) ON DELETE RESTRICT,
  CONSTRAINT domain_entity_versions_country_code_fk FOREIGN KEY (country_code) REFERENCES app.countries(code) ON DELETE RESTRICT
);

CREATE INDEX domain_entity_versions_f2_idx ON app.domain_entity_versions(entity_id);

CREATE INDEX domain_entity_versions_f3_idx ON app.domain_entity_versions(country_code);

CREATE TRIGGER domain_entity_versions_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.domain_entity_versions
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.domain_identifiers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  namespace text NOT NULL,
  external_id text NOT NULL,
  valid_from date,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT domain_identifiers_pk PRIMARY KEY (id),
  CONSTRAINT domain_identifiers_u1 UNIQUE (dataset_version_id,namespace,external_id),
  CONSTRAINT domain_identifiers_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT domain_identifiers_u3 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT domain_identifiers_dates_ck CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT domain_identifiers_identity_ck CHECK (length(namespace) BETWEEN 1 AND 80 AND length(external_id) BETWEEN 1 AND 256),
  CONSTRAINT domain_identifiers_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT domain_identifiers_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT domain_identifiers_entity_fk FOREIGN KEY (entity_id) REFERENCES app.domain_entities(id) ON DELETE RESTRICT
);

CREATE INDEX domain_identifiers_f2_idx ON app.domain_identifiers(entity_id);

CREATE TRIGGER domain_identifiers_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.domain_identifiers
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.domain_aliases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  locale text NOT NULL,
  normalized_alias text NOT NULL,
  alias_kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT domain_aliases_pk PRIMARY KEY (id),
  CONSTRAINT domain_aliases_u1 UNIQUE (dataset_version_id,entity_id,locale,normalized_alias),
  CONSTRAINT domain_aliases_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT domain_aliases_u3 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT domain_aliases_alias_ck CHECK (length(normalized_alias) BETWEEN 1 AND 300 AND length(alias_kind) BETWEEN 1 AND 80),
  CONSTRAINT domain_aliases_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT domain_aliases_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT domain_aliases_entity_fk FOREIGN KEY (entity_id) REFERENCES app.domain_entities(id) ON DELETE RESTRICT,
  CONSTRAINT domain_aliases_locale_fk FOREIGN KEY (locale) REFERENCES app.locales(code) ON DELETE RESTRICT
);

CREATE INDEX domain_aliases_f2_idx ON app.domain_aliases(entity_id);

CREATE INDEX domain_aliases_f3_idx ON app.domain_aliases(locale);

CREATE INDEX domain_aliases_q1_idx ON app.domain_aliases(dataset_version_id,locale,normalized_alias);

CREATE TRIGGER domain_aliases_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.domain_aliases
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.domain_relationships (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_entity_id uuid NOT NULL,
  to_entity_id uuid NOT NULL,
  kind text NOT NULL,
  valid_from date,
  valid_to date,
  source_url text NOT NULL,
  review_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT domain_relationships_pk PRIMARY KEY (id),
  CONSTRAINT domain_relationships_u1 UNIQUE (dataset_version_id,id),
  CONSTRAINT domain_relationships_u2 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT domain_relationships_endpoints_ck CHECK (from_entity_id <> to_entity_id),
  CONSTRAINT domain_relationships_kind_ck CHECK (kind IN ('brand_owned_by','company_operates_plant','model_of_make')),
  CONSTRAINT domain_relationships_dates_ck CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT domain_relationships_review_ck CHECK (review_status IN ('unreviewed','reviewed','rejected')),
  CONSTRAINT domain_relationships_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT domain_relationships_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT domain_relationships_from_entity_fk FOREIGN KEY (from_entity_id) REFERENCES app.domain_entities(id) ON DELETE RESTRICT,
  CONSTRAINT domain_relationships_to_entity_fk FOREIGN KEY (to_entity_id) REFERENCES app.domain_entities(id) ON DELETE RESTRICT
);

CREATE INDEX domain_relationships_f2_idx ON app.domain_relationships(from_entity_id);

CREATE INDEX domain_relationships_f3_idx ON app.domain_relationships(to_entity_id);

CREATE TRIGGER domain_relationships_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.domain_relationships
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.manufacturing_plant_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  plant_entity_id uuid NOT NULL,
  authority text NOT NULL,
  equipment_type text NOT NULL,
  code text NOT NULL,
  valid_from date,
  valid_to date,
  source_year smallint,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_version_id uuid NOT NULL,
  source_record_key text NOT NULL,
  CONSTRAINT manufacturing_plant_codes_pk PRIMARY KEY (id),
  CONSTRAINT manufacturing_plant_codes_u1 UNIQUE (dataset_version_id,authority,equipment_type,code,source_record_key),
  CONSTRAINT manufacturing_plant_codes_u2 UNIQUE (dataset_version_id,id),
  CONSTRAINT manufacturing_plant_codes_u3 UNIQUE (dataset_version_id,source_record_key),
  CONSTRAINT manufacturing_plant_codes_dates_ck CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT manufacturing_plant_codes_year_ck CHECK (source_year BETWEEN 1886 AND 2200),
  CONSTRAINT manufacturing_plant_codes_status_ck CHECK (status IN ('unknown','active','inactive','historical')),
  CONSTRAINT manufacturing_plant_codes_code_ck CHECK (length(code) BETWEEN 1 AND 80),
  CONSTRAINT manufacturing_plant_codes_source_key_ck CHECK (length(btrim(source_record_key)) BETWEEN 1 AND 512),
  CONSTRAINT manufacturing_plant_codes_dataset_fk FOREIGN KEY (dataset_version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT manufacturing_plant_codes_plant_entity_fk FOREIGN KEY (plant_entity_id) REFERENCES app.domain_entities(id) ON DELETE RESTRICT
);

CREATE INDEX manufacturing_plant_codes_f2_idx ON app.manufacturing_plant_codes(plant_entity_id);

CREATE INDEX manufacturing_plant_codes_q1_idx ON app.manufacturing_plant_codes(authority,equipment_type,code,valid_from,valid_to);

CREATE TRIGGER manufacturing_plant_codes_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.manufacturing_plant_codes
  FOR EACH ROW EXECUTE FUNCTION app.guard_dataset_row();

CREATE TABLE app.rule_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  version text NOT NULL,
  document jsonb NOT NULL,
  document_hash text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  status text NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rule_versions_pk PRIMARY KEY (id),
  CONSTRAINT rule_versions_u1 UNIQUE (kind,version),
  CONSTRAINT rule_versions_u2 UNIQUE (document_hash),
  CONSTRAINT rule_versions_document_ck CHECK (jsonb_typeof(document) = 'object' AND octet_length(document::text) <= 65536),
  CONSTRAINT rule_versions_hash_ck CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT rule_versions_schema_ck CHECK (schema_version > 0),
  CONSTRAINT rule_versions_status_ck CHECK (status IN ('draft','reviewed','published','retired')),
  CONSTRAINT rule_versions_review_ck CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL) AND (status NOT IN ('reviewed','published') OR reviewed_by IS NOT NULL)),
  CONSTRAINT rule_versions_reviewed_by_fk FOREIGN KEY (reviewed_by) REFERENCES admin.staff_identities(id) ON DELETE RESTRICT
);

CREATE INDEX rule_versions_f1_idx ON app.rule_versions(reviewed_by);

CREATE TRIGGER rule_versions_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.rule_versions
  FOR EACH ROW EXECUTE FUNCTION app.guard_published_record();

CREATE TABLE app.retailers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  market text NOT NULL,
  approved_origin text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT retailers_pk PRIMARY KEY (id),
  CONSTRAINT retailers_u1 UNIQUE (code),
  CONSTRAINT retailers_status_ck CHECK (status IN ('active','disabled')),
  CONSTRAINT retailers_origin_ck CHECK (approved_origin ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$' AND length(approved_origin) <= 300),
  CONSTRAINT retailers_revision_ck CHECK (revision > 0 AND updated_at >= created_at),
  CONSTRAINT retailers_market_fk FOREIGN KEY (market) REFERENCES app.markets(code) ON DELETE RESTRICT
);

CREATE INDEX retailers_f1_idx ON app.retailers(market);

-- Default privileges deny access to these tables and functions to every runtime role.
-- Read projections, import worker and publication grants require their later reviewed service migrations.
