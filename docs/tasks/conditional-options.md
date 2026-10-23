# Conditional capability activation tickets

**Working backlog · October 23, 2026.** These 10 tickets preserve separately gated options from the approved [phase/scope contract](../12-live-product-phases-and-gap-review.md#scope-reconciliation-and-completion). They are parked decision/decomposition tickets, outside the 119 core implementation PRs. Their authoritative status is in the [master tracker](../15-project-task-list.md#conditional-option-ledger). A parked ticket is not an implemented or approved-for-activation capability.

## Activation process

For a selected option, its planning PR must settle rights, purpose, product boundaries, cost, accountable owner and acceptance evidence first. Then replace its implementation outline with concrete child PR cards and status rows, assigning stable IDs such as `P4-OPT-001-S1-01`. Specify S1 schema/constraints → S2 entities/repositories → S3 services → S4 APIs/headless acceptance → S5 UI/templates → S6 integration/controlled rollout; carry forward the preceding accepted core phase. Do not implement a whole optional capability in the activation PR or start its UI before its APIs pass.

If an option is accepted into P4's committed scope at scope lock, all its child PRs and evidence become P4 exit dependencies before new P4 UI begins. If activated after the core phase closes, give it a separate named release and repeat the gates; it does not retroactively change core completion. Moving any already committed work to optional/deferred requires an explicit owner decision and a traceability change.

## P4-OPT-001

**Market rollout per country** · **Accountable role:** Product/data/privacy · **Work:** E28, E33

- [ ] Confirm licensed fitment/recall/price/retailer coverage and jurisdiction/locale rules per UK, IE, AU or other chosen market; never treat translation as coverage.
- [ ] Record the explicit activation/defer decision, rights/privacy/commercial evidence, estimate and release owner.
- [ ] Produce reviewable child PRs with dependencies, key tasks and tests from this implementation outline: Country-specific source/rule migrations and repository mappings; market services and API golden cases; localized UI/email/SEO; independent G7 rollout.

**Acceptance:** reviewed activation decision and fully linked child backlog, or a dated owner-approved deferred/declined disposition. No data export, procurement, production send or charge is performed merely by adding this ticket.

## P4-OPT-002

**Tier A audience sales** · **Accountable role:** Product/privacy · **Work:** E32

- [ ] Prove buyer demand, lawful/source-permitted use, deidentification and minimum-cell/anti-differencing controls; internal P2 aggregate insights do not authorize sale.
- [ ] Record the explicit activation/defer decision, rights/privacy/commercial evidence, estimate and release owner.
- [ ] Produce reviewable child PRs with dependencies, key tasks and tests from this implementation outline: Buyer/contract/export schema and repositories; aggregate export/suppression services; scoped APIs; operator approval UI; monitored delivery/deletion evidence.

**Acceptance:** reviewed activation decision and fully linked child backlog, or a dated owner-approved deferred/declined disposition. No data export, procurement, production send or charge is performed merely by adding this ticket.

## P4-OPT-003

**Tier B audience evaluation** · **Accountable role:** Privacy/security · **Work:** E32

- [ ] Require explicit market permission, buyer contracts, age exclusions, clean-room design and two distinct approvals; connector records remain excluded.
- [ ] Record the explicit activation/defer decision, rights/privacy/commercial evidence, estimate and release owner.
- [ ] Produce reviewable child PRs with dependencies, key tasks and tests from this implementation outline: Scoped profile/export/approval schema; purpose-filtered repositories; revalidation/deletion services; protected APIs; staff/buyer controls; independent privacy/security release.

**Acceptance:** reviewed activation decision and fully linked child backlog, or a dated owner-approved deferred/declined disposition. No data export, procurement, production send or charge is performed merely by adding this ticket.

## P4-OPT-004

**Tier C identity-sharing leads** · **Accountable role:** Product/privacy · **Work:** E33

- [ ] Require verified explicit identity-sharing permission for current recipient categories, buyer due diligence, approved fields and separate commercial decision.
- [ ] Record the explicit activation/defer decision, rights/privacy/commercial evidence, estimate and release owner.
- [ ] Produce reviewable child PRs with dependencies, key tasks and tests from this implementation outline: Purpose-specific consent/link/export schema; restricted repositories; permission/revalidation/deletion services; confirmation/export APIs; owner/staff UI; buyer acknowledgement evidence.

**Acceptance:** reviewed activation decision and fully linked child backlog, or a dated owner-approved deferred/declined disposition. No data export, procurement, production send or charge is performed merely by adding this ticket.

## P4-OPT-005

**Onsite partner offers** · **Accountable role:** Product/partners · **Work:** E33

- [ ] Approve product placement and purpose rules separately from report-email offers; preserve ranking, ad exclusions and unique-code confidentiality.
- [ ] Record the explicit activation/defer decision, rights/privacy/commercial evidence, estimate and release owner.
- [ ] Produce reviewable child PRs with dependencies, key tasks and tests from this implementation outline: Any onsite-reservation schema delta; scoped repository work; matching/cap/permission services; accepted APIs; site UI; privacy/race/rollout evidence.

**Acceptance:** reviewed activation decision and fully linked child backlog, or a dated owner-approved deferred/declined disposition. No data export, procurement, production send or charge is performed merely by adding this ticket.

## P4-OPT-006

**Third-party redemption integration** · **Accountable role:** Partners/backend · **Work:** E33

- [ ] Select partner contracts and exact reported-versus-verified semantics; confirm webhook security, correction and disputes ownership.
- [ ] Record the explicit activation/defer decision, rights/privacy/commercial evidence, estimate and release owner.
- [ ] Produce reviewable child PRs with dependencies, key tasks and tests from this implementation outline: Integration identity/event schema; tenant repositories; provider/reversal/reconciliation services; signed callbacks/APIs; portal states; settlement and recovery tests.

**Acceptance:** reviewed activation decision and fully linked child backlog, or a dated owner-approved deferred/declined disposition. No data export, procurement, production send or charge is performed merely by adding this ticket.

## P4-OPT-007

**Non-English localization** · **Accountable role:** Content/product · **Work:** E33

- [ ] Approve languages, translator/specialist review capacity and content/market separation; a language is not a new market approval.
- [ ] Record the explicit activation/defer decision, rights/privacy/commercial evidence, estimate and release owner.
- [ ] Produce reviewable child PRs with dependencies, key tasks and tests from this implementation outline: Locale/content/schema deltas if needed; locale repositories; reviewed messages/rules/tool outputs; API locale contracts; web/app/email/PDF/SEO translation; accessibility/content QA.

**Acceptance:** reviewed activation decision and fully linked child backlog, or a dated owner-approved deferred/declined disposition. No data export, procurement, production send or charge is performed merely by adding this ticket.

## P4-OPT-008

**Paid MCP or B2B API plans** · **Accountable role:** Commercial/connector · **Work:** E27, E33

- [ ] Approve redistribution rights, plans, service limits/SLA, billing policy and client terms; keep public tool honesty/consent intact.
- [ ] Record the explicit activation/defer decision, rights/privacy/commercial evidence, estimate and release owner.
- [ ] Produce reviewable child PRs with dependencies, key tasks and tests from this implementation outline: Plan/entitlement/usage schema; scoped repositories; metering/billing/quota services; API/protocol tests; developer billing UI; contract/load/payment activation evidence.

**Acceptance:** reviewed activation decision and fully linked child backlog, or a dated owner-approved deferred/declined disposition. No data export, procurement, production send or charge is performed merely by adding this ticket.

## P4-OPT-009

**Optional mobile advertising** · **Accountable role:** Product/privacy/mobile · **Work:** E33

- [ ] Approve mobile-specific inventory, CMP/tracking/platform rules and performance case; P3 ships without app ads.
- [ ] Record the explicit activation/defer decision, rights/privacy/commercial evidence, estimate and release owner.
- [ ] Produce reviewable child PRs with dependencies, key tasks and tests from this implementation outline: Only required config/metric schema; repositories; placement/consent services; APIs; native ad UI; device/privacy/performance and store review.

**Acceptance:** reviewed activation decision and fully linked child backlog, or a dated owner-approved deferred/declined disposition. No data export, procurement, production send or charge is performed merely by adding this ticket.

## P4-OPT-010

**Optional VIN capture and decode** · **Accountable role:** Product/privacy/data · **Work:** E30, E33

- [ ] Prove user need and data rights; minimize sensitive identifiers and never infer tire/wheel package verification from VIN alone.
- [ ] Record the explicit activation/defer decision, rights/privacy/commercial evidence, estimate and release owner.
- [ ] Produce reviewable child PRs with dependencies, key tasks and tests from this implementation outline: Encrypted identifier/retention schema if required; owner repositories; bounded decode/confirmation services; APIs; camera/manual UI; privacy/accuracy/deletion tests.

**Acceptance:** reviewed activation decision and fully linked child backlog, or a dated owner-approved deferred/declined disposition. No data export, procurement, production send or charge is performed merely by adding this ticket.
