import type { CsvMapping } from '../../application/src/ports/staff-csv.ts';
// Installed, versioned mappings; uploaded files never supply executable conversions.
export const staffCsvMappings: readonly CsvMapping[] = Object.freeze<CsvMapping[]>([
  {
    key: 'tire_models_v1',
    sourceKind: 'catalog',
    schemaVersion: '1',
    mappingVersion: '1',
    columns: [
      { name: 'model_id', type: 'text', required: true },
      { name: 'brand', type: 'text', required: true },
      { name: 'model', type: 'text', required: true },
      { name: 'category', type: 'text', required: true },
      { name: 'seasonal_class', type: 'text', required: true },
      { name: 'source_record_key', type: 'text', required: true },
    ],
    map: (r) => ({
      kind: 'tireModels',
      record: {
        id: r.model_id,
        brand: r.brand,
        model: r.model,
        category: r.category,
        seasonalClass: r.seasonal_class,
        sourceRecordKey: r.source_record_key,
      },
    }),
  },
  {
    key: 'domain_companies_v1',
    sourceKind: 'domain_reference',
    schemaVersion: '1',
    mappingVersion: '1',
    columns: [
      { name: 'record_id', type: 'text', required: true },
      { name: 'entity_id', type: 'text', required: true },
      { name: 'stable_key', type: 'text', required: true },
      { name: 'display_name', type: 'text', required: true },
      { name: 'country_code', type: 'text', required: false },
      { name: 'official_url', type: 'https_url', required: false },
      { name: 'valid_from', type: 'date', required: false },
      { name: 'valid_to', type: 'date', required: false },
      { name: 'review_status', type: 'text', required: true },
      { name: 'source_record_key', type: 'text', required: true },
    ],
    map: (r) => ({
      kind: 'domainEntityVersions',
      identities: [{ id: r.entity_id, kind: 'company', stableKey: r.stable_key }],
      record: {
        id: r.record_id,
        entityId: r.entity_id,
        displayName: r.display_name,
        countryCode: r.country_code,
        officialUrl: r.official_url,
        validFrom: r.valid_from,
        validTo: r.valid_to,
        reviewStatus: r.review_status,
        sourceRecordKey: r.source_record_key,
      },
    }),
  },
]);
