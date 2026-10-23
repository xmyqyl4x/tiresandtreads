# Phase 4 — complete core platform and growth operations

**Working PR decomposition 1.0 · October 23, 2026.** 24 planned PRs. Scope comes from the approved [four-phase baseline](../12-live-product-phases-and-gap-review.md); this breakdown adds execution detail without approving new capabilities. All implementation is unstarted. The [master task list](../15-project-task-list.md) is the authoritative status/assignee/PR/evidence ledger.

**Live outcome:** Lifecycle controls, reviewed content/tools, approved commercial operations and operating handover are live, with every committed requirement accounted for.

**Phase entry:** Acceptance of [P3-PR-025](phase-3-prs.md#p3-pr-025) and a recorded phase scope/estimate review. Every listed dependency means merged **and accepted with required evidence**, not just an open PR. New product UI/templates wait for [P4-PR-017](phase-4-prs.md#p4-pr-017). Read the [TDD](../08-test-driven-development.md), [schema](../09-database-design.md), [coding](../10-coding-standards.md), [domain imports](../13-domain-data-and-imports.md) and [AI/photo](../14-ai-analysis-and-photo-design.md) contracts before the affected work.

## PR sequence

| PR | Stage | Proposed title |
| --- | --- | --- |
| [P4-PR-001](#p4-pr-001) | S0 | Lock core-completion scope and commercial activation gates |
| [P4-PR-002](#p4-pr-002) | S1 | Create financial ledger, budget and partner API schemas |
| [P4-PR-003](#p4-pr-003) | S1 | Create lifecycle, curated content and operations extensions |
| [P4-PR-004](#p4-pr-004) | S1 | Close Phase 4 schema and compatibility gate |
| [P4-PR-005](#p4-pr-005) | S2 | Implement ledger, budgets and commercial repositories |
| [P4-PR-006](#p4-pr-006) | S2 | Implement lifecycle, SEO and correction repositories |
| [P4-PR-007](#p4-pr-007) | S2 | Close Phase 4 data-access gate |
| [P4-PR-008](#p4-pr-008) | S3 | Implement billing, payment reconciliation and paid event rules |
| [P4-PR-009](#p4-pr-009) | S3 | Implement partner API, signed webhook and commercial access services |
| [P4-PR-010](#p4-pr-010) | S3 | Implement direct sponsorship and ad operations expansion |
| [P4-PR-011](#p4-pr-011) | S3 | Implement full lifecycle and permissioned campaign services |
| [P4-PR-012](#p4-pr-012) | S3 | Implement curated SEO expansion and reviewed public tools |
| [P4-PR-013](#p4-pr-013) | S3 | Implement correction, republication and operational maintenance |
| [P4-PR-014](#p4-pr-014) | S3 | Close core platform service completion gate |
| [P4-PR-015](#p4-pr-015) | S4 | Expose commercial APIs, billing events and partner webhooks |
| [P4-PR-016](#p4-pr-016) | S4 | Expose lifecycle, SEO and maintenance operations APIs |
| [P4-PR-017](#p4-pr-017) | S4 | Accept the complete Phase 4 API surface |
| [P4-PR-018](#p4-pr-018) | S5 | Build partner billing, API access and sponsorship controls |
| [P4-PR-019](#p4-pr-019) | S5 | Build complete web/app lifecycle and messaging controls |
| [P4-PR-020](#p4-pr-020) | S5 | Publish curated vehicle/size content and expanded tools |
| [P4-PR-021](#p4-pr-021) | S5 | Build growth and correction operations workspace |
| [P4-PR-022](#p4-pr-022) | S6 | Verify four-phase regression, scale and handover readiness |
| [P4-PR-023](#p4-pr-023) | S6 | Release Phase 4 capabilities and observe live operation |
| [P4-PR-024](#p4-pr-024) | S6 | Close the implementation scope and archive completion evidence |

## Task cards

Each checkbox is implementation work, not a claim of completion. Each behavioral PR includes failing-then-passing unit/application tests and affected real database/API/provider checks; UI PRs also include functional/browser/accessibility checks. Evidence-only feasibility/gate/release PRs use documented review and measured results instead of artificial unit tests. Gate PRs collect existing evidence and exercise integration gaps; they do not postpone testing until the end.

### P4-PR-001

**Lock core-completion scope and commercial activation gates**

**Stage:** S0 · **Responsible role:** Product/commercial · **Work packages:** E27, E28, E31, E37, E42

**Depends on:** [P3-PR-025](phase-3-prs.md#p3-pr-025)

**Trace:** CAP-01, UC12, UC18. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Audit all committed requirements and remaining evidence across P1–P3; classify optional work explicitly without hiding unfinished core scope.
- [ ] Confirm partner pricing/terms, lifecycle purposes/content, curated SEO targets and source rights; record activation blockers.
- [ ] Re-estimate P4, assign support/operations owners and identify optional tickets requiring separate decisions.

**Verification and acceptance:** Accepted completion scope register and commercial/privacy gate owners; no revenue or new-market activation assumed.

### P4-PR-002

**Create financial ledger, budget and partner API schemas**

**Stage:** S1 · **Responsible role:** Backend · **Work packages:** E27

**Depends on:** [P4-PR-001](phase-4-prs.md#p4-pr-001)

**Trace:** UC12, DB11, DB12. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Migrate tenant/currency-scoped accounts, immutable balanced postings, reversals, invoices and payment-event dedupe.
- [ ] Add budgets/reservations/billable-event classification and provider reconciliation metadata.
- [ ] Add hashed/scoped API credentials, webhook destination/delivery and sponsorship scheduling persistence where absent.

**Verification and acceptance:** Real balance/currency/tenant/last-funds constraints and duplicate event tests pass; no mutable posted ledger entries.

### P4-PR-003

**Create lifecycle, curated content and operations extensions**

**Stage:** S1 · **Responsible role:** Backend/content · **Work packages:** E28, E31, E37, E42

**Depends on:** [P4-PR-001](phase-4-prs.md#p4-pr-001)

**Trace:** UC10, UC12, UC17, DB27, DB28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Extend P3 basic reminder records for remaining approved lifecycle rules, scheduling/content versions, caps and sunset evidence.
- [ ] Extend P1 public-page/review/source structures for curated vehicle/size pages, richer tools and suggested links.
- [ ] Add correction/republication and long-running operation evidence only where existing models do not suffice.

**Verification and acceptance:** Compatible migrations preserve old reports/reminders; private data cannot become public page dimensions.

### P4-PR-004

**Close Phase 4 schema and compatibility gate**

**Stage:** S1 · **Responsible role:** Backend/QA · **Work packages:** E27, E28, E31, E42

**Depends on:** [P4-PR-002](phase-4-prs.md#p4-pr-002), [P4-PR-003](phase-4-prs.md#p4-pr-003), [P4-PR-001](phase-4-prs.md#p4-pr-001)

**Trace:** DB11, DB12, DB13, DB27, DB28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run P3 upgrades, representative financial/ownership/content constraint tests and online migration review.
- [ ] Verify backup/restore, deletion replay and old-client compatibility under the new schema.
- [ ] Record S1 approval with any new scoped migration variants for activated optional work.

**Verification and acceptance:** Core migrations pass before repositories; optional features cannot bypass their own schema gate.

### P4-PR-005

**Implement ledger, budgets and commercial repositories**

**Stage:** S2 · **Responsible role:** Backend · **Work packages:** E27

**Depends on:** [P4-PR-004](phase-4-prs.md#p4-pr-004)

**Trace:** UC12, DB11, DB12. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement pure financial value types and explicit storage/money/currency mappers.
- [ ] Implement balanced posting/reversal, atomic budget reservation, invoice/payment and reconciliation repositories.
- [ ] Implement tenant-scoped API/webhook/sponsor projections with immutable audit history.

**Verification and acceptance:** Concurrent last-funds, duplicate payment, reversal, rollback and cross-tenant SQL tests pass with bounded queries.

### P4-PR-006

**Implement lifecycle, SEO and correction repositories**

**Stage:** S2 · **Responsible role:** Backend/content · **Work packages:** E28, E31, E37, E42

**Depends on:** [P4-PR-004](phase-4-prs.md#p4-pr-004)

**Trace:** UC10, UC12, UC17, DB27, DB28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement lifecycle occurrence/content/permission projections using existing subject/send repositories.
- [ ] Implement curated template eligibility, public SEO/link/audit and source correction read models.
- [ ] Implement bounded backfill/republication/purge/operation checkpoint queries and retention indexes.

**Verification and acceptance:** Mapper/query and replay/expiry tests pass; no mass private report-to-public-content projection.

### P4-PR-007

**Close Phase 4 data-access gate**

**Stage:** S2 · **Responsible role:** Backend/QA · **Work packages:** E27, E28, E31, E42

**Depends on:** [P4-PR-005](phase-4-prs.md#p4-pr-005), [P4-PR-006](phase-4-prs.md#p4-pr-006), [P4-PR-004](phase-4-prs.md#p4-pr-004)

**Trace:** ENG-03, ENG-04, ENG-05. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Review financial/content/lifecycle model boundaries and transaction ownership.
- [ ] Run preceding-phase repository/client fixtures and representative load/query plans.
- [ ] Publish S2 decision and updated remaining completion forecast.

**Verification and acceptance:** All P4 persistence behavior is accepted before commercial/lifecycle expansion services start.

### P4-PR-008

**Implement billing, payment reconciliation and paid event rules**

**Stage:** S3 · **Responsible role:** Backend/commercial · **Work packages:** E27

**Depends on:** [P4-PR-007](phase-4-prs.md#p4-pr-007)

**Trace:** UC12, DB11. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement eligible event classification, price/version snapshots, balanced charges/credits/refunds and invoice lifecycle.
- [ ] Integrate Stripe/webhook processing through durable dedupe and reconciliation; preserve uncertain/fraud state.
- [ ] Implement prepaid budget exhaustion, reservations and top-up permissions with reviewed terms.

**Verification and acceptance:** Unit/use-case/provider tests reject scanner/fraud charges, duplicate payment effects and overspend; browser redirects cannot credit balances.

### P4-PR-009

**Implement partner API, signed webhook and commercial access services**

**Stage:** S3 · **Responsible role:** Backend · **Work packages:** E27

**Depends on:** [P4-PR-008](phase-4-prs.md#p4-pr-008), [P4-PR-007](phase-4-prs.md#p4-pr-007)

**Trace:** UC11, UC12, DB11, DB12. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement scoped credential issuance/rotation/revocation, per-key quotas and tenant API policies.
- [ ] Implement signed outbound event delivery with safe reviewed destinations, bounded retry and replay identities.
- [ ] Implement permitted exports/redemption corrections and billing-aware access without exposing recipients.

**Verification and acceptance:** Wrong-tenant/key, SSRF, signature/retry and correction-ledger tests pass; API suspension never changes tire advice.

### P4-PR-010

**Implement direct sponsorship and ad operations expansion**

**Stage:** S3 · **Responsible role:** Backend/commercial · **Work packages:** E27, E38

**Depends on:** [P4-PR-008](phase-4-prs.md#p4-pr-008), [P4-PR-009](phase-4-prs.md#p4-pr-009), [P4-PR-007](phase-4-prs.md#p4-pr-007)

**Trace:** CAP-03, UC17, AT03, AT27. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement reviewed creative/date/cap scheduling and sponsor account permissions over existing ad-slot policy.
- [ ] Implement eligible delivery/reconciliation and conflict handling with network/house inventory.
- [ ] Keep public placement, disclosure, consent and rank independence unchanged.

**Verification and acceptance:** Schedule/cap/race/consent tests and revenue reconciliation pass; forbidden placements and commercial ranking inputs remain rejected.

### P4-PR-011

**Implement full lifecycle and permissioned campaign services**

**Stage:** S3 · **Responsible role:** Backend/privacy · **Work packages:** E31

**Depends on:** [P4-PR-007](phase-4-prs.md#p4-pr-007)

**Trace:** UC06, UC08, UC12, AT10, AT19. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Extend basic reminders to approved ownership/lifecycle content and scheduling use cases.
- [ ] Enforce current purpose, timezone/DST, quiet hours, channel/global caps, pause, suppression, sunset and repermission eligibility.
- [ ] Implement versioned dry-run preview/audience counts and limited activation without automatically sending historical backlog.

**Verification and acceptance:** Clock/use-case/withdrawal/provider tests prevent unsolicited or duplicate sends and preserve one-time report permissions.

### P4-PR-012

**Implement curated SEO expansion and reviewed public tools**

**Stage:** S3 · **Responsible role:** Content/backend · **Work packages:** E28, E37

**Depends on:** [P4-PR-007](phase-4-prs.md#p4-pr-007)

**Trace:** CAP-02, UC10, UC17, AT27. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement vehicle/size page eligibility using rights, unique evidence, at least three eligible options and editorial approval.
- [ ] Add reviewed DOT/tread/alternate-size/recall tool behavior only where its source rules are validated.
- [ ] Implement suggested internal links, orphan/decay/CWV findings and review/expiry withdrawal using P1 SEO services.

**Verification and acceptance:** Headless content/tool tests reject unsupported safety claims and thin/private pages; fields without data remain unavailable.

### P4-PR-013

**Implement correction, republication and operational maintenance**

**Stage:** S3 · **Responsible role:** Data/platform · **Work packages:** E35, E36, E40, E42

**Depends on:** [P4-PR-007](phase-4-prs.md#p4-pr-007)

**Trace:** UC09, UC13, UC15, AT14, AT22, AT24. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement full operational correction impact analysis across data bundles, public content and AI source invalidations.
- [ ] Implement bounded reimport/backfill/republication/reconciliation controls with checkpoints and audit.
- [ ] Tune retention/query/worker budgets from production profiles and rehearse safe rollback without erasing current safety knowledge.

**Verification and acceptance:** Correction/replay/invalidation use cases and load measurements preserve live reports, source truth, privacy and AI freshness.

### P4-PR-014

**Close core platform service completion gate**

**Stage:** S3 · **Responsible role:** QA/backend · **Work packages:** E27, E28, E31, E37, E42

**Depends on:** [P4-PR-008](phase-4-prs.md#p4-pr-008), [P4-PR-009](phase-4-prs.md#p4-pr-009), [P4-PR-010](phase-4-prs.md#p4-pr-010), [P4-PR-011](phase-4-prs.md#p4-pr-011), [P4-PR-012](phase-4-prs.md#p4-pr-012), [P4-PR-013](phase-4-prs.md#p4-pr-013), [P4-PR-007](phase-4-prs.md#p4-pr-007)

**Trace:** UC12, UC13, UC17, UC18, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run commercial/lifecycle/SEO/correction services through real repositories and provider sandboxes.
- [ ] Verify all prior release regressions, approved price/purpose policies and complete operator recovery behavior.
- [ ] Publish S3/G2 evidence and explicit blocked optional/commercial activation decisions.

**Verification and acceptance:** All committed P4 services pass; a disabled integration is not counted as an implemented capability.

### P4-PR-015

**Expose commercial APIs, billing events and partner webhooks**

**Stage:** S4 · **Responsible role:** Backend · **Work packages:** E27, E34

**Depends on:** [P4-PR-014](phase-4-prs.md#p4-pr-014)

**Trace:** UC11, UC12, DB11, DB12. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Expose partner billing/invoice/budget/credential/sponsorship APIs and verified payment callbacks.
- [ ] Implement signed outbound webhook integration and safe versioned correction/export contracts.
- [ ] Apply tenant/MFA/scopes/quotas/idempotency and operational audit consistently.

**Verification and acceptance:** Running API/provider tests cover duplicate billing, stale keys, exhaustion, unsafe destinations and cross-tenant access.

### P4-PR-016

**Expose lifecycle, SEO and maintenance operations APIs**

**Stage:** S4 · **Responsible role:** Backend · **Work packages:** E28, E31, E37, E42, E34

**Depends on:** [P4-PR-014](phase-4-prs.md#p4-pr-014)

**Trace:** UC10, UC12, UC13, UC17, UC18. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Expose lifecycle preview/schedule/pause/preferences and curated content/review/audit endpoints.
- [ ] Expose correction/reimport/impact/republication and operational status commands.
- [ ] Publish updated web/native/staff contracts with backwards compatibility and purpose checks.

**Verification and acceptance:** Real API tests cover withdrawals, source changes, expired content, failed/retried maintenance and old clients.

### P4-PR-017

**Accept the complete Phase 4 API surface**

**Stage:** S4 · **Responsible role:** QA/backend · **Work packages:** E34, E42

**Depends on:** [P4-PR-015](phase-4-prs.md#p4-pr-015), [P4-PR-016](phase-4-prs.md#p4-pr-016), [P4-PR-014](phase-4-prs.md#p4-pr-014)

**Trace:** CAP-01, UC18, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run partner payment/reconciliation, lifecycle and content/correction journeys headlessly.
- [ ] Verify every committed requirement has a service/API owner and affected old clients pass.
- [ ] Publish S4 approval, client contracts and explicit external activation statuses.

**Verification and acceptance:** All P4 APIs pass before new billing/lifecycle/SEO interfaces are implemented.

### P4-PR-018

**Build partner billing, API access and sponsorship controls**

**Stage:** S5 · **Responsible role:** Frontend/partners · **Work packages:** E27

**Depends on:** [P4-PR-017](phase-4-prs.md#p4-pr-017)

**Trace:** UC11, UC12, UC17. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build prepaid ledger/invoice/credit/refund/budget views with clear currency and reconciliation states.
- [ ] Build API credential/webhook management, scoped team permissions and safe rotation/revocation flows.
- [ ] Build sponsorship scheduling/creative/cap controls through accepted policies and previews.

**Verification and acceptance:** Tenant/browser/accessibility tests distinguish pending/settled/reversed funds and prevent unauthorized charges or placements.

### P4-PR-019

**Build complete web/app lifecycle and messaging controls**

**Stage:** S5 · **Responsible role:** Frontend/mobile/content · **Work packages:** E31

**Depends on:** [P4-PR-017](phase-4-prs.md#p4-pr-017)

**Trace:** UC06, UC08, UC12. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build ownership/lifecycle preferences, pause/history/channel/quiet-hour controls across web and app.
- [ ] Build staff preview/dry-run/limited activation controls and approved email/push templates.
- [ ] Keep one-time report requests, offer permission and recurring messages clearly independent.

**Verification and acceptance:** Cross-channel/browser/native/render tests prove consent changes, cap/DST behavior and readable failure/unavailable states.

### P4-PR-020

**Publish curated vehicle/size content and expanded tools**

**Stage:** S5 · **Responsible role:** Content/frontend · **Work packages:** E28, E37

**Depends on:** [P4-PR-017](phase-4-prs.md#p4-pr-017)

**Trace:** CAP-02, UC10, UC17. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build approved page templates and reviewed content with visible source dates, limitations and useful links.
- [ ] Render richer reviewed public tools with unknown/manual/installer-verification states.
- [ ] Verify canonical/hreflang/sitemaps/structured data and permitted ads using existing policies.

**Verification and acceptance:** Editorial/crawl/accessibility tests pass; no private or low-value automatic AI pages are indexed.

### P4-PR-021

**Build growth and correction operations workspace**

**Stage:** S5 · **Responsible role:** Frontend/platform · **Work packages:** E37, E38, E42

**Depends on:** [P4-PR-017](phase-4-prs.md#p4-pr-017)

**Trace:** UC13, UC15, UC17, UC18. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build SEO review/decay/link findings and reconciled ad/sponsor reporting over approved aggregate projections.
- [ ] Build source correction impact/republication, AI invalidation and retention/worker health views.
- [ ] Build permissions and audit-backed operational actions, with explicit failed/paused/unknown states.

**Verification and acceptance:** Staff-role/browser tests, CSV/report correctness and no-private-context checks pass; interfaces cannot override source safety or deletion.

### P4-PR-022

**Verify four-phase regression, scale and handover readiness**

**Stage:** S6 · **Responsible role:** QA/platform · **Work packages:** E19, E42

**Depends on:** [P4-PR-018](phase-4-prs.md#p4-pr-018), [P4-PR-019](phase-4-prs.md#p4-pr-019), [P4-PR-020](phase-4-prs.md#p4-pr-020), [P4-PR-021](phase-4-prs.md#p4-pr-021)

**Trace:** CAP-01, UC18, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run all committed UC/AT journeys across web/app/MCP with released-version compatibility fixtures.
- [ ] Measure production-shaped report/AI/import/analytics/ads/lifecycle load and reconcile supplier/AI/financial costs.
- [ ] Rehearse incident, rollback, provider outage, restore/deletion and staffing handover; fix critical gaps.

**Verification and acceptance:** G2/G4/G7 evidence and accountable operations signoff pass; no phase regression or failed recovery is waived silently.

### P4-PR-023

**Release Phase 4 capabilities and observe live operation**

**Stage:** S6 · **Responsible role:** Product/platform · **Work packages:** E27, E28, E31, E42

**Depends on:** [P4-PR-022](phase-4-prs.md#p4-pr-022), [P4-PR-018](phase-4-prs.md#p4-pr-018), [P4-PR-019](phase-4-prs.md#p4-pr-019), [P4-PR-020](phase-4-prs.md#p4-pr-020), [P4-PR-021](phase-4-prs.md#p4-pr-021)

**Trace:** CAP-01, UC18, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Approve controlled commercial/lifecycle/content rollout with current terms and feature-level gates.
- [ ] Run permitted production smoke, monitoring and support handover with prior channels still usable.
- [ ] Record release SHAs, URLs/builds, live outcomes, costs, unresolved external approvals and rollback readiness.

**Verification and acceptance:** Committed P4 user and operator journeys work live; financial/provider activation requires its separate approved gate.

### P4-PR-024

**Close the implementation scope and archive completion evidence**

**Stage:** S6 · **Responsible role:** Product/QA · **Work packages:** E42

**Depends on:** [P4-PR-022](phase-4-prs.md#p4-pr-022), [P4-PR-023](phase-4-prs.md#p4-pr-023), [P4-PR-018](phase-4-prs.md#p4-pr-018), [P4-PR-019](phase-4-prs.md#p4-pr-019), [P4-PR-020](phase-4-prs.md#p4-pr-020), [P4-PR-021](phase-4-prs.md#p4-pr-021)

**Trace:** CAP-01, ENG-06, UC18, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Reconcile every FR/CORE/NFR/ENG/CAP row to merged PRs, tests and a shipped release or explicit owner-approved optional/deferred disposition.
- [ ] Publish final four-phase evidence index, operating ownership, support/incident/data-refresh routines and maintenance backlog.
- [ ] Obtain owner completion signoff; retain failed or blocked committed work as open rather than hiding it in future scope.

**Verification and acceptance:** All committed work is verifiably live; optional backlog is disclosed separately and no fifth implicit phase is needed for unfinished core work.
