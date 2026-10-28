# Implementation working project task list

**Version 1.1 · October 23, 2026; option-C deployment supplement approved.** This working backlog decomposes the [approved four-phase plan](12-live-product-phases-and-gap-review.md) at commit [3743a11](https://github.com/xmyqyl4x/tiresandtreads/commit/3743a11d6457f418cc3e0a7268aed333b801b160) into **119 planned implementation PRs plus 10 parked optional-capability activation tickets**. P1-PR-001 is accepted after owner approval and merge; P1-PR-002 foundation tooling is accepted; P1-PR-003 local proofs are accepted; P1-PR-004 database foundations are accepted; P1-PR-005 domain/catalog/import schemas are accepted; P1-PR-006 report/consent/delivery/reliability schemas are accepted; P1-PR-007 CMS/SEO/ads/analytics/quota schemas are accepted; P1-PR-008 S1 validation and recovery proofs are accepted; P1-PR-009 entities and transaction helpers are accepted; P1-PR-010 catalog and ingestion repositories are accepted; P1-PR-011 owner/report/privacy/delivery repositories are accepted; P1-PR-012 content/operations/analytics/limiter adapters are accepted; P1-PR-013 S2 validation is accepted; P1-PR-014 runtime/jobs/assets is accepted; P1-PR-015 ingestion/publication services is accepted; P1-PR-016 NHTSA/shared work is accepted with licensed adapters pending; P1-PR-017 deterministic rules is technically approved and merged with specialist/data acceptance pending; P1-PR-018 pricing/comparison mathematics is technically approved and merged with specialist/data acceptance pending; P1-PR-019 report/refine/compare/access services is technically approved and merged with specialist/source acceptance pending; P1-PR-020 contact/consent/suppression services is accepted; P1-PR-021 content/public-tool/SEO services is accepted; P1-PR-022 report delivery/orchestration/cancellation services is accepted and merged in [PR #22](https://github.com/xmyqyl4x/tiresandtreads/pull/22). The approved option-C deployment refinements are incorporated below; product promises, safety/consent rules and live-release approvals remain unchanged.

This file is the authoritative ledger for status, assignee and actual PR/evidence links. Detailed key-task checklists, responsible roles, dependencies and verification criteria live in the four linked phase files. Stable IDs are backlog identifiers; real GitHub PR URLs are added as work opens. [Requirements traceability](05-requirements-traceability.md), [work packages](04-implementation-plan.md), [TDD](08-test-driven-development.md), [database design](09-database-design.md) and [coding standards](10-coding-standards.md) remain authoritative specifications.

**Status:** Approved October 23, 2026; see the [approval record](#approval-record). Approval establishes the implementation working backlog; individual task statuses continue to reflect actual delivery evidence.

## Phase summary

| Phase | Planned PRs | Usable live outcome | Detailed checklist |
| --- | --- | --- | --- |
| P1 | 43 | A driver completes supported assessment, comparison and optional report delivery; staff operates licensed imports, privacy, SEO and ad-ready public education. | [P1 task cards](tasks/phase-1-prs.md) |
| P2 | 27 | The live site supports confirmed photo inputs, grounded AI analysis/reuse, staff CSV publication and 5–10 verified pilot resellers. | [P2 task cards](tasks/phase-2-prs.md) |
| P3 | 25 | A real native app and MCP AI-client integration share authorized web reports, garage/history, basic reminders and privacy controls. | [P3 task cards](tasks/phase-3-prs.md) |
| P4 | 24 | Lifecycle controls, reviewed content/tools, approved commercial operations and operating handover are live, with every committed requirement accounted for. | [P4 task cards](tasks/phase-4-prs.md) |

No deadline or engineering-day estimate is inferred from the number of PRs. Estimate each card when its source contracts and preceding gates are understood; the historical 166–239-day subtotal is not this backlog's forecast. Assign real people at readiness; the roles in task cards are responsibilities, not claims that a team is staffed.

## Working rules

**Owner-directed P1 sequencing update, October 23, 2026:** commercial source providers and hosting budget are deferred until necessary. The [launch baseline](implementation/P1-PR-001-launch-baseline.md) defines blocking triggers. P1-PR-003 accepts the local S0 foundation independently of full G0, permitting synthetic database/repository work. Actual external integrations remain gated at the affected cards, and full G0/chosen-host evidence is required by P1-PR-031. Stable IDs and dependency edges remain; acceptance scope for 001/003 changes explicitly below and in their cards.

1. Pick the earliest dependency-satisfied card, assign its owner/reviewer and estimate, then mark it Ready. Begin with [P1-PR-001](tasks/phase-1-prs.md#p1-pr-001); bootstrap follows in [P1-PR-002](tasks/phase-1-prs.md#p1-pr-002) and provider/S0 acceptance in [P1-PR-003](tasks/phase-1-prs.md#p1-pr-003).
2. Use a branch such as `codex/p1-pr-001-launch-scope` and a PR title such as `[P1-PR-001] Lock launch scope and data rights`. Copy the card's tasks and trace IDs into the [PR template](../.github/pull_request_template.md). Link exact FR/CORE/NFR/ENG/CAP rows before implementation begins.
3. Dependencies mean merged **and accepted with required evidence**. All current-phase database work passes S1 before S2, all repositories pass S2 before S3 services, and every committed API passes S4 before new product screens/templates. Small headless fixtures and content research follow the existing S0 exception. Previous live releases remain supported.
4. Each behavioral PR follows red → green → refactor, with relevant unit, application use-case, real PostgreSQL, functional API/UI and provider checks. Use fixtures for deterministic CI and required real integrations/evaluations for release evidence. Feasibility/gate/release documentation uses review and measured evidence instead of invented unit tests.
5. Keep a PR reviewable around one stated outcome. Split a large card into stable suffixes such as `P1-PR-019a`/`019b`, record each child here, and update dependent cards to wait for all children. Preserve the original ID/history; never silently drop tasks or count both the parent and children as separate delivered scope.
6. Update task checkboxes, status, PR URL, commit/test evidence and requirement rows in the implementation PR. Merging code alone is not acceptance or a live release. Gate PRs assemble evidence already produced by feature PRs; they do not postpone testing.
7. Record blocker, owner, next action and review date for blocked work. Source rights, model evaluation, ad/store approvals and paid/data-product activation remain explicit gates. A new external dependency or scope change follows the approved decision process.
8. At each phase release, record production URL/build/protocol version, deployment SHA, actual user journey, support owner, rollback and live observations. Only then accept its release card and start dependent phase work. Optional tickets require a separate activation decision and decomposition.

## Status and evidence conventions

| Status | Meaning |
| --- | --- |
| Not started | No implementation work or completion claim; default for all 119 cards |
| Ready | Dependencies accepted, scope/trace/owner/reviewer/estimate and required external prerequisites established |
| In progress | Active work with failing-test/working evidence, or documented review/probes for an evidence-only card |
| In review | Actual PR open, required checks and review evidence linked |
| Merged | Changes are on main; acceptance or rollout evidence may still be outstanding |
| Accepted | PR merged and its declared stage outcome verified; release cards also require a usable live outcome |
| Blocked | Named unresolved dependency/failure with owner and next action; does not satisfy downstream dependencies |
| Parked / activated / deferred / declined | Optional-ticket dispositions; moving committed work out of scope requires owner approval |

Use the PR/evidence column for the real GitHub PR plus durable evidence path, for example `docs/implementation/evidence/P1/S4.md`; those paths are future artifacts, not existing test results. Evidence records commit, migration/contract/model/source versions, commands/results, fixtures/workload, measured targets, reviewer and remaining external gates. Record named assignees in the ledger; responsible roles remain in the detailed cards.

## Construction and release gates

| Phase | S0 feasibility | S1 database | S2 data access | S3 services | S4 full API gate | S5 UI range | S6 live phase acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | [P1-PR-003](tasks/phase-1-prs.md#p1-pr-003) | [P1-PR-008](tasks/phase-1-prs.md#p1-pr-008) | [P1-PR-013](tasks/phase-1-prs.md#p1-pr-013) | [P1-PR-027](tasks/phase-1-prs.md#p1-pr-027) | [P1-PR-031](tasks/phase-1-prs.md#p1-pr-031) | [P1-PR-032](tasks/phase-1-prs.md#p1-pr-032) through [P1-PR-040](tasks/phase-1-prs.md#p1-pr-040) | [P1-PR-043](tasks/phase-1-prs.md#p1-pr-043) |
| P2 | [P2-PR-001](tasks/phase-2-prs.md#p2-pr-001) | [P2-PR-005](tasks/phase-2-prs.md#p2-pr-005) | [P2-PR-008](tasks/phase-2-prs.md#p2-pr-008) | [P2-PR-017](tasks/phase-2-prs.md#p2-pr-017) | [P2-PR-020](tasks/phase-2-prs.md#p2-pr-020) | [P2-PR-021](tasks/phase-2-prs.md#p2-pr-021) through [P2-PR-025](tasks/phase-2-prs.md#p2-pr-025) | [P2-PR-027](tasks/phase-2-prs.md#p2-pr-027) |
| P3 | [P3-PR-001](tasks/phase-3-prs.md#p3-pr-001) | [P3-PR-004](tasks/phase-3-prs.md#p3-pr-004) | [P3-PR-007](tasks/phase-3-prs.md#p3-pr-007) | [P3-PR-013](tasks/phase-3-prs.md#p3-pr-013) | [P3-PR-017](tasks/phase-3-prs.md#p3-pr-017) | [P3-PR-018](tasks/phase-3-prs.md#p3-pr-018) through [P3-PR-022](tasks/phase-3-prs.md#p3-pr-022) | [P3-PR-025](tasks/phase-3-prs.md#p3-pr-025) |
| P4 | [P4-PR-001](tasks/phase-4-prs.md#p4-pr-001) | [P4-PR-004](tasks/phase-4-prs.md#p4-pr-004) | [P4-PR-007](tasks/phase-4-prs.md#p4-pr-007) | [P4-PR-014](tasks/phase-4-prs.md#p4-pr-014) | [P4-PR-017](tasks/phase-4-prs.md#p4-pr-017) | [P4-PR-018](tasks/phase-4-prs.md#p4-pr-018) through [P4-PR-021](tasks/phase-4-prs.md#p4-pr-021) | [P4-PR-024](tasks/phase-4-prs.md#p4-pr-024) |

Each gate depends on every relevant earlier-stage card, directly or transitively; each phase starts after the preceding phase's release acceptance. S6 integration verifies all S5 interfaces before rollout. P4 commercial activation still needs approved pricing/terms; optional market/audience/app-ad work is not silently included by these gates. [P4-PR-024](tasks/phase-4-prs.md#p4-pr-024) additionally closes the complete core scope/evidence register after live P4 rollout.

## Phase 1 ledger

| Planned PR and title | Stage | Status | Assignee | PR / acceptance evidence |
| --- | --- | --- | --- | --- |
| [P1-PR-001 — Lock Phase 1 scope, data rights and launch coverage](tasks/phase-1-prs.md#p1-pr-001) | S0 | Accepted | Codex; owner approved | [PR #1](https://github.com/xmyqyl4x/tiresandtreads/pull/1), merged `b9e02f0`; [launch baseline](implementation/P1-PR-001-launch-baseline.md) |
| [P1-PR-002 — Bootstrap headless workspace and TDD tooling](tasks/phase-1-prs.md#p1-pr-002) | S0 | Accepted | Codex; owner approved | [PR #2](https://github.com/xmyqyl4x/tiresandtreads/pull/2), merged `dd1817f`; [setup](development.md); [validation](implementation/evidence/P1/p1-pr-002-validation.md) |
| [P1-PR-003 — Prove local foundation and track provider gates](tasks/phase-1-prs.md#p1-pr-003) | S0 | Accepted | Codex; owner approved | [PR #3](https://github.com/xmyqyl4x/tiresandtreads/pull/3), merged `ebcf936`; [Local proof and external-gate packet](implementation/P1-PR-003-local-foundation.md) |
| [P1-PR-004 — Create database ownership, identity and asset foundations](tasks/phase-1-prs.md#p1-pr-004) | S1 | Accepted | Codex; owner approved | [PR #4](https://github.com/xmyqyl4x/tiresandtreads/pull/4), merged `4f00c30`; [Implementation packet](implementation/P1-PR-004-database-foundations.md); [validation](implementation/evidence/P1/p1-pr-004-validation.md) |
| [P1-PR-005 — Create domain, catalog, reference and import schemas](tasks/phase-1-prs.md#p1-pr-005) | S1 | Accepted | Codex; owner approved | [PR #5](https://github.com/xmyqyl4x/tiresandtreads/pull/5), merged `2d8acd2`; [Implementation packet](implementation/P1-PR-005-domain-catalog-import-schemas.md); [validation](implementation/evidence/P1/p1-pr-005-validation.md) |
| [P1-PR-006 — Create report, consent, delivery and reliability schemas](tasks/phase-1-prs.md#p1-pr-006) | S1 | Accepted | Codex; owner approved | [PR #6](https://github.com/xmyqyl4x/tiresandtreads/pull/6), merged `53f9fd1`; [Implementation packet](implementation/P1-PR-006-report-consent-delivery-schemas.md); [validation](implementation/evidence/P1/p1-pr-006-validation.md) |
| [P1-PR-007 — Create CMS, SEO, ads, analytics and quota schemas](tasks/phase-1-prs.md#p1-pr-007) | S1 | Accepted | Codex; owner approved | [PR #7](https://github.com/xmyqyl4x/tiresandtreads/pull/7), merged `ad3822a`; [Implementation packet](implementation/P1-PR-007-cms-seo-ads-analytics-schemas.md); [validation](implementation/evidence/P1/p1-pr-007-validation.md) |
| [P1-PR-008 — Close database gate with migration and recovery evidence](tasks/phase-1-prs.md#p1-pr-008) | S1 | Accepted | Codex; owner approved | [PR #8](https://github.com/xmyqyl4x/tiresandtreads/pull/8), merged `beccd8e`; [Implementation packet](implementation/P1-PR-008-database-validation-recovery.md); [validation](implementation/evidence/P1/p1-pr-008-validation.md) |
| [P1-PR-009 — Define domain entities, value objects and repository contracts](tasks/phase-1-prs.md#p1-pr-009) | S2 | Accepted | Codex; owner approved | [PR #9](https://github.com/xmyqyl4x/tiresandtreads/pull/9), merged `7ac3ed2`; [Implementation packet](implementation/P1-PR-009-entities-transactions.md); [validation](implementation/evidence/P1/p1-pr-009-validation.md) |
| [P1-PR-010 — Implement catalog and ingestion repositories](tasks/phase-1-prs.md#p1-pr-010) | S2 | Accepted | Codex; owner approved | [PR #10](https://github.com/xmyqyl4x/tiresandtreads/pull/10), merged `18a264a`; [Implementation packet](implementation/P1-PR-010-catalog-ingestion.md); [validation](implementation/evidence/P1/p1-pr-010-validation.md) |
| [P1-PR-011 — Implement owner, report, privacy and delivery repositories](tasks/phase-1-prs.md#p1-pr-011) | S2 | Accepted | Codex; owner approved | [PR #11](https://github.com/xmyqyl4x/tiresandtreads/pull/11), merged `e94c7cd`; [Implementation packet](implementation/P1-PR-011-owner-report-delivery.md); [validation](implementation/evidence/P1/p1-pr-011-validation.md) |
| [P1-PR-012 — Implement content, operations, analytics and limiter adapters](tasks/phase-1-prs.md#p1-pr-012) | S2 | Accepted | Codex; owner approved | [PR #12](https://github.com/xmyqyl4x/tiresandtreads/pull/12), merged `4a37b95`; [Implementation packet](implementation/P1-PR-012-content-operations-analytics.md); [validation](implementation/evidence/P1/p1-pr-012-validation.md) |
| [P1-PR-013 — Close entities and data-access gate](tasks/phase-1-prs.md#p1-pr-013) | S2 | Accepted | Codex; owner approved | [PR #13](https://github.com/xmyqyl4x/tiresandtreads/pull/13), merged `b3286d0`; [Gate packet](implementation/P1-PR-013-s2-data-access-gate.md); [validation](implementation/evidence/P1/p1-pr-013-validation.md); [forecast](implementation/P1-PR-013-s2-forecast.md) |
| [P1-PR-014 — Implement durable jobs, private assets and runtime composition](tasks/phase-1-prs.md#p1-pr-014) | S3 | Accepted | Codex; owner approved | [PR #14](https://github.com/xmyqyl4x/tiresandtreads/pull/14); [Implementation](implementation/P1-PR-014-jobs-assets-runtime.md); [validation](implementation/evidence/P1/p1-pr-014-validation.md) |
| [P1-PR-015 — Implement script-first ingestion and publication services](tasks/phase-1-prs.md#p1-pr-015) | S3 | Accepted | Codex; owner approved | [PR #15](https://github.com/xmyqyl4x/tiresandtreads/pull/15); [Implementation](implementation/P1-PR-015-ingestion-publication-services.md); [validation](implementation/evidence/P1/p1-pr-015-validation.md) |
| [P1-PR-016 — Integrate NHTSA and licensed domain source adapters](tasks/phase-1-prs.md#p1-pr-016) | S3 | In progress | Codex; NHTSA/shared accepted, licensed adapters deferred | [PR #16](https://github.com/xmyqyl4x/tiresandtreads/pull/16) (NHTSA/shared approved and merged); [Implementation](implementation/P1-PR-016-domain-source-adapters.md); [validation](implementation/evidence/P1/p1-pr-016-validation.md) |
| [P1-PR-017 — Implement deterministic eligibility and recommendation rules](tasks/phase-1-prs.md#p1-pr-017) | S3 | In progress | Codex; specialist review deferred by owner; DD06/G1/data gates pending | [PR #17](https://github.com/xmyqyl4x/tiresandtreads/pull/17) (technical implementation approved and merged at `89a4a098`); [Implementation](implementation/P1-PR-017-eligibility-recommendations.md); [validation](implementation/evidence/P1/p1-pr-017-validation.md) |
| [P1-PR-018 — Implement prices, installed costs and comparison mathematics](tasks/phase-1-prs.md#p1-pr-018) | S3 | In progress | Codex; specialist/data acceptance pending | [PR #18](https://github.com/xmyqyl4x/tiresandtreads/pull/18) (technical implementation approved and merged at `75276073`); [Implementation](implementation/P1-PR-018-pricing-comparison.md); [validation](implementation/evidence/P1/p1-pr-018-validation.md) |
| [P1-PR-019 — Implement report, refine, compare and access services](tasks/phase-1-prs.md#p1-pr-019) | S3 | In progress | Codex; specialist/source acceptance pending | [PR #19](https://github.com/xmyqyl4x/tiresandtreads/pull/19) (technical implementation approved and merged at `2bacfc78`); [Implementation](implementation/P1-PR-019-report-services.md); [validation](implementation/evidence/P1/p1-pr-019-validation.md) |
| [P1-PR-020 — Implement contact, consent and suppression services](tasks/phase-1-prs.md#p1-pr-020) | S3 | Accepted | Codex; owner approved | [PR #20](https://github.com/xmyqyl4x/tiresandtreads/pull/20), merged `2de57d88`; [Implementation](implementation/P1-PR-020-contact-consent.md); [validation](implementation/evidence/P1/p1-pr-020-validation.md) |
| [P1-PR-021 — Implement content, public tools and SEO publication services](tasks/phase-1-prs.md#p1-pr-021) | S3 | Accepted | Codex; owner approved | [PR #21](https://github.com/xmyqyl4x/tiresandtreads/pull/21), merged `c7595c59`; [Implementation](implementation/P1-PR-021-content-seo.md); [validation](implementation/evidence/P1/p1-pr-021-validation.md) |
| [P1-PR-022 — Implement report delivery orchestration and cancellation](tasks/phase-1-prs.md#p1-pr-022) | S3 | Accepted | Codex; owner approved | [PR #22](https://github.com/xmyqyl4x/tiresandtreads/pull/22), merged `5e6d4cd4`; [Implementation](implementation/P1-PR-022-delivery-orchestration.md); [validation](implementation/evidence/P1/p1-pr-022-validation.md) |
| [P1-PR-023 — Implement webhooks, preferences, feedback and safe redirects](tasks/phase-1-prs.md#p1-pr-023) | S3 | Accepted | Codex; owner approved | [PR #23](https://github.com/xmyqyl4x/tiresandtreads/pull/23), merged `c71df714`; [Implementation](implementation/P1-PR-023-mail-events-actions.md); [validation](implementation/evidence/P1/p1-pr-023-validation.md) |
| [P1-PR-024 — Implement PostgreSQL analytics, SQL limits and operations](tasks/phase-1-prs.md#p1-pr-024) | S3 | Accepted | Codex; owner approved | [PR #24](https://github.com/xmyqyl4x/tiresandtreads/pull/24), merged `4ba7b446`; [Implementation](implementation/P1-PR-024-analytics-limits-operations.md); [validation](implementation/evidence/P1/p1-pr-024-validation.md) |
| [P1-PR-025 — Implement privacy rights, retention and recovery services](tasks/phase-1-prs.md#p1-pr-025) | S3 | Accepted | Codex; owner approved | [PR #25](https://github.com/xmyqyl4x/tiresandtreads/pull/25), merged `7aa1b542`; [Implementation](implementation/P1-PR-025-privacy-retention-recovery.md); [validation](implementation/evidence/P1/p1-pr-025-validation.md) |
| [P1-PR-026 — Implement staff, affiliate, advertising and revenue services](tasks/phase-1-prs.md#p1-pr-026) | S3 | Accepted | Codex; owner approved | [PR #26](https://github.com/xmyqyl4x/tiresandtreads/pull/26), merged `ac258ac7`; [Implementation](implementation/P1-PR-026-staff-commerce-revenue.md); [validation](implementation/evidence/P1/p1-pr-026-validation.md) |
| [P1-PR-027 — Close business-service gate and engine safety review](tasks/phase-1-prs.md#p1-pr-027) | S3 | In progress | Codex; owner-approved continuation; full S3 open | [PR #27](https://github.com/xmyqyl4x/tiresandtreads/pull/27) merged `026a14c7`; [local host PR #28](https://github.com/xmyqyl4x/tiresandtreads/pull/28) merged `7c86af95`; [retained workflow PR #29](https://github.com/xmyqyl4x/tiresandtreads/pull/29) merged `92aa5d77`; [provider recovery/replay PR #30](https://github.com/xmyqyl4x/tiresandtreads/pull/30) merged `b02335bc`; [local observability PR #31](https://github.com/xmyqyl4x/tiresandtreads/pull/31) merged `9d7006f7`; [final local readiness review](implementation/P1-PR-027-final-local-readiness.md) accepted and merged as [PR #32](https://github.com/xmyqyl4x/tiresandtreads/pull/32), `7f2476e`; [private hosted staging decision packet](implementation/P1-PR-027-private-hosted-staging-decision.md) approved and merged as [PR #33](https://github.com/xmyqyl4x/tiresandtreads/pull/33), `7d0849b7`; [SP01–SP02 local-only TLS/ownership preflight](implementation/P1-PR-027-local-hosted-preflight.md) approved and merged as [PR #34](https://github.com/xmyqyl4x/tiresandtreads/pull/34), `1f1db236`; [SP03 local-only provider preflight](implementation/P1-PR-027-local-provider-preflight.md) approved in merged PR #35; [SP04 local custody/recovery preflight](implementation/P1-PR-027-local-custody-preflight.md) approved and merged as [PR #36](https://github.com/xmyqyl4x/tiresandtreads/pull/36), `0e521439`; [SP05 local deployment/access/rollback preflight](implementation/P1-PR-027-local-deployment-preflight.md) approved in merged PR #37 (`3e86d3e5`); [SP06 local capacity/lifecycle preflight](implementation/P1-PR-027-local-capacity-preflight.md) in review (actual hosted proofs pending; HS01–HS08 proposed); [observer contract](implementation/P1-PR-027-local-observability.md); [recovery contract](implementation/P1-PR-027-provider-recovery-replay.md); [retained workflow contract](implementation/P1-PR-027-persistent-local-workflows.md); [host contract](implementation/P1-PR-027-local-service-host.md); [Contract](implementation/P1-PR-027-s3-validation-gate.md); [gate disposition](implementation/P1-PR-027-s3-gate-review.md); [validation](implementation/evidence/P1/p1-pr-027-validation.md) |
| [P1-PR-028 — Expose public lookup and owner assessment APIs](tasks/phase-1-prs.md#p1-pr-028) | S4 | Blocked | Unassigned; S3 hold | Full S3 acceptance remains open; [gate disposition](implementation/P1-PR-027-s3-gate-review.md) |
| [P1-PR-029 — Expose consent, privacy, import and staff operations APIs](tasks/phase-1-prs.md#p1-pr-029) | S4 | Blocked | Unassigned; S3 hold | Full S3 acceptance remains open; [gate disposition](implementation/P1-PR-027-s3-gate-review.md) |
| [P1-PR-030 — Expose provider callbacks, event intake and workflow endpoints](tasks/phase-1-prs.md#p1-pr-030) | S4 | Blocked | Unassigned; S3 hold | Full S3 acceptance remains open; [gate disposition](implementation/P1-PR-027-s3-gate-review.md) |
| [P1-PR-031 — Accept the complete Phase 1 API before frontend work](tasks/phase-1-prs.md#p1-pr-031) | S4 | Not started | Unassigned | — |
| [P1-PR-032 — Build accessible web shell and design system](tasks/phase-1-prs.md#p1-pr-032) | S5 | Not started | Unassigned | — |
| [P1-PR-033 — Build assessment form and reference lookups](tasks/phase-1-prs.md#p1-pr-033) | S5 | Not started | Unassigned | — |
| [P1-PR-034 — Build results, explanation and refinement views](tasks/phase-1-prs.md#p1-pr-034) | S5 | Not started | Unassigned | — |
| [P1-PR-035 — Build comparison, shop-quote and sharing views](tasks/phase-1-prs.md#p1-pr-035) | S5 | Not started | Unassigned | — |
| [P1-PR-036 — Build delivery, cancellation, preferences and privacy controls](tasks/phase-1-prs.md#p1-pr-036) | S5 | Not started | Unassigned | — |
| [P1-PR-037 — Implement production email and PDF templates](tasks/phase-1-prs.md#p1-pr-037) | S5 | Not started | Unassigned | — |
| [P1-PR-038 — Build editorial CMS and reviewed education website](tasks/phase-1-prs.md#p1-pr-038) | S5 | Not started | Unassigned | — |
| [P1-PR-039 — Build staff operations, SEO and ad-revenue screens](tasks/phase-1-prs.md#p1-pr-039) | S5 | Not started | Unassigned | — |
| [P1-PR-040 — Build permitted affiliate and advertising placements](tasks/phase-1-prs.md#p1-pr-040) | S5 | Not started | Unassigned | — |
| [P1-PR-041 — Verify the full web product and accessibility journeys](tasks/phase-1-prs.md#p1-pr-041) | S6 | Not started | Unassigned | — |
| [P1-PR-042 — Prove production security, capacity and recovery](tasks/phase-1-prs.md#p1-pr-042) | S6 | Not started | Unassigned | — |
| [P1-PR-043 — Release Phase 1 and record the usable live outcome](tasks/phase-1-prs.md#p1-pr-043) | S6 | Not started | Unassigned | — |

## Phase 2 ledger

| Planned PR and title | Stage | Status | Assignee | PR / acceptance evidence |
| --- | --- | --- | --- | --- |
| [P2-PR-001 — Lock Phase 2 scope, AI evaluation and pilot readiness](tasks/phase-2-prs.md#p2-pr-001) | S0 | Not started | Unassigned | — |
| [P2-PR-002 — Create organization, offer and coupon schemas](tasks/phase-2-prs.md#p2-pr-002) | S1 | Not started | Unassigned | — |
| [P2-PR-003 — Create AI policy, artifact, reuse and budget schemas](tasks/phase-2-prs.md#p2-pr-003) | S1 | Not started | Unassigned | — |
| [P2-PR-004 — Create photo and admin-import extension schemas](tasks/phase-2-prs.md#p2-pr-004) | S1 | Not started | Unassigned | — |
| [P2-PR-005 — Close Phase 2 schema and upgrade gate](tasks/phase-2-prs.md#p2-pr-005) | S1 | Not started | Unassigned | — |
| [P2-PR-006 — Implement tenant, offer and pilot reporting repositories](tasks/phase-2-prs.md#p2-pr-006) | S2 | Not started | Unassigned | — |
| [P2-PR-007 — Implement AI, photo and import-review repositories](tasks/phase-2-prs.md#p2-pr-007) | S2 | Not started | Unassigned | — |
| [P2-PR-008 — Close Phase 2 data-access gate](tasks/phase-2-prs.md#p2-pr-008) | S2 | Not started | Unassigned | — |
| [P2-PR-009 — Implement reseller verification and offer moderation](tasks/phase-2-prs.md#p2-pr-009) | S3 | Not started | Unassigned | — |
| [P2-PR-010 — Implement matching, coupon allocation and pilot delivery](tasks/phase-2-prs.md#p2-pr-010) | S3 | Not started | Unassigned | — |
| [P2-PR-011 — Implement partner insights, disputes and consented operations](tasks/phase-2-prs.md#p2-pr-011) | S3 | Not started | Unassigned | — |
| [P2-PR-012 — Implement bounded AI report analysis and validation](tasks/phase-2-prs.md#p2-pr-012) | S3 | Not started | Unassigned | — |
| [P2-PR-013 — Implement exact AI reuse, refresh and cost admission](tasks/phase-2-prs.md#p2-pr-013) | S3 | Not started | Unassigned | — |
| [P2-PR-014 — Implement private tire-photo processing and confirmation](tasks/phase-2-prs.md#p2-pr-014) | S3 | Not started | Unassigned | — |
| [P2-PR-015 — Integrate AI/photo privacy and frozen report delivery](tasks/phase-2-prs.md#p2-pr-015) | S3 | Not started | Unassigned | — |
| [P2-PR-016 — Implement staff CSV review and publication workflow](tasks/phase-2-prs.md#p2-pr-016) | S3 | Not started | Unassigned | — |
| [P2-PR-017 — Accept Phase 2 services and evaluate real model behavior](tasks/phase-2-prs.md#p2-pr-017) | S3 | Not started | Unassigned | — |
| [P2-PR-018 — Expose reseller and staff CSV/operations APIs](tasks/phase-2-prs.md#p2-pr-018) | S4 | Not started | Unassigned | — |
| [P2-PR-019 — Expose AI analysis and photo APIs](tasks/phase-2-prs.md#p2-pr-019) | S4 | Not started | Unassigned | — |
| [P2-PR-020 — Accept all Phase 2 APIs before new frontend work](tasks/phase-2-prs.md#p2-pr-020) | S4 | Not started | Unassigned | — |
| [P2-PR-021 — Build reseller onboarding, offers and pilot portal](tasks/phase-2-prs.md#p2-pr-021) | S5 | Not started | Unassigned | — |
| [P2-PR-022 — Build staff CSV import and partner moderation screens](tasks/phase-2-prs.md#p2-pr-022) | S5 | Not started | Unassigned | — |
| [P2-PR-023 — Build AI-assisted report and delivery presentation](tasks/phase-2-prs.md#p2-pr-023) | S5 | Not started | Unassigned | — |
| [P2-PR-024 — Build web tire-photo upload and field confirmation](tasks/phase-2-prs.md#p2-pr-024) | S5 | Not started | Unassigned | — |
| [P2-PR-025 — Build AI/privacy and pilot operations dashboards](tasks/phase-2-prs.md#p2-pr-025) | S5 | Not started | Unassigned | — |
| [P2-PR-026 — Verify assisted advice, privacy and partner security](tasks/phase-2-prs.md#p2-pr-026) | S6 | Not started | Unassigned | — |
| [P2-PR-027 — Release Phase 2 assistance and reseller pilot](tasks/phase-2-prs.md#p2-pr-027) | S6 | Not started | Unassigned | — |

## Phase 3 ledger

| Planned PR and title | Stage | Status | Assignee | PR / acceptance evidence |
| --- | --- | --- | --- | --- |
| [P3-PR-001 — Lock multichannel scope, rights and distribution plan](tasks/phase-3-prs.md#p3-pr-001) | S0 | Not started | Unassigned | — |
| [P3-PR-002 — Create consumer ownership, garage and device schemas](tasks/phase-3-prs.md#p3-pr-002) | S1 | Not started | Unassigned | — |
| [P3-PR-003 — Create reminder, API-client and tool-grant schemas](tasks/phase-3-prs.md#p3-pr-003) | S1 | Not started | Unassigned | — |
| [P3-PR-004 — Close Phase 3 schema upgrade gate](tasks/phase-3-prs.md#p3-pr-004) | S1 | Not started | Unassigned | — |
| [P3-PR-005 — Implement identity, garage and synchronization repositories](tasks/phase-3-prs.md#p3-pr-005) | S2 | Not started | Unassigned | — |
| [P3-PR-006 — Implement reminder and client-grant repositories](tasks/phase-3-prs.md#p3-pr-006) | S2 | Not started | Unassigned | — |
| [P3-PR-007 — Close multichannel data-access gate](tasks/phase-3-prs.md#p3-pr-007) | S2 | Not started | Unassigned | — |
| [P3-PR-008 — Implement account authority and verified guest merge](tasks/phase-3-prs.md#p3-pr-008) | S3 | Not started | Unassigned | — |
| [P3-PR-009 — Implement garage, tire history and offline sync services](tasks/phase-3-prs.md#p3-pr-009) | S3 | Not started | Unassigned | — |
| [P3-PR-010 — Implement basic reminders, push and quiet-hour rules](tasks/phase-3-prs.md#p3-pr-010) | S3 | Not started | Unassigned | — |
| [P3-PR-011 — Implement wallet, deep-link and cross-channel privacy services](tasks/phase-3-prs.md#p3-pr-011) | S3 | Not started | Unassigned | — |
| [P3-PR-012 — Define public and authenticated tool application contracts](tasks/phase-3-prs.md#p3-pr-012) | S3 | Not started | Unassigned | — |
| [P3-PR-013 — Close shared ownership and tool-service gate](tasks/phase-3-prs.md#p3-pr-013) | S3 | Not started | Unassigned | — |
| [P3-PR-014 — Expose consumer, sync, reminder and device APIs](tasks/phase-3-prs.md#p3-pr-014) | S4 | Not started | Unassigned | — |
| [P3-PR-015 — Implement and verify public MCP transport and tools](tasks/phase-3-prs.md#p3-pr-015) | S4 | Not started | Unassigned | — |
| [P3-PR-016 — Implement scoped authenticated MCP flows](tasks/phase-3-prs.md#p3-pr-016) | S4 | Not started | Unassigned | — |
| [P3-PR-017 — Accept complete web, mobile and MCP API parity](tasks/phase-3-prs.md#p3-pr-017) | S4 | Not started | Unassigned | — |
| [P3-PR-018 — Build Expo shell, authentication and native foundations](tasks/phase-3-prs.md#p3-pr-018) | S5 | Not started | Unassigned | — |
| [P3-PR-019 — Build mobile garage, assessment, reports and camera flow](tasks/phase-3-prs.md#p3-pr-019) | S5 | Not started | Unassigned | — |
| [P3-PR-020 — Build offline sync, wallet and reminder settings](tasks/phase-3-prs.md#p3-pr-020) | S5 | Not started | Unassigned | — |
| [P3-PR-021 — Build web account, garage and ownership controls](tasks/phase-3-prs.md#p3-pr-021) | S5 | Not started | Unassigned | — |
| [P3-PR-022 — Build developer documentation and AI-client packaging](tasks/phase-3-prs.md#p3-pr-022) | S5 | Not started | Unassigned | — |
| [P3-PR-023 — Verify native quality and complete client journeys](tasks/phase-3-prs.md#p3-pr-023) | S6 | Not started | Unassigned | — |
| [P3-PR-024 — Complete store and AI-client distribution readiness](tasks/phase-3-prs.md#p3-pr-024) | S6 | Not started | Unassigned | — |
| [P3-PR-025 — Release Phase 3 web, app and AI-client experience](tasks/phase-3-prs.md#p3-pr-025) | S6 | Not started | Unassigned | — |

## Phase 4 ledger

| Planned PR and title | Stage | Status | Assignee | PR / acceptance evidence |
| --- | --- | --- | --- | --- |
| [P4-PR-001 — Lock core-completion scope and commercial activation gates](tasks/phase-4-prs.md#p4-pr-001) | S0 | Not started | Unassigned | — |
| [P4-PR-002 — Create financial ledger, budget and partner API schemas](tasks/phase-4-prs.md#p4-pr-002) | S1 | Not started | Unassigned | — |
| [P4-PR-003 — Create lifecycle, curated content and operations extensions](tasks/phase-4-prs.md#p4-pr-003) | S1 | Not started | Unassigned | — |
| [P4-PR-004 — Close Phase 4 schema and compatibility gate](tasks/phase-4-prs.md#p4-pr-004) | S1 | Not started | Unassigned | — |
| [P4-PR-005 — Implement ledger, budgets and commercial repositories](tasks/phase-4-prs.md#p4-pr-005) | S2 | Not started | Unassigned | — |
| [P4-PR-006 — Implement lifecycle, SEO and correction repositories](tasks/phase-4-prs.md#p4-pr-006) | S2 | Not started | Unassigned | — |
| [P4-PR-007 — Close Phase 4 data-access gate](tasks/phase-4-prs.md#p4-pr-007) | S2 | Not started | Unassigned | — |
| [P4-PR-008 — Implement billing, payment reconciliation and paid event rules](tasks/phase-4-prs.md#p4-pr-008) | S3 | Not started | Unassigned | — |
| [P4-PR-009 — Implement partner API, signed webhook and commercial access services](tasks/phase-4-prs.md#p4-pr-009) | S3 | Not started | Unassigned | — |
| [P4-PR-010 — Implement direct sponsorship and ad operations expansion](tasks/phase-4-prs.md#p4-pr-010) | S3 | Not started | Unassigned | — |
| [P4-PR-011 — Implement full lifecycle and permissioned campaign services](tasks/phase-4-prs.md#p4-pr-011) | S3 | Not started | Unassigned | — |
| [P4-PR-012 — Implement curated SEO expansion and reviewed public tools](tasks/phase-4-prs.md#p4-pr-012) | S3 | Not started | Unassigned | — |
| [P4-PR-013 — Implement correction, republication and operational maintenance](tasks/phase-4-prs.md#p4-pr-013) | S3 | Not started | Unassigned | — |
| [P4-PR-014 — Close core platform service completion gate](tasks/phase-4-prs.md#p4-pr-014) | S3 | Not started | Unassigned | — |
| [P4-PR-015 — Expose commercial APIs, billing events and partner webhooks](tasks/phase-4-prs.md#p4-pr-015) | S4 | Not started | Unassigned | — |
| [P4-PR-016 — Expose lifecycle, SEO and maintenance operations APIs](tasks/phase-4-prs.md#p4-pr-016) | S4 | Not started | Unassigned | — |
| [P4-PR-017 — Accept the complete Phase 4 API surface](tasks/phase-4-prs.md#p4-pr-017) | S4 | Not started | Unassigned | — |
| [P4-PR-018 — Build partner billing, API access and sponsorship controls](tasks/phase-4-prs.md#p4-pr-018) | S5 | Not started | Unassigned | — |
| [P4-PR-019 — Build complete web/app lifecycle and messaging controls](tasks/phase-4-prs.md#p4-pr-019) | S5 | Not started | Unassigned | — |
| [P4-PR-020 — Publish curated vehicle/size content and expanded tools](tasks/phase-4-prs.md#p4-pr-020) | S5 | Not started | Unassigned | — |
| [P4-PR-021 — Build growth and correction operations workspace](tasks/phase-4-prs.md#p4-pr-021) | S5 | Not started | Unassigned | — |
| [P4-PR-022 — Verify four-phase regression, scale and handover readiness](tasks/phase-4-prs.md#p4-pr-022) | S6 | Not started | Unassigned | — |
| [P4-PR-023 — Release Phase 4 capabilities and observe live operation](tasks/phase-4-prs.md#p4-pr-023) | S6 | Not started | Unassigned | — |
| [P4-PR-024 — Close the implementation scope and archive completion evidence](tasks/phase-4-prs.md#p4-pr-024) | S6 | Not started | Unassigned | — |

## Conditional option ledger

These parked tickets are excluded from the 119 core-PR count. Their [activation/child-PR rules](tasks/conditional-options.md#activation-process) preserve S1–S6 order and the approved optional-scope boundaries.

| Ticket and option | Work | Status | Assignee | Decision / child PR evidence |
| --- | --- | --- | --- | --- |
| [P4-OPT-001 — Market rollout per country](tasks/conditional-options.md#p4-opt-001) | E28, E33 | Parked | Unassigned | — |
| [P4-OPT-002 — Tier A audience sales](tasks/conditional-options.md#p4-opt-002) | E32 | Parked | Unassigned | — |
| [P4-OPT-003 — Tier B audience evaluation](tasks/conditional-options.md#p4-opt-003) | E32 | Parked | Unassigned | — |
| [P4-OPT-004 — Tier C identity-sharing leads](tasks/conditional-options.md#p4-opt-004) | E33 | Parked | Unassigned | — |
| [P4-OPT-005 — Onsite partner offers](tasks/conditional-options.md#p4-opt-005) | E33 | Parked | Unassigned | — |
| [P4-OPT-006 — Third-party redemption integration](tasks/conditional-options.md#p4-opt-006) | E33 | Parked | Unassigned | — |
| [P4-OPT-007 — Non-English localization](tasks/conditional-options.md#p4-opt-007) | E33 | Parked | Unassigned | — |
| [P4-OPT-008 — Paid MCP or B2B API plans](tasks/conditional-options.md#p4-opt-008) | E27, E33 | Parked | Unassigned | — |
| [P4-OPT-009 — Optional mobile advertising](tasks/conditional-options.md#p4-opt-009) | E33 | Parked | Unassigned | — |
| [P4-OPT-010 — Optional VIN capture and decode](tasks/conditional-options.md#p4-opt-010) | E30, E33 | Parked | Unassigned | — |

## Traceability and next action

**Approved deployment supplement:** [DP01–DP08 with option C](16-deployment-and-local-environments.md#integration-with-the-working-pr-task-list) assign local Docker infrastructure, pre-push verification, portable app/PostgreSQL hosting and container release evidence to these existing cards. P1 task details now reflect C; all core IDs/counts/statuses/dependencies and the historical approval record below remain intact. The later owner-directed P1 deferral moves concrete provider/region/DB/operator selection to the [recorded blocking triggers](implementation/P1-PR-001-launch-baseline.md#deferred-decision-register); local S0 acceptance does not accept G0 or production readiness.

The [work-package-to-PR map](tasks/work-package-pr-map.md) covers E01–E42 and exposes optional E32/E33 work separately. A work-package link is an ownership/navigation aid, not acceptance of all of its source requirements. At readiness, select exact rows from docs/05; at acceptance, attach tests and shipped version. Preserve all 137 original FR IDs and the existing CORE/NFR/ENG/CAP/UC/AT/DB identifiers.

P1-PR-001–015 are accepted, including the local S1 database and S2 entities/data-access gates. Runtime/jobs/assets local implementation is accepted; ingestion/publication services are accepted in [P1-PR-015](tasks/phase-1-prs.md#p1-pr-015). Source adapter construction is in progress in [P1-PR-016](tasks/phase-1-prs.md#p1-pr-016), with licensed-provider acceptance pending DD01/DD02. [S2 forecast](implementation/P1-PR-013-s2-forecast.md) provides a scoped remaining-P1 planning allowance. S3 construction is authorized; full hosted provider acceptance still requires its recorded proofs. Deferred source/provider/host decisions remain open at their recorded triggers. Product frontend work remains behind [P1-PR-031](tasks/phase-1-prs.md#p1-pr-031).

## Approval record

On **October 23, 2026 (America/Los_Angeles)**, the requesting user approved this implementation working task list and authorized the merge of `codex/implementation-pr-task-list` into `main`. The reviewed baseline is commit [`c984bcf`](https://github.com/xmyqyl4x/tiresandtreads/commit/c984bcf04098d465e521bd0ee12215faba6d6978).

The user's instruction was: “Approve the implementation working task list and merge the codex/implementation-pr-task-list branch into main.” This approves the 119 planned core PRs (43/27/25/24 across P1–P4), their task checklists, dependencies, stage gates, testing/acceptance criteria, work-package mappings and progress-tracking workflow. The ten optional activation tickets remain parked under their existing decision process.

This approval establishes the working backlog and authorizes its documentation merge. It does not mark implementation tasks complete: all core tasks remain Not started, assignees remain Unassigned, and implementation, provider/data prerequisites and live phase acceptance still require their specified evidence. Earlier scope, stack, database-first, PostgreSQL and engineering approvals remain tied to their reviewed commits.
