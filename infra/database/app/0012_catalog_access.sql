-- P1-PR-010: dedicated repository capabilities, published projections and keyset indexes.
-- No source access is granted to the general application/privacy roles.
GRANT USAGE ON SCHEMA app TO tt_catalog_runtime,tt_ingest_runtime,tt_publish_runtime;
GRANT SELECT ON app.code_sets,app.code_values,app.countries,app.currencies,app.locales,app.markets,app.market_locales,app.units TO tt_catalog_runtime,tt_ingest_runtime,tt_publish_runtime;
ALTER TABLE app.dataset_versions ALTER COLUMN status SET DEFAULT 'staging';
CREATE VIEW app.catalog_sources WITH (security_barrier=true) AS
SELECT d.id AS dataset_id,d.provider_id,d.license_id,d.kind,d.external_version,d.fetched_at,d.row_count,l.market,l.rights,l.expires_at
FROM app.dataset_versions d JOIN app.data_providers p ON p.id=d.provider_id
JOIN app.data_licenses l ON l.id=d.license_id AND l.provider_id=d.provider_id
WHERE d.status='published' AND p.status='active' AND l.rights_schema_version=1
AND l.effective_at<=statement_timestamp() AND l.reviewed_at<=statement_timestamp()
AND (l.expires_at IS NULL OR l.expires_at>statement_timestamp())
AND l.rights->>'display'='true' AND l.rights->>'api'='true';
CREATE VIEW app.catalog_bundles WITH (security_barrier=true) AS
SELECT b.id,b.market,b.manifest_hash,b.published_at,(SELECT count(*) FROM app.bundle_members m WHERE m.bundle_id=b.id) AS component_count
FROM app.dataset_bundles b WHERE b.status='published';
CREATE VIEW app.catalog_members WITH (security_barrier=true) AS
SELECT m.bundle_id,m.component_key,m.dataset_version_id,s.market FROM app.bundle_members m
JOIN app.catalog_bundles b ON b.id=m.bundle_id JOIN app.catalog_sources s ON s.dataset_id=m.dataset_version_id AND s.market=b.market;
CREATE VIEW app.catalog_heads WITH (security_barrier=true) AS
SELECT market,bundle_id,revision FROM app.market_dataset_heads;
CREATE VIEW app.catalog_domain_entity_versions WITH (security_barrier=true) AS
SELECT f.id,f.entity_id,f.display_name,f.country_code,f.official_url,f.valid_from,f.valid_to,f.review_status,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.domain_entity_versions f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_domain_identifiers WITH (security_barrier=true) AS
SELECT f.id,f.entity_id,f.namespace,f.external_id,f.valid_from,f.valid_to,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.domain_identifiers f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_domain_aliases WITH (security_barrier=true) AS
SELECT f.id,f.entity_id,f.locale,f.normalized_alias,f.alias_kind,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.domain_aliases f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_domain_relationships WITH (security_barrier=true) AS
SELECT f.id,f.from_entity_id,f.to_entity_id,f.kind,f.valid_from,f.valid_to,f.source_url,f.review_status,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.domain_relationships f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_manufacturing_plant_codes WITH (security_barrier=true) AS
SELECT f.id,f.plant_entity_id,f.authority,f.equipment_type,f.code,f.valid_from,f.valid_to,f.source_year,f.status,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.manufacturing_plant_codes f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_vehicles WITH (security_barrier=true) AS
SELECT f.id,f.market,f.model_year,f.make,f.model,f.trim,f.powertrain,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.vehicles f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_vehicle_lookup_options WITH (security_barrier=true) AS
SELECT f.id,f.make_entity_id,f.model_entity_id,f.model_year,f.vehicle_type,f.market,f.source_trim,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.vehicle_lookup_options f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_vehicle_reference_links WITH (security_barrier=true) AS
SELECT f.id,f.vehicle_id,f.lookup_option_id,f.match_status,f.reviewed_at,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.vehicle_reference_links f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_tire_model_reference_links WITH (security_barrier=true) AS
SELECT f.id,f.tire_model_id,f.brand_entity_id,f.manufacturer_entity_id,f.match_status,f.source_url,f.reviewed_at,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.tire_model_reference_links f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_reference_code_values WITH (security_barrier=true) AS
SELECT f.id,f.system,f.code,f.locale,f.label,f.numeric_value,f.unit,f.meaning,f.valid_from,f.valid_to,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.reference_code_values f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_fitment_configurations WITH (security_barrier=true) AS
SELECT f.id,f.vehicle_id,f.wheel_package,f.verification_status,f.approved_options,f.schema_version,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.fitment_configurations f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_fitment_axles WITH (security_barrier=true) AS
SELECT f.id,f.configuration_id,f.axle,f.quantity,f.size_code,f.width_mm,f.aspect_ratio,f.rim_inches,f.construction,f.min_load_index,f.min_speed_rank,f.load_range,f.xl_required,f.run_flat_required,f.unknown_constraints,f.schema_version,f.created_at,f.dataset_version_id
FROM app.fitment_axles f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_tire_models WITH (security_barrier=true) AS
SELECT f.id,f.brand,f.model,f.category,f.seasonal_class,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.tire_models f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_tire_skus WITH (security_barrier=true) AS
SELECT f.id,f.model_id,f.manufacturer_sku,f.size_code,f.construction,f.load_index,f.speed_rank,f.load_range,f.xl,f.run_flat,f.rim_inches,f.status,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.tire_skus f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_market_availability WITH (security_barrier=true) AS
SELECT f.id,f.sku_id,f.market,f.available,f.observed_at,f.expires_at,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.market_availability f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_evidence WITH (security_barrier=true) AS
SELECT f.id,f.sku_id,f.model_id,f.metric_code,f.numeric_value,f.text_value,f.missing_reason,f.unit,f.method,f.source_url,f.tested_at,f.reviewed_at,f.confidence,f.applicability,f.schema_version,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.evidence f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_prices WITH (security_barrier=true) AS
SELECT f.id,f.sku_id,f.retailer_id,f.market,f.currency,f.unit_price_minor,f.quantity_basis,f.observed_at,f.valid_until,f.tax_included,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.prices f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_price_components WITH (security_barrier=true) AS
SELECT f.id,f.price_id,f.kind,f.basis,f.amount_kind,f.low_minor,f.high_minor,f.rate,f.included,f.created_at,f.dataset_version_id
FROM app.price_components f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_climate_profiles WITH (security_barrier=true) AS
SELECT f.id,f.market,f.region_key,f.profile,f.method,f.reviewed_at,f.schema_version,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.climate_profiles f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_market_rules WITH (security_barrier=true) AS
SELECT f.id,f.market,f.region_key,f.rule_code,f.guidance,f.effective_from,f.effective_to,f.reviewed_at,f.schema_version,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.market_rules f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_advice_facts WITH (security_barrier=true) AS
SELECT f.id,f.topic_key,f.market,f.locale,f.claim,f.applicability,f.reviewed_at,f.review_due_at,f.status,f.schema_version,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.advice_facts f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_advice_fact_sources WITH (security_barrier=true) AS
SELECT f.id,f.fact_id,f.source_url,f.provider_id,f.license_id,f.locator,f.retrieved_at,f.content_hash,f.created_at,f.dataset_version_id
FROM app.advice_fact_sources f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_recalls WITH (security_barrier=true) AS
SELECT f.id,f.authority,f.recall_number,f.announced_on,f.status,f.source_url,f.summary,f.product_type,f.manufacturer_entity_id,f.component_code,f.consequence,f.remedy,f.manufacturer_campaign_number,f.affected_count,f.source_updated_at,f.created_at,f.dataset_version_id,f.source_record_key
FROM app.recalls f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_recall_source_targets WITH (security_barrier=true) AS
SELECT f.id,f.recall_id,f.target_key,f.brand_name,f.product_name,f.size_text,f.dot_pattern,f.manufactured_from,f.manufactured_to,f.match_status,f.schema_version,f.created_at,f.dataset_version_id
FROM app.recall_source_targets f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
CREATE VIEW app.catalog_recall_targets WITH (security_barrier=true) AS
SELECT f.id,f.recall_id,f.source_target_id,f.sku_id,f.model_id,f.dot_match,f.match_status,f.mapping_version,f.reviewed_at,f.schema_version,f.created_at,f.dataset_version_id
FROM app.recall_targets f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
GRANT SELECT ON app.catalog_sources,app.catalog_bundles,app.catalog_members,app.catalog_heads,app.catalog_domain_entity_versions,app.catalog_domain_identifiers,app.catalog_domain_aliases,app.catalog_domain_relationships,app.catalog_manufacturing_plant_codes,app.catalog_vehicles,app.catalog_vehicle_lookup_options,app.catalog_vehicle_reference_links,app.catalog_tire_model_reference_links,app.catalog_reference_code_values,app.catalog_fitment_configurations,app.catalog_fitment_axles,app.catalog_tire_models,app.catalog_tire_skus,app.catalog_market_availability,app.catalog_evidence,app.catalog_prices,app.catalog_price_components,app.catalog_climate_profiles,app.catalog_market_rules,app.catalog_advice_facts,app.catalog_advice_fact_sources,app.catalog_recalls,app.catalog_recall_source_targets,app.catalog_recall_targets TO tt_catalog_runtime;
GRANT SELECT ON app.data_providers,app.data_licenses,app.dataset_versions,app.dataset_bundles,app.bundle_members,app.market_dataset_heads,app.source_connectors,app.feed_health,app.domain_entities,app.retailers,app.domain_entity_versions,app.domain_identifiers,app.domain_aliases,app.domain_relationships,app.manufacturing_plant_codes,app.vehicles,app.vehicle_lookup_options,app.vehicle_reference_links,app.tire_model_reference_links,app.reference_code_values,app.fitment_configurations,app.fitment_axles,app.tire_models,app.tire_skus,app.market_availability,app.evidence,app.prices,app.price_components,app.climate_profiles,app.market_rules,app.advice_facts,app.advice_fact_sources,app.recalls,app.recall_source_targets,app.recall_targets TO tt_ingest_runtime,tt_publish_runtime;
GRANT INSERT ON app.domain_entities,app.domain_entity_versions,app.domain_identifiers,app.domain_aliases,app.domain_relationships,app.manufacturing_plant_codes,app.vehicles,app.vehicle_lookup_options,app.vehicle_reference_links,app.tire_model_reference_links,app.reference_code_values,app.fitment_configurations,app.fitment_axles,app.tire_models,app.tire_skus,app.market_availability,app.evidence,app.prices,app.price_components,app.climate_profiles,app.market_rules,app.advice_facts,app.advice_fact_sources,app.recalls,app.recall_source_targets,app.recall_targets TO tt_ingest_runtime;
GRANT INSERT (id,provider_id,license_id,kind,external_version,checksum,effective_at,fetched_at,row_count) ON app.dataset_versions TO tt_ingest_runtime;
GRANT UPDATE (row_count) ON app.dataset_versions TO tt_ingest_runtime;
GRANT SELECT,INSERT ON app.import_runs,app.import_staging_rows TO tt_ingest_runtime;
GRANT UPDATE (status,checkpoint,accepted_count,rejected_count,lease_until,fence,finished_at,updated_at,revision) ON app.import_runs TO tt_ingest_runtime;
GRANT SELECT,INSERT ON app.dataset_bundles,app.bundle_members,app.market_dataset_heads,app.import_publications TO tt_publish_runtime;
GRANT SELECT ON app.import_runs,app.import_staging_rows TO tt_publish_runtime;
GRANT UPDATE (status,checkpoint,lease_until,fence,finished_at,updated_at,revision) ON app.import_runs TO tt_publish_runtime;
GRANT UPDATE (status,published_at,row_count) ON app.dataset_versions TO tt_publish_runtime;
GRANT UPDATE (status,published_at) ON app.dataset_bundles TO tt_publish_runtime;
GRANT UPDATE (bundle_id,updated_at,revision) ON app.market_dataset_heads TO tt_publish_runtime;
GRANT USAGE ON SCHEMA admin TO tt_publish_runtime;
GRANT SELECT ON admin.audit_events TO tt_publish_runtime;
GRANT SELECT (id,status) ON admin.staff_identities TO tt_publish_runtime;
GRANT INSERT ON app.outbox TO tt_publish_runtime;
-- A narrow lock capability avoids granting publication workers UPDATE on providers/licenses.
CREATE FUNCTION app.lock_publication_sources(target uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$
BEGIN
  IF (SELECT count(*) FROM app.bundle_members WHERE bundle_id=target)>16 THEN
    RAISE EXCEPTION 'Too many components' USING ERRCODE='23514';
  END IF;
  PERFORM d.id FROM app.dataset_versions d WHERE EXISTS(SELECT 1 FROM app.bundle_members m WHERE m.bundle_id=target AND m.dataset_version_id=d.id) ORDER BY d.id FOR UPDATE;
  PERFORM l.id FROM app.data_licenses l JOIN app.data_providers p ON p.id=l.provider_id
    WHERE EXISTS(SELECT 1 FROM app.dataset_versions d JOIN app.bundle_members m ON m.dataset_version_id=d.id WHERE m.bundle_id=target AND d.license_id=l.id)
    ORDER BY p.id,l.id FOR SHARE OF p,l;
END $$;
GRANT EXECUTE ON FUNCTION app.lock_publication_sources(uuid) TO tt_publish_runtime;
CREATE INDEX tire_skus_page_idx ON app.tire_skus(dataset_version_id,size_code,id);
CREATE INDEX vehicles_page_idx ON app.vehicles(dataset_version_id,market,model_year,id);
CREATE INDEX domain_aliases_page_idx ON app.domain_aliases(dataset_version_id,locale,normalized_alias,id);
CREATE INDEX vehicle_lookup_options_page_idx ON app.vehicle_lookup_options(dataset_version_id,market,make_entity_id,model_year,id);
CREATE INDEX evidence_page_idx ON app.evidence(dataset_version_id,sku_id,id);
CREATE INDEX prices_page_idx ON app.prices(dataset_version_id,sku_id,market,id);
CREATE INDEX recalls_page_idx ON app.recalls(dataset_version_id,product_type,id);
CREATE INDEX reference_code_values_page_idx ON app.reference_code_values(dataset_version_id,system,locale,id);
CREATE INDEX domain_entity_versions_page_idx ON app.domain_entity_versions(dataset_version_id,entity_id,id);

-- A normalized source row and its materialized fact commit together. This ledger makes completeness testable.
CREATE TABLE app.import_materializations (
  run_id uuid NOT NULL,
  row_number bigint NOT NULL,
  record_kind text NOT NULL,
  record_id uuid NOT NULL,
  PRIMARY KEY (run_id,row_number),
  CONSTRAINT import_materializations_record_uq UNIQUE (run_id,record_kind,record_id),
  CONSTRAINT import_materializations_row_fk FOREIGN KEY (run_id,row_number) REFERENCES app.import_staging_rows(run_id,row_number) ON DELETE RESTRICT,
  CONSTRAINT import_materializations_kind_ck CHECK (length(record_kind) BETWEEN 1 AND 80)
);
GRANT SELECT,INSERT ON app.import_materializations TO tt_ingest_runtime;
GRANT SELECT ON app.import_materializations TO tt_publish_runtime;
CREATE TRIGGER import_runs_identity BEFORE UPDATE ON app.import_runs FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('provider_id','dataset_version_id','upstream_run_key','mode','mapping_version','content_hash','schema_version');

-- Validated source rows are frozen for ingestion workers until a new dataset is registered.
CREATE OR REPLACE FUNCTION app.guard_dataset_row() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, app AS $$
DECLARE item record; old_id uuid; new_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_id := OLD.dataset_version_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_id := NEW.dataset_version_id; END IF;
  FOR item IN SELECT id,status FROM app.dataset_versions
    WHERE id = ANY(ARRAY[old_id,new_id]) ORDER BY id FOR SHARE
  LOOP
    IF item.status = 'published' OR (current_user='tt_ingest_runtime' AND item.status<>'staging') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Published dataset rows are immutable';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Bound manifests even when privileged SQL bypasses the repository.
CREATE OR REPLACE FUNCTION app.guard_bundle_publication() RETURNS trigger LANGUAGE plpgsql
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
    IF members > 16 THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Bundle exceeds component limit'; END IF;
    IF members = 0 THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Bundle has no members'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Bound decoded fact rows at the storage boundary, including privileged imports.
ALTER TABLE app.domain_entity_versions ADD CONSTRAINT domain_entity_versions_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,entity_id,display_name,country_code,official_url,valid_from,valid_to,review_status,source_record_key)::text)<=65536);
ALTER TABLE app.domain_identifiers ADD CONSTRAINT domain_identifiers_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,entity_id,namespace,external_id,valid_from,valid_to,source_record_key)::text)<=65536);
ALTER TABLE app.domain_aliases ADD CONSTRAINT domain_aliases_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,entity_id,locale,normalized_alias,alias_kind,source_record_key)::text)<=65536);
ALTER TABLE app.domain_relationships ADD CONSTRAINT domain_relationships_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,from_entity_id,to_entity_id,kind,valid_from,valid_to,source_url,review_status,source_record_key)::text)<=65536);
ALTER TABLE app.manufacturing_plant_codes ADD CONSTRAINT manufacturing_plant_codes_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,plant_entity_id,authority,equipment_type,code,valid_from,valid_to,source_year,status,source_record_key)::text)<=65536);
ALTER TABLE app.vehicles ADD CONSTRAINT vehicles_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,market,model_year,make,model,trim,powertrain,source_record_key)::text)<=65536);
ALTER TABLE app.vehicle_lookup_options ADD CONSTRAINT vehicle_lookup_options_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,make_entity_id,model_entity_id,model_year,vehicle_type,market,source_trim,source_record_key)::text)<=65536);
ALTER TABLE app.vehicle_reference_links ADD CONSTRAINT vehicle_reference_links_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,vehicle_id,lookup_option_id,match_status,reviewed_by,reviewed_at,source_record_key)::text)<=65536);
ALTER TABLE app.tire_model_reference_links ADD CONSTRAINT tire_model_reference_links_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,tire_model_id,brand_entity_id,manufacturer_entity_id,match_status,source_url,reviewed_by,reviewed_at,source_record_key)::text)<=65536);
ALTER TABLE app.reference_code_values ADD CONSTRAINT reference_code_values_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,system,code,locale,label,numeric_value,unit,meaning,valid_from,valid_to,source_record_key)::text)<=65536);
ALTER TABLE app.fitment_configurations ADD CONSTRAINT fitment_configurations_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,vehicle_id,wheel_package,verification_status,approved_options,schema_version,source_record_key)::text)<=65536);
ALTER TABLE app.fitment_axles ADD CONSTRAINT fitment_axles_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,configuration_id,axle,quantity,size_code,width_mm,aspect_ratio,rim_inches,construction,min_load_index,min_speed_rank,load_range,xl_required,run_flat_required,unknown_constraints,schema_version)::text)<=65536);
ALTER TABLE app.tire_models ADD CONSTRAINT tire_models_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,brand,model,category,seasonal_class,source_record_key)::text)<=65536);
ALTER TABLE app.tire_skus ADD CONSTRAINT tire_skus_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,model_id,manufacturer_sku,size_code,construction,load_index,speed_rank,load_range,xl,run_flat,rim_inches,status,source_record_key)::text)<=65536);
ALTER TABLE app.market_availability ADD CONSTRAINT market_availability_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,sku_id,market,available,observed_at,expires_at,source_record_key)::text)<=65536);
ALTER TABLE app.evidence ADD CONSTRAINT evidence_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,sku_id,model_id,metric_code,numeric_value,text_value,missing_reason,unit,method,source_url,tested_at,reviewed_at,confidence,applicability,schema_version,source_record_key)::text)<=65536);
ALTER TABLE app.prices ADD CONSTRAINT prices_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,sku_id,retailer_id,market,currency,unit_price_minor,quantity_basis,observed_at,valid_until,tax_included,source_record_key)::text)<=65536);
ALTER TABLE app.price_components ADD CONSTRAINT price_components_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,price_id,kind,basis,amount_kind,low_minor,high_minor,rate,included,source_note)::text)<=65536);
ALTER TABLE app.climate_profiles ADD CONSTRAINT climate_profiles_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,market,region_key,profile,method,reviewed_at,schema_version,source_record_key)::text)<=65536);
ALTER TABLE app.market_rules ADD CONSTRAINT market_rules_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,market,region_key,rule_code,guidance,effective_from,effective_to,reviewed_at,schema_version,source_record_key)::text)<=65536);
ALTER TABLE app.advice_facts ADD CONSTRAINT advice_facts_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,topic_key,market,locale,claim,applicability,reviewed_by,reviewed_at,review_due_at,status,schema_version,source_record_key)::text)<=65536);
ALTER TABLE app.advice_fact_sources ADD CONSTRAINT advice_fact_sources_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,fact_id,source_url,provider_id,license_id,locator,retrieved_at,content_hash)::text)<=65536);
ALTER TABLE app.recalls ADD CONSTRAINT recalls_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,authority,recall_number,announced_on,status,source_url,summary,product_type,manufacturer_entity_id,component_code,consequence,remedy,manufacturer_campaign_number,affected_count,source_updated_at,source_record_key)::text)<=65536);
ALTER TABLE app.recall_source_targets ADD CONSTRAINT recall_source_targets_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,recall_id,target_key,brand_name,product_name,size_text,dot_pattern,manufactured_from,manufactured_to,source_details,match_status,schema_version)::text)<=65536);
ALTER TABLE app.recall_targets ADD CONSTRAINT recall_targets_read_size_ck CHECK (octet_length(ROW(dataset_version_id,id,recall_id,source_target_id,sku_id,model_id,dot_match,match_status,mapping_version,reviewed_at,reviewed_by,schema_version)::text)<=65536);
