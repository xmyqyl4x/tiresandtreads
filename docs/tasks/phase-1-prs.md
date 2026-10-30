# Phase 1 — live US tire-advice website

**Working PR decomposition 1.0 · October 23, 2026.** 43 planned PRs. Scope comes from the approved [four-phase baseline](../12-live-product-phases-and-gap-review.md); this breakdown adds execution detail without approving new capabilities. P1-PR-001/002/003 are accepted; P1-PR-004 database foundations are accepted; P1-PR-005 domain/catalog/import schemas are accepted; P1-PR-006 report/consent/delivery/reliability schemas are accepted; P1-PR-007 CMS/SEO/ads/analytics/quota schemas are accepted; P1-PR-008 S1 validation and recovery proofs are accepted; P1-PR-009 entities and transaction helpers are accepted; P1-PR-010 catalog and ingestion repositories are accepted; P1-PR-011 owner/report/privacy/delivery repositories are accepted; P1-PR-012 content/operations/analytics/limiter adapters are accepted; P1-PR-013 S2 validation is accepted; P1-PR-014 runtime/jobs/assets is accepted; P1-PR-015 ingestion/publication services is accepted; P1-PR-016 source adapters is in progress. The [master task list](../15-project-task-list.md) is the authoritative status/assignee/PR/evidence ledger.

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

**Verification and acceptance:** [Implementation packet](../implementation/P1-PR-007-cms-seo-ads-analytics-schemas.md) and [validation evidence](../implementation/evidence/P1/p1-pr-007-validation.md). Real PostgreSQL and Payload tests preserve CMS isolation, draft/version/publication transactions, public-only SEO/ad dimensions, provider-report correction semantics, privacy generation hiding and concurrent quota bounds. [PR #7](https://github.com/xmyqyl4x/tiresandtreads/pull/7) was owner-approved and merged at `ad3822a`.

### P1-PR-008

**Close database gate with migration and recovery evidence**

**Stage:** S1 · **Responsible role:** Backend/QA · **Work packages:** E04, E19

**Depends on:** [P1-PR-004](phase-1-prs.md#p1-pr-004), [P1-PR-005](phase-1-prs.md#p1-pr-005), [P1-PR-006](phase-1-prs.md#p1-pr-006), [P1-PR-007](phase-1-prs.md#p1-pr-007), [P1-PR-003](phase-1-prs.md#p1-pr-003)

**Trace:** ENG-03, DB13, DB28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Run empty and representative upgrade migrations against real runtime roles.
- [x] Verify required P1 constraints/indexes, retention deletion order and separate CMS recovery boundaries.
- [x] Perform initial restore/deletion-marker replay drill; record schema inventory, versions, failures and S1 decision.

**Verification and acceptance:** [Implementation packet](../implementation/P1-PR-008-database-validation-recovery.md) and [validation evidence](../implementation/evidence/P1/p1-pr-008-validation.md) account for all P1 storage invariants, repeatable migrations, complete inventory and independent app/CMS recovery. [PR #8](https://github.com/xmyqyl4x/tiresandtreads/pull/8) was owner-approved and merged at `beccd8e`. The local S1 database gate is accepted; hosted RPO/RTO and later service/use-case gates remain open.

### P1-PR-009

**Define domain entities, value objects and repository contracts**

**Stage:** S2 · **Responsible role:** Backend · **Work packages:** E04

**Depends on:** [P1-PR-008](phase-1-prs.md#p1-pr-008)

**Trace:** ENG-04, ENG-05. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Define pure tire/unit/money/unknown/provenance, report/consent and import entity/value interfaces.
- [x] Define narrow repository/query/provider ports and explicit transaction context without ORM leakage.
- [x] Create storage-row/domain/wire mapping rules and schema-version/error contracts.

**Verification and acceptance:** [Implementation packet](../implementation/P1-PR-009-entities-transactions.md) and [validation evidence](../implementation/evidence/P1/p1-pr-009-validation.md). Strict type/import checks, exact value/unknown mapping and real restricted-role transaction commit/rollback/timeout/concurrency tests pass. [PR #9](https://github.com/xmyqyl4x/tiresandtreads/pull/9) was owner-approved and merged at `7ac3ed2`.

### P1-PR-010

**Implement catalog and ingestion repositories**

**Stage:** S2 · **Responsible role:** Data/backend · **Work packages:** E04, E05, E35, E36

**Depends on:** [P1-PR-009](phase-1-prs.md#p1-pr-009), [P1-PR-008](phase-1-prs.md#p1-pr-008)

**Trace:** DB14, DB21, DB22. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement source/reference/fitment/SKU/evidence/recall repositories and pinned lookup read models.
- [x] Implement bounded staging/batch/checkpoint, coherent publication/head compare-and-set and source reverse indexes.
- [x] Add parameterized queries, keyset pagination and explicit license/coverage projections.

**Verification and acceptance:** [Implementation packet](../implementation/P1-PR-010-catalog-ingestion.md) and [validation evidence](../implementation/evidence/P1/p1-pr-010-validation.md). Real PostgreSQL tests cover all 25 fact families, restricted capabilities, partial publication, fenced/resumed imports, head contention and pinned keyset reads. Synthetic query-plan/memory evidence records workload and limits. [PR #10](https://github.com/xmyqyl4x/tiresandtreads/pull/10) was owner-approved and merged at `18a264a`.

### P1-PR-011

**Implement owner, report, privacy and delivery repositories**

**Stage:** S2 · **Responsible role:** Backend · **Work packages:** E04, E08, E10, E11, E12, E14

**Depends on:** [P1-PR-009](phase-1-prs.md#p1-pr-009), [P1-PR-010](phase-1-prs.md#p1-pr-010), [P1-PR-008](phase-1-prs.md#p1-pr-008)

**Trace:** DB01, DB03, DB04, DB07, DB12, DB15. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement scoped report/draft/compare/capability and contact/permission repositories with explicit mappers.
- [x] Implement send/attempt/outbox/inbox and privacy/deletion graph persistence on one transaction client.
- [x] Add revision checks, lock ordering, key rotation lookup and asset-grant projections.

**Verification and acceptance:** [Implementation packet](../implementation/P1-PR-011-owner-report-delivery.md) and [validation evidence](../implementation/evidence/P1/p1-pr-011-validation.md). Real PostgreSQL tests cover scoped ownership/capabilities, immutable versions, exact money, identity rotation, consent revisions, delivery contention, transactional rollback and fenced reliability records. [PR #11](https://github.com/xmyqyl4x/tiresandtreads/pull/11) was owner-approved and merged at `e94c7cd`.

### P1-PR-012

**Implement content, operations, analytics and limiter adapters**

**Stage:** S2 · **Responsible role:** Backend/platform · **Work packages:** E04, E15, E16, E17, E18, E37, E38

**Depends on:** [P1-PR-009](phase-1-prs.md#p1-pr-009), [P1-PR-010](phase-1-prs.md#p1-pr-010), [P1-PR-011](phase-1-prs.md#p1-pr-011), [P1-PR-008](phase-1-prs.md#p1-pr-008)

**Trace:** DB16, DB17, DB18, DB19, DB27. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement published-content bridge repositories, portable SQL/S3 public-config read adapters and safe staff/config/commercial projections.
- [x] Implement SQL event receipt, dirty-day generation, quota upserts and cleanup repositories.
- [x] Implement SEO/search/ad report projections with missing-versus-zero semantics and superseded-revision exclusion.

**Verification and acceptance:** [Implementation packet](../implementation/P1-PR-012-content-operations-analytics.md) and [validation evidence](../implementation/evidence/P1/p1-pr-012-validation.md). Real PostgreSQL permission/generation/quota contention, publication/cleanup and reporting cases pass; bounded configuration failure and indexed SEO pagination are proved. [PR #12](https://github.com/xmyqyl4x/tiresandtreads/pull/12) was owner-approved and merged at `4a37b95`.

### P1-PR-013

**Close entities and data-access gate**

**Stage:** S2 · **Responsible role:** Backend/QA · **Work packages:** E04

**Depends on:** [P1-PR-009](phase-1-prs.md#p1-pr-009), [P1-PR-010](phase-1-prs.md#p1-pr-010), [P1-PR-011](phase-1-prs.md#p1-pr-011), [P1-PR-012](phase-1-prs.md#p1-pr-012), [P1-PR-008](phase-1-prs.md#p1-pr-008)

**Trace:** ENG-03, ENG-04, ENG-05. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Review every P1 entity/row/DTO mapper and repository interface against the accepted schema.
- [x] Run real transaction/ownership/pool/query suites and dependency lint rules.
- [x] Publish S2 evidence and revised effort/critical-path forecast; assign any required schema corrections before services start.

**Verification and acceptance:** [Gate packet](../implementation/P1-PR-013-s2-data-access-gate.md), [audit](../implementation/P1-PR-013-s2-contract-audit.md), [forecast](../implementation/P1-PR-013-s2-forecast.md) and [validation](../implementation/evidence/P1/p1-pr-013-validation.md). Complete live-schema/model/codec, real transaction/pool/owner/query and dependency checks are included. [PR #13](https://github.com/xmyqyl4x/tiresandtreads/pull/13) was owner-approved and merged at `b3286d0`; S2 is accepted.

### P1-PR-014

**Implement durable jobs, private assets and runtime composition**

**Stage:** S3 · **Responsible role:** Platform/backend · **Work packages:** E02, E12, E13, E14

**Depends on:** [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** DB08, DB15. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Compose narrow runtime credentials, clocks, repositories and provider ports; add bounded container pools, graceful shutdown and host-neutral deployment metadata.
- [x] Implement outbox relay/Inngest retry/lease/reconciliation and private S3 asset lifecycle/encryption adapters.
- [x] Add redacted operational telemetry, job deadlines, retry limits and failure queues.

**Verification and acceptance:** [Implementation](../implementation/P1-PR-014-jobs-assets-runtime.md) and [validation](../implementation/evidence/P1/p1-pr-014-validation.md) cover local crash/replay/late-worker, revoked-asset, real SDK/dev-server and bounded worker/pool tests. [PR #14](https://github.com/xmyqyl4x/tiresandtreads/pull/14) was owner-approved and merged at `969235f`; the original DD03/DD05 hosted provider proofs remain pending for full adapter acceptance. No exactly-once external effect or live product claim.

### P1-PR-015

**Implement script-first ingestion and publication services**

**Stage:** S3 · **Responsible role:** Data/backend · **Work packages:** E05, E36

**Depends on:** [P1-PR-014](phase-1-prs.md#p1-pr-014), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** CAP-04, UC13, AT22, DB22. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement fetch registration, streaming stage/normalize/validate/diff and critical rejection policy.
- [x] Add planned CLI commands for dry-run, publish, resume, status and safe rollback through shared services.
- [x] Publish coherent bundles with expected-head concurrency and outbox invalidation; enforce source rights and complete-snapshot semantics.

**Verification and acceptance:** [Implementation](../implementation/P1-PR-015-ingestion-publication-services.md) and [validation](../implementation/evidence/P1/p1-pr-015-validation.md) record 310 passing tests, including real PostgreSQL/process CLI proofs for truncated snapshots, duplicates, resumes, expected-head races, rights expiry and rollback that cannot erase a newer recall warning. [PR #15](https://github.com/xmyqyl4x/tiresandtreads/pull/15) was owner-approved and merged at `5504a4a`. Source-specific provider contracts remain 016.

### P1-PR-016

**Integrate NHTSA and licensed domain source adapters**

**Stage:** S3 · **Responsible role:** Data · **Work packages:** E01, E05, E35

**Depends on:** [P1-PR-015](phase-1-prs.md#p1-pr-015), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** CAP-04, UC01, UC13, AT17, AT21, DB21. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement official vehicle/manufacturer/plant/recall and selected licensed catalog/fitment/price/climate connectors.
- [ ] Normalize units, retain unresolved recall targets, validate source schemas and reviewed cross-source mappings.
- [x] Schedule bounded refresh/reconciliation, record no-change success and alert on coverage/freshness/rights failures.

**Verification and acceptance:** DD01/DD02 rights and source contracts resolved for each accepted connector; recorded source-contract fixtures and permitted live compatibility checks. vPIC identity never asserts fitment; stale recall issuance is blocked. Synthetic tests cannot accept an unselected licensed connector. [Implementation](../implementation/P1-PR-016-domain-source-adapters.md) records the NHTSA/shared-infrastructure work, read-only compatibility observations and open acceptance gates. PR #16 was owner-approved and merged at `a774e1f`; the owner authorized 017 while retaining the licensed-adapter deferral. The card remains in progress: licensed providers/contracts, public-source rights review and the future issuance-service integration are not accepted by synthetic tests or this PR. The owner directed that licensed adapters remain pending while the NHTSA/shared portion proceeds; [validation](../implementation/evidence/P1/p1-pr-016-validation.md) records the completed checks for that portion.

### P1-PR-017

**Implement deterministic eligibility and recommendation rules**

**Stage:** S3 · **Responsible role:** Data/backend · **Work packages:** E06

**Depends on:** [P1-PR-016](phase-1-prs.md#p1-pr-016), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC01, UC02, AT01, AT02, AT03, AT17. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement input normalization, wheel/axle fitment, load/speed, seasonal, replacement/AWD and recall eligibility.
- [x] Implement evidence-backed preference ordering, unknowns, stable tie-breaks, exclusions and reason codes.
- [ ] Build at least 50 specialist-reviewed golden scenarios and property tests; exclude all paid terms from engine inputs.

**Technical implementation approved and merged:** [PR #17](https://github.com/xmyqyl4x/tiresandtreads/pull/17) at `89a4a098bd80796bff4b293497410118f36e8fcd`. Specialist review and licensed adapters remain pending by owner direction.

**Verification and acceptance:** [Implementation](../implementation/P1-PR-017-eligibility-recommendations.md) and [98-case draft specialist packet](../implementation/evidence/P1/p1-pr-017-golden-review.json) cover deterministic rules, sparse evidence, stable ordering, bounded portfolios and commercial invariance. The third task stays unchecked: actual named specialist review and G1 acceptance remain pending DD06, along with real source/data and 019 resolver/report integration evidence. The technical implementation cannot establish production fitment coverage or issuance authority.

**Owner direction, October 25, 2026:** Keep specialist review pending and proceed with implementation and draft scenarios. The 98-case packet remains draft; this direction does not close the third task or G1. Licensed adapters remain pending.

### P1-PR-018

**Implement prices, installed costs and comparison mathematics**

**Stage:** S3 · **Responsible role:** Backend/data · **Work packages:** E06, E10

**Depends on:** [P1-PR-017](phase-1-prs.md#p1-pr-017), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC02, UC04, AT05, AT20. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement unit/currency/quantity/installed-component normalization and comparable price bases.
- [x] Implement scenario, winter-share and cost-per-distance calculations only with supported assumptions/evidence.
- [x] Qualify unknown quote products and missing prices/warranty/lifespan evidence without invented precision.

**Technical implementation approved and merged:** [PR #18](https://github.com/xmyqyl4x/tiresandtreads/pull/18) at `752760736ecc9ab70186503bf27cd942768f7e83`. The owner authorized 019 while retaining specialist review and licensed adapters as pending.

**Verification and acceptance:** [Implementation](../implementation/P1-PR-018-pricing-comparison.md) and [validation](../implementation/evidence/P1/p1-pr-018-validation.md) cover exact money/units, explicit quantities and service/tax bases, freshness, private quote authorization boundaries, unknown products, scenario allocation/replacements, outward cost-per-distance bounds and deterministic comparisons. Technical math tasks are implemented; the full card remains **In progress** pending actual specialist approval of explanations and licensed/source/tax/life evidence. The owner explicitly retained specialist review and licensed adapters as pending when authorizing 018. No production resolver, price coverage or live release is accepted.

### P1-PR-019

**Implement report, refine, compare and access services**

**Stage:** S3 · **Responsible role:** Backend · **Work packages:** E08, E10

**Depends on:** [P1-PR-017](phase-1-prs.md#p1-pr-017), [P1-PR-018](phase-1-prs.md#p1-pr-018), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC01, UC03, UC04, UC05, AT04, AT06, DB01, DB02, DB03, DB15. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement report snapshots pinned to engine/rule/data versions and current safety overlay.
- [x] Implement draft revision, refine/new-version diff, four-item comparison and shop-quote use cases.
- [x] Implement owner/read-only share/revoke/fork/PDF authorization and private DTOs; persist idempotent outcomes.

**Verification and acceptance:** [Implementation](../implementation/P1-PR-019-report-services.md) and [validation](../implementation/evidence/P1/p1-pr-019-validation.md) cover pinned immutable snapshots and current recall overlays, drafts/refine diffs, four-item comparisons, encrypted private quotes, owner/view/fork/revoke/PDF scope, safe exact-version command receipts and real transaction/race/rollback proofs. Technical workflows are implemented; the full card remains **In progress** for actual source/policy/clearance/inspection coverage and specialist acceptance under the owner-directed deferrals. All results remain technical evaluations with issuance disabled; HTTP, renderer, privacy-job and live release gates remain separate.

**Technical implementation approved and merged:** [PR #19](https://github.com/xmyqyl4x/tiresandtreads/pull/19) at `2bacfc78c60a86e6d49eed372ccd5c6b6fd7b714`. The owner authorized 020 while retaining specialist review and licensed adapters as pending.

### P1-PR-020

**Implement contact, consent and suppression services**

**Stage:** S3 · **Responsible role:** Backend/privacy · **Work packages:** E11

**Depends on:** [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC06, UC08, AT10, AT11, AT19, DB07. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement report-only/offers-only contact flows, address verification and independent purpose events.
- [x] Implement restrictive default/GPC/CMP server policy and current-purpose projections.
- [x] Implement suppression, double opt-in, lookup-key rotation and permission rechecks for queued operations.

**Verification and acceptance:** Unit/use-case/real DB tests cover forged grants, withdraw/grant races, hard-bounce suppression and no email-gated assessment.

**Implementation status:** S3 technical implementation accepted after owner approval and [PR #20](https://github.com/xmyqyl4x/tiresandtreads/pull/20) merge `2de57d88`; [service contract](../implementation/P1-PR-020-contact-consent.md) and [validation](../implementation/evidence/P1/p1-pr-020-validation.md). Public transports, actual sender/notice review and physical privacy-job fulfillment remain at their planned cards. Specialist review and licensed adapters remain pending independently.

### P1-PR-021

**Implement content, public tools and SEO publication services**

**Stage:** S3 · **Responsible role:** Content/backend · **Work packages:** E15, E37

**Depends on:** [P1-PR-014](phase-1-prs.md#p1-pr-014), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** CAP-02, UC10, UC17, AT16, AT27, DB16, DB27. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement reviewed CMS publication bridge, learning-link selection, glossary and pure decoder/checklist behavior.
- [x] Implement portable SQL/S3 public-config and safe redirect publication with revision, expiry and cross-replica invalidation; public page registry, metadata/sitemap/structured-data policies and private exclusion.
- [x] Add bounded crawl audits, Search Console/IndexNow adapters and aggregate metrics where authorized; expose missing data honestly.

**Verification and acceptance:** Role/publication retry tests and headless SEO/tool contracts; publication reaches all replicas within 60 seconds, out-of-order updates are rejected and expired safety/privacy configuration fails closed; unsafe redirects and private indexing rejected.

**Implementation status:** S3 technical implementation approved and merged in [PR #21](https://github.com/xmyqyl4x/tiresandtreads/pull/21) at `c7595c59`; [contract](../implementation/P1-PR-021-content-seo.md) and [validation](../implementation/evidence/P1/p1-pr-021-validation.md). Real editorial/provider property/key-file verification, worker/CDN propagation and API/browser/live acceptance remain at their declared gates. Specialist review and licensed adapters remain pending independently.

### P1-PR-022

**Implement report delivery orchestration and cancellation**

**Stage:** S3 · **Responsible role:** Backend · **Work packages:** E12

**Depends on:** [P1-PR-014](phase-1-prs.md#p1-pr-014), [P1-PR-019](phase-1-prs.md#p1-pr-019), [P1-PR-020](phase-1-prs.md#p1-pr-020), [P1-PR-021](phase-1-prs.md#p1-pr-021), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC06, UC07, AT07, AT08, AT19, DB04, DB05. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Freeze report/comparison/template/content selection and implement render ports with labeled fixtures.
- [x] Implement scheduled send identity, 60-second cancellation, dispatch claim and final permission recheck.
- [x] Integrate Resend/private-PDF adapters, uncertain handoff reconciliation and retry limits without actual product templates.

**Verification and acceptance:** Two-connection cancel/claim races and accepted-timeout provider tests; headless rendering uses fixtures until S5.

**Implementation status:** S3 technical implementation approved and merged in [PR #22](https://github.com/xmyqyl4x/tiresandtreads/pull/22) at `5e6d4cd4`; [contract](../implementation/P1-PR-022-delivery-orchestration.md) and [validation](../implementation/evidence/P1/p1-pr-022-validation.md). Current production report issuance remains denied. Actual templates, signed provider events, worker cadence, abuse controls and API/browser/live acceptance retain their declared gates. Specialist review and licensed adapters remain pending.

### P1-PR-023

**Implement webhooks, preferences, feedback and safe redirects**

**Stage:** S3 · **Responsible role:** Backend · **Work packages:** E13

**Depends on:** [P1-PR-022](phase-1-prs.md#p1-pr-022), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC07, AT08, AT12, AT13, DB06. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Verify and durably deduplicate provider callbacks, including reordered/delayed observations.
- [x] Implement preference/unsubscribe/feedback state transitions and fixed-destination tracked links.
- [x] Classify scanner/bot activity, reconcile uncertain sends and expose operator recovery commands.

**Verification and acceptance:** Functional service tests prove no state-changing scanner GET, correct one-click unsubscribe and no duplicate delivery metrics.

**Implementation status:** S3 implementation approved and merged in [PR #23](https://github.com/xmyqyl4x/tiresandtreads/pull/23) at `c71df714`; [contract](../implementation/P1-PR-023-mail-events-actions.md) and [validation](../implementation/evidence/P1/p1-pr-023-validation.md). Signed synthetic callbacks, separate event facts, immediate suppression, POST-only actions, safe reviewed links and operator recovery are implemented. HTTP/browser, scheduled worker, real provider/client and full erasure acceptance retain their later gates. Specialist review and licensed adapters remain pending.

### P1-PR-024

**Implement PostgreSQL analytics, SQL limits and operations**

**Stage:** S3 · **Responsible role:** Platform/backend · **Work packages:** E16

**Depends on:** [P1-PR-014](phase-1-prs.md#p1-pr-014), [P1-PR-020](phase-1-prs.md#p1-pr-020), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC08, UC09, AT11, DB17, DB18, DB19, DB20. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement allowlisted consent-aware intake, idempotent aggregation and privacy generation invalidation.
- [x] Implement SQL admission quotas, bounded cleanup, operational dashboards and separate report/worker pool budgets.
- [x] Profile repeated computation; document no-cache decision or implement DB20 only with measured parity/privacy benefit.

**Verification and acceptance:** Real race/load/expiry tests prove quota bounds and no deleted data in rebuilt aggregates; optional cache has evidence or remains absent.

**Implementation status:** S3 implementation approved and merged in [PR #24](https://github.com/xmyqyl4x/tiresandtreads/pull/24) at `4ba7b446`; [contract](../implementation/P1-PR-024-analytics-limits-operations.md) and [validation](../implementation/evidence/P1/p1-pr-024-validation.md). Signed consent-aware intake, fenced aggregates, privacy expiry/replay barriers, capped SQL quotas, operations read models and separate workload pools are implemented. DB20 remains conditional with no computation cache after synthetic profiling. HTTP/client, scheduled worker, full privacy fulfillment and hosted capacity retain their later gates. Specialist review and licensed adapters remain pending.

### P1-PR-025

**Implement privacy rights, retention and recovery services**

**Stage:** S3 · **Responsible role:** Backend/privacy · **Work packages:** E14

**Depends on:** [P1-PR-014](phase-1-prs.md#p1-pr-014), [P1-PR-019](phase-1-prs.md#p1-pr-019), [P1-PR-020](phase-1-prs.md#p1-pr-020), [P1-PR-023](phase-1-prs.md#p1-pr-023), [P1-PR-024](phase-1-prs.md#p1-pr-024), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC09, AT14, DB13, DB18. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement proportionate rights verification, current suppression/revocation and deadline-driven fulfillment.
- [x] Build idempotent SQL/object/email/analytics deletion graph, retention sweeps and minimal audit evidence.
- [x] Implement restore/import/outbox replay barriers and operator escalation for incomplete downstream deletion.

**Verification and acceptance:** Deletion while processing and restored-backup use cases pass; revoked shares/assets cannot be recovered by stale caches or jobs.

**Implementation status:** Owner-approved [PR #25](https://github.com/xmyqyl4x/tiresandtreads/pull/25), merged `7aa1b542`; [contract](../implementation/P1-PR-025-privacy-retention-recovery.md) and [validation](../implementation/evidence/P1/p1-pr-025-validation.md). Separate privacy authority, owner/email proofs, immediate restriction, durable journal acknowledgment, fenced SQL/email/object/analytics erasure, late-renderer barriers, dry-run retention and authenticated restore replay are implemented. Access/export/correction use audited actual operator fulfillment. Production jurisdiction/provider/journal durability, HTTP/UI and scheduled-host evidence retain their gates. Specialist review and licensed adapters remain pending.

### P1-PR-026

**Implement staff, affiliate, advertising and revenue services**

**Stage:** S3 · **Responsible role:** Backend/commercial · **Work packages:** E17, E18, E38

**Depends on:** [P1-PR-016](phase-1-prs.md#p1-pr-016), [P1-PR-021](phase-1-prs.md#p1-pr-021), [P1-PR-023](phase-1-prs.md#p1-pr-023), [P1-PR-024](phase-1-prs.md#p1-pr-024), [P1-PR-025](phase-1-prs.md#p1-pr-025), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** CAP-03, UC17, AT03, AT27, DB27. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement role-scoped staff queues, masked queries, audited configuration and recovery commands.
- [x] Implement approved affiliate destinations, ad route/slot/consent/brand policy, ads.txt and house fallback configuration.
- [x] Import/reconcile aggregate ad reports, source revisions and currencies; expose fill/revenue/consent/latency status without private joins.

**Verification and acceptance:** Role and financial-correction tests; private/form placements rejected and ad configuration leaves tire ranking unchanged.

**Implementation status:** Owner-approved [PR #26](https://github.com/xmyqyl4x/tiresandtreads/pull/26), merged `ac258ac7`; [contract](../implementation/P1-PR-026-staff-commerce-revenue.md), [validation](../implementation/evidence/P1/p1-pr-026-validation.md). Current-role masked queues, audited fenced recovery, independent commercial review, checked destinations, deny-first placement/house policy and immutable correction-aware aggregate imports are implemented. Network/affiliate approvals, live adapters, staff MFA/HTTP/UI and rendered privacy/performance retain their gates. Specialist review and licensed adapters remain pending.

### P1-PR-027

**Close business-service gate and engine safety review**

**Stage:** S3 · **Responsible role:** Backend/data/QA · **Work packages:** E05, E06, E08, E10, E11, E12, E13, E14, E15, E16, E17, E18, E35, E36, E37, E38

**Depends on:** [P1-PR-014](phase-1-prs.md#p1-pr-014), [P1-PR-015](phase-1-prs.md#p1-pr-015), [P1-PR-016](phase-1-prs.md#p1-pr-016), [P1-PR-017](phase-1-prs.md#p1-pr-017), [P1-PR-018](phase-1-prs.md#p1-pr-018), [P1-PR-019](phase-1-prs.md#p1-pr-019), [P1-PR-020](phase-1-prs.md#p1-pr-020), [P1-PR-021](phase-1-prs.md#p1-pr-021), [P1-PR-022](phase-1-prs.md#p1-pr-022), [P1-PR-023](phase-1-prs.md#p1-pr-023), [P1-PR-024](phase-1-prs.md#p1-pr-024), [P1-PR-025](phase-1-prs.md#p1-pr-025), [P1-PR-026](phase-1-prs.md#p1-pr-026), [P1-PR-013](phase-1-prs.md#p1-pr-013)

**Trace:** UC01, UC02, UC03, UC04, UC05, UC06, UC07, UC08, UC09, UC10, UC13, UC17. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run P1 headless service journeys with real repositories and required provider sandbox evidence.
- [ ] Approve golden tire cases, source coverage, backend permission and adverse-path evidence at G1/G2.
- [ ] Publish service inventory and S3 closure; record actual-render/UI evidence outstanding for S5.

**Verification and acceptance:** All committed P1 services accepted before endpoint implementation; fixtures are explicitly identified and cannot close UI/render gates.

**Implementation status:** Technical fixes/validation owner-approved and merged as [PR #27](https://github.com/xmyqyl4x/tiresandtreads/pull/27), `026a14c7`; [local service-host/budget continuation](../implementation/P1-PR-027-local-service-host.md) approved and merged as [PR #28](https://github.com/xmyqyl4x/tiresandtreads/pull/28), `7c86af95`; [retained dev/stage workflow continuation](../implementation/P1-PR-027-persistent-local-workflows.md) approved and merged as [PR #29](https://github.com/xmyqyl4x/tiresandtreads/pull/29), `92aa5d77`; [provider cold-restart/SQL replay continuation](../implementation/P1-PR-027-provider-recovery-replay.md) approved and merged as [PR #30](https://github.com/xmyqyl4x/tiresandtreads/pull/30), `b02335bc`; [local observability/response continuation](../implementation/P1-PR-027-local-observability.md) approved and merged as [PR #31](https://github.com/xmyqyl4x/tiresandtreads/pull/31), `9d7006f7`; [final local readiness/evidence reconciliation](../implementation/P1-PR-027-final-local-readiness.md) accepted and merged as [PR #32](https://github.com/xmyqyl4x/tiresandtreads/pull/32), `7f2476e`; [private hosted staging decision packet](../implementation/P1-PR-027-private-hosted-staging-decision.md) approved and merged as [PR #33](https://github.com/xmyqyl4x/tiresandtreads/pull/33), `7d0849b7`; [SP01–SP02 local-only TLS/ownership preflight](../implementation/P1-PR-027-local-hosted-preflight.md) approved and merged as [PR #34](https://github.com/xmyqyl4x/tiresandtreads/pull/34), `1f1db236`; [SP03 local-only provider preflight](../implementation/P1-PR-027-local-provider-preflight.md) approved and merged as [PR #35](https://github.com/xmyqyl4x/tiresandtreads/pull/35), `9529a3f8`; [SP04 local-only custody/recovery preflight](../implementation/P1-PR-027-local-custody-preflight.md) approved and merged as [PR #36](https://github.com/xmyqyl4x/tiresandtreads/pull/36), `0e521439`; [SP05 local deployment/access/rollback preflight](../implementation/P1-PR-027-local-deployment-preflight.md) approved in merged PR #37 (`3e86d3e5`); [SP06 local capacity/lifecycle preflight](../implementation/P1-PR-027-local-capacity-preflight.md) approved in merged PR #38 (`fa25c6b7`); [SP07 local observation/response preflight](../implementation/P1-PR-027-local-observation-preflight.md) approved in merged PR #39 (`9d314d00`); [SP08 local evidence handoff](../implementation/P1-PR-027-local-evidence-handoff.md) accepted in merged PR #40 (`8965bd72`) (actual hosted proofs pending; HS01–HS08 proposed). No provisioning/purchases or product API implementation are authorized. [HS05/HS04 operator and budget proposal](../implementation/P1-PR-027-staging-operations-budget.md) is in review; assignments and funding unapproved. Full parent gate remains in progress and APIs remain held by explicit owner direction. [Contract](../implementation/P1-PR-027-s3-validation-gate.md), [gate disposition](../implementation/P1-PR-027-s3-gate-review.md), [service register](../implementation/evidence/P1/s3-service-register.json) and [validation](../implementation/evidence/P1/p1-pr-027-validation.md). Combined service journeys, executable privacy selections, bounded maintenance bindings and masked queue alarms are implemented. Full S3 acceptance is OPEN: 98 draft cases/zero actual specialist reviews; licensed source, affected provider, policy and full host/budget proof remain outstanding. Original completion boxes stay open because they require missing acceptance. P1-PR-028–030 remain held under existing dependencies; no exception to database → repositories → services → APIs → UI is created.

[HS01/HS02 review](../implementation/P1-PR-027-host-database-review.md) follows owner-approved PR #41 (`e37617ca`) definitions only; all HS decisions remain proposed, operators/rates unconfirmed and all six actual gates open. No provisioning/purchases/notifications; specialist/licensed work pending and APIs held.

[Restricted-admin local investigation](../implementation/P1-PR-027-restricted-admin-investigation.md) follows owner-approved PR #42 (`ad9c55a0`) analysis only; 13 local scenarios, unchanged production bootstrap policy. All HS/operator/rate/S3/specialist/licensed/API holds remain; no provisioning/purchases/notifications.

[Bootstrap/provisioning lifecycle contract review](../implementation/P1-PR-027-bootstrap-lifecycle-contract.md) follows approved PR #43 (`f878e8fd`) local investigation only. Proposed separation of setup/validation/migrations/admission/rotation/recovery and 22 future test cases; no implementation or acceptance. All HS/operator/coverage/rate/S3/specialist/licensed/API/frontend holds remain. No provisioning, purchases or notifications.

[Phase-aware disposable lifecycle validation proof](../implementation/P1-PR-027-lifecycle-validation-proof.md) follows approved PR #44 (`d407a86c`) design analysis only; 62 new local cases and three profiles, all code in test support. Production bootstrap/CLI/preflight/policy unchanged; paired receipt/handoff is proposed next. All HS/operator/coverage/rate/S3/specialist/licensed/API/frontend holds remain. No provisioning, purchases or notifications.

[Disposable paired validation and receipt/handoff proof](../implementation/P1-PR-027-paired-lifecycle-handoff-proof.md) follows approved PR #45 (`25b06379`) local phase-aware proof only. 56 new local cases; seven new code files under tests; exact pairs, fresh reads, replay/partial/drift refusal and real one-sided migration commits. Production bootstrap/CLI/preflight/policy and all HS/operator/coverage/rate/S3/specialist/licensed/API/frontend holds unchanged. No provisioning, purchases or notifications.

[Disposable interrupted-executor and cold-restart proof](../implementation/P1-PR-027-interrupted-executor-cold-restart-proof.md) follows approved PR #46 (`b7e15907`) local paired proof only: 50 new local cases, 15 real SIGKILL checkpoints, fresh both-DB evidence after restart, orphan/resume and drift controls. Six new code files under tests; production bootstrap/CLI/preflight/policy and all HS/operator/coverage/rate/S3/specialist/licensed/API/frontend holds unchanged. No provisioning, purchases or notifications.

[Lifecycle evidence reconciliation and remaining-gap review](../implementation/P1-PR-027-lifecycle-evidence-reconciliation.md) follows approved PR #47 (`a4221e63`) local proof only. All 22 original requirements mapped; no new implementation, case completion or gate closure. Earlier actual local restore/signed custody credited separately; lifecycle mutation/coordination/rotation and actual operating acceptance remain open. T07–T09 adverse-case proof proposed next only. All production/HS/operator/coverage/rate/S3/specialist/licensed/API/frontend holds unchanged. No provisioning, purchases or notifications.

[Disposable BLC-T07–T09 catalog adverse-case proof](../implementation/P1-PR-027-catalog-adverse-case-proof.md) follows approved PR #48 (`5ef8d9f2`) reconciliation only: 231 local DB controls, strict observed defect/state/undo assertions and pre-existing probe-role refusal. Three new files under tests; prior reader/proofs and production bootstrap/CLI/preflight/policy unchanged. No full case or gate closure; all HS/operator/coverage/rate/S3/specialist/licensed/API/frontend holds remain. No provisioning, purchases or notifications.

[Local-only provisioning-journal and serialization contract review](../implementation/P1-PR-027-provisioning-journal-serialization-contract.md) follows approved PR #49 (`d26d21f4`) local catalog proof only. BLC-T12/T13/T22 proposed records/outcomes/provenance/coordination limits and 18 future scenarios; documentation only, no implementation or case/gate closure. Production bootstrap/CLI/preflight/policy and all HS/operator/coverage/rate/S3/specialist/licensed/API/frontend holds unchanged. No provisioning, purchases or notifications.

### P1-PR-028

**Expose public lookup and owner assessment APIs**

**Stage:** S4 · **Responsible role:** Backend · **Work packages:** E34

**Depends on:** [P1-PR-027](phase-1-prs.md#p1-pr-027)

**Trace:** UC01, UC03, UC04, UC05, AT01, AT04, AT06. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Expose typed reference/fitment/content-tool and report/refine/compare/quote/share/PDF endpoints.
- [ ] Apply actor/ownership validation, CSRF/Origin, body limits, quotas, idempotency and consistent errors.
- [ ] Publish OpenAPI/client contracts, pagination and source/coverage/freshness fields.

**Verification and acceptance:** Running HTTP tests against real DB cover normal, unknown, denied, duplicate, stale-version and overload paths.

**Readiness:** Held on full S3 acceptance in P1-PR-027; the [gate disposition](../implementation/P1-PR-027-s3-gate-review.md) lists the required evidence. Technical validation/merge alone does not satisfy this dependency.

### P1-PR-029

**Expose consent, privacy, import and staff operations APIs**

**Stage:** S4 · **Responsible role:** Backend · **Work packages:** E34

**Depends on:** [P1-PR-027](phase-1-prs.md#p1-pr-027)

**Trace:** UC06, UC08, UC09, UC10, UC13, UC17. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Expose consent/preferences, delivery/cancel/status and privacy-rights APIs through accepted services.
- [ ] Expose operator import/diff/publish/rollback/status, content publication and staff/SEO/ad metric APIs.
- [ ] Enforce role/MFA/masking, expected revision and audit; keep P2 CSV UI out of P1 scope.

**Verification and acceptance:** Role matrix, no-enumeration, withdrawal, unsafe import command and private-metadata API tests pass.

**Readiness:** Held on full S3 acceptance in P1-PR-027; the [gate disposition](../implementation/P1-PR-027-s3-gate-review.md) lists the required evidence. Technical validation/merge alone does not satisfy this dependency.

### P1-PR-030

**Expose provider callbacks, event intake and workflow endpoints**

**Stage:** S4 · **Responsible role:** Platform/backend · **Work packages:** E34

**Depends on:** [P1-PR-027](phase-1-prs.md#p1-pr-027)

**Trace:** UC07, UC08, AT12, AT13, DB06, DB08, DB17. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Wire signature-verified callbacks, durable job entry points, analytics intake and unsubscribe routes.
- [ ] Enforce commit-before-ack, replay/digest conflict rules and bounded public request behavior.
- [ ] Verify environment secrets, safe log redaction, provider retries and endpoint observability.

**Verification and acceptance:** Running HTTP/provider sandbox tests cover forged/replayed events, committed receipt and uncertain delivery recovery.

**Readiness:** Held on full S3 acceptance in P1-PR-027; the [gate disposition](../implementation/P1-PR-027-s3-gate-review.md) lists the required evidence. Technical validation/merge alone does not satisfy this dependency.

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
