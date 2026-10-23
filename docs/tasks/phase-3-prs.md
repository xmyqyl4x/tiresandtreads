# Phase 3 — web, native app and AI-client ownership

**Working PR decomposition 1.0 · October 23, 2026.** 25 planned PRs. Scope comes from the approved [four-phase baseline](../12-live-product-phases-and-gap-review.md); this breakdown adds execution detail without approving new capabilities. All implementation is unstarted. The [master task list](../15-project-task-list.md) is the authoritative status/assignee/PR/evidence ledger.

**Live outcome:** A real native app and MCP AI-client integration share authorized web reports, garage/history, basic reminders and privacy controls.

**Phase entry:** Acceptance of [P2-PR-027](phase-2-prs.md#p2-pr-027) and a recorded phase scope/estimate review. Every listed dependency means merged **and accepted with required evidence**, not just an open PR. New product UI/templates wait for [P3-PR-017](phase-3-prs.md#p3-pr-017). Read the [TDD](../08-test-driven-development.md), [schema](../09-database-design.md), [coding](../10-coding-standards.md), [domain imports](../13-domain-data-and-imports.md) and [AI/photo](../14-ai-analysis-and-photo-design.md) contracts before the affected work.

## PR sequence

| PR | Stage | Proposed title |
| --- | --- | --- |
| [P3-PR-001](#p3-pr-001) | S0 | Lock multichannel scope, rights and distribution plan |
| [P3-PR-002](#p3-pr-002) | S1 | Create consumer ownership, garage and device schemas |
| [P3-PR-003](#p3-pr-003) | S1 | Create reminder, API-client and tool-grant schemas |
| [P3-PR-004](#p3-pr-004) | S1 | Close Phase 3 schema upgrade gate |
| [P3-PR-005](#p3-pr-005) | S2 | Implement identity, garage and synchronization repositories |
| [P3-PR-006](#p3-pr-006) | S2 | Implement reminder and client-grant repositories |
| [P3-PR-007](#p3-pr-007) | S2 | Close multichannel data-access gate |
| [P3-PR-008](#p3-pr-008) | S3 | Implement account authority and verified guest merge |
| [P3-PR-009](#p3-pr-009) | S3 | Implement garage, tire history and offline sync services |
| [P3-PR-010](#p3-pr-010) | S3 | Implement basic reminders, push and quiet-hour rules |
| [P3-PR-011](#p3-pr-011) | S3 | Implement wallet, deep-link and cross-channel privacy services |
| [P3-PR-012](#p3-pr-012) | S3 | Define public and authenticated tool application contracts |
| [P3-PR-013](#p3-pr-013) | S3 | Close shared ownership and tool-service gate |
| [P3-PR-014](#p3-pr-014) | S4 | Expose consumer, sync, reminder and device APIs |
| [P3-PR-015](#p3-pr-015) | S4 | Implement and verify public MCP transport and tools |
| [P3-PR-016](#p3-pr-016) | S4 | Implement scoped authenticated MCP flows |
| [P3-PR-017](#p3-pr-017) | S4 | Accept complete web, mobile and MCP API parity |
| [P3-PR-018](#p3-pr-018) | S5 | Build Expo shell, authentication and native foundations |
| [P3-PR-019](#p3-pr-019) | S5 | Build mobile garage, assessment, reports and camera flow |
| [P3-PR-020](#p3-pr-020) | S5 | Build offline sync, wallet and reminder settings |
| [P3-PR-021](#p3-pr-021) | S5 | Build web account, garage and ownership controls |
| [P3-PR-022](#p3-pr-022) | S5 | Build developer documentation and AI-client packaging |
| [P3-PR-023](#p3-pr-023) | S6 | Verify native quality and complete client journeys |
| [P3-PR-024](#p3-pr-024) | S6 | Complete store and AI-client distribution readiness |
| [P3-PR-025](#p3-pr-025) | S6 | Release Phase 3 web, app and AI-client experience |

## Task cards

Each checkbox is implementation work, not a claim of completion. Each behavioral PR includes failing-then-passing unit/application tests and affected real database/API/provider checks; UI PRs also include functional/browser/accessibility checks. Evidence-only feasibility/gate/release PRs use documented review and measured results instead of artificial unit tests. Gate PRs collect existing evidence and exercise integration gaps; they do not postpone testing until the end.

### P3-PR-001

**Lock multichannel scope, rights and distribution plan**

**Stage:** S0 · **Responsible role:** Product/platform · **Work packages:** E29, E30, E31

**Depends on:** [P2-PR-027](phase-2-prs.md#p2-pr-027)

**Trace:** CAP-01, CAP-08, UC18. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Confirm web/account/garage, basic reminders, native app and public/authenticated MCP capability inventory.
- [ ] Verify data redistribution, target-client protocol/auth/packaging, app-store/privacy requirements and developer accounts.
- [ ] Choose supported device/client test matrix, release/rollback path, compatibility policy and revised P3 estimate.

**Verification and acceptance:** P3 feasibility and distribution evidence has named owners; app/MCP remain committed outcomes even if external approval is delayed.

### P3-PR-002

**Create consumer ownership, garage and device schemas**

**Stage:** S1 · **Responsible role:** Backend · **Work packages:** E30

**Depends on:** [P3-PR-001](phase-3-prs.md#p3-pr-001)

**Trace:** UC12, UC18, DB12, DB28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Add verified subject/account mappings and safe guest-to-account merge history.
- [ ] Add owner-scoped garage/tire-set/check/correction, device/push and sync-event persistence.
- [ ] Add saved report/offer ownership and deletion indexes; retain privacy boundaries of P1/P2.

**Verification and acceptance:** Compound owner keys, client-event dedupe and compatibility migrations reject cross-owner child records.

### P3-PR-003

**Create reminder, API-client and tool-grant schemas**

**Stage:** S1 · **Responsible role:** Backend · **Work packages:** E29, E30, E31

**Depends on:** [P3-PR-002](phase-3-prs.md#p3-pr-002), [P3-PR-001](phase-3-prs.md#p3-pr-001)

**Trace:** CAP-08, UC12, UC18, DB12, DB28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Add basic reminder rules/occurrences/timezones and delivery/channel dedupe references.
- [ ] Add API clients, tool versions, scoped grants, revocation and directory status metadata.
- [ ] Add necessary token/device lifecycle constraints without storing raw secrets or prompts.

**Verification and acceptance:** Duplicate occurrence, revoked grant, expiry and wrong-subject relationship tests pass.

### P3-PR-004

**Close Phase 3 schema upgrade gate**

**Stage:** S1 · **Responsible role:** Backend/QA · **Work packages:** E29, E30, E31

**Depends on:** [P3-PR-002](phase-3-prs.md#p3-pr-002), [P3-PR-003](phase-3-prs.md#p3-pr-003), [P3-PR-001](phase-3-prs.md#p3-pr-001)

**Trace:** DB12, DB13, DB28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Test P2-to-P3 migration/backfill and supported rollback/restore strategy.
- [ ] Verify owner isolation, device/token deletion, legacy web data and P2 AI/photo relationships.
- [ ] Record S1 evidence and grants before repository work.

**Verification and acceptance:** Real DB integrity/recovery tests pass and existing reports remain readable by the correct owner.

### P3-PR-005

**Implement identity, garage and synchronization repositories**

**Stage:** S2 · **Responsible role:** Backend · **Work packages:** E30

**Depends on:** [P3-PR-004](phase-3-prs.md#p3-pr-004)

**Trace:** UC12, UC18, DB12, DB28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Define pure ownership/check/sync models and explicit storage/wire mappers.
- [ ] Implement verified merge, garage/tire-check/correction and device/event repositories.
- [ ] Implement bounded offline-delta/read projections and conflict/revision indexes.

**Verification and acceptance:** Round-trip and concurrent merge/dedupe/conflict tests pass with actual DB roles; no last-write-wins for safety history.

### P3-PR-006

**Implement reminder and client-grant repositories**

**Stage:** S2 · **Responsible role:** Backend · **Work packages:** E29, E30, E31

**Depends on:** [P3-PR-004](phase-3-prs.md#p3-pr-004)

**Trace:** UC12, UC18, DB12, DB28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement reminder occurrence/delivery and timezone/cap persistence over existing send services.
- [ ] Implement tool/client/grant/version and safe aggregate telemetry projections.
- [ ] Implement revocation/deletion queries across credentials, devices, reminders and report links.

**Verification and acceptance:** Real DB scope/expiry/dedupe tests and indexed read plans pass; no prompt or private-image storage in public tool records.

### P3-PR-007

**Close multichannel data-access gate**

**Stage:** S2 · **Responsible role:** Backend/QA · **Work packages:** E29, E30, E31

**Depends on:** [P3-PR-005](phase-3-prs.md#p3-pr-005), [P3-PR-006](phase-3-prs.md#p3-pr-006), [P3-PR-004](phase-3-prs.md#p3-pr-004)

**Trace:** ENG-03, ENG-04, ENG-05. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Review ownership/entity/DTO boundaries and API compatibility expectations.
- [ ] Run P1/P2 repository regression, connection/transaction/permission and sync query tests.
- [ ] Publish S2 acceptance and updated P3 forecast.

**Verification and acceptance:** All new persistence behavior is accepted before shared account/mobile/tool services begin.

### P3-PR-008

**Implement account authority and verified guest merge**

**Stage:** S3 · **Responsible role:** Backend/identity · **Work packages:** E30

**Depends on:** [P3-PR-007](phase-3-prs.md#p3-pr-007)

**Trace:** UC05, UC09, UC12, UC18, DB12. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement consumer identity/session/secure token rotation and explicit proof of guest ownership.
- [ ] Implement account linking, report/garage access and merge conflict decisions without email-only ownership inference.
- [ ] Extend revocation/deletion and provider identity reconciliation.

**Verification and acceptance:** Stolen/forwarded link, concurrent merge, revoked device and wrong-account tests deny unauthorized access across channels.

### P3-PR-009

**Implement garage, tire history and offline sync services**

**Stage:** S3 · **Responsible role:** Backend · **Work packages:** E30

**Depends on:** [P3-PR-008](phase-3-prs.md#p3-pr-008), [P3-PR-007](phase-3-prs.md#p3-pr-007)

**Trace:** UC12, UC18, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement garage/tire installation/check/correction use cases with explicit units and confidence.
- [ ] Implement client-event dedupe, revisions/deltas and conflict policy for offline writes.
- [ ] Implement bounded last-five-report/content projections with separate online recall freshness state.

**Verification and acceptance:** Unit/use-case tests cover duplicate/offline/out-of-order events and unsafe merge conflicts; old data never becomes current safety assurance.

### P3-PR-010

**Implement basic reminders, push and quiet-hour rules**

**Stage:** S3 · **Responsible role:** Backend/platform · **Work packages:** E30, E31

**Depends on:** [P3-PR-008](phase-3-prs.md#p3-pr-008), [P3-PR-009](phase-3-prs.md#p3-pr-009), [P3-PR-007](phase-3-prs.md#p3-pr-007)

**Trace:** UC08, UC12, UC18, AT10, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement scheduled basic ownership reminders and device registration using current purpose/channel permissions.
- [ ] Implement local/server occurrence dedupe, timezone/DST, quiet hours, frequency caps and pause/sunset rules.
- [ ] Wrap push providers with bounded retries, stale-token handling and revocation.

**Verification and acceptance:** Clock/property/provider tests prove no duplicate reminder, no send after withdrawal and explicit behavior across DST/reinstall.

### P3-PR-011

**Implement wallet, deep-link and cross-channel privacy services**

**Stage:** S3 · **Responsible role:** Backend · **Work packages:** E30, E14

**Depends on:** [P3-PR-008](phase-3-prs.md#p3-pr-008), [P3-PR-009](phase-3-prs.md#p3-pr-009), [P3-PR-010](phase-3-prs.md#p3-pr-010), [P3-PR-007](phase-3-prs.md#p3-pr-007)

**Trace:** UC05, UC09, UC12, UC18, AT14, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement saved-offer/expiry/timezone semantics and authorized report/deep-link resolution.
- [ ] Reuse P2 AI/photo services with device/account scope; preserve explicit confirmation and no public photos.
- [ ] Complete app/device/grant/object deletion graph and replay handling.

**Verification and acceptance:** Offline offer expiry, shared-link scope, AI/photo ownership and cross-channel deletion tests pass.

### P3-PR-012

**Define public and authenticated tool application contracts**

**Stage:** S3 · **Responsible role:** Backend/connector · **Work packages:** E29

**Depends on:** [P3-PR-008](phase-3-prs.md#p3-pr-008), [P3-PR-009](phase-3-prs.md#p3-pr-009), [P3-PR-010](phase-3-prs.md#p3-pr-010), [P3-PR-011](phase-3-prs.md#p3-pr-011), [P3-PR-007](phase-3-prs.md#p3-pr-007)

**Trace:** CAP-08, UC12, UC18, AT03, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Define tool contracts for decode_tire_size, recommend_tires, compare_tires, check_shop_quote, explain_term, get_maintenance_plan and find_offers.
- [ ] Map them to existing services with licensed public DTOs, units/provenance/unknowns and no assigned private coupon codes.
- [ ] Define authenticated save/report-email operations, explicit user confirmations, scope checks and minimized telemetry.

**Verification and acceptance:** Golden service replay matches web results; public tools cannot invoke private processing or infer personal records.

### P3-PR-013

**Close shared ownership and tool-service gate**

**Stage:** S3 · **Responsible role:** QA/backend · **Work packages:** E29, E30, E31

**Depends on:** [P3-PR-008](phase-3-prs.md#p3-pr-008), [P3-PR-009](phase-3-prs.md#p3-pr-009), [P3-PR-010](phase-3-prs.md#p3-pr-010), [P3-PR-011](phase-3-prs.md#p3-pr-011), [P3-PR-012](phase-3-prs.md#p3-pr-012), [P3-PR-007](phase-3-prs.md#p3-pr-007)

**Trace:** CAP-08, UC12, UC18, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run account/merge/garage/sync/reminder/wallet/tool journeys headlessly with real repositories.
- [ ] Verify current auth/provider contracts and scoped deletion/consent across old and new callers.
- [ ] Publish S3 acceptance, compatibility matrix and remaining client/render evidence.

**Verification and acceptance:** All committed P3 services pass before REST/MCP transport integration.

### P3-PR-014

**Expose consumer, sync, reminder and device APIs**

**Stage:** S4 · **Responsible role:** Backend · **Work packages:** E30, E31, E34

**Depends on:** [P3-PR-013](phase-3-prs.md#p3-pr-013)

**Trace:** UC12, UC18, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Expose versioned account/merge/garage/tire-check/sync/device/reminder/wallet endpoints.
- [ ] Apply object authorization, quotas, idempotency, secure token lifecycle and backward-compatible errors.
- [ ] Publish generated web/native clients and online/offline conflict contracts.

**Verification and acceptance:** Running HTTP tests use old/new client fixtures and prove wrong-account denial, dedupe, revocation and bounded sync payloads.

### P3-PR-015

**Implement and verify public MCP transport and tools**

**Stage:** S4 · **Responsible role:** Backend/connector · **Work packages:** E29, E34

**Depends on:** [P3-PR-013](phase-3-prs.md#p3-pr-013)

**Trace:** CAP-08, FR-AI-01, FR-AI-02, FR-AI-03, FR-AI-06, FR-AI-07, FR-AI-09. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement the pinned official SDK/transport and seven public tool adapters plus glossary resources/prompt template.
- [ ] Enforce schemas/output bounds, public limits, safe attribution and no arbitrary URL/tool execution.
- [ ] Version contracts and implement protocol-compatible errors, timing/size metrics and deprecation fixtures.

**Verification and acceptance:** Inspector/protocol and real-client tests replay golden results with no ranking divergence or private capability exposure.

### P3-PR-016

**Implement scoped authenticated MCP flows**

**Stage:** S4 · **Responsible role:** Backend/security · **Work packages:** E29, E34

**Depends on:** [P3-PR-014](phase-3-prs.md#p3-pr-014), [P3-PR-015](phase-3-prs.md#p3-pr-015), [P3-PR-013](phase-3-prs.md#p3-pr-013)

**Trace:** FR-AI-04, FR-AI-05, UC08, UC18, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement current target-client authorization with scoped, revocable grants and strict audience checks.
- [ ] Expose permitted owner save/report actions through the same services, requiring the actual user's confirmation for sending or permission changes.
- [ ] Minimize logs and exclude connector-origin records from disallowed audience processing.

**Verification and acceptance:** Client/HTTP tests cover missing/expired/revoked grants, forged confirmation and cross-owner attempts; assistant text cannot grant consent.

### P3-PR-017

**Accept complete web, mobile and MCP API parity**

**Stage:** S4 · **Responsible role:** QA/backend · **Work packages:** E29, E30, E31, E34

**Depends on:** [P3-PR-014](phase-3-prs.md#p3-pr-014), [P3-PR-015](phase-3-prs.md#p3-pr-015), [P3-PR-016](phase-3-prs.md#p3-pr-016), [P3-PR-013](phase-3-prs.md#p3-pr-013)

**Trace:** CAP-01, CAP-08, UC18, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run identical supported inputs through web REST and MCP with exact versions and compare authoritative outputs.
- [ ] Exercise real target-client public/authenticated flows and mobile API fixtures, including offline/conflict/revocation/deletion.
- [ ] Publish P3 S4 gate and compatibility/security evidence before any new app or web-account UI.

**Verification and acceptance:** Both app-facing APIs and public/authenticated tool contracts pass; distribution approval and actual UI remain S5/S6 work.

### P3-PR-018

**Build Expo shell, authentication and native foundations**

**Stage:** S5 · **Responsible role:** Mobile · **Work packages:** E30

**Depends on:** [P3-PR-017](phase-3-prs.md#p3-pr-017)

**Trace:** FR-APP-01, FR-APP-02, FR-APP-06, FR-APP-09. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Create Expo application only now; pin native/runtime/build tooling and establish Garage/Assess/Learn/Offers/Settings navigation.
- [ ] Implement secure session storage, guest mode, verified sign-in/merge and accessible error/loading components.
- [ ] Configure locale, crash reporting, compatible update policy and privacy inventory.

**Verification and acceptance:** Native/device tests cover secure sessions, cold start/accessibility and guest-to-account authority without copied business rules.

### P3-PR-019

**Build mobile garage, assessment, reports and camera flow**

**Stage:** S5 · **Responsible role:** Mobile · **Work packages:** E30, E41

**Depends on:** [P3-PR-018](phase-3-prs.md#p3-pr-018), [P3-PR-017](phase-3-prs.md#p3-pr-017)

**Trace:** CAP-07, CAP-08, UC16, UC18, FR-APP-07. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Build garage/tire-check history and assessment/results/compare flows on generated clients.
- [ ] Reuse web-backed AI analysis and photo upload/candidate confirmation with manual recovery.
- [ ] Implement shared-report/deep-link routing and current safety warnings separately from offline copies.

**Verification and acceptance:** Real-device journeys and API parity tests prove confirmed inputs, correct ownership and usable unsupported/offline states.

### P3-PR-020

**Build offline sync, wallet and reminder settings**

**Stage:** S5 · **Responsible role:** Mobile · **Work packages:** E30, E31

**Depends on:** [P3-PR-018](phase-3-prs.md#p3-pr-018), [P3-PR-019](phase-3-prs.md#p3-pr-019), [P3-PR-017](phase-3-prs.md#p3-pr-017)

**Trace:** FR-APP-04, FR-APP-08, UC12, UC18. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Implement last-five-report/content cache, queued maintenance events and explicit conflict resolution.
- [ ] Implement saved offers with expiry/offline freshness and in-context push/reminder permission controls.
- [ ] Implement account deletion, device revocation, processing choices and fallback web links in Settings.

**Verification and acceptance:** Airplane-mode/reconnect/reinstall/timezone tests preserve history and consent; no guaranteed offline redemption or recall clearance.

### P3-PR-021

**Build web account, garage and ownership controls**

**Stage:** S5 · **Responsible role:** Frontend · **Work packages:** E30, E31

**Depends on:** [P3-PR-017](phase-3-prs.md#p3-pr-017)

**Trace:** CAP-08, UC12, UC18. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Add optional web account and verified guest merge interfaces while preserving anonymous P1 use.
- [ ] Build garage/history/basic reminder/wallet and device/session controls on shared APIs.
- [ ] Expose account deletion and cross-channel consent/status feedback without broadening original purposes.

**Verification and acceptance:** Web/mobile consistency, ownership, merge conflict and deletion browser tests pass.

### P3-PR-022

**Build developer documentation and AI-client packaging**

**Stage:** S5 · **Responsible role:** Connector/content · **Work packages:** E29

**Depends on:** [P3-PR-017](phase-3-prs.md#p3-pr-017)

**Trace:** FR-AI-08, FR-AI-10, CAP-08. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Publish developer setup, contracts, source/redistribution terms, attribution, rate limits and 90-day breaking-change policy.
- [ ] Prepare current client plugin packaging and optional permitted comparison UI over accepted MCP tools.
- [ ] Provide public/authenticated setup, confirmation and disconnect instructions with truthful limitations.

**Verification and acceptance:** Real-client install/setup and tool-choice/phrasing review pass; listing submissions and acceptance are tracked separately.

### P3-PR-023

**Verify native quality and complete client journeys**

**Stage:** S6 · **Responsible role:** QA/mobile/connector · **Work packages:** E29, E30

**Depends on:** [P3-PR-018](phase-3-prs.md#p3-pr-018), [P3-PR-019](phase-3-prs.md#p3-pr-019), [P3-PR-020](phase-3-prs.md#p3-pr-020), [P3-PR-021](phase-3-prs.md#p3-pr-021), [P3-PR-022](phase-3-prs.md#p3-pr-022)

**Trace:** FR-APP-09, FR-APP-10, FR-AI-10, UC18, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Run target-device/browser/AI-client full flows, accessibility, crash/startup and tool latency measurements.
- [ ] Test offline conflicts, push permission, account deletion, grants, expired shares and P2 photo/AI reuse across channels.
- [ ] Exercise compatible old-client upgrades, rollback/kill switches and all prior live-product regressions.

**Verification and acceptance:** G4/G7 native/client evidence meets agreed targets; neither mock mobile calls nor an unlisted demo closes a live channel.

### P3-PR-024

**Complete store and AI-client distribution readiness**

**Stage:** S6 · **Responsible role:** Product/mobile/connector · **Work packages:** E29, E30

**Depends on:** [P3-PR-023](phase-3-prs.md#p3-pr-023), [P3-PR-018](phase-3-prs.md#p3-pr-018), [P3-PR-019](phase-3-prs.md#p3-pr-019), [P3-PR-020](phase-3-prs.md#p3-pr-020), [P3-PR-021](phase-3-prs.md#p3-pr-021), [P3-PR-022](phase-3-prs.md#p3-pr-022)

**Trace:** FR-APP-06, FR-APP-10, FR-APP-11, FR-APP-12, FR-AI-08. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Prepare reviewed store metadata/privacy disclosures/screenshots, support and account-deletion instructions.
- [ ] Perform internal/beta distribution, signed rollout configuration and actual platform submissions through authorized owners.
- [ ] Track provider/store review findings and acceptance, including manual handoff where APIs cannot submit.

**Verification and acceptance:** Required listings/distribution permissions are evidenced; rejection or pending approval remains visible and blocks the affected release.

### P3-PR-025

**Release Phase 3 web, app and AI-client experience**

**Stage:** S6 · **Responsible role:** Product/platform · **Work packages:** E29, E30, E31

**Depends on:** [P3-PR-023](phase-3-prs.md#p3-pr-023), [P3-PR-024](phase-3-prs.md#p3-pr-024), [P3-PR-018](phase-3-prs.md#p3-pr-018), [P3-PR-019](phase-3-prs.md#p3-pr-019), [P3-PR-020](phase-3-prs.md#p3-pr-020), [P3-PR-021](phase-3-prs.md#p3-pr-021), [P3-PR-022](phase-3-prs.md#p3-pr-022)

**Trace:** CAP-01, CAP-08, UC18, AT28. Exact FR/CORE/NFR rows are selected through the [requirements matrix](../05-requirements-traceability.md) at readiness; this grouping does not automatically complete every requirement in a work package.

- [ ] Approve G5/G7 rollout with deployment/build/protocol versions and compatible migrations.
- [ ] Demonstrate live web/account, usable native app and real public/authenticated AI-client workflows with scoped consent.
- [ ] Record support/observability, public access paths, revocation/deletion smoke and production incident ownership.

**Verification and acceptance:** Both committed new channels are usable and the earlier product remains live; one channel alone cannot close P3.
