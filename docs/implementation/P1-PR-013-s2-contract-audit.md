# P1-PR-013 — S2 contract and storage audit

**October 25, 2026 · technical review complete; owner S2 acceptance pending.** Scope: accepted SQL/Payload schema plus 009–012 entities, records, mappers, repository interfaces and implementations, including the corrections in [013](P1-PR-013-s2-data-access-gate.md).

## Complete inventory

The [source audit](evidence/P1/p1-pr-013-source-audit.json) records file hashes and exported declarations for **48 non-generated package source files**, including **79 interfaces and 83 repository methods**. It covers domain values/entities, application ports, wire primitives, DB mappers/repositories/helpers and configuration/integration boundaries. The file hashes bind private helper implementations as well as exported declarations. Empty stage markers and generated declarations are separately identified rather than counted as business behavior.

The [storage audit](evidence/P1/p1-pr-013-storage-audit.json) assigns all **190 relations**: 123 application tables, 39 application views and 28 CMS tables. Each relation has a module, source location, current-versus-first-use boundary and next owning card. The generated application models cover all **1,574 columns**, including operator migration metadata; runtime access remains controlled by explicit grants. Payload's database is inventoried without introducing application ORM access.

## Contract review

| Family | Contracts and representation reviewed | Adapter and schema evidence | Conclusion |
| --- | --- | --- | --- |
| Values and entities | UUID kinds, revisions, `Instant`, exact money/quantity/tire dimensions, known/unknown evidence; catalog/provenance, report, consent and import records | `domain/src/values`, four entity files, strict negative type fixtures and unit suite | Pure readonly records; source meaning, fitment and permission authorization remain service decisions |
| Wire DTOs | Money/evidence/error V1 primitives and health contract | `contracts/src`, OpenAPI drift checks and HTTP smoke | Independent transport shapes; no storage/domain object serialized as an API response |
| Shared DB mapping | Raw `pg` bigint strings, dates, tire unknowns, report head states/schema versions | `db/src/mappers.ts`, actual driver round trips and malformed-row tests | Explicit conversion with safe integrity errors; raw rows are never inferred Drizzle values |
| Catalog facts | 25 typed fact families, 247 fields, source rights/expiry/coverage, parameterized filters and scoped cursors | `catalog-records`, `catalog` ports; `facts`/`codec`/`catalog` adapters; SQL public views; real full-family round trips | Nullability/types and private-field omission match actual PostgreSQL; verified source/recall policy remains S3 |
| Ingestion/publication | Identity/version/checkpoint, exact counters, staged batches, fencing, materialization and coherent head CAS | `ingestion` port/adapter and dataset `publication` adapter; 14 catalog/import cases | Import-state decoder corrected; no changed-body replay or partial publication accepted |
| Owner/report | Identity rotation, report heads/versions/items, draft revisions, comparison slots and quote money | `owner-report`/`private-records`; `owners`/`reports`; real-owner/revision/rollback tests | Scope and immutable version binding preserved; render/share redaction stays in service DTOs |
| Capabilities/assets | Share references, view/version binding, download authority, ready-asset metadata | `CapabilityRepository`; `capabilities`; share/revocation/expiry/schema tests | Returns safe metadata, never storage locations; final permission/signing handoff remains 014/019 |
| Privacy/consent | Contact ciphertext/HMAC overlap, independent scopes, permission revision, request steps/resources and markers | `privacy`/`private-records`; privacy adapter; withdrawal/identity/erasure-record tests | No plaintext contact in public projections; complete policy/erasure workflow is assigned below |
| Delivery/reliability | Scheduled send/attempt/outcome/receipt, inbox/outbox identities and expiring fences | `delivery`/`reliability`; real cancellation/claim/replay/late-worker tests | No provider call in transaction; uncertainty is retained for later reconciliation |
| Public publication | Monotonic content generations/tombstones and public config schema/checksum/expiry | Content publication/read ports and adapter; SQL/S3 configuration reader | Out-of-order/expired/changed messages fail closed; durable cross-store propagation remains 021 |
| Analytics/quotas | Event receipt/context, generations/privacy barriers, full replacement, fixed UTC windows and HMAC overlap | Analytics/limiter ports/adapters; real snapshot-race, permission, purge and quota contention tests | Captured counts stay consistent with locked day; all-window quota consumes atomically |
| Staff/SEO/commercial | Staff role/status, configuration metadata, public paths, checked links/slots, exact search/ad and aggregate values | Operations port/adapters and restricted views; sparse/replacement/permission/query-plan tests | Missing stays distinct from zero; dashboard cannot read contacts/raw events/private configuration |

Module-qualified names are significant: `ports/ingestion.ts::PublicationRepository` publishes datasets, while `ports/publication.ts::PublicationRepository` publishes public content/configuration. Consumers import the relevant module directly. Neither name grants access to the other process's credentials.

Storage models describe SQL representation; application records describe a selected operation; domain records describe meaning; wire DTOs describe an authorized channel response. They are deliberately not one-to-one types. All current repository methods and helpers were reviewed against their owning columns, constraints, lock order and failure path. SQL remains authoritative for stored legality; external input/JSON semantic validation remains an explicit service/transport responsibility.

## First-use extension register

| Assigned card | Remaining persistence/composition responsibility | Required before its service can activate |
| --- | --- | --- |
| 014 | Pool/credential composition, private object lifecycle, command idempotency and job-run lifecycle; outbox/inbox scheduling/reconciliation | Narrow ports/grants and real crash/replay/late-worker/pool-drain proofs; no network calls inside unit of work |
| 015–016 | Connector/artifact/rejection/feed-health operations, provider/license/retailer metadata authoring and source fetch implementation | Source rights/completeness, bounded scripts, actual provider contract evidence and reviewed importer permissions |
| 017–018 | Versioned rule loading and semantic fact-to-engine mapping; any justified persisted derived-score operation | Deterministic pure engine and specialist-approved cases; derived score storage never becomes an undeclared required cache |
| 019 | Full report access/redaction, asset/version/grant policy and service DTO mapping | Authentication/revocation tests and frozen input/output semantics across owners/channels |
| 020 | Verified challenges, cookie-purpose policy and suppression/tombstone lifecycle | Current notice/context evidence, GPC/defaults, purpose separation and race tests before collection/dispatch |
| 021 | Actual Payload work leasing/acknowledgement, editorial review, redirect rules and durable SQL/object publication | Separate DB transactions, partial-failure/restart/retry tests and measured propagation; no cross-database FK/transaction |
| 022–023 | Template/payload freeze, idempotent provider handoff, provider events/links/feedback/preferences | Real provider boundary and uncertain-send reconciliation, safe scanner behavior and narrow retained evidence |
| 024 | Analytics/limiter service policy, workload admission, schedules/cleanup and operational dashboards | Bounded mixed-load proof and current consent enforcement; seeds remain disabled until authorized activation |
| 025 | Quote-private notes, holds/retention/deletion graph, suppression tombstones, multi-store erase/restore replay | Complete scoped graph traversal and verified deletion evidence; an enumerated request is not fulfilled erasure |
| 026 | Staff role administration, configuration/features, affiliate approval, ad account/report ingestion and SEO command lifecycles | Authorized command repositories, source-revision ordering, safe host checks and audit/review evidence |

These are declared responsibilities at the first owning use case, not waived safety work or a claim that all table CRUD is implemented. Their accepted S1 schemas and generated S2 column models are available. Each owning card extends its narrow adapter before implementing orchestration and repeats affected S1/S2 checks. No unresolved schema correction remains from this gate; future requirement-driven changes remain possible.

## Review limits

Synthetic workloads verify representation, transaction behavior and selected access paths. They do not establish production capacity, full retention/legal policy, tire suitability, source licensing or external vendor behavior. Complete P1 API acceptance and G0 are still prerequisites to frontend work at 031/032. Original requirements, four live phases and deferred decision triggers are preserved.
