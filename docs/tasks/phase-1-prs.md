# Phase 1 — live US tire-advice website

**Working PR decomposition 1.0 · October 23, 2026.** 43 planned PRs. Scope comes from the approved [four-phase baseline](../12-live-product-phases-and-gap-review.md); this breakdown adds execution detail without approving new capabilities. P1-PR-001/002/003 are accepted; P1-PR-004 database foundations are accepted; P1-PR-005 domain/catalog/import schemas are accepted; P1-PR-006 report/consent/delivery/reliability schemas are accepted; P1-PR-007 CMS/SEO/ads/analytics/quota schemas are in review. The [master task list](../15-project-task-list.md) is the authoritative status/assignee/PR/evidence ledger.

**Live outcome:** A driver completes supported assessment, comparison and optional report delivery; staff operates licensed imports, privacy, SEO and ad-ready public education.

**Phase entry:** Approved planning baseline; begin with P1-PR-001 scope/data feasibility. Every listed dependency means merged **and accepted with required evidence**, not just an open PR. New product UI/templates wait for [P1-PR-031](phase-1-prs.md#p1-pr-031). Read the [TDD](../08-test-driven-development.md), [schema](../09-database-design.md), [coding](../10-coding-standards.md), [domain imports](../13-domain-data-and-imports.md) and [AI/photo](../14-ai-analysis-and-photo-design.md) contracts before the affected work.

## PR sequence

**Owner-directed deferral:** provider and hosting-budget decisions are deferred until needed. [The P1 launch baseline](../implementation/P1-PR-001-launch-baseline.md) records triggers. Local S0 in 003 permits synthetic S1/S2 work while G0 remains open; actual provider/import/host acceptance still requires real evidence, and full G0 closes by 031. No product capability or safety gate is waived.

**Approved option-C deployment detail:** [The deployment task mapping](../16-deployment-and-local-environments.md#integration-with-the-working-pr-task-list) expands the existing cards with portable Linux app containers/PostgreSQL outside Vercel, isolated Docker dev/test/stage, pre-push checks, public-config portability and container-host release proofs. DP01–DP08 amend the former hosting default; all task IDs, dependencies and completion statuses remain.

| PR | Stage | Proposed title |
| --- | --- | --- |
| [P1-PR-001](#p1-pr-001) | S0 | Lock Phase 1 scope, data rights and launch coverage |
| [P1-PR-002](#p1-pr-002) | S0 | Bootstrap headless workspace and TDD tooling |
| [P1-PR-003](#p1-pr-003) | S0 | Prove local foundation and track provider gates |
| [P1-PR-004](#p1-pr-004) | S1 | Create database ownership, identity and asset foundations |
| [P1-PR-005](#p1-pr-005) | S1 | Create domain, catalog, reference and import schemas |
| [P1-PR-006](#p1-pr-006) | S1 | Create report, consent, delivery and reliability schemas |
| [P1-PR-007](#p1-pr-007) | S1 | Create CMS, SEO, ads, analytics and quota schemas |
| [P1-PR-008](#p1-pr-008) | S1 | Close database gate with migration and recovery evidence |
| [P1-PR-009](#p1-pr-009) | S2 | Define domain entities, value objects and repository contracts |
| [P1-PR-010](#p1-pr-010) | S2 | Implement catalog and ingestion repositories |
| [P1-PR-011](#p1-pr-011) | S2 | Implement owner, report, privacy and delivery repositories |
| [P1-PR-012](#p1-pr-012) | S2 | Implement content, operations, analytics and limiter adapters |
| [P1-PR-013](#p1-pr-013) | S2 | Close entities and data-access gate |
| [P1-PR-014](#p1-pr-014) | S3 | Implement durable jobs, private assets and runtime composition |
| [P1-PR-015](#p1-pr-015) | S3 | Implement script-first ingestion and publication services |
| [P1-PR-016](#p1-pr-016) | S3 | Integrate NHTSA and licensed domain source adapters |
| [P1-PR-017](#p1-pr-017) | S3 | Implement deterministic eligibility and recommendation rules |
| [P1-PR-018](#p1-pr-018) | S3 | Implement prices, installed costs and comparison mathematics |
| [P1-PR-019](#p1-pr-019) | S3 | Implement report, refine, compare and access services |
| [P1-PR-020](#p1-pr-020) | S3 | Implement contact, consent and suppression services |
| [P1-PR-021](#p1-pr-021) | S3 | Implement content, public tools and SEO publication services |
| [P1-PR-022](#p1-pr-022) | S3 | Implement report delivery orchestration and cancellation |
| [P1-PR-023](#p1-pr-023) | S3 | Implement webhooks, preferences, feedback and safe redirects |
| [P1-PR-024](#p1-pr-024) | S3 | Implement PostgreSQL analytics, SQL limits and operations |
| [P1-PR-025](#p1-pr-025) | S3 | Implement privacy rights, retention and recovery services |
| [P1-PR-026](#p1-pr-026) | S3 | Implement staff, affiliate, advertising and revenue services |
| [P1-PR-027](#p1-pr-027) | S3 | Close business-service gate and engine safety review |
| [P1-PR-028](#p1-pr-028) | S4 | Expose public lookup and owner assessment APIs |
| [P1-PR-029](#p1-pr-029) | S4 | Expose consent, privacy, import and staff operations APIs |
| [P1-PR-030](#p1-pr-030) | S4 | Expose provider callbacks, event intake and workflow endpoints |
| [P1-PR-031](#p1-pr-031) | S4 | Accept the complete Phase 1 API before frontend work |
| [P1-PR-032](#p1-pr-032) | S5 | Build accessible web shell and design system |
| [P1-PR-033](#p1-pr-033) | S5 | Build assessment form and reference lookups |
| [P1-PR-034](#p1-pr-034) | S5 | Build results, explanation and refinement views |
| [P1-PR-035](#p1-pr-035) | S5 | Build comparison, shop-quote and sharing views |
| [P1-PR-036](#p1-pr-036) | S5 | Build delivery, cancellation, preferences and privacy controls |
| [P1-PR-037](#p1-pr-037) | S5 | Implement production email and PDF templates |
| [P1-PR-038](#p1-pr-038) | S5 | Build editorial CMS and reviewed education website |
| [P1-PR-039](#p1-pr-039) | S5 | Build staff operations, SEO and ad-revenue screens |
| [P1-PR-040](#p1-pr-040) | S5 | Build permitted affiliate and advertising placements |
| [P1-PR-041](#p1-pr-041) | S6 | Verify the full web product and accessibility journeys |
| [P1-PR-042](#p1-pr-042) | S6 | Prove production security, capacity and recovery |
| [P1-PR-043](#p1-pr-043) | S6 | Release Phase 1 and record the usable live outcome |

## Task cards

Each checkbox is implementation work, not a claim of completion. Each behavioral PR includes failing-then-passing unit/application tests and affected real database/API/provider checks; UI PRs also include functional/browser/accessibility checks. Evidence-only feasibility/gate/release PRs use documented review and measured results instead of artificial unit tests. Gate PRs collect existing evidence and exercise integration gaps; they do not postpone testing until the end.

### P1-PR-001

**Lock Phase 1 scope, data rights and launch coverage**

**Stage:** S0 · **Responsible role:** Product/data · **Work packages:** E01, E35, E42

**Depends on:** No implementation PR; approved planning baseline.

**Trace:** CAP-01, CAP-04, CORE-10. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Record US configuration/size-level targets, actual verified coverage and refusal/evidence criteria for optional/staggered/AWD/EV/LT cases; defer real coverage benchmarking until permitted samples exist.
- [x] Build source/license/provider matrix including display, storage, derived use, AI and redistribution rights; record unresolved blockers and decision owners.
- [x] Record committed/conditional scope, responsibilities, content review schedule and initial card sizing; defer option-C provider/region/DB/budget/operator choices and full P1 forecast to explicit blocking triggers.

**Verification and acceptance:** [Prepared launch baseline and source probes](../implementation/P1-PR-001-launch-baseline.md); owner approved and PR #1 merged at `b9e02f0`. Checkboxes record completed preparation, not acceptance of coverage, rights, hosting or G0. Documentation review is the test for this PR.

### P1-PR-002

**Bootstrap headless workspace and TDD tooling**

**Stage:** S0 · **Responsible role:** Platform · **Work packages:** E02

**Depends on:** [P1-PR-001](phase-1-prs.md#p1-pr-001)

**Trace:** ENG-01, ENG-02, ENG-04, ENG-05. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Create pnpm workspace, strict TypeScript packages and minimal headless Next.js host; pin Node 24/Linux images and compatible dependencies; add isolated Docker dev/test/stage setup and doctor commands.
- [x] Configure lint, formatting, import boundaries, unit/use-case/HTTP/real-PostgreSQL commands, exact-commit local pre-push verification and frozen-lockfile Linux CI.
- [x] Add isolated local environments, synthetic/provider fixtures, secret/config validation, OpenAPI skeleton and immutable-image/protected-hosted-release scaffolding; actual hosted environment protection/provisioning follows DD03/DD04 before hosted use. Keep product UI absent.

**Verification and acceptance:** [Local validation record](../implementation/evidence/P1/p1-pr-002-validation.md). Fresh checkout runs the committed commands; an intentional failing fixture proves CI gates and package-boundary checks work. Owner approved and PR #2 merged at `dd1817f`; P1-PR-003 local S0 acceptance remains separate.

### P1-PR-003

**Prove local foundation and track provider gates**

**Stage:** S0 · **Responsible role:** Platform/data · **Work packages:** E01, E02

**Depends on:** [P1-PR-001](phase-1-prs.md#p1-pr-001), [P1-PR-002](phase-1-prs.md#p1-pr-002)

**Trace:** ENG-06, CAP-03, CORE-10. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Probe local Linux container startup/drain, standard PostgreSQL pooling/direct migrations, separate Payload ownership and headless package/auth boundaries without product screens; use real isolated PostgreSQL.
- [x] Verify local build/runtime/migration networking and lifecycle; inventory remaining reverse-proxy/TLS, Clerk/Inngest/S3/KMS/email/CMP/ad and chosen-host proofs with their affected adapter/activation triggers.
- [x] Record measured local workload/resource targets, source contract requirements, next-card estimates and deferred owner decisions; accept local S0 separately and keep full G0 explicitly open until required external evidence exists.

**Verification and acceptance:** [PR #3](https://github.com/xmyqyl4x/tiresandtreads/pull/3) was owner-approved and merged at `ebcf936`, accepting local S0. Full G0 remains open. [Local proof and external-gate packet](../implementation/P1-PR-003-local-foundation.md). Reproducible real local DB/runtime/ownership proofs and accountable local S0 acceptance. External fixtures prove contracts only. Protected imports and real adapters wait for their recorded decisions; full G0 and hosted proofs close by 031. No mock-only claims of production readiness.

### P1-PR-004

**Create database ownership, identity and asset foundations**

**Stage:** S1 · **Responsible role:** Backend/platform · **Work packages:** E04

**Depends on:** [P1-PR-003](phase-1-prs.md#p1-pr-003)

**Trace:** ENG-03, DB12, DB15. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Create separate application/Payload migration ownership, runtime roles and migration runner.
- [x] Add staff/subject/session, object asset, code/market/unit registry foundations required by later FKs.
- [x] Add synthetic seeds, named constraints, FK indexes and reversible/compatible migration guidance.

**Verification and acceptance:** [Implementation and ownership packet](../implementation/P1-PR-004-database-foundations.md) and [validation evidence](../implementation/evidence/P1/p1-pr-004-validation.md). Empty/upgrade migration tests and real-role denial tests; no runtime DDL or cross-CMS ownership. [PR #4](https://github.com/xmyqyl4x/tiresandtreads/pull/4) was owner-approved and merged at `4f00c30`.

### P1-PR-005

**Create domain, catalog, reference and import schemas**

**Stage:** S1 · **Responsible role:** Data/backend · **Work packages:** E04, E05, E35, E36

**Depends on:** [P1-PR-004](phase-1-prs.md#p1-pr-004), [P1-PR-003](phase-1-prs.md#p1-pr-003)

**Trace:** CAP-04, DB14, DB21, DB22. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Migrate source/licenses/datasets/bundles/heads, canonical company/brand/plant identities, aliases and reviewed mappings.
- [x] Add vehicles/axles/SKUs/evidence/prices/climate/rules, code dictionaries, advice citations and full unresolved recall targets.
- [x] Add connector/run/staging/rejection/publication/checkpoint metadata and provenance/expiry indexes.

**Verification and acceptance:** [Implementation packet](../implementation/P1-PR-005-domain-catalog-import-schemas.md) and [validation evidence](../implementation/evidence/P1/p1-pr-005-validation.md). Constraint fixtures preserve ambiguous mappings, unknown safety fields and unresolved recalls; published versions cannot mutate through runtime roles. [PR #5](https://github.com/xmyqyl4x/tiresandtreads/pull/5) was owner-approved and merged at `2d8acd2`.

### P1-PR-006

**Create report, consent, delivery and reliability schemas**

**Stage:** S1 · **Responsible role:** Backend · **Work packages:** E04, E08, E10, E11, E12, E13, E14

**Depends on:** [P1-PR-004](phase-1-prs.md#p1-pr-004), [P1-PR-005](phase-1-prs.md#p1-pr-005), [P1-PR-003](phase-1-prs.md#p1-pr-003)

**Trace:** DB01, DB02, DB03, DB04, DB05, DB06, DB07, DB08, DB13, DB15. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Add immutable report/version/draft/item/compare structures and owner/share/download capability separation.
- [x] Add encrypted contacts, consent/suppression/rights/deletion records, sends/templates/attempts/events and fixed presentation references.
- [x] Create idempotency/outbox/inbox, deferred/composite FKs, revision and lifecycle constraints; create the audit schema and bind `import_publications.approval_record_id` to `admin.audit_events` with a named FK/index before removing its 005 NULL-only check.

**Verification and acceptance:** [Implementation packet](../implementation/P1-PR-006-report-consent-delivery-schemas.md) and [validation evidence](../implementation/evidence/P1/p1-pr-006-validation.md). Real PostgreSQL tests reject wrong-owner references, fifth comparison slots and duplicate identities; prove circular FK/upgrade ordering, fixed sends, privacy detachments and command-claim contention. [PR #6](https://github.com/xmyqyl4x/tiresandtreads/pull/6) was owner-approved and merged at `53f9fd1`.

### P1-PR-007

**Create CMS, SEO, ads, analytics and quota schemas**

**Stage:** S1 · **Responsible role:** Backend/content · **Work packages:** E04, E15, E16, E17, E18, E37, E38

**Depends on:** [P1-PR-004](phase-1-prs.md#p1-pr-004), [P1-PR-005](phase-1-prs.md#p1-pr-005), [P1-PR-006](phase-1-prs.md#p1-pr-006), [P1-PR-003](phase-1-prs.md#p1-pr-003)

**Trace:** CAP-02, CAP-03, DB16, DB17, DB18, DB19, DB27. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Define Payload collections/migrations for editorial content, redirects, review and durable publication; add application published-content projection.
- [x] Extend the staff audit foundation created in 006 with configuration, affiliates/ad slots/network reports, SEO page/search/audit records.
- [x] Create analytics receipt/generation/privacy invalidation and SQL rate buckets; leave optional computation cache absent pending profiling.

**Verification and acceptance:** [Implementation packet](../implementation/P1-PR-007-cms-seo-ads-analytics-schemas.md) and [validation evidence](../implementation/evidence/P1/p1-pr-007-validation.md). Real PostgreSQL and Payload tests preserve CMS isolation, draft/version/publication transactions, public-only SEO/ad dimensions, provider-report correction semantics, privacy generation hiding and concurrent quota bounds. [PR #7](https://github.com/xmyqyl4x/tiresandtreads/pull/7) is in review; owner acceptance remains pending.

### P1-PR-008

**Close database gate with migration and recovery evidence**

**Stage:** S1 · **Responsible role:** Backend/QA · **Work packages:** E04, E19

**Depends on:** [P1-PR-004](phase-1-prs.md#p1-pr-004), [P1-PR-005](phase-1-prs.md#p1-pr-005), [P1-PR-006](phase-1-prs.md#p1-pr-006), [P1-PR-007](phase-1-prs.md#p1-pr-007), [P1-PR-003](phase-1-prs.md#p1-pr-003)

**Trace:** ENG-03, DB13, DB28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run empty and representative upgrade migrations against real runtime roles.
- [ ] Verify required P1 constraints/indexes, retention deletion order and separate CMS recovery boundaries.
- [ ] Perform initial restore/deletion-marker replay drill; record schema inventory, versions, failures and S1 decision.

**Verification and acceptance:** All applicable schema invariants pass; migrations and recovery are repeatable before any repository implementation begins.

### P1-PR-009

**Define domain entities, value objects and repository contracts**

**Stage:** S2 · **Responsible role:** Backend · **Work packages:** E04

**Depends on:** [P1-PR-008](phase-1-prs.md#p1-pr-008)

**Trace:** ENG-04, ENG-05. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Define pure tire/unit/money/unknown/provenance, report/consent and import entity/value interfaces.
- [ ] Define narrow repository/query/provider ports and explicit transaction context without ORM leakage.
- [ ] Create storage-row/domain/wire mapping rules and schema-version/error contracts.

**Verification and acceptance:** Type/import checks and unit tests for invalid/unknown/value mapping; no SQL/provider access hidden in domain entities.

### P1-PR-010

**Implement catalog and ingestion repositories**

**Stage:** S2 · **Responsible role:** Data/backend · **Work packages:** E04, E05, E35, E36

**Depends on:** [P1-PR-009](phase-1-prs.md#p1-pr-009), [P1-PR-008](phase-1-prs.md#p1-pr-008)

**Trace:** DB14, DB21, DB22. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement source/reference/fitment/SKU/evidence/recall repositories and pinned lookup read models.
- [ ] Implement bounded staging/batch/checkpoint, coherent publication/head compare-and-set and source reverse indexes.
- [ ] Add parameterized queries, keyset pagination and explicit license/coverage projections.

**Verification and acceptance:** Real DB tests for partial publish, duplicate/resumed runs and concurrent head changes; query-plan/memory evidence on representative datasets.

### P1-PR-011

**Implement owner, report, privacy and delivery repositories**

**Stage:** S2 · **Responsible role:** Backend · **Work packages:** E04, E08, E10, E11, E12, E14

**Depends on:** [P1-PR-009](phase-1-prs.md#p1-pr-009), [P1-PR-010](phase-1-prs.md#p1-pr-010), [P1-PR-008](phase-1-prs.md#p1-pr-008)

**Trace:** DB01, DB03, DB04, DB07, DB12, DB15. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement scoped report/draft/compare/capability and contact/permission repositories with explicit mappers.
- [ ] Implement send/attempt/outbox/inbox and privacy/deletion graph persistence on one transaction client.
- [ ] Add revision checks, lock ordering, key rotation lookup and asset-grant projections.

**Verification and acceptance:** Round-trip/null/money tests plus real rollback, wrong-owner and concurrent identity/cancel tests; no hidden cross-pool transaction.

### P1-PR-012

**Implement content, operations, analytics and limiter adapters**

**Stage:** S2 · **Responsible role:** Backend/platform · **Work packages:** E04, E15, E16, E17, E18, E37, E38

**Depends on:** [P1-PR-009](phase-1-prs.md#p1-pr-009), [P1-PR-010](phase-1-prs.md#p1-pr-010), [P1-PR-011](phase-1-prs.md#p1-pr-011), [P1-PR-008](phase-1-prs.md#p1-pr-008)

**Trace:** DB16, DB17, DB18, DB19, DB27. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement published-content bridge repositories, portable SQL/S3 public-config read adapters and safe staff/config/commercial projections.
- [ ] Implement SQL event receipt, dirty-day generation, quota upserts and cleanup repositories.
- [ ] Implement SEO/search/ad report projections with missing-versus-zero semantics and superseded-revision exclusion.

**Verification and acceptance:** Permission/generation/quota contention tests and bounded query plans; dashboard roles cannot read contacts/raw private records.

### P1-PR-013

**Close entities and data-access gate**

**Stage:** S2 · **Responsible role:** Backend/QA · **Work packages:** E04

**Depends on:** [P1-PR-009](phase-1-prs.md#p1-pr-009), [P1-PR-010](phase-1-prs.md#p1-pr-010), [P1-PR-011](phase-1-prs.md#p1-pr-011), [P1-PR-012](phase-1-prs.md#p1-pr-012), [P1-PR-008](phase-1-prs.md#p1-pr-008)

**Trace:** ENG-03, ENG-04, ENG-05. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Review every P1 entity/row/DTO mapper and repository interface against the accepted schema.
- [ ] Run real transaction/ownership/pool/query suites and dependency lint rules.
- [ ] Publish S2 evidence and revised effort/critical-path forecast; assign any required schema corrections before services start.

**Verification and acceptance:** All P1 repository contracts pass with actual PostgreSQL; no mock-only S2 signoff.

### P1-PR-014

**Implement durable jobs, private assets and runtime composition**

**Stage:** S3 · **Responsible role:** Platform/backend · **Work packages:** E02, E12, E13, E14

**Depends on:** [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** DB08, DB15. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Compose narrow runtime credentials, clocks, repositories and provider ports; add bounded container pools, graceful shutdown and host-neutral deployment metadata.
- [ ] Implement outbox relay/Inngest retry/lease/reconciliation and private S3 asset lifecycle/encryption adapters.
- [ ] Add redacted operational telemetry, job deadlines, retry limits and failure queues.

**Verification and acceptance:** Crash/replay/late-worker and revoked-asset tests; retries cannot create a second logical effect and secrets stay out of logs.

### P1-PR-015

**Implement script-first ingestion and publication services**

**Stage:** S3 · **Responsible role:** Data/backend · **Work packages:** E05, E36

**Depends on:** [P1-PR-014](phase-1-prs.md#p1-pr-014), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** CAP-04, UC13, AT22, DB22. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement fetch registration, streaming stage/normalize/validate/diff and critical rejection policy.
- [ ] Add planned CLI commands for dry-run, publish, resume, status and safe rollback through shared services.
- [ ] Publish coherent bundles with expected-head concurrency and outbox invalidation; enforce source rights and complete-snapshot semantics.

**Verification and acceptance:** Script use-case and real DB tests cover truncated feeds, duplicates, resumes, head races and rollback that cannot erase a newer recall warning.

### P1-PR-016

**Integrate NHTSA and licensed domain source adapters**

**Stage:** S3 · **Responsible role:** Data · **Work packages:** E01, E05, E35

**Depends on:** [P1-PR-015](phase-1-prs.md#p1-pr-015), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** CAP-04, UC01, UC13, AT17, AT21, DB21. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement official vehicle/manufacturer/plant/recall and selected licensed catalog/fitment/price/climate connectors.
- [ ] Normalize units, retain unresolved recall targets, validate source schemas and reviewed cross-source mappings.
- [ ] Schedule bounded refresh/reconciliation, record no-change success and alert on coverage/freshness/rights failures.

**Verification and acceptance:** DD01/DD02 rights and source contracts resolved for each accepted connector; recorded source-contract fixtures and permitted live compatibility checks. vPIC identity never asserts fitment; stale recall issuance is blocked. Synthetic tests cannot accept an unselected licensed connector.

### P1-PR-017

**Implement deterministic eligibility and recommendation rules**

**Stage:** S3 · **Responsible role:** Data/backend · **Work packages:** E06

**Depends on:** [P1-PR-016](phase-1-prs.md#p1-pr-016), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC01, UC02, AT01, AT02, AT03, AT17. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement input normalization, wheel/axle fitment, load/speed, seasonal, replacement/AWD and recall eligibility.
- [ ] Implement evidence-backed preference ordering, unknowns, stable tie-breaks, exclusions and reason codes.
- [ ] Build at least 50 specialist-reviewed golden scenarios and property tests; exclude all paid terms from engine inputs.

**Verification and acceptance:** Unit/property/use-case suites demonstrate safety-before-budget, reproducibility, sparse evidence and commercial invariance; G1 evidence prepared.

### P1-PR-018

**Implement prices, installed costs and comparison mathematics**

**Stage:** S3 · **Responsible role:** Backend/data · **Work packages:** E06, E10

**Depends on:** [P1-PR-017](phase-1-prs.md#p1-pr-017), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC02, UC04, AT05, AT20. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement unit/currency/quantity/installed-component normalization and comparable price bases.
- [ ] Implement scenario, winter-share and cost-per-distance calculations only with supported assumptions/evidence.
- [ ] Qualify unknown quote products and missing prices/warranty/lifespan evidence without invented precision.

**Verification and acceptance:** Boundary/property tests cover incompatible units/currencies/quantities, absent assumptions and rounding; specialist approves explanations.

### P1-PR-019

**Implement report, refine, compare and access services**

**Stage:** S3 · **Responsible role:** Backend · **Work packages:** E08, E10

**Depends on:** [P1-PR-017](phase-1-prs.md#p1-pr-017), [P1-PR-018](phase-1-prs.md#p1-pr-018), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC01, UC03, UC04, UC05, AT04, AT06, DB01, DB02, DB03, DB15. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement report snapshots pinned to engine/rule/data versions and current safety overlay.
- [ ] Implement draft revision, refine/new-version diff, four-item comparison and shop-quote use cases.
- [ ] Implement owner/read-only share/revoke/fork/PDF authorization and private DTOs; persist idempotent outcomes.

**Verification and acceptance:** Use-case/DB tests prove immutable versions, stale-write conflicts, share denial and one outcome under duplicate requests.

### P1-PR-020

**Implement contact, consent and suppression services**

**Stage:** S3 · **Responsible role:** Backend/privacy · **Work packages:** E11

**Depends on:** [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC06, UC08, AT10, AT11, AT19, DB07. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement report-only/offers-only contact flows, address verification and independent purpose events.
- [ ] Implement restrictive default/GPC/CMP server policy and current-purpose projections.
- [ ] Implement suppression, double opt-in, lookup-key rotation and permission rechecks for queued operations.

**Verification and acceptance:** Unit/use-case/real DB tests cover forged grants, withdraw/grant races, hard-bounce suppression and no email-gated assessment.

### P1-PR-021

**Implement content, public tools and SEO publication services**

**Stage:** S3 · **Responsible role:** Content/backend · **Work packages:** E15, E37

**Depends on:** [P1-PR-014](phase-1-prs.md#p1-pr-014), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** CAP-02, UC10, UC17, AT16, AT27, DB16, DB27. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement reviewed CMS publication bridge, learning-link selection, glossary and pure decoder/checklist behavior.
- [ ] Implement portable SQL/S3 public-config and safe redirect publication with revision, expiry and cross-replica invalidation; public page registry, metadata/sitemap/structured-data policies and private exclusion.
- [ ] Add bounded crawl audits, Search Console/IndexNow adapters and aggregate metrics where authorized; expose missing data honestly.

**Verification and acceptance:** Role/publication retry tests and headless SEO/tool contracts; publication reaches all replicas within 60 seconds, out-of-order updates are rejected and expired safety/privacy configuration fails closed; unsafe redirects and private indexing rejected.

### P1-PR-022

**Implement report delivery orchestration and cancellation**

**Stage:** S3 · **Responsible role:** Backend · **Work packages:** E12

**Depends on:** [P1-PR-014](phase-1-prs.md#p1-pr-014), [P1-PR-019](phase-1-prs.md#p1-pr-019), [P1-PR-020](phase-1-prs.md#p1-pr-020), [P1-PR-021](phase-1-prs.md#p1-pr-021), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC06, UC07, AT07, AT08, AT19, DB04, DB05. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Freeze report/comparison/template/content selection and implement render ports with labeled fixtures.
- [ ] Implement scheduled send identity, 60-second cancellation, dispatch claim and final permission recheck.
- [ ] Integrate Resend/private-PDF adapters, uncertain handoff reconciliation and retry limits without actual product templates.

**Verification and acceptance:** Two-connection cancel/claim races and accepted-timeout provider tests; headless rendering uses fixtures until S5.

### P1-PR-023

**Implement webhooks, preferences, feedback and safe redirects**

**Stage:** S3 · **Responsible role:** Backend · **Work packages:** E13

**Depends on:** [P1-PR-022](phase-1-prs.md#p1-pr-022), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC07, AT08, AT12, AT13, DB06. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Verify and durably deduplicate provider callbacks, including reordered/delayed observations.
- [ ] Implement preference/unsubscribe/feedback state transitions and fixed-destination tracked links.
- [ ] Classify scanner/bot activity, reconcile uncertain sends and expose operator recovery commands.

**Verification and acceptance:** Functional service tests prove no state-changing scanner GET, correct one-click unsubscribe and no duplicate delivery metrics.

### P1-PR-024

**Implement PostgreSQL analytics, SQL limits and operations**

**Stage:** S3 · **Responsible role:** Platform/backend · **Work packages:** E16

**Depends on:** [P1-PR-014](phase-1-prs.md#p1-pr-014), [P1-PR-020](phase-1-prs.md#p1-pr-020), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC08, UC09, AT11, DB17, DB18, DB19, DB20. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement allowlisted consent-aware intake, idempotent aggregation and privacy generation invalidation.
- [ ] Implement SQL admission quotas, bounded cleanup, operational dashboards and separate report/worker pool budgets.
- [ ] Profile repeated computation; document no-cache decision or implement DB20 only with measured parity/privacy benefit.

**Verification and acceptance:** Real race/load/expiry tests prove quota bounds and no deleted data in rebuilt aggregates; optional cache has evidence or remains absent.

### P1-PR-025

**Implement privacy rights, retention and recovery services**

**Stage:** S3 · **Responsible role:** Backend/privacy · **Work packages:** E14

**Depends on:** [P1-PR-014](phase-1-prs.md#p1-pr-014), [P1-PR-019](phase-1-prs.md#p1-pr-019), [P1-PR-020](phase-1-prs.md#p1-pr-020), [P1-PR-023](phase-1-prs.md#p1-pr-023), [P1-PR-024](phase-1-prs.md#p1-pr-024), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC09, AT14, DB13, DB18. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement proportionate rights verification, current suppression/revocation and deadline-driven fulfillment.
- [ ] Build idempotent SQL/object/email/analytics deletion graph, retention sweeps and minimal audit evidence.
- [ ] Implement restore/import/outbox replay barriers and operator escalation for incomplete downstream deletion.

**Verification and acceptance:** Deletion while processing and restored-backup use cases pass; revoked shares/assets cannot be recovered by stale caches or jobs.

### P1-PR-026

**Implement staff, affiliate, advertising and revenue services**

**Stage:** S3 · **Responsible role:** Backend/commercial · **Work packages:** E17, E18, E38

**Depends on:** [P1-PR-016](phase-1-prs.md#p1-pr-016), [P1-PR-021](phase-1-prs.md#p1-pr-021), [P1-PR-023](phase-1-prs.md#p1-pr-023), [P1-PR-024](phase-1-prs.md#p1-pr-024), [P1-PR-025](phase-1-prs.md#p1-pr-025), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** CAP-03, UC17, AT03, AT27, DB27. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement role-scoped staff queues, masked queries, audited configuration and recovery commands.
- [ ] Implement approved affiliate destinations, ad route/slot/consent/brand policy, ads.txt and house fallback configuration.
- [ ] Import/reconcile aggregate ad reports, source revisions and currencies; expose fill/revenue/consent/latency status without private joins.

**Verification and acceptance:** Role and financial-correction tests; private/form placements rejected and ad configuration leaves tire ranking unchanged.

### P1-PR-027

**Close business-service gate and engine safety review**

**Stage:** S3 · **Responsible role:** Backend/data/QA · **Work packages:** E05, E06, E08, E10, E11, E12, E13, E14, E15, E16, E17, E18, E35, E36, E37, E38

**Depends on:** [P1-PR-014](phase-1-prs.md#p1-pr-014), [P1-PR-015](phase-1-prs.md#p1-pr-015), [P1-PR-016](phase-1-prs.md#p1-pr-016), [P1-PR-017](phase-1-prs.md#p1-pr-017), [P1-PR-018](phase-1-prs.md#p1-pr-018), [P1-PR-019](phase-1-prs.md#p1-pr-019), [P1-PR-020](phase-1-prs.md#p1-pr-020), [P1-PR-021](phase-1-prs.md#p1-pr-021), [P1-PR-022](phase-1-prs.md#p1-pr-022), [P1-PR-023](phase-1-prs.md#p1-pr-023), [P1-PR-024](phase-1-prs.md#p1-pr-024), [P1-PR-025](phase-1-prs.md#p1-pr-025), [P1-PR-026](phase-1-prs.md#p1-pr-026), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC01, UC02, UC03, UC04, UC05, UC06, UC07, UC08, UC09, UC10, UC13, UC17. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run P1 headless service journeys with real repositories and required provider sandbox evidence.
- [ ] Approve golden tire cases, source coverage, backend permission and adverse-path evidence at G1/G2.
- [ ] Publish service inventory and S3 closure; record actual-render/UI evidence outstanding for S5.

**Verification and acceptance:** All committed P1 services accepted before endpoint implementation; fixtures are explicitly identified and cannot close UI/render gates.

### P1-PR-028

**Expose public lookup and owner assessment APIs**

**Stage:** S4 · **Responsible role:** Backend · **Work packages:** E34

**Depends on:** [P1-PR-027](phase-1-prs.md#p1-pr-027)

**Trace:** UC01, UC03, UC04, UC05, AT01, AT04, AT06. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Expose typed reference/fitment/content-tool and report/refine/compare/quote/share/PDF endpoints.
- [ ] Apply actor/ownership validation, CSRF/Origin, body limits, quotas, idempotency and consistent errors.
- [ ] Publish OpenAPI/client contracts, pagination and source/coverage/freshness fields.

**Verification and acceptance:** Running HTTP tests against real DB cover normal, unknown, denied, duplicate, stale-version and overload paths.

### P1-PR-029

**Expose consent, privacy, import and staff operations APIs**

**Stage:** S4 · **Responsible role:** Backend · **Work packages:** E34

**Depends on:** [P1-PR-027](phase-1-prs.md#p1-pr-027)

**Trace:** UC06, UC08, UC09, UC10, UC13, UC17. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Expose consent/preferences, delivery/cancel/status and privacy-rights APIs through accepted services.
- [ ] Expose operator import/diff/publish/rollback/status, content publication and staff/SEO/ad metric APIs.
- [ ] Enforce role/MFA/masking, expected revision and audit; keep P2 CSV UI out of P1 scope.

**Verification and acceptance:** Role matrix, no-enumeration, withdrawal, unsafe import command and private-metadata API tests pass.

### P1-PR-030

**Expose provider callbacks, event intake and workflow endpoints**

**Stage:** S4 · **Responsible role:** Platform/backend · **Work packages:** E34

**Depends on:** [P1-PR-027](phase-1-prs.md#p1-pr-027)

**Trace:** UC07, UC08, AT12, AT13, DB06, DB08, DB17. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Wire signature-verified callbacks, durable job entry points, analytics intake and unsubscribe routes.
- [ ] Enforce commit-before-ack, replay/digest conflict rules and bounded public request behavior.
- [ ] Verify environment secrets, safe log redaction, provider retries and endpoint observability.

**Verification and acceptance:** Running HTTP/provider sandbox tests cover forged/replayed events, committed receipt and uncertain delivery recovery.

### P1-PR-031

**Accept the complete Phase 1 API before frontend work**

**Stage:** S4 · **Responsible role:** QA/backend · **Work packages:** E34

**Depends on:** [P1-PR-028](phase-1-prs.md#p1-pr-028), [P1-PR-029](phase-1-prs.md#p1-pr-029), [P1-PR-030](phase-1-prs.md#p1-pr-030), [P1-PR-027](phase-1-prs.md#p1-pr-027)

**Trace:** CAP-01, ENG-07, AT01, AT06, AT07, AT11, AT14, AT17, AT21, AT22, AT27. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run assessment → stored report → refine/compare → schedule/cancel → deletion headlessly through real APIs.
- [ ] Audit every P1 endpoint against service/actor/schema/UC inventory and prove load, source and permission failure behavior.
- [ ] Publish S4 evidence, client artifacts and remaining S5 render evidence; re-estimate frontend work.

**Verification and acceptance:** All P1 API categories, full G0 and outstanding chosen-host/provider proofs are accepted under the [decision register](../implementation/P1-PR-001-launch-baseline.md#deferred-decision-register). This PR is the mandatory dependency for every P1 product UI/template PR.

### P1-PR-032

**Build accessible web shell and design system**

**Stage:** S5 · **Responsible role:** Frontend · **Work packages:** E03

**Depends on:** [P1-PR-031](phase-1-prs.md#p1-pr-031)

**Trace:** NFR-01, NFR-02. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement approved tokens, navigation, reusable controls, validation/error patterns and responsive shell.
- [ ] Add locale/Intl scaffolding, focus management, reduced motion and consent integration boundaries.
- [ ] Establish component accessibility/performance checks without business logic in components.

**Verification and acceptance:** Keyboard/reflow/contrast tests at approved viewports and bundle budget checks; components consume accepted contracts.

### P1-PR-033

**Build assessment form and reference lookups**

**Stage:** S5 · **Responsible role:** Frontend · **Work packages:** E07

**Depends on:** [P1-PR-032](phase-1-prs.md#p1-pr-032), [P1-PR-031](phase-1-prs.md#p1-pr-031)

**Trace:** UC01, CAP-04, AT01, AT02, AT17. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement vehicle/size/wheel-package, conditions, priorities, mileage, quantity and budget flows.
- [ ] Consume published lookup APIs with loading/unknown/unsupported/manual-recovery states.
- [ ] Submit through accepted report APIs with accessible errors, duplicate-submit handling and no email/ad gate.

**Verification and acceptance:** Browser feature tests cover ambiguous fitment, unsupported inputs, stale safety data, slow network and keyboard completion.

### P1-PR-034

**Build results, explanation and refinement views**

**Stage:** S5 · **Responsible role:** Frontend · **Work packages:** E09, E10

**Depends on:** [P1-PR-032](phase-1-prs.md#p1-pr-032), [P1-PR-033](phase-1-prs.md#p1-pr-033), [P1-PR-031](phase-1-prs.md#p1-pr-031)

**Trace:** UC02, UC03, AT03, AT20. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Render up to five supported picks, reasons/exclusions, confidence, units/prices and provenance/as-of details.
- [ ] Render maintenance/questions/current safety overlay and unavailable evidence without false precision.
- [ ] Implement draft autosave, refine controls, version conflict/diff and return-to-report behavior.

**Verification and acceptance:** Results/refine browser tests match authoritative DTOs, preserve versions and remain usable at narrow widths.

### P1-PR-035

**Build comparison, shop-quote and sharing views**

**Stage:** S5 · **Responsible role:** Frontend · **Work packages:** E10, E08

**Depends on:** [P1-PR-032](phase-1-prs.md#p1-pr-032), [P1-PR-034](phase-1-prs.md#p1-pr-034), [P1-PR-031](phase-1-prs.md#p1-pr-031)

**Trace:** UC04, UC05, AT04, AT05, AT06, AT18. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build four-item comparison and explicit replacement/removal interaction.
- [ ] Build quote checks and cost assumption controls with unverified-product/basis warnings.
- [ ] Build copy/revoke share, redacted view and private PDF access with accessible responsive controls.

**Verification and acceptance:** Fifth-item, unknown quote, expired/revoked share, 320px and keyboard/focus journeys pass.

### P1-PR-036

**Build delivery, cancellation, preferences and privacy controls**

**Stage:** S5 · **Responsible role:** Frontend · **Work packages:** E13

**Depends on:** [P1-PR-032](phase-1-prs.md#p1-pr-032), [P1-PR-034](phase-1-prs.md#p1-pr-034), [P1-PR-031](phase-1-prs.md#p1-pr-031)

**Trace:** UC06, UC08, UC09, AT07, AT10, AT11, AT19. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build independent report/offer submission, notice and confirmation states.
- [ ] Show server cancellation deadline, send/pending/unknown/cancelled status and safe retry controls.
- [ ] Build purpose preferences/GPC acknowledgement and rights request/status interfaces.

**Verification and acceptance:** Browser network tests show denied processing stays off; cancel/withdraw/report-only journeys work without an account.

### P1-PR-037

**Implement production email and PDF templates**

**Stage:** S5 · **Responsible role:** Frontend/backend · **Work packages:** E12

**Depends on:** [P1-PR-032](phase-1-prs.md#p1-pr-032), [P1-PR-031](phase-1-prs.md#p1-pr-031)

**Trace:** UC06, UC07, AT08, AT19. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement HTML/text email and PDF from frozen presentation DTOs, with required disclosure and education links.
- [ ] Add long-label, missing-data, currency/quantity and private-link layout handling.
- [ ] Test supported email clients, images-off/dark mode and PDF reading order/page boundaries; retain accessible HTML equivalent.

**Verification and acceptance:** Real renderer/client evidence replaces S4 fixtures; <100KB email target and immutable report/send identity pass.

### P1-PR-038

**Build editorial CMS and reviewed education website**

**Stage:** S5 · **Responsible role:** Content/frontend · **Work packages:** E15, E37

**Depends on:** [P1-PR-032](phase-1-prs.md#p1-pr-032), [P1-PR-031](phase-1-prs.md#p1-pr-031)

**Trace:** CAP-02, UC10, UC17, AT16, AT27. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build role-scoped draft/review/publish/rollback screens and safe redirect controls.
- [ ] Publish 25 reviewed glossary articles plus hub/decoder/checklist/methodology/trust/support pages with sources and review dates.
- [ ] Render metadata, canonical/hreflang where applicable, JSON-LD, sitemaps and Search Console verification; exclude private pages.

**Verification and acceptance:** Editorial roles, publish propagation, public crawl/index contracts, accessibility and useful script-free content pass.

### P1-PR-039

**Build staff operations, SEO and ad-revenue screens**

**Stage:** S5 · **Responsible role:** Frontend/backend · **Work packages:** E17, E37, E38

**Depends on:** [P1-PR-032](phase-1-prs.md#p1-pr-032), [P1-PR-031](phase-1-prs.md#p1-pr-031)

**Trace:** CAP-02, CAP-03, UC09, UC13, UC17. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build masked report/send/privacy/import-health queues and audited recovery/config actions.
- [ ] Build source coverage/freshness, SEO findings/strategic register, aggregate analytics and ad revenue status.
- [ ] Show missing integrations explicitly; keep partner/mobile/audience and P2 CSV modules inactive.

**Verification and acceptance:** Role/masking/browser tests and failed/retry states pass; staff cannot bypass ingestion or permission services.

### P1-PR-040

**Build permitted affiliate and advertising placements**

**Stage:** S5 · **Responsible role:** Frontend/commercial · **Work packages:** E18, E38

**Depends on:** [P1-PR-032](phase-1-prs.md#p1-pr-032), [P1-PR-034](phase-1-prs.md#p1-pr-034), [P1-PR-038](phase-1-prs.md#p1-pr-038), [P1-PR-039](phase-1-prs.md#p1-pr-039), [P1-PR-031](phase-1-prs.md#p1-pr-031)

**Trace:** CAP-03, UC17, AT03, AT11, AT27. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Render approved affiliate links/disclosures and manual allowlisted education/results inventory.
- [ ] Reserve responsive slot space, labels and lazy loading; default private results to house content and keep home/forms/compare/email ad-free.
- [ ] Wire CMP/default-off/no-fill/blocked-script fallbacks and network readiness without automatic placement expansion.

**Verification and acceptance:** Consent-state/browser network checks, ads.txt, density/CLS budgets and unchanged ranking pass; live ad approval recorded separately.

### P1-PR-041

**Verify the full web product and accessibility journeys**

**Stage:** S6 · **Responsible role:** QA/product · **Work packages:** E19

**Depends on:** [P1-PR-032](phase-1-prs.md#p1-pr-032), [P1-PR-033](phase-1-prs.md#p1-pr-033), [P1-PR-034](phase-1-prs.md#p1-pr-034), [P1-PR-035](phase-1-prs.md#p1-pr-035), [P1-PR-036](phase-1-prs.md#p1-pr-036), [P1-PR-037](phase-1-prs.md#p1-pr-037), [P1-PR-038](phase-1-prs.md#p1-pr-038), [P1-PR-039](phase-1-prs.md#p1-pr-039), [P1-PR-040](phase-1-prs.md#p1-pr-040)

**Trace:** CAP-01, UC01, UC02, UC03, UC04, UC05, UC06, UC07, UC08, UC09, UC10, UC13, UC17, AT18. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run core browser → API → database → email/PDF journeys with real templates and supported data.
- [ ] Complete keyboard/screen-reader/reflow/email-client checks and beta regression triage.
- [ ] Verify public SEO/ad fallbacks, editorial content completeness and unsupported-input recovery.

**Verification and acceptance:** G3 experience evidence and relevant AT suite pass; no critical placeholders or inaccessible required journey.

### P1-PR-042

**Prove production security, capacity and recovery**

**Stage:** S6 · **Responsible role:** Platform/QA · **Work packages:** E19

**Depends on:** [P1-PR-041](phase-1-prs.md#p1-pr-041), [P1-PR-032](phase-1-prs.md#p1-pr-032), [P1-PR-033](phase-1-prs.md#p1-pr-033), [P1-PR-034](phase-1-prs.md#p1-pr-034), [P1-PR-035](phase-1-prs.md#p1-pr-035), [P1-PR-036](phase-1-prs.md#p1-pr-036), [P1-PR-037](phase-1-prs.md#p1-pr-037), [P1-PR-038](phase-1-prs.md#p1-pr-038), [P1-PR-039](phase-1-prs.md#p1-pr-039), [P1-PR-040](phase-1-prs.md#p1-pr-040)

**Trace:** NFR-01, NFR-03, NFR-04, NFR-05, NFR-06, DB28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run permission/token leak/security checks and realistic report plus analytics/import/limit/ads mixed load.
- [ ] Demonstrate container/proxy resource budgets, alerts, bounded costs, backup restore and deletion replay; rehearse readiness/drain, image rollback and cross-replica public-cache invalidation.
- [ ] Complete incident/runbook, support, secrets/rollback/kill-switch and privacy deadline handover.

**Verification and acceptance:** G2/G4 evidence meets approved targets with recorded measurements; no unsafe recommendations, high security defects or failed recovery.

### P1-PR-043

**Release Phase 1 and record the usable live outcome**

**Stage:** S6 · **Responsible role:** Product/platform · **Work packages:** E20

**Depends on:** [P1-PR-041](phase-1-prs.md#p1-pr-041), [P1-PR-042](phase-1-prs.md#p1-pr-042), [P1-PR-032](phase-1-prs.md#p1-pr-032), [P1-PR-033](phase-1-prs.md#p1-pr-033), [P1-PR-034](phase-1-prs.md#p1-pr-034), [P1-PR-035](phase-1-prs.md#p1-pr-035), [P1-PR-036](phase-1-prs.md#p1-pr-036), [P1-PR-037](phase-1-prs.md#p1-pr-037), [P1-PR-038](phase-1-prs.md#p1-pr-038), [P1-PR-039](phase-1-prs.md#p1-pr-039), [P1-PR-040](phase-1-prs.md#p1-pr-040)

**Trace:** CAP-01, UC18, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Complete owner G5 decision, release manifest, compatible migrations and controlled production activation.
- [ ] Run permitted production smoke for supported/unsupported assessments and optional delivery; verify operations/support ownership.
- [ ] Record production URL, release SHA, post-launch observations and separate pending ad approvals; keep phase open for failed committed scope.

**Verification and acceptance:** A supported driver completes the live journey and operations can import/rollback/recover; release evidence links close P1, not merely PR merge.
