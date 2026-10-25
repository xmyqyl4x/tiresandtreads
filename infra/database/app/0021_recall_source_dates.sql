-- The bulk feed supplies report receipt dates, not public announcement dates.
ALTER TABLE app.recalls ALTER COLUMN announced_on DROP NOT NULL;
ALTER TABLE app.recalls ADD COLUMN report_received_on date;
CREATE OR REPLACE VIEW app.catalog_recalls WITH(security_barrier=true) AS
 SELECT f.id,f.authority,f.recall_number,f.announced_on,f.status,f.source_url,f.summary,f.product_type,f.manufacturer_entity_id,f.component_code,f.consequence,f.remedy,f.manufacturer_campaign_number,f.affected_count,f.source_updated_at,f.created_at,f.dataset_version_id,f.source_record_key,f.report_received_on
 FROM app.recalls f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id;
