# Phase 2 — assisted advice and reseller pilot

**Working PR decomposition 1.0 · October 23, 2026.** 27 planned PRs. Scope comes from the approved [four-phase baseline](../12-live-product-phases-and-gap-review.md); this breakdown adds execution detail without approving new capabilities. All implementation is unstarted. The [master task list](../15-project-task-list.md) is the authoritative status/assignee/PR/evidence ledger.

**Live outcome:** The live site supports confirmed photo inputs, grounded AI analysis/reuse, staff CSV publication and 5–10 verified pilot resellers.

**Phase entry:** Acceptance of [P1-PR-043](phase-1-prs.md#p1-pr-043) and a recorded phase scope/estimate review. Every listed dependency means merged **and accepted with required evidence**, not just an open PR. New product UI/templates wait for [P2-PR-020](phase-2-prs.md#p2-pr-020). Read the [TDD](../08-test-driven-development.md), [schema](../09-database-design.md), [coding](../10-coding-standards.md), [domain imports](../13-domain-data-and-imports.md) and [AI/photo](../14-ai-analysis-and-photo-design.md) contracts before the affected work.

## PR sequence

| PR | Stage | Proposed title |
| --- | --- | --- |
| [P2-PR-001](#p2-pr-001) | S0 | Lock Phase 2 scope, AI evaluation and pilot readiness |
| [P2-PR-002](#p2-pr-002) | S1 | Create organization, offer and coupon schemas |
| [P2-PR-003](#p2-pr-003) | S1 | Create AI policy, artifact, reuse and budget schemas |
| [P2-PR-004](#p2-pr-004) | S1 | Create photo and admin-import extension schemas |
| [P2-PR-005](#p2-pr-005) | S1 | Close Phase 2 schema and upgrade gate |
| [P2-PR-006](#p2-pr-006) | S2 | Implement tenant, offer and pilot reporting repositories |
| [P2-PR-007](#p2-pr-007) | S2 | Implement AI, photo and import-review repositories |
| [P2-PR-008](#p2-pr-008) | S2 | Close Phase 2 data-access gate |
| [P2-PR-009](#p2-pr-009) | S3 | Implement reseller verification and offer moderation |
| [P2-PR-010](#p2-pr-010) | S3 | Implement matching, coupon allocation and pilot delivery |
| [P2-PR-011](#p2-pr-011) | S3 | Implement partner insights, disputes and consented operations |
| [P2-PR-012](#p2-pr-012) | S3 | Implement bounded AI report analysis and validation |
| [P2-PR-013](#p2-pr-013) | S3 | Implement exact AI reuse, refresh and cost admission |
| [P2-PR-014](#p2-pr-014) | S3 | Implement private tire-photo processing and confirmation |
| [P2-PR-015](#p2-pr-015) | S3 | Integrate AI/photo privacy and frozen report delivery |
| [P2-PR-016](#p2-pr-016) | S3 | Implement staff CSV review and publication workflow |
| [P2-PR-017](#p2-pr-017) | S3 | Accept Phase 2 services and evaluate real model behavior |
| [P2-PR-018](#p2-pr-018) | S4 | Expose reseller and staff CSV/operations APIs |
| [P2-PR-019](#p2-pr-019) | S4 | Expose AI analysis and photo APIs |
| [P2-PR-020](#p2-pr-020) | S4 | Accept all Phase 2 APIs before new frontend work |
| [P2-PR-021](#p2-pr-021) | S5 | Build reseller onboarding, offers and pilot portal |
| [P2-PR-022](#p2-pr-022) | S5 | Build staff CSV import and partner moderation screens |
| [P2-PR-023](#p2-pr-023) | S5 | Build AI-assisted report and delivery presentation |
| [P2-PR-024](#p2-pr-024) | S5 | Build web tire-photo upload and field confirmation |
| [P2-PR-025](#p2-pr-025) | S5 | Build AI/privacy and pilot operations dashboards |
| [P2-PR-026](#p2-pr-026) | S6 | Verify assisted advice, privacy and partner security |
| [P2-PR-027](#p2-pr-027) | S6 | Release Phase 2 assistance and reseller pilot |

## Task cards

Each checkbox is implementation work, not a claim of completion. Each behavioral PR includes failing-then-passing unit/application tests and affected real database/API/provider checks; UI PRs also include functional/browser/accessibility checks. Evidence-only feasibility/gate/release PRs use documented review and measured results instead of artificial unit tests. Gate PRs collect existing evidence and exercise integration gaps; they do not postpone testing until the end.

### P2-PR-001

**Lock Phase 2 scope, AI evaluation and pilot readiness**

**Stage:** S0 · **Responsible role:** Product/data/privacy · **Work packages:** E21, E26, E36, E39, E40, E41

**Depends on:** [P1-PR-043](phase-1-prs.md#p1-pr-043)

**Trace:** CAP-04, CAP-05, CAP-06, CAP-07. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Confirm P1 stability, 5–10 pilot-reseller onboarding plan and noncharging pilot terms.
- [ ] Evaluate/pin provider/model/prompt/schema direction, source-to-AI rights, image handling, notices, budgets and retention controls.
- [ ] Prepare specialist-labeled explanation/image evaluation fixtures, current acceptance thresholds and P2 effort/dependency forecast.

**Verification and acceptance:** P2 G0/provider/privacy feasibility record is accepted; no AI correctness or network agreement is inferred from a mock.

### P2-PR-002

**Create organization, offer and coupon schemas**

**Stage:** S1 · **Responsible role:** Backend · **Work packages:** E21, E22, E23, E24, E25

**Depends on:** [P2-PR-001](phase-2-prs.md#p2-pr-001)

**Trace:** UC11, DB09, DB10, DB12. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Add organizations/memberships/agreements/verification/locations and scoped runtime RLS.
- [ ] Add immutable offer/target/pool/code/reservation/cap/decision records and correction/redemption/dispute persistence.
- [ ] Add privacy-scoped visitor/internal aggregate support only where absent from P1; preserve noncharging pilot semantics.

**Verification and acceptance:** Real constraints and RLS deny wrong-tenant parents and double live codes; upgrade preserves P1 records.

### P2-PR-003

**Create AI policy, artifact, reuse and budget schemas**

**Stage:** S1 · **Responsible role:** Backend · **Work packages:** E39, E40

**Depends on:** [P2-PR-001](phase-2-prs.md#p2-pr-001)

**Trace:** CAP-05, CAP-06, DB23, DB24, DB25. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Migrate policy/scopes/requests/attempts/artifacts/source links and exact reuse entry/lease/fence structures.
- [ ] Add immutable report-analysis attachment and frozen delivery selection references.
- [ ] Add atomic AI budget windows/reservations, expiry/reverse-source indexes and deletion linkage.

**Verification and acceptance:** Scope/policy/request composite FK tests and budget bounds pass; no shared scope can silently substitute for an owner scope.

### P2-PR-004

**Create photo and admin-import extension schemas**

**Stage:** S1 · **Responsible role:** Backend/data · **Work packages:** E36, E41

**Depends on:** [P2-PR-003](phase-2-prs.md#p2-pr-003), [P2-PR-001](phase-2-prs.md#p2-pr-001)

**Trace:** CAP-04, CAP-07, DB22, DB26. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Add private photo upload/extraction/candidate/confirmed-field records and compound owner keys.
- [ ] Extend P1 import templates/review/status metadata only where required for P2 staff CSV workflow.
- [ ] Migrate file retention, processing-choice and job cancellation references without duplicating existing source/import truth.

**Verification and acceptance:** Wrong-owner FK, pending/complete extraction state, immutable confirmation and upgrade tests pass.

### P2-PR-005

**Close Phase 2 schema and upgrade gate**

**Stage:** S1 · **Responsible role:** Backend/QA · **Work packages:** E04, E21, E36, E39, E40, E41

**Depends on:** [P2-PR-002](phase-2-prs.md#p2-pr-002), [P2-PR-003](phase-2-prs.md#p2-pr-003), [P2-PR-004](phase-2-prs.md#p2-pr-004), [P2-PR-001](phase-2-prs.md#p2-pr-001)

**Trace:** DB12, DB23, DB24, DB25, DB26, DB28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run empty and P1-to-P2 migrations with tenant and AI/photo constraints.
- [ ] Verify storage grants, index plans, purge ordering and backward-compatible deployment/backfill strategy.
- [ ] Record S1 approval and a rollback/restore drill with P1 access still supported.

**Verification and acceptance:** All P2 schema tests pass on real PostgreSQL before repository implementation starts.

### P2-PR-006

**Implement tenant, offer and pilot reporting repositories**

**Stage:** S2 · **Responsible role:** Backend · **Work packages:** E21, E22, E23, E24, E25

**Depends on:** [P2-PR-005](phase-2-prs.md#p2-pr-005)

**Trace:** UC11, DB09, DB10, DB12. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement pure tenant/offer/coupon entities and row/DTO mappers with organization-scoped ports.
- [ ] Implement code/cap/reservation locking and immutable offer selection plus correction ledgers.
- [ ] Implement masked pilot/redemption/visitor/aggregate query projections and purpose-specific grants.

**Verification and acceptance:** Real RLS/transaction/cross-tenant tests and last-code/cap races pass; no recipient identity in partner projections.

### P2-PR-007

**Implement AI, photo and import-review repositories**

**Stage:** S2 · **Responsible role:** Backend/data · **Work packages:** E36, E39, E40, E41

**Depends on:** [P2-PR-005](phase-2-prs.md#p2-pr-005)

**Trace:** UC13, UC14, UC15, UC16, DB22, DB23, DB24, DB25, DB26. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement typed inference/artifact/scope/budget/attachment repositories and canonical input manifests.
- [ ] Implement fenced exact-key claims, source invalidation queries, owner-scoped photo/candidate/confirmation persistence.
- [ ] Implement import review/diff projections and deletion/cancellation adapters using P1 storage abstractions.

**Verification and acceptance:** Unit mapper and real lease/budget/ownership/expiry tests pass; one connection owns each transaction.

### P2-PR-008

**Close Phase 2 data-access gate**

**Stage:** S2 · **Responsible role:** Backend/QA · **Work packages:** E04, E21, E36, E39, E40, E41

**Depends on:** [P2-PR-006](phase-2-prs.md#p2-pr-006), [P2-PR-007](phase-2-prs.md#p2-pr-007), [P2-PR-005](phase-2-prs.md#p2-pr-005)

**Trace:** ENG-03, ENG-04, ENG-05. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Audit new entity/row/wire boundaries and sharing of existing repository ports.
- [ ] Prove P1 regression, realistic query/lease contention and rollback/deletion behavior.
- [ ] Publish S2 evidence, risks and revised P2 estimate before service construction.

**Verification and acceptance:** All new repositories pass real DB integration; no provider SDK or ORM leaks into pure models.

### P2-PR-009

**Implement reseller verification and offer moderation**

**Stage:** S3 · **Responsible role:** Backend/partners · **Work packages:** E21, E22

**Depends on:** [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** UC11, AT15. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement onboarding agreements, verification, roles/MFA, suspension and organization lifecycle.
- [ ] Implement versioned offer drafting/target validation/moderation with safe URL/file handling.
- [ ] Implement code CSV quarantine/dedupe/import and restricted reveal through durable jobs.

**Verification and acceptance:** Use-case tests deny pending/suspended serving, preserve published offers during edits and prevent cross-tenant access.

### P2-PR-010

**Implement matching, coupon allocation and pilot delivery**

**Stage:** S3 · **Responsible role:** Backend · **Work packages:** E23

**Depends on:** [P2-PR-009](phase-2-prs.md#p2-pr-009), [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** UC06, UC08, UC11, AT09, AT10, DB09, DB10. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement deterministic nonpaid matching and simulation with maximum three offers/one per seller.
- [ ] Reserve unique codes, per-offer/monthly caps and slots atomically; quarantine uncertain sends.
- [ ] Recheck purpose before dispatch, remove ineligible offers and preserve separately requested report-only delivery.

**Verification and acceptance:** Two-worker last-code/cap and withdrawal races pass; no cash billing or ranking effect in the pilot.

### P2-PR-011

**Implement partner insights, disputes and consented operations**

**Stage:** S3 · **Responsible role:** Backend/privacy · **Work packages:** E24, E25

**Depends on:** [P2-PR-009](phase-2-prs.md#p2-pr-009), [P2-PR-010](phase-2-prs.md#p2-pr-010), [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** UC09, UC11, AT13, AT15. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement aggregate partner includes/clicks/issues/redemption reporting and append-only corrections/disputes.
- [ ] Implement deliverability/domain health and role-masked consented visitor explorer.
- [ ] Implement internal aggregate insights with minimum-cell/differencing safeguards and privacy deletion propagation.

**Verification and acceptance:** Partner/analyst permission tests, scanner exclusion and small-cell suppression pass; no identity export through aggregates.

### P2-PR-012

**Implement bounded AI report analysis and validation**

**Stage:** S3 · **Responsible role:** Backend/data · **Work packages:** E39

**Depends on:** [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** CAP-05, UC14, AT23, DB23. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build minimized versioned evidence packets, explicit processing-choice checks and strict output contracts.
- [ ] Implement the server provider port, deadline/refusal/incomplete response handling and grounded claim/citation/number validation.
- [ ] Publish accepted immutable report enrichment or deterministic fallback without mutating rankings/safety/costs.

**Verification and acceptance:** Unit/provider-contract/use-case tests reject unsupported facts and unsafe output; core report stays available on AI failure.

### P2-PR-013

**Implement exact AI reuse, refresh and cost admission**

**Stage:** S3 · **Responsible role:** Backend · **Work packages:** E40

**Depends on:** [P2-PR-012](phase-2-prs.md#p2-pr-012), [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** CAP-06, UC15, AT24, AT25, DB24, DB25. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement canonical exact keys over parameters, source/engine/model/prompt/schema/policy and scope; enforce reviewed generic versus private reuse.
- [ ] Implement read-time invalidation, expiry, hourly bounded popular-key refresh and leased/fenced publication.
- [ ] Reserve/settle per-attempt cost budgets, retain uncertain reservations and enforce bounded retry/circuit-breaker behavior.

**Verification and acceptance:** Concurrent hit/miss/refresh/price-budget tests pass; no stale, cross-owner or late-worker result is published.

### P2-PR-014

**Implement private tire-photo processing and confirmation**

**Stage:** S3 · **Responsible role:** Platform/backend · **Work packages:** E41

**Depends on:** [P2-PR-012](phase-2-prs.md#p2-pr-012), [P2-PR-013](phase-2-prs.md#p2-pr-013), [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** CAP-07, UC16, AT26, DB26. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement owner-bound upload intent/finalize, quotas, quarantine, bounded decode/scan/re-encode and metadata removal.
- [ ] Send sanitized images through the extraction port; return per-field candidates/quality/partial-DOT states.
- [ ] Implement explicit confirm/correct/delete commands through ordinary domain validators; retain manual input path.

**Verification and acceptance:** Malicious/oversized/unreadable images and forged owner/finalize/confirmation tests pass; no photo establishes condition or approved fitment.

### P2-PR-015

**Integrate AI/photo privacy and frozen report delivery**

**Stage:** S3 · **Responsible role:** Backend/privacy · **Work packages:** E14, E39, E40, E41

**Depends on:** [P2-PR-012](phase-2-prs.md#p2-pr-012), [P2-PR-013](phase-2-prs.md#p2-pr-013), [P2-PR-014](phase-2-prs.md#p2-pr-014), [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** UC06, UC09, UC14, UC15, UC16, AT23, AT25, DB23, DB25. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Freeze selected AI attachment or no-AI fallback in email/PDF presentation identities; never regenerate on retry or auto-resend.
- [ ] Extend deletion/withdrawal/tombstone jobs to requests, reuse entries, artifacts, images, provider files and attempts.
- [ ] Preserve confirmed report facts under their retention policy while purging expired images/candidates and usable image links.

**Verification and acceptance:** Delete/withdraw during provider return and restore replay cannot recreate data; fixed send payload and shared-view redaction tests pass.

### P2-PR-016

**Implement staff CSV review and publication workflow**

**Stage:** S3 · **Responsible role:** Data/backend · **Work packages:** E36

**Depends on:** [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** CAP-04, UC13, AT21, AT22, DB22. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Expose versioned template/mapping/upload/validation/diff/approval/publish/cancel services over P1 ingestion.
- [ ] Implement bounded CSV validation and safe exported error reports without arbitrary SQL or URL fetching.
- [ ] Implement separation of reviewer/publisher permissions and stale-head conflict recovery.

**Verification and acceptance:** Script/admin parity, malformed/formula CSV, rejected critical rows and simultaneous publish tests pass.

### P2-PR-017

**Accept Phase 2 services and evaluate real model behavior**

**Stage:** S3 · **Responsible role:** Data/QA/privacy · **Work packages:** E26, E36, E39, E40, E41

**Depends on:** [P2-PR-009](phase-2-prs.md#p2-pr-009), [P2-PR-010](phase-2-prs.md#p2-pr-010), [P2-PR-011](phase-2-prs.md#p2-pr-011), [P2-PR-012](phase-2-prs.md#p2-pr-012), [P2-PR-013](phase-2-prs.md#p2-pr-013), [P2-PR-014](phase-2-prs.md#p2-pr-014), [P2-PR-015](phase-2-prs.md#p2-pr-015), [P2-PR-016](phase-2-prs.md#p2-pr-016), [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** UC11, UC13, UC14, UC15, UC16, AT23, AT24, AT25, AT26. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run partner/import/AI/photo service journeys with real repositories and allowed provider sandbox calls.
- [ ] Evaluate at least 50 explanation cases and 50 representative labeled tire images against agreed critical-error and precision/abstention gates.
- [ ] Approve P2 S3/G2/G7 evidence, budgets and privacy/retention controls; keep failures blocked.

**Verification and acceptance:** No observed critical model misclaim, all server confirmation gates enforced, and real provider evidence available before API/UI acceptance.

### P2-PR-018

**Expose reseller and staff CSV/operations APIs**

**Stage:** S4 · **Responsible role:** Backend · **Work packages:** E21, E22, E23, E24, E25, E36, E34

**Depends on:** [P2-PR-017](phase-2-prs.md#p2-pr-017)

**Trace:** UC11, UC13, AT09, AT15, AT22. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Expose scoped organization/offer/moderation/reservation/simulation/reporting/dispute endpoints.
- [ ] Expose private import upload/template/diff/approval/status/rollback and masked operations endpoints.
- [ ] Add versioned contracts, MFA/roles/RLS, quotas, idempotency, expected revisions and audit.

**Verification and acceptance:** Running HTTP tenant/CSV/race tests pass; guessing IDs or injecting file/URL data cannot bypass shared services.

### P2-PR-019

**Expose AI analysis and photo APIs**

**Stage:** S4 · **Responsible role:** Backend · **Work packages:** E39, E40, E41, E34

**Depends on:** [P2-PR-017](phase-2-prs.md#p2-pr-017)

**Trace:** UC14, UC15, UC16, AT23, AT24, AT25, AT26. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Expose owner analysis request/status/attachment and private photo upload/finalize/extract/confirm/delete endpoints.
- [ ] Document pending/available/unavailable/expired states, input limits, processing notices and exact reuse semantics.
- [ ] Enforce ownership, explicit action, quotas/cost admission, CSRF and idempotency; deny share-only invocation.

**Verification and acceptance:** HTTP tests prove unauthorized callers cannot infer prompts/images, trigger charges or apply unconfirmed fields.

### P2-PR-020

**Accept all Phase 2 APIs before new frontend work**

**Stage:** S4 · **Responsible role:** QA/backend · **Work packages:** E34, E26

**Depends on:** [P2-PR-018](phase-2-prs.md#p2-pr-018), [P2-PR-019](phase-2-prs.md#p2-pr-019), [P2-PR-017](phase-2-prs.md#p2-pr-017)

**Trace:** CAP-01, CAP-04, CAP-05, CAP-06, CAP-07. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Demonstrate photo confirmation → deterministic report → validated analysis/reuse → frozen delivery and deletion headlessly.
- [ ] Demonstrate tenant onboarding/moderation/last-code and admin CSV publish flows through real APIs.
- [ ] Run P1 regression and mixed worker/DB load; publish P2 S4 acceptance and generated clients.

**Verification and acceptance:** All P2 API categories pass together; neither AI-only nor reseller-only acceptance opens the frontend gate.

### P2-PR-021

**Build reseller onboarding, offers and pilot portal**

**Stage:** S5 · **Responsible role:** Frontend/partners · **Work packages:** E21, E22, E23, E24

**Depends on:** [P2-PR-020](phase-2-prs.md#p2-pr-020)

**Trace:** UC11, AT09, AT15. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build verification/agreements/member controls and pending/suspended states.
- [ ] Build draft/target/moderation/code-pool/simulation controls through accepted APIs.
- [ ] Build aggregate pilot-credit/redemption/dispute views with correct labels and no recipient details.

**Verification and acceptance:** Tenant/browser/accessibility tests pass; pilot portal has no inferred charges or paid ranking controls.

### P2-PR-022

**Build staff CSV import and partner moderation screens**

**Stage:** S5 · **Responsible role:** Frontend/data · **Work packages:** E22, E36

**Depends on:** [P2-PR-020](phase-2-prs.md#p2-pr-020)

**Trace:** UC11, UC13, AT21, AT22. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build template download, private upload, validation/mapping/diff/rejection preview and job progress.
- [ ] Build approval/publish/head-conflict/rollback actions with required roles and audit feedback.
- [ ] Build partner verification/offer moderation queues without table-edit shortcuts.

**Verification and acceptance:** Large/error CSV, role separation, retry/resume and keyboard/reflow tests match script behavior.

### P2-PR-023

**Build AI-assisted report and delivery presentation**

**Stage:** S5 · **Responsible role:** Frontend/content · **Work packages:** E39, E40

**Depends on:** [P2-PR-020](phase-2-prs.md#p2-pr-020)

**Trace:** UC14, UC15, AT23, AT24. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Add explicit assistance choice and separate labeled/cited explanation with generation/source/reuse dates.
- [ ] Render pending/unavailable/expired/refreshed states and deterministic fallback without blocking core actions.
- [ ] Update email/PDF templates to render the chosen frozen attachment and redacted shared-view policy.

**Verification and acceptance:** Browser and renderer tests preserve authoritative facts, old versions and send identity; AI completion sends no unsolicited email.

### P2-PR-024

**Build web tire-photo upload and field confirmation**

**Stage:** S5 · **Responsible role:** Frontend · **Work packages:** E41

**Depends on:** [P2-PR-020](phase-2-prs.md#p2-pr-020)

**Trace:** UC16, AT26. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build optional photo capture/upload purpose notice, bounds, progress and quality/retake states.
- [ ] Display per-field candidates with unknown/conflicting/partial readings and explicit correction/confirmation.
- [ ] Support manual entry, image removal and expiry without losing the usable assessment.

**Verification and acceptance:** Keyboard/mobile/browser tests prove no candidate changes inputs before confirmation and all failure paths offer manual recovery.

### P2-PR-025

**Build AI/privacy and pilot operations dashboards**

**Stage:** S5 · **Responsible role:** Frontend/platform · **Work packages:** E25, E39, E40, E41

**Depends on:** [P2-PR-020](phase-2-prs.md#p2-pr-020)

**Trace:** UC09, UC11, UC15, UC16. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Expose safe AI cost/admission/rejection/reuse/invalidation and photo correction/purge health metrics.
- [ ] Add staff retry/disable controls that cannot bypass privacy, budgets or critical validation.
- [ ] Extend privacy/consent and deliverability/visitor operations screens using purpose-scoped projections.

**Verification and acceptance:** Role and browser tests show no private prompts/images in analytics; kill switches preserve deterministic/manual product paths.

### P2-PR-026

**Verify assisted advice, privacy and partner security**

**Stage:** S6 · **Responsible role:** QA/security · **Work packages:** E26, E39, E40, E41

**Depends on:** [P2-PR-021](phase-2-prs.md#p2-pr-021), [P2-PR-022](phase-2-prs.md#p2-pr-022), [P2-PR-023](phase-2-prs.md#p2-pr-023), [P2-PR-024](phase-2-prs.md#p2-pr-024), [P2-PR-025](phase-2-prs.md#p2-pr-025)

**Trace:** UC11, UC13, UC14, UC15, UC16, AT09, AT15, AT23, AT24, AT25, AT26. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run full assisted-report/import/partner browser journeys and real email/PDF integration.
- [ ] Perform partner isolation/security review, malicious upload and AI deletion/withdrawal races; rerun model evaluation if its configuration changed.
- [ ] Verify accessibility, P1 regression, mixed load/cost caps, restore/purge and support playbooks.

**Verification and acceptance:** G2/G4/G6/G7 evidence passes; no private-data leak, critical AI failure, duplicate coupon or broken existing live journey.

### P2-PR-027

**Release Phase 2 assistance and reseller pilot**

**Stage:** S6 · **Responsible role:** Product/platform · **Work packages:** E26

**Depends on:** [P2-PR-026](phase-2-prs.md#p2-pr-026), [P2-PR-021](phase-2-prs.md#p2-pr-021), [P2-PR-022](phase-2-prs.md#p2-pr-022), [P2-PR-023](phase-2-prs.md#p2-pr-023), [P2-PR-024](phase-2-prs.md#p2-pr-024), [P2-PR-025](phase-2-prs.md#p2-pr-025)

**Trace:** CAP-01, CAP-04, CAP-05, CAP-06, CAP-07, UC18. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Approve controlled rollout, provider/cost/notice configuration and staffed support.
- [ ] Demonstrate real web photo confirmation, available AI or explicit fallback, exact reuse and staff CSV publication.
- [ ] Onboard the agreed 5–10 verified pilot resellers and record real moderated offer journey, production metrics and rollback evidence.

**Verification and acceptance:** P2 is live with required capabilities and actual pilot evidence; external gaps keep the phase open, while P1 stays usable.
