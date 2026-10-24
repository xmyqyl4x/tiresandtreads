# P1-PR-007 — CMS, SEO, advertising, analytics and quota schemas

**October 23, 2026 · in progress; owner acceptance pending.** Implementer: Codex. Acceptance owner: repository owner. Prerequisite [PR #6](https://github.com/xmyqyl4x/tiresandtreads/pull/6) was owner-approved and merged at `53f9fd1f9dcce8b781fb15f4e465b33443850748`. This is P1/S1, E04/E15/E16/E17/E18/E37/E38, following the [task card](../tasks/phase-1-prs.md#p1-pr-007).

## Scope and traceability

This change implements the remaining CMS/publication, administrative operations, analytics and quota storage assigned to 007 by [database design](../09-database-design.md). It supplies the persistence portions of CAP-02/CAP-03 and DB16–DB19/DB27. Exact consumers are FR-SEO-01/03/05/08/09/11/12, FR-ADS-02/04/10, and FR-DAT-01/02/05/06/14 in the [requirements matrix](../05-requirements-traceability.md). UC08/UC10/UC17 and AT11/AT16/AT27 remain end-to-end service/API/UI acceptance; schema tests do not close those capabilities or a usable live phase.

| Migration | New physical tables | Scope |
| --- | --- | --- |
| [0010_public_operations](../../infra/database/app/0010_public_operations.sql) | 15 | Published DTOs, configuration/features, affiliate workflows/links/checks, ad slots/blocks, SEO registry/audits/findings/search metrics, ad accounts/imports/metrics |
| [0011_analytics_quotas](../../infra/database/app/0011_analytics_quotas.sql) | 5 | Events, dirty days, aggregate metrics, quota policies and buckets |
| [0002_editorial](../../infra/database/cms/0002_editorial.ts) | 20 | Nine new logical Payload collections with generated version and relationship tables; extends existing document-lock relationships |

Application history becomes **11 migrations**, CMS history **two**. The nine accepted application migrations and the accepted CMS migration/snapshot are unchanged. New runtime grants remain absent. No dependency, UI, product API, hosted infrastructure or live provider integration is added. PostgreSQL remains the only required operational/analytics/quota database; the conditional computation cache is absent.

## CMS ownership and publication

[Collection configuration](../../scripts/database/cms-collections.ts) adds articles, glossary terms, topics, explanation templates, media metadata, SEO metadata, redirects, editorial reviews and durable publication work. Existing `cms-staff` identities remain separate from application staff and retain verified-identity requirements with local login disabled. Every new collection denies anonymous CRUD and version reads. No admin HTTP surface is activated.

Payload 3.92.0 generated the migration and [snapshot](../../infra/database/cms/0002_editorial.json) from `0001_staff.json` using its real PostgreSQL adapter. Generated tables/indexes/enums remain Payload-owned; reviewed additive checks constrain published completeness, integer versions, bounded JSON, public paths, publication identity and leases. The application text-status convention does not replace Payload-generated enums. Generation uses `push: false`; migrations run under the existing locked/checksummed operator. Each execution now obtains a fresh Payload cache key, so a second upgrade in one process cannot reuse a destroyed adapter.

Seven document collections support drafts and at most 20 retained Payload versions per document. Draft-required fields can be nullable physically; publishing requires content identity, locale/market, revision/schema version, title, source, approved review status and reviewer/time. Version-content UPDATE is rejected while Payload may maintain `latest`/`updated_at`; ordinary retention can prune old versions. Editorial review facts are immutable. These checks cannot establish that a reviewer was authorized or the cited source is valid. Version relationship handling, source/expiry policy and staff permissions must be enforced by later editorial services.

Media contains logical object UUID, alt text, rights metadata, MIME type and review state. Object existence, scope and sanitation remain asset services; there is no cross-database FK or upload handler. Initial redirects use exact public paths and explicit 301/302/410 codes. A 410 has no target; published 301/302 records require one. Self-targets, private routes and unvalidated activation are rejected. Bounded regex, loop/chain detection, CSV import and render behavior remain later editorial/API work.

Publication work fixes document/revision, event UUID, DTO and schema version. Retry counters are bounded; leases require token, expiry and increasing generation; published state requires its timestamp. Tests use real Payload operations to commit a draft plus publication work in one database transaction and SQL to prove rollback of both. This demonstrates storage atomicity, not an implemented publish workflow: the later service must create work only after validating approved content and use the same Payload transaction. Projection workers must fence stale claims and retry cross-database propagation.

`app.published_content` stores immutable, bounded, revisioned public DTOs with hash, locale/market and validity. Duplicate content/revision/locale/market is rejected. Public-shape validation, approved-source checks, out-of-order revision selection, propagation status and stale-content removal remain repository/service responsibilities. No application request joins editorial tables or receives CMS credentials.

## SEO, configuration and advertising

Published configuration versions are immutable; feature-state FKs bind the same key to a published configuration and default disabled. Affiliate applications require submitted/terms evidence before an approved state. Links have basic HTTPS shape bounds, retailer/market references and immutable expiring check records. Actual host allowlisting, secret stripping, SSRF-safe URL checks and commercial authorization remain adapter/service requirements.

SEO registries accept only `/`, one-segment public education/glossary paths and tire model/size paths. Query strings, encoded path tricks, private routes and arbitrary canonical targets are rejected. Page class matches its path; ownership/review dates and audit findings are indexed. Search metrics replace a unique page/day/source row and distinguish unavailable position from zero. Provider revision comparison and sparse-data semantics remain ingestion logic.

Ad inventory allows education, glossary, tire-model and tire-size route classes. The assessment home page and private report routes are excluded. Network accounts distinguish pending from verified and require a verification timestamp for the latter. Rendering still must apply the approved consent, placement, density, exclusion and performance rules; a stored status never enables a tag or proves network approval.

Ad imports have immutable account/period/revision/checksum identities and a monotonic `source_generation` unique per account. Metrics use explicit public page/slot FKs or the `all` dimension; no report/subject/photo dimension exists. Signed revenue corrections and estimated/finalized status remain distinct. Metrics lock their import while checking its period and reject edits to approved snapshots.

Each approved import is a **complete period snapshot**. `admin.current_ad_daily_metrics` selects the newest approved snapshot covering an account/day. Superseded rows and dimensions omitted by the replacement disappear, including old estimates replaced by finalized data. Consumers select one dimensional grain and one revenue status rather than summing overlapping totals. Import services must validate provider completeness/timezone, assign source order, reject changed-body conflicts and serialize approval; no provider is called here.

## Analytics, privacy and quotas

Events use a globally unique supplied event UUID, required erasable subject FK, bounded registered fields, static route templates, a 32-byte payload digest and original permission/policy versions. Properties contain only enumerated step/outcome values; no free text, actual private path or arbitrary identifier is accepted. Occurrence is bounded to 24 hours before through five minutes after receipt, UTC receipt day is generated, and expiry is at most 13 months. UPDATE is rejected; ordered privileged retention remains possible. Consent verification, digest conflict handling and transactional dirty-day invalidation remain collector/privacy services.

Dirty-day requested/completed/privacy revisions cannot regress and must remain ordered. Lease fields are paired; retries are bounded. Aggregate dimensions use code registries, values are nonnegative and generations positive. `analytics.visible_daily_metrics` returns only a completed matching generation on an unblocked day, hiding stale privacy-sensitive metrics immediately. Actual rebuild completeness, current subject restrictions, worker fencing and atomic replacement remain aggregation services. No ingest, dashboard role or background job is activated.

`app.rate_limit_policies` adds immutable policy/version/window/cap identities. Three initial email/IP policy rows are disabled. Bucket FKs bind the cap, used capacity cannot exceed it, principal keys contain only versioned 32-byte HMACs, windows align to UTC epoch and expiry is bounded to 48 hours. A separate-connection capped-upsert test proves two contenders cannot consume the last slot. The later limiter must check policy activation, consume every applicable window in deterministic order in one transaction, preserve active quotas across key rotation, ignore expired windows and fail closed on database unavailability. This PR does not claim full multi-window HTTP enforcement or production throughput.

## Validation, recovery and next work

[Validation evidence](evidence/P1/p1-pr-007-validation.md) records TDD, real PostgreSQL/Payload checks and environment results. All application FKs, including analytics, have leading indexes. Additional access paths support public-content reads, review queues, import periods, event expiry, dirty days, publication retries and quota cleanup. These are initial access paths; measured mixed workload/query-plan budgets remain S2/S3 work.

Use `node scripts/verify/database.mjs` for isolated schema checks and `pnpm verify:push` on a clean commit for the full Linux pipeline. Apply additive migrations with `pnpm database migrate dev` / `stage`; status must show 11 app/two CMS and zero pending. Replay is a no-op. Never reset retained volumes or change an applied checksum. Destructive CMS rollback is refused; recovery uses a reviewed forward migration or restore.

After owner acceptance, P1-PR-008 closes complete S1 validation and recovery/restore evidence. Entities/repositories remain 009–013, followed by shared services and APIs. Product frontends remain behind 031. Deferred providers, hosting budget, full G0, live approvals and PostgreSQL-only architecture remain unchanged.
