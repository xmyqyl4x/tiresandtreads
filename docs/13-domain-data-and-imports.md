# Domain reference data and ingestion

**Specification 1.0 · October 22, 2026 · Approved October 23, 2026.** Companion to [database design](09-database-design.md), using its typed-column, nullability, immutable **V** dataset-row and FK conventions. These are schema and workflow contracts, not implemented migrations or runnable commands. P1 delivers the domain schema and script pipeline; P2 adds staff CSV controls over the same services. [Four live phases](12-live-product-phases-and-gap-review.md) govern delivery.

## Source authority and initial coverage

Keep enough domain data to populate forms, explain supported choices and investigate recalls without making every page request depend on an external service. Store normalized records plus provenance, rights, retrieval time, source revision, review state and explicit unknowns. Preserve the selected P1 coverage of about 100 verified vehicle configurations and 50 tire models at size/SKU level; a larger lookup catalogue must not imply verified recommendation coverage.

| Domain | Candidate authority / use | Boundary and initial refresh policy |
| --- | --- | --- |
| Vehicle makes/models/year/type; manufacturer identifiers | NHTSA vPIC for US identification and form candidates | Nightly incremental/checksum check where supported; weekly reconciliation. VIN decode is optional and cannot prove wheel package, tire fitment, load or speed requirements |
| Tire companies, brands, aliases and ownership | NHTSA manufacturer/plant data plus reviewed manufacturer/licensed catalogues | Weekly check and monthly reconciliation; a brand, distributor, parent company and manufacturing plant are distinct entities |
| DOT equipment/plant codes | NHTSA vPIC equipment plant endpoint and reviewed historical sources | Weekly check; retain validity and source-year scope. Missing older records do not prove a code is invalid |
| Tire/vehicle/equipment recall campaigns and targets | NHTSA bulk recalls and dictionaries; official campaign documents | Daily fetch/check including no-change success; existing 48-hour freshness gate blocks new verified issuance when stale; urgent alerts trigger an extra run |
| Tire products, sizes, load/speed codes, construction, seasonal markings, UTQG/label facts | Licensed/manufacturer/regulatory sources with permitted use | Provider cadence and contract; daily availability/price checks when available. Ratings retain method, units, applicability and unknowns; no invented comparable performance score |
| Verified fitment, optional/staggered packages and constraints | Licensed fitment source or reviewed manufacturer evidence | Versioned contract cadence; verification requires explicit axle/package constraints. vPIC and crowdsourced photos are not substitutes |
| Climate, regional rules and advice facts | Approved authoritative sources and specialist-reviewed editorial facts | Explicit review/expiry dates per source; daily expiry alert, scheduled review at least quarterly for advice; jurisdiction-specific rules reviewed before use |
| Prices, availability and retailer facts | Approved retailer/affiliate feeds | Existing freshness/price-basis rules; never infer inventory or guaranteed all-in pricing |

These cadences are proposed project settings, not promises about upstream update frequency. [NHTSA datasets](https://www.nhtsa.gov/nhtsa-datasets-and-apis) provide bulk recall data and dictionaries covering tires as well as other product types. [vPIC](https://vpic.nhtsa.dot.gov/api/Home/Index) supplies manufacturer/vehicle metadata and tire/retread equipment-plant endpoints, with supported year limits and traffic controls. Prefer official APIs/bulk files; do not scrape arbitrary pages. Verify formats, terms, attribution, limits and completeness at E01/E35, including display, persistent storage, derived AI input and MCP redistribution rights.

Do not use only vehicle-year/make/model recall queries for tire coverage. Preserve tire campaign numbers, component types, affected brand/product/size, manufacturing dates, DOT/TIN patterns and remedy facts. A partial DOT or unresolved source target yields a conditional match requiring further checking. A successful lookup is not a universal recall clearance. Complaints and manufacturer communications, if later imported, are separate evidence classes and cannot be promoted to a recall or a proven defect automatically. No public complainant/person data is part of the launch import.

## Canonical identity and versioned reference schema

All tables below are in `app` unless qualified. Stable identity rows have no mutable authoritative facts; **V** rows contain the source claims. Multiple providers may disagree. Resolve aliases through reviewed mappings with provenance instead of overwriting a licensed source. Bundles pin the exact source and mapping versions used by lookups and reports. Original text can remain as a source label while canonical keys drive joins.

| Table | Typed columns and relationships | Constraints and access paths |
| --- | --- | --- |
| `domain_entities` | `kind text`, `stable_key text UQ`, `status text`, `merged_into_id uuid? FK domain_entities` | No self-merge; cycle checks at reviewed merge; kind company/brand/plant/vehicle_make/vehicle_model; stable internal UUID; merged identities retain reviewed redirects, no destructive history rewrite |
| `domain_entity_versions` | **V**; `entity_id uuid FK domain_entities`, `display_name text`, `country_code char(2)?`, `official_url text?`, `valid_from date?`, `valid_to date?`, `review_status text` | UQ(dataset_version_id,entity_id); ordered optional interval; index(entity_id,dataset_version_id); reviewed kind consistency |
| `domain_identifiers` | **V**; `entity_id uuid FK domain_entities`, `namespace text`, `external_id text`, `valid_from date?`, `valid_to date?` | UQ(dataset_version_id,namespace,external_id); identifiers are source-scoped, not presumed globally unique |
| `domain_aliases` | **V**; `entity_id uuid FK domain_entities`, `locale text`, `normalized_alias text`, `alias_kind text` | UQ(dataset_version_id,entity_id,locale,normalized_alias); indexed normalized lookup; ambiguous alias can map to several entities and requires disambiguation |
| `domain_relationships` | **V**; `from_entity_id uuid FK domain_entities`, `to_entity_id uuid FK domain_entities`, `kind text`, `valid_from date?`, `valid_to date?`, `source_url text`, `review_status text` | No self-link; brand_owned_by/company_operates_plant/model_of_make; kind/endpoints/interval validated in publication service; history preserved |
| `manufacturing_plant_codes` | **V**; `plant_entity_id uuid FK domain_entities`, `authority text`, `equipment_type text`, `code text`, `valid_from date?`, `valid_to date?`, `source_year smallint?`, `status text` | UQ(dataset_version_id,authority,equipment_type,code,source_record_key); code/validity index; ambiguous historical code assignment not silently merged |
| `vehicle_lookup_options` | **V**; `make_entity_id uuid FK domain_entities`, `model_entity_id uuid FK domain_entities`, `model_year smallint`, `vehicle_type text`, `market text`, `source_trim text?` | Indexed(dataset_version_id,market,make_entity_id,model_year,model_entity_id); identifiers plus year/type define a source option, not fitment verification |
| `vehicle_reference_links` | **V**; `vehicle_id uuid FK vehicles`, `lookup_option_id uuid FK vehicle_lookup_options`, `match_status text`, `reviewed_by uuid? FK admin.staff_identities`, `reviewed_at ts?` | UQ(dataset_version_id,vehicle_id,lookup_option_id); reviewed/unresolved/rejected; bundle validates referenced fitment and lookup datasets |
| `tire_model_reference_links` | **V**; `tire_model_id uuid FK tire_models`, `brand_entity_id uuid FK domain_entities`, `manufacturer_entity_id uuid? FK domain_entities`, `match_status text`, `source_url text` | UQ(dataset_version_id,tire_model_id,brand_entity_id); public joins use reviewed mappings only; unknown manufacturer allowed |
| `reference_code_values` | **V**; `system text`, `code text`, `locale text`, `label text`, `numeric_value numeric?`, `unit text?`, `meaning text`, `valid_from date?`, `valid_to date?` | UQ(dataset_version_id,system,code,locale); load/speed/size/marking/unit codes have per-system schema/range tests; no single interpretation across jurisdictions |
| `advice_facts` | **V**; `topic_key text`, `market text`, `locale text`, `claim text`, `applicability json`, `reviewed_by uuid FK admin.staff_identities`, `reviewed_at ts`, `review_due_at ts`, `status text` | UQ(dataset_version_id,topic_key,market,locale); bounded declarative applicability; reviewed/current required for advice/AI grounding |
| `advice_fact_sources` | `fact_id uuid FK advice_facts`, `source_url text`, `provider_id uuid FK data_providers`, `license_id uuid FK data_licenses`, `locator text?`, `retrieved_at ts`, `content_hash text` | UQ(fact_id,source_url,content_hash); provenance index; store only licensed excerpts, not unlimited copyrighted documents |

Existing `vehicles.make/model/trim` and `tire_models.brand` preserve imported display text. Reference-link tables provide normalized identities and reviewed cross-dataset mapping; do not force vPIC IDs into licensed fitment keys. Existing `tire_skus`, `fitment_axles`, `evidence`, `prices`, `climate_profiles` and `market_rules` remain the authority for their defined facts. No second unversioned tyre catalogue is introduced. Payload owns editorial pages; reviewed `advice_facts` supply structured domain facts and citations through published DTOs, not direct cross-database joins.

### Recall extension

Extend the existing `recalls`/`recall_targets` contract rather than creating competing recall truth. Campaign rows remain **V**, with existing `(dataset_version_id,authority,recall_number)` uniqueness.

| Table/change | Typed additions | Integrity and matching behavior |
| --- | --- | --- |
| `recalls` additions | `product_type text`, `manufacturer_entity_id uuid? FK domain_entities`, `component_code text?`, `consequence text?`, `remedy text?`, `manufacturer_campaign_number text?`, `affected_count bigint?`, `source_updated_at ts?` | Product type tire/vehicle/equipment/child_seat; nonnegative optional count; source-reported status and dates, no inferred completion |
| `recall_source_targets` | `recall_id uuid FK recalls`, `target_key text`, `brand_name text?`, `product_name text?`, `size_text text?`, `dot_pattern json?`, `manufactured_from date?`, `manufactured_to date?`, `source_details json`, `match_status text` | UQ(recall_id,target_key); bounded schema, ordered dates; retains unresolved targets even when our catalogue lacks the product |
| `recall_targets` additions | `source_target_id uuid FK recall_source_targets`, `mapping_version text`, `reviewed_at ts?`, `reviewed_by uuid? FK admin.staff_identities` | Existing one SKU/model target rule remains for resolved links; unresolved source records live in recall_source_targets. Validate campaign consistency and mapping provenance; index source_target_id |

Recall state changes invalidate affected safety overlays and AI reuse entries immediately after validated publication. A withdrawn/revised campaign is a new source revision, not deletion of report evidence. Cross-product joins and DOT range interpretation need specialist-reviewed fixtures. Record negative coverage explicitly: unavailable/full source failure/partial download/zero-result are different states. `feed_health.last_success_at` advances only after an authenticated, complete, validated source check, including verified no-change checks.

## Import metadata and staging schema

Existing `import_runs`, `import_rejections`, datasets/bundles, `object_assets`, outbox and audit remain. Add these narrow structures; no generic SQL console or arbitrary executable mapping language.

| Table/change | Typed columns | Constraints and operations |
| --- | --- | --- |
| `source_connectors` | `provider_id uuid FK data_providers`, `kind text`, `allowed_origin text`, `schema_version text`, `schedule_key text`, `status text` | UQ(provider_id,kind); credentials resolved from secret store, never CSV/URL; configured origin/path allowlist |
| `import_runs` additions | `connector_id uuid? FK source_connectors`, `mode text`, `mapping_version text`, `content_hash text`, `schema_version text`, `requested_by uuid? FK admin.staff_identities`, `expected_head_revision bigint?`, `lease_until ts?`, `fence bigint DEFAULT 0` | Mode full/incremental/manual; content checksum plus source and mapping identifies repeat payload; explicit reviewed reprocess gets a new run key; lease prevents two winning workers |
| `import_staging_rows` | `run_id uuid FK import_runs`, `row_number bigint`, `source_key text`, `normalized json`, `validation_status text`, `expires_at ts` | UQ(run_id,row_number); duplicates by source_key flagged, not overwritten; JSON schema per source, indexed(run_id,validation_status); no live query reads staging |
| `import_artifacts` | `run_id uuid FK import_runs`, `kind text`, `asset_id uuid FK object_assets`, `checksum text`, `expires_at ts` | Manifest/diff/validation/original bytes in private storage; integrity checks and rights-based expiry |
| `import_publications` | `run_id uuid FK import_runs`, `bundle_id uuid FK dataset_bundles`, `market text`, `previous_bundle_id uuid? FK dataset_bundles`, `actor_id uuid? FK admin.staff_identities`, `service_actor_key text?`, `approval_record_id uuid? FK admin.audit_events`, `published_at ts` | UQ(run_id,market); same-head compare-and-set in publication transaction; exactly one staff actor or allowlisted service_actor_key; audited service identity required for automated publisher |

Initial staging/rejection/diff TTL is 30 days; purge earlier when data rights require it. Accepted source bytes have an explicit license-based retention policy. Immutable published facts referenced by reports follow existing report/source retention rules. Import workers can write staging; only publication services can change heads. Separate fetch, validate, approve and publish permissions; scheduled auto-publication requires a previously reviewed source/schema policy, bounded deltas and no unresolved critical rejects.

## Script first, admin later

Planned entry points below illustrate the contract only; no `pnpm data:*` commands are implemented. The CLI authenticates as a restricted operator/service and invokes L3 ingestion use cases through the composition root; it never bypasses validators with ad hoc SQL. P2 HTTP/admin adapters call those same use cases.

```text
pnpm data:fetch --source nhtsa-recalls --mode full
pnpm data:validate --run <run-id>
pnpm data:diff --run <run-id> --against <bundle-id>
pnpm data:publish --run <run-id> --expect-head <revision>
pnpm data:resume --run <run-id>
pnpm data:rollback --market US --bundle <validated-bundle-id>
pnpm data:import-csv --template tire-catalog-v1 --file <private-file> --dry-run
```

1. **Fetch/register:** use an allowlisted connector, TLS, conditional requests, page/checkpoint manifests, bounded timeouts and backoff honoring upstream limits. Record checksum/source/license/time and verified total/completeness. Raw remote content is data, not instructions. Initial bootstrap may use official bulk snapshots; incremental APIs are used only where source semantics support them.
2. **Stage/normalize:** stream batches into isolated staging, preserve original identifiers/units and parse to versioned contracts. Validate encoding, columns, mandatory fields, ranges, duplicate keys, references and validity intervals. Unknown codes remain explicit; no silent default zero. ZIP archives require entry/path, inflated-byte and compression-ratio bounds.
3. **Validate/diff:** compare additions, changes, removals and coverage to the currently published bundle. Source schema drift, suspicious row-count changes, missing required safety facts or unresolved critical relationships quarantine the run. Treat absence as deletion only for a proven complete snapshot with declared semantics. Quarantine noncritical row rejects only under a reviewed threshold; critical recall/feed errors block publication.
4. **Approve/publish:** require current rights and source policy; pin a coherent bundle including reviewed cross-source mappings. In one short transaction compare expected head, publish records/pointer and enqueue invalidation/refresh work in the outbox. Concurrent publishers cannot silently overwrite each other. Do not hold transactions during fetches, AI calls or CSV parsing.
5. **Operate/recover:** resume by checkpoint/idempotent batch identity; a retried run publishes once. Reconcile outbox events, expose freshness/coverage/errors, alert on failed checks and approaching expiry. Rollback creates an audited head change to a compatible validated bundle and replays invalidations. A rollback never suppresses a newer known recall warning: current safety overlay remains authoritative or verified issuance is disabled.

P2 admin workflow: download a versioned template → upload private CSV → validate → preview mapping/diff/rejections → authorized approval → publish → job status/rollback. Templates document source-key and unit columns, allowable values and examples; imports never create new privileges or change rules/consents. Initial manual limit 20 MiB/100,000 rows with background streaming; larger official datasets use bounded scheduled/bulk jobs outside web requests. Validate actual bytes/MIME, UTF-8, parser limits and file signatures; reject executables, formula-leading cells in fields that should be plain values, unsafe links and extra columns unless explicitly mapped. Escape exported CSV cells against spreadsheet formula execution. Quarantine assets before parser access and never fetch arbitrary URLs supplied in a CSV.

## Read APIs and data operations

P1 versioned read contracts: `GET /api/v1/reference/vehicle-makes`, `vehicle-models?makeId=&year=`, `vehicle-options`, `tire-brands`, `tire-sizes`, `manufacturers/{id}`, `recalls` and `advice`. Use allowlisted filters, bounded keyset pagination, normalized units, provenance/as-of and `coverage`/`verificationStatus` fields. Public lookup APIs disclose only approved licensed facts and cannot return private imports or manufacturer contacts. A direct lookup miss offers manual entry/installer verification, not guessed values. Indexed pinned dataset reads serve forms; optional CDN caching cannot cache safety authorization or stale recall clearance.

P1 operator endpoints and P2 admin UI: create/import, validate, preview, approve/publish, cancel, status and rollback under `/api/v1/admin/imports`; POST commands require role/MFA, idempotency key and expected revision. No user-controlled table or connector origin parameter. Public reads use published records only. Operational metrics include last complete check, source lag, coverage, accepted/rejected counts, mapping ambiguity, publish conflicts, duration, DB load and expiry/deletion backlog. Log identifiers/error codes, not complete CSVs.

## Test and release evidence

DB21–DB22 and UC13/AT21–AT22 cover source identity, complete snapshot semantics, malformed data, pagination truncation, full versus incremental retractions, repeated and resumed runs, head races, schema drift, rights expiry and rollback with a newer safety warning. Source contract fixtures include tire recalls absent from our SKU catalogue, company/brand ambiguity, historical plant codes, staggered fitment and vPIC lookup without fitment authority. Verify real PostgreSQL constraints, migration/rollback, API role boundaries and safe CSV rendering before P2 UI acceptance. No live NHTSA endpoint is hammered by unit tests; use licensed/synthetic recorded fixtures and a bounded scheduled source-compatibility check.
