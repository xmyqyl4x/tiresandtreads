# P1-PR-005 — Domain, catalog, reference and import schemas

**October 23, 2026 · accepted after owner approval and merge.** Implementer: Codex. Acceptance owner: repository owner. Review: [PR #5](https://github.com/xmyqyl4x/tiresandtreads/pull/5), merged at `2d8acd2c8476e12debae29b5738ae74cd8d3cd4b` after exact-head CI passed. Prerequisite [PR #4](https://github.com/xmyqyl4x/tiresandtreads/pull/4) was owner-approved and merged at `4f00c3054f0fcfd706098a0c3fd66af72449e1f4`. This is P1/S1, work packages E04/E05/E35/E36, following the [task card](../tasks/phase-1-prs.md#p1-pr-005).

## Scope and traceability

This implements the persistence portion of CAP-04, DB14, DB21 and DB22 from [database design](../09-database-design.md) and [domain data/imports](../13-domain-data-and-imports.md). It supplies storage and relational integrity for later FR-IN form candidates and source-backed report evidence. It does not complete any FR, UC13, AT21/AT22, source connector, publication workflow or live phase. No provider has been selected or licensed by this PR; verified launch coverage remains zero under the [launch register](P1-PR-001-launch-baseline.md#source-and-rights-register).

Three additive application migrations follow the two accepted foundations. Earlier app migrations and the CMS migration/snapshot remain byte-identical. No package or lockfile changes are required.

| Migration | New tables | Responsibility |
| --- | --- | --- |
| [0003_source_versions](../../infra/database/app/0003_source_versions.sql) | 14 | Providers, licenses, dataset versions/bundles/members/market heads; canonical entities, source versions, identifiers, aliases, relationships and plant codes; rule versions and retailers |
| [0004_catalog_reference](../../infra/database/app/0004_catalog_reference.sql) | 21 | Vehicles, fitment configurations/axles, models/SKUs, availability, evidence/scores, prices/components, climate/rules, vehicle/product reference links, code dictionaries, advice/citations, recalls and both unresolved/resolved targets |
| [0005_import_metadata](../../infra/database/app/0005_import_metadata.sql) | 7 | Connectors, runs/checkpoints, feed health, staging, rejections, artifacts and publications |

The total is **42 tables**. Twenty-five source tables/owned children carry an explicit dataset key and publication guard. Every FK has a leading index, with additional indexes for picker/size/alias lookup, source provenance, prices, review/expiry work, staging status and checkpoints. These are initial access paths, not measured production capacity or accepted S2 query plans.

## Relational integrity and unknowns

Provider/license and provider/connector/run associations use composite FKs. Fitment configuration→vehicle, axle→configuration, SKU→model, price component→price, advice citation→fact and recall child→campaign references prove same-dataset ownership. Recall target→source target additionally proves the same campaign. Cross-source evidence, SKU prices and reviewed reference mappings deliberately reference exact immutable row IDs in other datasets; later publication validators must prove that every referenced version belongs to the selected coherent bundle.

Source identity is unique within a dataset. Aliases remain unique per entity, so the same alias can name two brands. Historical plant-code assignments retain separate source records and optional date bounds. A stable entity, a lookup option or a reviewed alias does not prove tire fitment. Entity merge cycles, endpoint kinds, authoritative source interpretation and reviewed mapping policy remain application validation obligations.

Unknown load/speed, width/aspect ratio and XL/run-flat flags are nullable. In particular, missing XL/run-flat evidence is not stored as `false`. This clarifies the original nonnullable Boolean notation in docs/09 while preserving its explicit-unknown requirement. A source such as a flotation tire need not invent an aspect ratio. `unknown_constraints` is a bounded string array; exact source/size/marking rules follow licensed contracts and the deterministic engine. Broad storage bounds reject negative/nonfinite dimensions; they are not eligibility thresholds.

Evidence has exactly one model/SKU subject and exactly one numeric value, text value or missing reason. A measured zero is distinct from missing evidence. Scores use a bounded 0–100 storage scale with an explicit missing alternative. Money uses nonnegative integer minor units and registered currency; fixed costs and percentage components have exclusive shapes and explicit bases. Rights, climate, rules, applicability and staging JSON have shape/byte/schema-version constraints; these are not a substitute for complete provider-specific validators. SQL does not prove that free text is redacted or that a URL is licensed to fetch.

Unresolved recall source targets have no required SKU/model link and preserve source labels, DOT patterns and partial manufacturing dates. Resolved links require one SKU/model, source-target provenance, mapping version and explicit review metadata for reviewed matches. Feed health records attempts, successful complete checks and the matching provider/run separately from campaign dates. No successful check is inferred from a catalog row or an empty response.

## Publication and access boundaries

Dataset writes lock the parent dataset in shared mode, checking both old and new parents when moving a row. Publishing locks that same parent. Published datasets, their source rows/children, bundles and bundle members reject INSERT/UPDATE/DELETE changes that would rewrite them. A bundle can publish only with at least one member and all pinned datasets published; market heads reference a published bundle in the same market. Rule versions freeze after publication, while score and publication history are append-only. The tests exercise both edit-versus-publication lock orders using separate PostgreSQL connections. This follows PostgreSQL's [row-lock semantics](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS) and [relational constraint rules](https://www.postgresql.org/docs/18/ddl-constraints.html).

These guards enforce integrity, not approval or permissions. Required component sets, rights/expiry, source completeness, safety review, exact mapping coverage, expected-head compare-and-set, worker fencing, audit/outbox and rollback invalidation remain later ingestion/publication use cases. A migrator can still perform privileged DDL or TRUNCATE; it is an operator credential, never application authority. Retention deletion of immutable history needs the separately reviewed retention/restore workflow; normal writes cannot bypass the guards.

Existing web/staff/asset/CMS runtimes receive **no grants** on these 42 tables or guard functions. There is no production connection from the health host to them. S2/S3 must introduce reviewed projections and narrowly scoped import/publication access. PostgreSQL row-lock privileges must be considered in that design; do not grant general dataset UPDATE just to satisfy a child-write trigger. Use a reviewed scoped procedure/role design with negative tests when the importer becomes executable.

Connector origins accept an HTTPS origin without path, user-info, query or fragment; a separate bounded path prefix is stored. Actual redirect/DNS/SSRF controls and credentials belong to the later adapter. No credential column is added. Staging allows duplicate source keys on different row numbers so validators can reject/report duplicates instead of overwriting them. Run identity is unique per provider/upstream key; counters, expected revisions and lease/fence shape are bounded. Publication records require exactly one staff actor or registered service actor, and the service-actor registry starts empty.

### Audit FK sequencing

At the accepted 005 baseline, `import_publications.approval_record_id` is constrained to NULL until P1-PR-006 creates `admin.audit_events`. [006](P1-PR-006-report-consent-delivery-schemas.md) now supplies that additive FK/index migration and preserves earlier NULL approvals without fabrication. That migration must add its named FK and leading index before removing `import_publications_audit_pending_ck`; a column comment and the 006 task card record the dependency. This avoids either an unvalidated audit UUID or premature implementation of the audit module. No automated publication is enabled here. Later services require audited identity/approval even where the relational column permits a system workflow.

## Local operation and recovery

Use the existing [database commands](../development.md#database-ownership-and-migrations): `pnpm database migrate dev`, `pnpm database status dev`, and the same commands for `stage`. The expected application history is five migrations; CMS remains one. A second migrate applies zero versions. Each new migration is atomic with its checksum/history row. Migration locks, source drift rejection, role passwords, separate dev/stage volumes and redacted errors retain the accepted 004 behavior.

The new schemas contain no imported data. Synthetic constraint fixtures run only in disposable PostgreSQL and roll back or remove their own records. The existing optional local seed still creates only disabled identity/asset foundation fixtures. Native PostgreSQL is untouched. No `data:fetch`, CSV parser, admin page or production publication command is introduced; those must call the later shared ingestion services.

Use additive correction or compatible application rollback after an applied migration. Never rewrite an applied SQL file/hash, delete local volumes to bypass drift, or run destructive down migrations. Backup/restore and deletion replay remain P1-PR-008; host-specific evidence remains gated by the deferred hosting decision. JSON storage limits and provisional source/status vocabularies can be expanded by reviewed additive migrations when provider contracts justify it.

## Review evidence and next work

[Validation evidence](evidence/P1/p1-pr-005-validation.md) records red/green, upgrade, role and concurrency results. Full Linux verification includes all schema cases and independent GitHub CI. P1-PR-006 follows acceptance with report/consent/delivery/reliability and the pending audit FK; 007 adds CMS/SEO/ads/analytics and 008 closes the full schema/restore gate. Entities/repositories remain 009–013, shared services/APIs follow, and product UI stays behind P1-PR-031. Full G0, provider rights and live phase release remain open.
