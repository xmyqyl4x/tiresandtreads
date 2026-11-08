# Phase 2 — assisted advice and reseller pilot

**Working PR decomposition 1.0 · October 23, 2026.** 27 planned PRs. Scope comes from the approved [four-phase baseline](../12-live-product-phases-and-gap-review.md); this breakdown adds execution detail without approving new capabilities. Local P2-PR-001 preparation and P2-PR-002 groundwork have an explicit owner sequencing exception; actual phase acceptance remains open. The [master task list](../15-project-task-list.md) is the authoritative status/assignee/PR/evidence ledger.

**Live outcome:** The live site supports confirmed photo inputs, grounded AI analysis/reuse, staff CSV publication and 5–10 verified pilot resellers.

**Phase entry:** Acceptance of [P1-PR-043](phase-1-prs.md#p1-pr-043) and a recorded phase scope/estimate review. Every listed dependency means merged **and accepted with required evidence**, not just an open PR. New product UI/templates wait for [P2-PR-020](phase-2-prs.md#p2-pr-020). Read the [TDD](../08-test-driven-development.md), [schema](../09-database-design.md), [coding](../10-coding-standards.md), [domain imports](../13-domain-data-and-imports.md) and [AI/photo](../14-ai-analysis-and-photo-design.md) contracts before the affected work.

**Owner-directed local exception after PR #88:** [Scope and evaluation preparation](../implementation/P2-PR-001-local-scope-evaluation.md) and the [authorization record](../implementation/evidence/P2/local-phase-2-authorization.json) permit only draft P2-PR-001 inputs and opt-in local P2-PR-002 reseller schemas before Phase 1 live acceptance. The ordinary accepted dependency edges, all actual phase gates, provider/operator decisions and deployment restrictions remain. Future cards require their own satisfied dependencies or explicit scope.

**Next-card local continuation after PR #90:** The owner selected [P2-PR-003 local AI schemas](../implementation/P2-PR-003-local-ai-schema.md), recorded in a [separate continuation](../implementation/evidence/P2/p2-pr-003-local-authorization.json). This extends disposable local implementation/testing only to card 003; ordinary dependency acceptance, phase entry, all gates and deployment/provider/operator holds remain unchanged. No later card is authorized by that record.

**Next-card local continuation after PR #91:** The owner selected [P2-PR-004 local photo/CSV schemas](../implementation/P2-PR-004-local-photo-import-schema.md), recorded in a [separate continuation](../implementation/evidence/P2/p2-pr-004-local-authorization.json). This permits card 004 local implementation/testing and merge only. Actual phase/schema acceptance, all six S3 gates and deployment/provider/operator holds remain unchanged; card 005 acceptance is not implied.

**Next-card local continuation after PR #92:** The owner selected [P2-PR-005 local schema/upgrade validation](../implementation/P2-PR-005-local-schema-upgrade-validation.md), recorded in a [separate continuation](../implementation/evidence/P2/p2-pr-005-local-authorization.json). Card 005 local proof work and merge are allowed; actual S1 approval, phase entry, promotion, all six S3 gates and deployment/provider/operator holds remain open. The pending approval record does not accept later repository cards.

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

**Local preparation completed:**

- [x] Draft the noncharging pilot onboarding and actual-input checklist without contacting prospects.
- [x] Record provider/prompt/schema/rights/budget/retention direction with actual decisions unconfirmed.
- [x] Prepare 24 synthetic evaluation case templates, actual benchmark/threshold requirements and a provisional dependency/effort forecast.

[Local packet](../implementation/P2-PR-001-local-scope-evaluation.md). The original three acceptance-dependent tasks above remain open; no specialist labels or actual evaluations are claimed.

**Verification and acceptance:** P2 G0/provider/privacy feasibility record is accepted; no AI correctness or network agreement is inferred from a mock.

### P2-PR-002

**Create organization, offer and coupon schemas**

**Stage:** S1 · **Responsible role:** Backend · **Work packages:** E21, E22, E23, E24, E25

**Depends on:** [P2-PR-001](phase-2-prs.md#p2-pr-001)

**Trace:** UC11, DB09, DB10, DB12. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Add organizations/memberships/agreements/verification/locations and scoped runtime RLS.
- [x] Add immutable offer/target/pool/code/reservation/cap/decision records and correction/redemption/dispute persistence.
- [x] Add privacy-scoped visitor/internal aggregate support only where absent from P1; preserve noncharging pilot semantics.

**Local implementation:** [Opt-in reseller schema](../implementation/P2-PR-002-local-reseller-schema.md) completes these three tasks only in the owner-authorized disposable local track. Three migrations, 23 forced-RLS tables and 44 native cases are implemented; ordinary P1 manifests/bootstrap/CLI/preflight and all actual acceptance/deployment holds remain unchanged. P2 S1 and promotion remain open.

**Verification and acceptance:** Real constraints and RLS deny wrong-tenant parents and double live codes; upgrade preserves P1 records.

### P2-PR-003

**Create AI policy, artifact, reuse and budget schemas**

**Stage:** S1 · **Responsible role:** Backend · **Work packages:** E39, E40

**Depends on:** [P2-PR-001](phase-2-prs.md#p2-pr-001)

**Trace:** CAP-05, CAP-06, DB23, DB24, DB25. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Migrate policy/scopes/requests/attempts/artifacts/source links and exact reuse entry/lease/fence structures.
- [x] Add immutable report-analysis attachment and frozen delivery selection references.
- [x] Add atomic AI budget windows/reservations, expiry/reverse-source indexes and deletion linkage.

**Local implementation:** [Opt-in AI storage and evidence](../implementation/P2-PR-003-local-ai-schema.md) completes these three tasks in the owner-selected disposable track: three migrations, twelve forced-RLS tables, two guarded views and 75 native cases. Actual P2 feasibility/S1, production promotion, provider/model/budget/privacy acceptance and later orchestration remain held. Default P1/partner sources, models, bootstrap/CLI/preflight and policy are unchanged.

**Verification and acceptance:** Scope/policy/request composite FK tests and budget bounds pass; no shared scope can silently substitute for an owner scope.

### P2-PR-004

**Create photo and admin-import extension schemas**

**Stage:** S1 · **Responsible role:** Backend/data · **Work packages:** E36, E41

**Depends on:** [P2-PR-003](phase-2-prs.md#p2-pr-003), [P2-PR-001](phase-2-prs.md#p2-pr-001)

**Trace:** CAP-04, CAP-07, DB22, DB26. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Add private photo upload/extraction/candidate/confirmed-field records and compound owner keys.
- [x] Extend P1 import templates/review/status metadata only where required for P2 staff CSV workflow.
- [x] Migrate file retention, processing-choice and job cancellation references without duplicating existing source/import truth.

**Local implementation:** [Opt-in photo/import storage and evidence](../implementation/P2-PR-004-local-photo-import-schema.md) completes the three tasks in the owner-selected disposable track: three migrations, eight forced-RLS tables, five guarded views and 83 native cases. Existing P1 import/assets/jobs and AI processing authority remain authoritative. Actual file processing, P2 S1/promotion, privacy/restore/provider acceptance and later services stay held; default bootstrap/CLI/preflight, prior sources and models are unchanged.

**Verification and acceptance:** Wrong-owner FK, pending/complete extraction state, immutable confirmation and upgrade tests pass.

### P2-PR-005

**Close Phase 2 schema and upgrade gate**

**Stage:** S1 · **Responsible role:** Backend/QA · **Work packages:** E04, E21, E36, E39, E40, E41

**Depends on:** [P2-PR-002](phase-2-prs.md#p2-pr-002), [P2-PR-003](phase-2-prs.md#p2-pr-003), [P2-PR-004](phase-2-prs.md#p2-pr-004), [P2-PR-001](phase-2-prs.md#p2-pr-001)

**Trace:** DB12, DB23, DB24, DB25, DB26, DB28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Run empty and P1-to-P2 migrations with tenant and AI/photo constraints.
- [x] Verify storage grants, index plans, purge ordering and backward-compatible deployment/backfill strategy.
- [ ] Record S1 approval and a rollback/restore drill with P1 access still supported.

**Local validation completed:** [Combined schema/upgrade packet](../implementation/P2-PR-005-local-schema-upgrade-validation.md) covers fresh/populated migrations, all-table archive parity, original P1 repository access, grants, existing measured plans, fixed photo purge and synthetic erasure replay. The [S1 record](../implementation/evidence/P2/p2-s1-local-readiness.json) stays pending. The rollback/restore drill is complete locally; the original combined approval task above remains unchecked because actual S1 approval is held. This is no gate closure or ordinary accepted dependency for P2-PR-006.

**Verification and acceptance:** All P2 schema tests pass on real PostgreSQL before repository implementation starts.

### P2-PR-006

**Implement tenant, offer and pilot reporting repositories**

**Stage:** S2 · **Responsible role:** Backend · **Work packages:** E21, E22, E23, E24, E25

**Depends on:** [P2-PR-005](phase-2-prs.md#p2-pr-005)

**Trace:** UC11, DB09, DB10, DB12. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement pure tenant/offer/coupon entities and row/DTO mappers with organization-scoped ports.
- [x] Implement code/cap/reservation locking and immutable offer selection plus correction ledgers.
- [x] Implement masked pilot/redemption/visitor/aggregate query projections and purpose-specific grants.

**Verification and acceptance:** Real RLS/transaction/cross-tenant tests and last-code/cap races pass; no recipient identity in partner projections.

**Local implementation completed:** [Repository packet](../implementation/P2-PR-006-local-partner-repositories.md) and [focused proof](../implementation/evidence/P2/p2-pr-006-local-proof.json) cover the three tasks in the owner-authorized disposable track. Actual S1 approval remains pending; this local continuation is an explicit exception to the ordinary accepted dependency. Actual S2/pilot/privacy/source/provider/deployment acceptance and all existing holds remain open; no original case or gate closes. P2-PR-007 is not implemented by this card.

### P2-PR-007

**Implement AI, photo and import-review repositories**

**Stage:** S2 · **Responsible role:** Backend/data · **Work packages:** E36, E39, E40, E41

**Depends on:** [P2-PR-005](phase-2-prs.md#p2-pr-005)

**Trace:** UC13, UC14, UC15, UC16, DB22, DB23, DB24, DB25, DB26. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement typed inference/artifact/scope/budget/attachment repositories and canonical input manifests.
- [x] Implement fenced exact-key claims, source invalidation queries, owner-scoped photo/candidate/confirmation persistence.
- [x] Implement import review/diff projections and deletion/cancellation adapters using P1 storage abstractions.

**Verification and acceptance:** Unit mapper and real lease/budget/ownership/expiry tests pass; one connection owns each transaction.

**Local implementation completed:** [Repository packet](../implementation/P2-PR-007-local-analysis-repositories.md) and [focused proof](../implementation/evidence/P2/p2-pr-007-local-proof.json) cover the three tasks in the owner-authorized disposable track. Actual S1 approval remains pending; this is an explicit local exception to the accepted dependency. Actual S2/privacy/source/provider/restore/deployment acceptance and all existing holds remain open. No original case or gate closes; P2-PR-008 is not implemented here.

### P2-PR-008

**Close Phase 2 data-access gate**

**Stage:** S2 · **Responsible role:** Backend/QA · **Work packages:** E04, E21, E36, E39, E40, E41

**Depends on:** [P2-PR-006](phase-2-prs.md#p2-pr-006), [P2-PR-007](phase-2-prs.md#p2-pr-007), [P2-PR-005](phase-2-prs.md#p2-pr-005)

**Trace:** ENG-03, ENG-04, ENG-05. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Audit new entity/row/wire boundaries and sharing of existing repository ports.
- [x] Prove P1 regression, realistic query/lease contention and rollback/deletion behavior.
- [x] Publish S2 evidence, risks and revised P2 estimate before service construction.

**Verification and acceptance:** All new repositories pass real DB integration; no provider SDK or ORM leaks into pure models.

**Local validation completed:** [S2 packet](../implementation/P2-PR-008-local-data-access-validation.md) and [source-bound proof](../implementation/evidence/P2/p2-pr-008-local-proof.json) cover the three local tasks. [Actual S2 readiness](../implementation/evidence/P2/p2-s2-local-readiness.json) remains pending with no approval records; actual S1 is also pending. This owner-authorized local exception closes no gate or design case and starts no P2-PR-009 service.

### P2-PR-009

**Implement reseller verification and offer moderation**

**Stage:** S3 · **Responsible role:** Backend/partners · **Work packages:** E21, E22

**Depends on:** [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** UC11, AT15. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement onboarding agreements, verification, roles/MFA, suspension and organization lifecycle.
- [x] Implement versioned offer drafting/target validation/moderation with safe URL/file handling.
- [x] Implement code CSV quarantine/dedupe/import and restricted reveal through durable jobs.

**Verification and acceptance:** Use-case tests deny pending/suspended serving, preserve published offers during edits and prevent cross-tenant access.

**Local implementation complete:** [Service packet](../implementation/P2-PR-009-local-reseller-services.md) and [source-bound evidence](../implementation/evidence/P2/p2-pr-009-local-proof.json) cover the three local tasks under the owner-authorized exception. Actual S1/S2, authentication/provider/privacy/pilot/deployment acceptance and all six S3 gates remain pending. No case or gate closed in P2-PR-009; the separately authorized local P2-PR-010 work is recorded below.

### P2-PR-010

**Implement matching, coupon allocation and pilot delivery**

**Stage:** S3 · **Responsible role:** Backend · **Work packages:** E23

**Depends on:** [P2-PR-009](phase-2-prs.md#p2-pr-009), [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** UC06, UC08, UC11, AT09, AT10, DB09, DB10. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement deterministic nonpaid matching and simulation with maximum three offers/one per seller.
- [x] Reserve unique codes, per-offer/monthly caps and slots atomically; quarantine uncertain sends.
- [x] Recheck purpose before dispatch, remove ineligible offers and preserve separately requested report-only delivery.

**Verification and acceptance:** Two-worker last-code/cap and withdrawal races pass; no cash billing or ranking effect in the pilot.

**Local implementation complete:** [Service packet](../implementation/P2-PR-010-local-matching-delivery.md) and [source-bound evidence](../implementation/evidence/P2/p2-pr-010-local-proof.json) cover the three local tasks under the owner-authorized exception. Actual S1/S2, authentication/MFA/privacy/source/restore/provider/pilot/deployment acceptance and all six S3 gates remain pending. No case or gate closes; subsequent local services are tracked under P2-PR-011.

### P2-PR-011

**Implement partner insights, disputes and consented operations**

**Stage:** S3 · **Responsible role:** Backend/privacy · **Work packages:** E24, E25

**Depends on:** [P2-PR-009](phase-2-prs.md#p2-pr-009), [P2-PR-010](phase-2-prs.md#p2-pr-010), [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** UC09, UC11, AT13, AT15. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement aggregate partner includes/clicks/issues/redemption reporting and append-only corrections/disputes.
- [x] Implement deliverability/domain health and role-masked consented visitor explorer.
- [x] Implement internal aggregate insights with minimum-cell/differencing safeguards and privacy deletion propagation.

**Verification and acceptance:** Partner/analyst permission tests, scanner exclusion and small-cell suppression pass; no identity export through aggregates.

**Local implementation complete:** [Service packet](../implementation/P2-PR-011-local-partner-insights.md) and [source-bound evidence](../implementation/evidence/P2/p2-pr-011-local-proof.json) cover the three local tasks under the existing owner-authorized exception. Actual S1/S2, privacy/rights, authentication/MFA, source/restore/provider/pilot/deployment acceptance and all six S3 gates remain pending. No original case or gate closes. Subsequent authorized local services are tracked under P2-PR-012.

### P2-PR-012

**Implement bounded AI report analysis and validation**

**Stage:** S3 · **Responsible role:** Backend/data · **Work packages:** E39

**Depends on:** [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** CAP-05, UC14, AT23, DB23. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Build minimized versioned evidence packets, explicit processing-choice checks and strict output contracts.
- [x] Implement the server provider port, deadline/refusal/incomplete response handling and grounded claim/citation/number validation.
- [x] Publish accepted immutable report enrichment or deterministic fallback without mutating rankings/safety/costs.

**Verification and acceptance:** Unit/provider-contract/use-case tests reject unsupported facts and unsafe output; core report stays available on AI failure.

**Local implementation complete:** [Service packet](../implementation/P2-PR-012-local-report-analysis.md) and [source-bound evidence](../implementation/evidence/P2/p2-pr-012-local-proof.json) cover these three local tasks under the owner-authorized exception. Actual S1/S2, specialist/model quality, provider, full privacy/rights, source/restore/deployment acceptance and all six S3 gates remain pending. No original case or gate closes. P2-PR-013 is the next authorized local scope.

### P2-PR-013

**Implement exact AI reuse, refresh and cost admission**

**Stage:** S3 · **Responsible role:** Backend · **Work packages:** E40

**Depends on:** [P2-PR-012](phase-2-prs.md#p2-pr-012), [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** CAP-06, UC15, AT24, AT25, DB24, DB25. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement canonical exact keys over parameters, source/engine/model/prompt/schema/policy and scope; enforce reviewed generic versus private reuse.
- [x] Implement read-time invalidation, expiry, hourly bounded popular-key refresh and leased/fenced publication.
- [x] Reserve/settle per-attempt cost budgets, retain uncertain reservations and enforce bounded retry/circuit-breaker behavior.

**Verification and acceptance:** Concurrent hit/miss/refresh/price-budget tests pass; no stale, cross-owner or late-worker result is published.

**Local implementation complete:** [Service packet](../implementation/P2-PR-013-local-ai-reuse.md) and [source-bound evidence](../implementation/evidence/P2/p2-pr-013-local-proof.json) cover these three local tasks under the owner-authorized exception. Actual S1/S2, provider/model/cost/privacy/authentication, source/recovery and deployment acceptance and all six S3 gates remain pending. No case or gate closes. P2-PR-014 is the next authorized local scope.

### P2-PR-014

**Implement private tire-photo processing and confirmation**

**Stage:** S3 · **Responsible role:** Platform/backend · **Work packages:** E41

**Depends on:** [P2-PR-012](phase-2-prs.md#p2-pr-012), [P2-PR-013](phase-2-prs.md#p2-pr-013), [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** CAP-07, UC16, AT26, DB26. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Implement owner-bound upload intent/finalize, quotas, quarantine, bounded decode/scan/re-encode and metadata removal.
- [x] Send sanitized images through the extraction port; return per-field candidates/quality/partial-DOT states.
- [x] Implement explicit confirm/correct/delete commands through ordinary domain validators; retain manual input path.

**Verification and acceptance:** Malicious/oversized/unreadable images and forged owner/finalize/confirmation tests pass; no photo establishes condition or approved fitment.

**Local implementation complete:** [Service packet](../implementation/P2-PR-014-local-photo-services.md) and [source-bound evidence](../implementation/evidence/P2/p2-pr-014-local-proof.json) cover these three local tasks under the owner-authorized exception. Actual S1/S2, real scanner/model/provider quality, full privacy/rights/source/recovery/authentication and deployment acceptance and all six S3 gates remain pending. No case or gate closes. P2-PR-015 remains the next backlog card.

### P2-PR-015

**Integrate AI/photo privacy and frozen report delivery**

**Stage:** S3 · **Responsible role:** Backend/privacy · **Work packages:** E14, E39, E40, E41

**Depends on:** [P2-PR-012](phase-2-prs.md#p2-pr-012), [P2-PR-013](phase-2-prs.md#p2-pr-013), [P2-PR-014](phase-2-prs.md#p2-pr-014), [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** UC06, UC09, UC14, UC15, UC16, AT23, AT25, DB23, DB25. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Freeze selected AI attachment or no-AI fallback in email/PDF presentation identities; never regenerate on retry or auto-resend.
- [x] Extend deletion/withdrawal/tombstone jobs to requests, reuse entries, artifacts, images, provider files and attempts.
- [x] Preserve confirmed report facts under their retention policy while purging expired images/candidates and usable image links.

**Verification and acceptance:** Delete/withdraw during provider return and restore replay cannot recreate data; fixed send payload and shared-view redaction tests pass.

**Local implementation complete:** [The service packet](../implementation/P2-PR-015-local-ai-photo-privacy-delivery.md) and [source-bound evidence](../implementation/evidence/P2/p2-pr-015-local-proof.json) cover these three local tasks. Real provider/retention, full privacy/rights and latest-chain restore/custody acceptance remains held, as do all existing gates. No case/gate closes. P2-PR-016 is next.

### P2-PR-016

**Implement staff CSV review and publication workflow**

**Stage:** S3 · **Responsible role:** Data/backend · **Work packages:** E36

**Depends on:** [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** CAP-04, UC13, AT21, AT22, DB22. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Expose versioned template/mapping/upload/validation/diff/approval/publish/cancel services over P1 ingestion.
- [x] Implement bounded CSV validation and safe exported error reports without arbitrary SQL or URL fetching.
- [x] Implement separation of reviewer/publisher permissions and stale-head conflict recovery.

**Verification and acceptance:** Script/admin parity, malformed/formula CSV, rejected critical rows and simultaneous publish tests pass.

**Local implementation complete:** [The service packet](../implementation/P2-PR-016-local-staff-csv-services.md) and [source-bound evidence](../implementation/evidence/P2/p2-pr-016-local-proof.json) cover these three tasks in the opt-in disposable track. Default runtime/bootstrap/policy are unchanged; actual authentication, source/privacy and gate/deployment acceptance remain held. No case/gate closes.

### P2-PR-017

**Accept Phase 2 services and evaluate real model behavior**

**Stage:** S3 · **Responsible role:** Data/QA/privacy · **Work packages:** E26, E36, E39, E40, E41

**Depends on:** [P2-PR-009](phase-2-prs.md#p2-pr-009), [P2-PR-010](phase-2-prs.md#p2-pr-010), [P2-PR-011](phase-2-prs.md#p2-pr-011), [P2-PR-012](phase-2-prs.md#p2-pr-012), [P2-PR-013](phase-2-prs.md#p2-pr-013), [P2-PR-014](phase-2-prs.md#p2-pr-014), [P2-PR-015](phase-2-prs.md#p2-pr-015), [P2-PR-016](phase-2-prs.md#p2-pr-016), [P2-PR-008](phase-2-prs.md#p2-pr-008)

**Trace:** UC11, UC13, UC14, UC15, UC16, AT23, AT24, AT25, AT26. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run partner/import/AI/photo service journeys with real repositories and allowed provider sandbox calls.
- [ ] Evaluate at least 50 explanation cases and 50 representative labeled tire images against agreed critical-error and precision/abstention gates.
- [ ] Approve P2 S3/G2/G7 evidence, budgets and privacy/retention controls; keep failures blocked.

**Verification and acceptance:** No observed critical model misclaim, all server confirmation gates enforced, and real provider evidence available before API/UI acceptance.

**Authorized local preparation:**

- [x] Run combined latest-schema partner/CSV/photo/analysis/frozen-delivery journeys and local lifecycle adversarial tests with real repositories and owned local storage.
- [x] Implement an offline synthetic validator/evaluation rehearsal with bounded inputs, denominator accounting, split bookkeeping and aggregate-only output.
- [x] Reconcile current local evidence and record actual benchmark/provider/privacy/operator inputs still required.

[Local readiness packet](../implementation/P2-PR-017-local-service-readiness.md). These local tasks do not complete the three original acceptance tasks above. Actual50+50 evaluation, provider calls, agreed thresholds and P2 S3/G2/G7 sign-off remain pending; all existing holds remain and no case/gate closes.

### P2-PR-018

**Expose reseller and staff CSV/operations APIs**

**Stage:** S4 · **Responsible role:** Backend · **Work packages:** E21, E22, E23, E24, E25, E36, E34

**Depends on:** [P2-PR-017](phase-2-prs.md#p2-pr-017)

**Trace:** UC11, UC13, AT09, AT15, AT22. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Expose scoped organization/offer/moderation/reservation/simulation/reporting/dispute endpoints.
- [x] Expose private import upload/template/diff/approval/status/rollback and masked operations endpoints.
- [x] Add versioned contracts, MFA/roles/RLS, quotas, idempotency, expected revisions and audit.

**Verification and acceptance:** Running HTTP tenant/CSV/race tests pass; guessing IDs or injecting file/URL data cannot bypass shared services.

**Local implementation only:** [HTTP packet](../implementation/P2-PR-018-local-partner-staff-api.md). Trusted authority/MFA remains synthetic in tests; actual service/API/schema/privacy/provider acceptance and all six S3 gates remain held. Generated clients and combined acceptance evidence are P2-PR-020; no gate closes.

### P2-PR-019

**Expose AI analysis and photo APIs**

**Stage:** S4 · **Responsible role:** Backend · **Work packages:** E39, E40, E41, E34

**Depends on:** [P2-PR-017](phase-2-prs.md#p2-pr-017)

**Trace:** UC14, UC15, UC16, AT23, AT24, AT25, AT26. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [x] Expose owner analysis request/status/attachment and private photo upload/finalize/extract/confirm/delete endpoints.
- [x] Document pending/available/unavailable/expired states, input limits, processing notices and exact reuse semantics.
- [x] Enforce ownership, explicit action, quotas/cost admission, CSRF and idempotency; deny share-only invocation.

**Verification and acceptance:** HTTP tests prove unauthorized callers cannot infer prompts/images, trigger charges or apply unconfirmed fields.

**Local implementation only:** [Owner analysis/photo HTTP packet](../implementation/P2-PR-019-local-analysis-photo-api.md). Reviewed runtime, synthetic authority/scanner/model/journal and actual local storage/codec/SQL evidence do not accept identity, model quality, privacy, S3/S4 or deployment. Combined API validation/generated clients are P2-PR-020; all existing holds remain.

### P2-PR-020

**Accept all Phase 2 APIs before new frontend work**

**Stage:** S4 · **Responsible role:** QA/backend · **Work packages:** E34, E26

**Depends on:** [P2-PR-018](phase-2-prs.md#p2-pr-018), [P2-PR-019](phase-2-prs.md#p2-pr-019), [P2-PR-017](phase-2-prs.md#p2-pr-017)

**Trace:** CAP-01, CAP-04, CAP-05, CAP-06, CAP-07. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Demonstrate photo confirmation → deterministic report → validated analysis/reuse → frozen delivery and deletion headlessly.
- [ ] Demonstrate tenant onboarding/moderation/last-code and admin CSV publish flows through real APIs.
- [ ] Run P1 regression and mixed worker/DB load; publish P2 S4 acceptance and generated clients.

**Verification and acceptance:** All P2 API categories pass together; neither AI-only nor reseller-only acceptance opens the frontend gate.

**Owner-authorized local validation:** [Combined API packet](../implementation/P2-PR-020-local-api-validation.md). The three original acceptance boxes above remain open. Local implementation/testing/merge through card020 is authorized; actual dependency acceptance, phase entry and S4/frontend acceptance are not implied. No frontend or hosted deployment is activated.

- [x] Implement64 opt-in API operation definitions, separate typed clients, private response validation and deterministic OpenAPI drift checking.
- [x] Implement combined actual loopback HTTP/SQL owner, partner and staff journeys with explicit frozen analysis delivery, last-code race, scoped deletion/withdrawal and bounded mixed reads/workers.
- [x] Harden coupon error truncation, dispute authorization around encryption and CSV preview/intake binding; record source-bound local validation and remaining actual acceptance inputs.


### P2-PR-021

**Build reseller onboarding, offers and pilot portal**

**Stage:** S5 · **Responsible role:** Frontend/partners · **Work packages:** E21, E22, E23, E24

**Depends on:** [P2-PR-020](phase-2-prs.md#p2-pr-020)

**Trace:** UC11, AT09, AT15. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build verification/agreements/member controls and pending/suspended states.
- [ ] Build draft/target/moderation/code-pool/simulation controls through accepted APIs.
- [ ] Build aggregate pilot-credit/redemption/dispute views with correct labels and no recipient details.

**Verification and acceptance:** Tenant/browser/accessibility tests pass; pilot portal has no inferred charges or paid ranking controls.

Local implementation progress (actual S5/pilot acceptance remains open):

- [x] Implement opt-in private onboarding/member/state controls, reviewed typed offer/coupon/simulation controls and noncharging aggregate/redemption/dispute views.
- [x] Validate tenant/API/database/CSP boundaries and actual synthetic-browser registration, offers, suppression, keyboard/reflow and private disconnect; record source-bound evidence and preserved holds.

### P2-PR-022

**Build staff CSV import and partner moderation screens**

**Stage:** S5 · **Responsible role:** Frontend/data · **Work packages:** E22, E36

**Depends on:** [P2-PR-020](phase-2-prs.md#p2-pr-020)

**Trace:** UC11, UC13, AT21, AT22. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build template download, private upload, validation/mapping/diff/rejection preview and job progress.
- [ ] Build approval/publish/head-conflict/rollback actions with required roles and audit feedback.
- [ ] Build partner verification/offer moderation queues without table-edit shortcuts.

**Verification and acceptance:** Large/error CSV, role separation, retry/resume and keyboard/reflow tests match script behavior.

Local implementation progress (actual S5/source/identity acceptance remains open):

- [x] Implement private template/upload/validation/diff/rejection/status controls with independent review, publication receipts, cancellation and approved rollback through shared services.
- [x] Implement permission-scoped business/offer queues and current private evidence/context reads with independent decision controls; validate source/API/service boundaries and record actual local browser observations separately.

### P2-PR-023

**Build AI-assisted report and delivery presentation**

**Stage:** S5 · **Responsible role:** Frontend/content · **Work packages:** E39, E40

**Depends on:** [P2-PR-020](phase-2-prs.md#p2-pr-020)

**Trace:** UC14, UC15, AT23, AT24. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Add explicit assistance choice and separate labeled/cited explanation with generation/source/reuse dates.
- [ ] Render pending/unavailable/expired/refreshed states and deterministic fallback without blocking core actions.
- [ ] Update email/PDF templates to render the chosen frozen attachment and redacted shared-view policy.

**Verification and acceptance:** Browser and renderer tests preserve authoritative facts, old versions and send identity; AI completion sends no unsolicited email.

Local progress: opt-in owner report/assistance presentation, typed current options, explicit permission/reuse and frozen delivery/cancel controls are implemented. Focused84-case Linux/SQL/Next proof, actual synthetic-browser journeys and three-page PDF visual inspection are recorded in [P2-PR-023](../implementation/P2-PR-023-local-assisted-report-presentation.md). Original acceptance boxes remain open; final exact-commit regression and PR/main checks are required.

### P2-PR-024

**Build web tire-photo upload and field confirmation**

**Stage:** S5 · **Responsible role:** Frontend · **Work packages:** E41

**Depends on:** [P2-PR-020](phase-2-prs.md#p2-pr-020)

**Trace:** UC16, AT26. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build optional photo capture/upload purpose notice, bounds, progress and quality/retake states.
- [ ] Display per-field candidates with unknown/conflicting/partial readings and explicit correction/confirmation.
- [ ] Support manual entry, image removal and expiry without losing the usable assessment.

**Verification and acceptance:** Keyboard/mobile/browser tests prove no candidate changes inputs before confirmation and all failure paths offer manual recovery.

Local progress: optional private photo options/upload, per-field confirmation/correction, confirmed-only axle application and manual assessment recovery are implemented. Focused121-case Linux/Next/SQL/public regression and actual browser checks including interrupted pending-intent recovery are recorded in [P2-PR-024](../implementation/P2-PR-024-local-photo-confirmation.md). Original acceptance boxes remain open; exact-commit full regression and actual PR/main checks are required.

### P2-PR-025

**Build AI/privacy and pilot operations dashboards**

**Stage:** S5 · **Responsible role:** Frontend/platform · **Work packages:** E25, E39, E40, E41

**Depends on:** [P2-PR-020](phase-2-prs.md#p2-pr-020)

**Trace:** UC09, UC11, UC15, UC16. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Expose safe AI cost/admission/rejection/reuse/invalidation and photo correction/purge health metrics.
- [ ] Add staff retry/disable controls that cannot bypass privacy, budgets or critical validation.
- [ ] Extend privacy/consent and deliverability/visitor operations screens using purpose-scoped projections.

**Verification and acceptance:** Role and browser tests show no private prompts/images in analytics; kill switches preserve deterministic/manual product paths.

Local progress: role-scoped cost/reuse/photo health, durable existing-worker resume receipts, exact negative policy control and independent privacy/delivery/visitor/pilot projections are implemented. Focused154-case strict Linux/Next/PostgreSQL and actual browser/negative-control/manual-recovery/receipt-hold evidence is recorded in [P2-PR-025](../implementation/P2-PR-025-local-assistance-operations.md). Original acceptance boxes remain open; exact-commit full regression and actual PR/main checks are required.

### P2-PR-026

**Verify assisted advice, privacy and partner security**

**Stage:** S6 · **Responsible role:** QA/security · **Work packages:** E26, E39, E40, E41

**Depends on:** [P2-PR-021](phase-2-prs.md#p2-pr-021), [P2-PR-022](phase-2-prs.md#p2-pr-022), [P2-PR-023](phase-2-prs.md#p2-pr-023), [P2-PR-024](phase-2-prs.md#p2-pr-024), [P2-PR-025](phase-2-prs.md#p2-pr-025)

**Trace:** UC11, UC13, UC14, UC15, UC16, AT09, AT15, AT23, AT24, AT25, AT26. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run full assisted-report/import/partner browser journeys and real email/PDF integration.
- [ ] Perform partner isolation/security review, malicious upload and AI deletion/withdrawal races; rerun model evaluation if its configuration changed.
- [ ] Verify accessibility, P1 regression, mixed load/cost caps, restore/purge and support playbooks.

**Verification and acceptance:** G2/G4/G6/G7 evidence passes; no private-data leak, critical AI failure, duplicate coupon or broken existing live journey.

Local progress: the combined Next/API/PostgreSQL55 boundary, real frozen HTML/text/PDF renderer, hostile uploads, current owner/tenant/role checks, in-flight withdrawal/deletion, source-image purge and quarantined 225-table SQL archive parity are exercised by 207 focused cases, including 16 new database scenarios and two future-date renderer controls. Actual browser journeys, narrow layouts and operator uncertainty/expiry response are recorded in [P2-PR-026](../implementation/P2-PR-026-local-security-privacy-validation.md), with a [local support handover](../operations/phase-2-local-security-handover.md). Model configuration is unchanged. Original acceptance boxes remain open: real identity/MFA, external model/scanner/source/privacy/custody/latest-chain recovery, inbox/browser/assistive-technology matrix, independent review and pilot/phase acceptance are still required. Full exact-commit regression and actual PR/main checks are required before reporting this local card complete; P2-PR-027 rollout remains held.

Validation follow-up: a bounded 40-minute CI job budget accommodates the complete suite. Its exact current-source digest transition preserves historical pins and receipts; 26 targeted evidence cases, including five new adverse controls, verify compatibility while all readiness inputs and acceptance remain held.

### P2-PR-027

**Release Phase 2 assistance and reseller pilot**

**Stage:** S6 · **Responsible role:** Product/platform · **Work packages:** E26

**Depends on:** [P2-PR-026](phase-2-prs.md#p2-pr-026), [P2-PR-021](phase-2-prs.md#p2-pr-021), [P2-PR-022](phase-2-prs.md#p2-pr-022), [P2-PR-023](phase-2-prs.md#p2-pr-023), [P2-PR-024](phase-2-prs.md#p2-pr-024), [P2-PR-025](phase-2-prs.md#p2-pr-025)

**Trace:** CAP-01, CAP-04, CAP-05, CAP-06, CAP-07, UC18. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Approve controlled rollout, provider/cost/notice configuration and staffed support.
- [ ] Demonstrate real web photo confirmation, available AI or explicit fallback, exact reuse and staff CSV publication.
- [ ] Onboard the agreed 5–10 verified pilot resellers and record real moderated offer journey, production metrics and rollback evidence.

**Verification and acceptance:** P2 is live with required capabilities and actual pilot evidence; external gaps keep the phase open, while P1 stays usable.

**Local preparation:**

- [x] Reconcile completed PR114 and bind its actual source/tree, full local regression and nine PR/nine main checks as historical construction evidence.
- [x] Inventory default and opt-in migrations, API/evidence hashes, pending runtime/provider/identity/model/privacy/custody/pilot/support inputs and empty release approvals.
- [x] Prepare controlled rollout, real-journey observations, operator responsibilities, full budget intake, uncertainty/pause/rollback and owner decision handoff.

See the [local release packet](../implementation/P2-PR-027-local-release-preparation.md), [machine-readable inventory](../implementation/evidence/P2/p2-pr-027-release-inputs.json) and [rollout handover](../operations/phase-2-controlled-rollout.md). New exact-commit build/regression, fresh review and actual PR/main checks are required before reporting local preparation complete. The original three live tasks remain open. Production composition/promotion, actual approvals and5-10 verified real pilot organizations are outstanding; no local merge accepts the phase or grants early P3 sequencing.
