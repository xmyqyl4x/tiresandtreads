# Implementation plan

**Baseline 1.4 (option-C deployment approved October 23, 2026).** Deliver the US web experience before expanding into reseller operations, native applications, or audience sales. This plan converts the [product design](01-final-product-design.md), [architecture](02-technical-architecture.md), and [delivery/privacy specification](03-delivery-and-privacy.md) into reviewable work packages. Requirements remain traceable in [the coverage matrix](05-requirements-traceability.md).

**Current direction:** build the database, data access/models, business services and exposed APIs before product frontends. The [PostgreSQL and build-order amendment](11-postgresql-and-build-order.md) replaces ClickHouse/Redis/QStash with PostgreSQL analytics, SQL limits and measured caching. The original [AS01–AS07 approval](07-stack-and-layer-signoff.md#7-signoff-decisions) remains historical; AS02/AS07 implementation selections are amended. Separate Payload ownership, Inngest execution, consent defaults and release gates remain.

**Engineering obligations:** apply the [TDD strategy](08-test-driven-development.md), [database contract](09-database-design.md), and [coding standards](10-coding-standards.md) in each stage. P1-PR-002 bootstrap implementation is accepted; P1-PR-003 local foundation proofs are in progress; product-layer implementation remains at its dependency-gated cards. Estimates below are a revised planning allowance, not measured throughput. Re-estimate at S0/G0 and after the S2 data-access and S4 API demonstrations.

## Four live releases

The [P1–P4 delivery contract](12-live-product-phases-and-gap-review.md#four-live-product-phases) now governs scope: P1 live core web/SEO/ads/reference scripts; P2 AI/reuse/photos/admin CSV plus reseller pilot; P3 usable app and MCP channel; P4 lifecycle, curated SEO/growth operations and core completion. R0/S stages are internal work, not live phases. Complete all APIs for the current phase before its UI; earlier live releases stay supported. Optional audiences/extra markets remain independently gated.

## Implementation PR working backlog

Use the [project task list](15-project-task-list.md) for day-to-day execution of this approved plan. It decomposes the four phases into 119 planned PRs (43/27/25/24), plus 10 parked optional activation tickets. The linked phase cards define key tasks, role ownership, dependencies and verification; the master ledger owns status, assignee and actual PR/evidence links. [Package mapping](tasks/work-package-pr-map.md) covers E01–E42 without treating a merged PR as a shipped phase. This decomposition does not revise scope, authorize external activation or supply a new elapsed-time estimate.

## Development process for every work package

The [approved deployment plan](16-deployment-and-local-environments.md) selects option C: app containers and PostgreSQL outside Vercel, with local Docker dev/test/stage and checks before GitHub push. DP01–DP08 supersede the Vercel/Neon default; record option-C vendor, region, DB operating model, cost and operator as deferred decisions in P1-PR-001/003, resolving each before its [blocking trigger](implementation/P1-PR-001-launch-baseline.md#deferred-decision-register). [The deployment task mapping](16-deployment-and-local-environments.md#integration-with-the-working-pr-task-list) preserves all 119 core IDs, four live phases and S0–S6 ordering. No hosted infrastructure has been provisioned.

1. Establish readiness: requirement/UC/AT IDs, actors, acceptance examples, layer/table ownership, adverse paths, and realistic test data.
2. Write and run the smallest failing unit/application use-case tests for the next behavior. For a database or API invariant, begin with a failing real boundary test as well.
3. Implement the behavior in its owning layer, then refactor with tests passing. Browser, staff, future mobile and MCP adapters share the same application/domain implementation.
4. Complete affected functional API/UI, integration, contract, accessibility, privacy and performance verification. Record first failure and final results in the PR.
5. Update traceability, migrations, contracts and runbooks; review against the coding standards and definition of done before marking the package complete.

Testing and database design are continuous work in the feature estimates. E19 broadens integrated, recovery and release evidence after individual features already have passing tests. Exploratory spikes remain explicitly unshipped until the discovered behavior has contracts and tests.

## Staffing and estimate basis

Planning assumption: three experienced full-time engineers able to contribute to backend work (backend, data/platform, and frontend/full-stack), a half-time product designer, QA/accessibility support from the first test harness, a tire-data specialist, a content editor with 25 reviewed articles, and privacy/legal support at gates. These are role assignments, not a claim that people have been hired. The frontend engineer can help with contracts, fixtures, API tests and tooling before S5; specialist frontend availability alone does not accelerate backend gates.

The former overlapping **16-week calendar is withdrawn**. Establish a new elapsed-time forecast at full G0 and refine it at S2/S4 after splitting backend/presentation effort and scheduling the dependency graph. The prior baseline package allowances total **166–239 engineering days (about 33–48 person-weeks)**, with explicit database/data-access, PostgreSQL analytics and API acceptance work. This historical subtotal excludes E35–E42 and the expanded phase requirements; it is not a current full-project estimate. Re-estimate all four phases with each scope lock, including data review, model evaluation, stores/client review, SEO/ad operations, and continuing support. The effort total is not a calendar: sequential ingestion → engine → report → delivery → privacy → administration dependencies limit parallel utilization, even with three engineers. External licensing, vendor access, content and specialist review can extend elapsed time; a solo builder must estimate separately. Size the next local cards at S0, publish the combined bottom-up rebaseline at full G0 and update it at S2/S4; do not claim removing vendors guarantees lower total cost or an earlier launch.

## Build stages and exit gates

The owner has deferred commercial data-provider and hosting-budget choices until necessary. For P1, accept the local S0 foundation with real local proofs and an open-decision register; full G0 remains open until actual rights, provider, hosting and budget evidence is accepted. This permits synthetic S1/S2 work. Protected imports, real adapters and hosted provisioning still require the relevant decision first; full G0 closes no later than P1-PR-031. See the [P1 launch baseline](implementation/P1-PR-001-launch-baseline.md).

Stage gates S0–S6 control construction order; G0–G7 remain business, safety and release gates. Complete each stage's exit evidence before starting dependent implementation. **All business services and APIs committed to the current phase pass S4 before building that phase's product frontend.** P1 does not wait for unused P2–P4 schemas. Existing UX documents, content writing and provider research may progress in parallel. A minimal headless framework host and disposable vendor-auth compatibility fixture are allowed at S0; they are not product UI or a design-system implementation.

```mermaid
flowchart LR
  S0["S0 Prerequisites and test harness"] --> S1["S1 PostgreSQL schema and integrity"]
  S1 --> S2["S2 Entities, mappers and repositories"]
  S2 --> S3["S3 Domain and application services"]
  S3 --> S4["S4 APIs and headless acceptance"]
  S4 --> S5["S5 Frontends and renderers"]
  S5 --> S6["S6 Integrated quality and rollout"]
```

| Stage | Build scope and package mapping | Required exit evidence |
| --- | --- | --- |
| S0 prerequisites | E01/E02: coverage/refusal and rights register, package/runtime compatibility, isolated DB setup, CI/TDD harness, service-port contracts and local headless compatibility; external decisions have blocking triggers | Real local integration evidence, locked dependencies and reproducible test host; G0 status explicitly open where external evidence is deferred; no product UI |
| S1 database | E04a: application and separate CMS database ownership, all required P1 table/constraint/index migrations including E35–E38 additions, runtime grants, synthetic seeds, outbox/inbox, analytics and limiter schema; create referenced foundations before dependent FKs | Empty/upgrade migration and real-role constraint tests, backup/restore/deletion replay drill; DB-level portions of DB01–DB22 and DB27–DB28 proven where applicable; DB23–DB26 enter P2; later-release invariants explicitly staged |
| S2 data access | E04b: typed persistence records, pure entity/value interfaces, mappers, narrow repository/query ports, transaction context and real PostgreSQL implementations | Round-trip/null/unit mapping, ownership scoping, concurrency/rollback, query plans, bounded reads and pool tests; domain/application imports contain no ORM dependency |
| S3 business services | E05/E06/E08/E10a/E11/E12a/E13a/E14/E15a/E16/E17a/E18a plus E35–E38 backend increments: ingestion, rules, reports, consent, delivery orchestration, privacy, content bridge, analytics and staff/commercial services | UC01–UC10, UC13, UC17 service scenarios with real repositories plus required adapter sandbox evidence; G1 engine evidence and backend G2 controls; deterministic rules, failure/retry/deletion tests; render ports use fixtures until S5 |
| S4 APIs | E34: expose and verify every R1 public/owner/staff/content/provider API against the same services; OpenAPI, auth/CSRF, quotas, idempotency, errors, observability and API clients | Runnable headless assessment → stored report → compare → schedule/cancel → deletion journey; denied/expired/retry paths; DB17–DB20 stress tests; API inventory and contracts complete; full G0 and chosen-host proofs accepted; no mock-only backend signoff |
| S5 frontends | E03/E07/E09/E10b/E12b/E13b/E15b/E17b/E18b: public/staff/CMS experiences, accessible components, preferences/privacy controls, email/PDF templates and approved commercial surfaces | Frontends use accepted API/service contracts; real browser integration and email/PDF rendering checks; 25 reviewed articles; complete G2/G3 user-facing evidence |
| S6 release evidence | E19/E20: integrated accessibility/performance/failure/recovery, invited beta, operational handover, controlled activation | G4/G5 decision with all relevant UC/AT tests and no critical issues; measured costs, alerts, rollback and recovery ready |

Each gate produces a versioned evidence packet listing commit, migrations/contracts, test commands/results, measured budgets, unresolved external dependencies and accountable reviewer. A gate is not passed by a diagram, fixture-only demo or skipped check. S4 permits fixture renderers for interface tests, but records real email/PDF acceptance as outstanding until S5/S6. It does not authorize production delivery.

Later R2–R4 capabilities follow the same schema → repositories/models → services → API → UI sequence within their approved release. Existing validated foundations are reused. A change discovered in S5 returns to the relevant layer with a regression test and compatible migration/contract update; do not patch business rules in the UI to preserve the schedule.

## R0 and R1 work packages

E01–E33 remain stable traceability IDs. Suffixes `a` and `b` split existing packages into backend and later presentation deliverables; the row estimate covers both, not each separately. E04a/E04b split schema and data access. E34 makes API integration/acceptance explicit. A base package is complete only when all its parts pass. Effort is engineering days, not elapsed days; rows are grouped for traceability, not execution order.

| ID | Work package and accountable role | Depends on / stage | Estimate | Acceptance evidence |
| --- | --- | --- | --- | --- |
| E01 | Data/provider and business feasibility, data lead | None; S0 | 5–8 | Evaluate fitment candidates; benchmark optional/staggered/AWD/EV/LT; rights, costs, gaps and refusal path |
| E02 | Bootstrap and headless integration proofs, platform lead | E01 local scope and deferred-decision register; S0 | 6–9 | Lock Node 24/Linux containers and compatible packages; isolated Docker dev/test/stage, pre-push/CI/TDD commands, strict types/import rules, real PostgreSQL roles, protected image releases, auth/CMS/CMP/ESP proofs and measured budgets |
| E03 | Design system and accessible shell, frontend lead | S4 passed; S5 | 5–7 | Tokens/components at 320/390/768/1280px; keyboard, focus, contrast and reduced-motion checks |
| E04 | E04a schema/migrations; E04b data access/entities, backend lead | E02 → E04a S1 → E04b S2 | 12–17 | E04a 6–8 days: all R1 schema, constraints, roles, migration/restore tests. E04b 6–9: pure entity/value contracts, Drizzle records/mappers, repositories, read models, unit-of-work, concurrent rollback and query evidence |
| E05 | Catalog/fitment/climate/recall ingestion, data lead | E01,E04b; S3 | 10–14 | Provenance, coherent publish, idempotent imports, quarantine, chosen launch coverage and stale-recall gate |
| E06 | Engine and pricing/scenarios, data lead | E05; S3 | 10–15 | Deterministic pure rules, safety-before-budget, unknown evidence, property tests and reviewed golden cases |
| E07 | Assessment frontend, frontend lead | S4,E03; S5 | 6–9 | Keyboard/mobile form, size-only/wheel-package cases, lookup recovery; consumes E34 create-report API without duplicating rules |
| E08 | Report snapshots/capabilities services, backend lead | E04b,E06; S3 | 6–8 | Owner/share isolation, immutable versions, revoke/expiry, safe DTOs and private cache headers specified for E34 |
| E09 | Results/explanations frontend, frontend lead | S4,E03,E07; S5 | 7–10 | Evidence/unknowns, quantity/basis, as-of dates, corrections, exclusions and live safety overlay |
| E10 | E10a refine/compare/quote services; E10b frontend, backend/frontend leads | a: E06,E08 S3; b: S4,E03,E09 S5 | 9–13 | a: drafts/revisions, immutable comparison and quote semantics through service tests; b: autosave/conflicts, four-item compare and accessible mobile views |
| E11 | Contact/consent/suppression services, backend lead | E02,E04b; S3 | 7–10 | Independent purposes, verified changes, restrictive defaults, GPC, current-purpose checks and no forged grants |
| E12 | E12a delivery/PDF orchestration; E12b templates, backend/presentation leads | a: E08,E10a,E11,E15a S3; b: S4,E15b S5 | 10–14 | a: fixed DTO/version, durable intent, 60s cancellation, rendering ports/private assets; b: actual HTML/text/PDF, <100KB email, deterministic learning links and client/render acceptance |
| E13 | E13a events/preferences/redirect services; E13b controls, backend/frontend leads | a: E12a S3; b: S4,E03,E12b S5 | 7–10 | a: webhook verification/dedupe, uncertain sends, RFC 8058, safe redirects and bot classification; b: preferences, delivery/cancel status and retry controls |
| E14 | Privacy and retention services, backend lead | E08,E11,E13a,E16; S3 | 7–10 | Verified rights flow, complete SQL/analytics/object deletion graph, deadline policy and tombstone/backup replay; controls implemented in E13b/E17b |
| E15 | E15a CMS/content/tool services; E15b education/CMS UI/SEO, content/full-stack leads | a: E02,E04b S3; b: S4,E03 S5 | 10–14 | a: service access rules over S1 CMS collections, durable publication bridge, published DTOs and pure public-tool logic; b: 25 reviewed terms, hub/decoder/checklist/trust pages, editor UI, metadata/robots/sitemap and <60s propagation |
| E16 | PostgreSQL events/aggregates/limit/cache adapters, platform lead | E04b,E11; S3; load proof S4 | 8–12 | Allowlisted event intake, consent withdrawal/deletion, dedupe/recompute generations, SQL quotas, cleanup and no report slowdown under bounded analytic load; no optional pure computation cache without measured benefit; E40 is a separate required P2 artifact store |
| E17 | E17a staff queries/commands; E17b admin UI, backend/frontend leads | a: E05,E13a,E14,E15a,E16 S3; b: S4,E03 S5 | 9–13 | a: role matrix, masked DTOs/audited commands and operational queues; b: staff screens, privacy/request views and explicit inactive modules |
| E18 | E18a affiliate/ad policy services; E18b placements, platform/frontend leads | a: E08,E11,E15a,E17a S3; b: S4,E03,E09,E17b S5 | 5–7 | a: approved destinations, opaque attribution, link checks/config/blocks; b: disclosure, ads.txt/slots/house fallback, no forbidden placements and report-token isolation |
| E34 | Shared API exposure and headless acceptance, backend/QA leads | All S3 packages; S4 | 8–12 | Complete API inventory/OpenAPI/client contracts, public/owner/staff/webhook authorization, negative/retry/limit tests and realistic workload evidence before UI starts |
| E19 | Integrated hardening and beta, QA/all engineers | E03,E07–E18,E34 complete; S6 | 14–20 | Full relevant UC/E2E/accessibility/load/failure/render suites, targeted critical-rule mutation review, restore/deletion drill and beta regression/runbooks |
| E20 | Launch and observation, platform lead/owner | E19 and G0–G4; S6 | 5–7 | Permitted production smoke, alerts/support, staged activation, rollback/kill switches and G5 decision |

Content research and writing proceed throughout, but UI/template implementation starts in S5. E12a consumes the E15a published-content contract using synthetic fixtures; real reviewed content and renderer outputs are required at E12b. No dependency runs from a backend package to a product frontend. The API row is a provisional allowance for shared wiring/verification; refine it against feature-level estimates at S0 to avoid counting endpoint work twice.

## Added capability packages and dependency placement

E35–E42 are unestimated scope additions, not work hidden inside the prior subtotal. At each phase S0, split their schema, repository, service/API and presentation effort, identify overlap with E04/E05/E15/E18/E34, and count each deliverable once. No estimated launch date is valid until this combined dependency plan is approved.

| ID | Phase and owner | Backend-first dependency chain | Completion evidence |
| --- | --- | --- | --- |
| E35 | P1 domain reference model; data lead | E01 source requirements/rights register → E04a reference/recall tables → E04b mappers/repositories → E05 lookup/matching services → E34 APIs → picker/admin views | Docs/13 schemas, provenance/rights, complete recall target coverage and DB21; larger lookups never imply fitment coverage |
| E36 | P1 import scripts; P2 admin CSV; data/backend lead | S1 import/staging extensions → S2 repositories → S3 fetch/validate/diff/publish/rollback services and CLI → S4 operator APIs → P2 S5 staff UI | Resumable/repeated import, critical quarantine, head race, rollback safety, safe versioned CSV and DB22 |
| E37 | P1 SEO foundation; P4 advanced expansion; content/platform lead | S1 strategic/search metric schema → S2 projections → E15a content/SEO/audit services → S4 APIs → E15b pages/staff findings; P4 E28 reviewed expansion | P1 crawl/metadata/private exclusion/Search Console readiness and audit; P4 curated programmatic quality, no thin AI pages |
| E38 | P1 advertising operations; platform/commercial lead | S1 slots/provider reporting schema → S2 adapters → E18a placement/consent/reporting services → S4 contracts → E18b permitted public inventory | AdSense readiness, house/no-choice/no-fill fallback, ad blocking, revenue corrections, ads.txt and performance evidence; actual provider approval separately recorded |
| E39 | P2 AI explanations; backend/data lead | P2 S0 evaluated provider/rights/notice → S1 policy/request/artifact schema → S2 repositories → S3 inference/validation/fallback → S4 owner APIs → S5 report/email/PDF integration | UC14, AT23, model evaluation, cited facts and deterministic fallback; selected attachment frozen in each send |
| E40 | P2 persistent AI reuse; backend lead | S1 scopes/keys/leases/source indexes alongside E39 → S2 repositories → S3 exact-match/invalidation/refresh → S4 hit/miss/race/privacy tests → S5 reuse/status UI | DB23–DB25, AT24–AT25; no cross-owner leakage, stale guidance or duplicated winning artifacts; finite cost/retry budgets |
| E41 | P2 web photos; P3 app reuse; platform/backend lead | S1 upload/candidate/confirmation schema → S2 scoped repositories → S3 sanitize/extract/confirm using E39 ports → S4 upload APIs → S5 web, later app UI | DB26, UC16/AT26; malicious/partial/blurry files, explicit confirmation, manual path, deletion and no photo safety diagnosis |
| E42 | P4 completion and operations; product/QA/platform leads | Accepted E27–E31 committed scopes and E35–E41 → cross-phase contract/migration/recovery evidence → production handover | Every committed requirement has real evidence; remaining gated optional scope listed; four live outcomes demonstrated and owner completion signoff |

Before each phase UI, E34's acceptance process recurs for all new and affected APIs, including import, SEO/ad operations, inference and photos. E39/E40/E41 schema and repository dependencies are planned together, then their S3 services compose through ports; no service implementation precedes their S2 gate. P2 does not start UI after only the reseller APIs pass. Run regression evidence for existing live report/delivery/privacy flows in every phase.

## First implementation sequence

1. Record E01 scope, coverage/refusal criteria, source-rights questions and decision triggers. Prove portable local backend compatibility in E02. Resolve source contracts before protected ingestion/real adapter acceptance and host/budget choices before hosted work; close full G0 by P1-PR-031.
2. Use focused `codex/` branches and PRs with stage, requirement, UC/AT and DB IDs. Pin versions, test commands and isolated environments before feature work.
3. Complete S1 schema/migration/integrity evidence for P1 including E35–E38; leave R2–R4 migrations until their releases. Do not provision paid/public resources from this planning amendment.
4. Complete S2 entity/value interfaces, persistence models/mappers, repository contracts and real transaction/query tests. Pure ports/types may be declared before service behavior to preserve inward dependencies.
5. Complete S3 rules and services through failing-then-passing unit/use-case and real-database tests. Demonstrate UC01/UC02 without a browser, then compare, delivery/cancel, content, privacy, analytics and staff/commercial services.
6. Complete S4 exposed API contracts and headless full-journey/denial/load tests; publish the gate evidence packet. Only then start E03 and the S5 frontend/rendering parts.
7. Integrate real UI and templates with those contracts, then pass S6 quality/recovery and G5 launch gates.

## Quality strategy

The [test strategy](08-test-driven-development.md) defines the red/green/refactor cycle, unit/application use-case/functional API/UI categories, coverage policies, UC01–UC18, fixtures, and CI gates. Tests target risks and behaviors, not component implementation details. Only required checks run on each change; heavy email/device/load suites run when their affected surfaces change and before a release. Changed shared contracts, permissions, schema, and engine packages expand the dependent test selection.

| Layer | Required tests | Blocking failure |
| --- | --- | --- |
| Engine unit/property | Same normalized inputs/versions give same result; all picks satisfy fitment/climate; budget never overrides safety; rankings unchanged by monetization; money/units/range arithmetic | Any unsafe eligibility or nondeterministic ranking |
| Application use cases | Actor/precondition/action/outcome scenarios through shared use-case interfaces; normal, denied, stale, retry and recovery paths | UI/API/job adapters produce inconsistent business behavior or unauthorized side effects |
| Functional API/UI | Running contract/schema/status/pagination/CSRF tests plus focused accessible UI feature tests | Public contract, object permission or user-visible feature failure |
| Golden scenario suite | At least 50 reviewed cases with expected eligibility, exclusions and explanation codes | Unexplained difference from approved behavior |
| Database integration | Idempotent outbox/inbox, duplicate/different-body keys, version conflicts, pooled-connection tenant context, code/budget races | Duplicate external effect, lost event, cross-tenant read/write |
| Browser E2E | Form → results → refine → compare → share → email → PDF, permission denied, no results, failure recovery | Cannot complete core journey or unsafe degraded state |
| Privacy/security | GPC, denied CMP, withdrawal while queued, share edit denial, token leak checks, deletion across stores, forged webhooks, redirects/SSRF/uploads | Personal-data exposure or unauthorized processing |
| Email/PDF rendering | Gmail web/mobile, Apple Mail, Outlook classic/new, Yahoo; images blocked/dark mode/long copy; PDF page boundaries and reading order | Missing controls, clipped disclosure, wrong report version or inaccessible core facts |
| Accessibility | Automated checks plus keyboard, NVDA/VoiceOver/TalkBack as applicable, zoom/reflow, compare navigation | Critical/serious accessibility issue in required journey |
| Performance/reliability | Agreed mobile lab budget, field vitals when sufficient traffic, 10× baseline ingest, retry/backpressure, failure injection, backup restore | Safety/permission bypass under load; failed recovery objectives |

Golden scenarios should include ordinary US sedan, hot/dry climate, heavy rain, heavy snow with each seasonal choice, EV, XL, LT towing, staggered setup, optional wheel package, unsupported model/trim, known-size-only, missing load/speed, AWD partial replacement, one-tire replacement, run-flat, zero/fewer-than-five eligible products, no budget fit, missing prices, stale recalls, active/conditional recalls, unknown quote, mismatched quantity/currency/services, low tread/old DOT, winter minus-size unapproved/approved, and non-US visitor. Cover boundary values and combinations until at least 50 distinct reviewed cases exist; do not generate 50 identical-shaped snapshots.

## Acceptance scenarios that must be demonstrated

| ID | Given / when | Expected outcome |
| --- | --- | --- |
| AT01 | Driver selects an ambiguous wheel package | No verified-fit recommendation until package resolved |
| AT02 | Budget allows only below-spec products | No unsafe picks; explanation and recovery, no relaxation |
| AT03 | Offer bid, affiliate rate, or ad configuration changes | Byte-equivalent core engine result for identical versions/inputs |
| AT04 | User selects a fifth comparison item | Existing four stay intact; accessible replace/remove prompt |
| AT05 | Unknown tire is quoted with an installed total | Unverified fit and qualified price basis; no invented performance |
| AT06 | Shared recipient calls owner/edit/send endpoint | Denied, no data or side effects; can fork a new report |
| AT07 | User submits report request twice then cancels at 30 seconds | One scheduled identity, no provider send, cancelled UI |
| AT08 | Provider accepts but response times out | Same payload/key reused safely; no second code or unbounded resends |
| AT09 | Two workers claim the last unique coupon | One reservation; other chooses eligible alternative or omits offer |
| AT10 | Offers are withdrawn after scheduling | Recheck removes offers or suppresses marketing before dispatch; report-only intent preserved |
| AT11 | GPC is active and analytics/ad consent absent | Core report works; denied tags/events/sharing remain off |
| AT12 | Delayed signed webhook reports an old occurrence time | Valid delivery verified per provider; duplicate does not double count |
| AT13 | Link scanner performs HEAD/GET on all email links | No opt-in, redemption, code allocation or final feedback mutation |
| AT14 | Delete request completes, then an old batch/backup replays | Tombstone suppresses reintroduction; assets/links remain revoked |
| AT15 | Reseller A guesses Reseller B's ID through API/export/job | RLS and service checks deny all tenant data |
| AT16 | CMS editor publishes redirect/content change | Safe route validation; published version visible in <60s or explicit failed/retry status |
| AT17 | Recall pipeline has failed for 48 hours | Verified recommendation generation stops; old report shows stale safety status |
| AT18 | Four items and long labels on a 320px screen | Usable compare controls, no lost labels/focus or obstructed actions |
| AT19 | Marketing opted out but a new report explicitly requested | Only permitted report content; global hard-bounce/complaint still blocks |
| AT20 | Price assumptions, mileage or winter share are incomplete | Assumptions are explicit or comparison suppressed; no false all-in saving |
| AT21 | An official lookup/recall source is partial, ambiguous or has schema drift | Quarantine or show unknown; vPIC identity never asserts tire fitment; unresolved tire recall targets remain recorded |
| AT22 | Imports repeat/resume or two publishers race; staff rolls back a dataset | One coherent publication per run/head, no partial rows; newer known recall warning is not erased by rollback |
| AT23 | AI returns unsupported facts, invalid citations, refusal or times out | Reject enrichment; deterministic report remains usable; no rank/price/safety changes or automatic resend |
| AT24 | Exact parameters repeat, then model/source/recall/rights version changes | Authorized valid artifact reused; changed or expired identity misses/invalidates; one fenced winner under concurrent refresh |
| AT25 | Owner withdraws processing/deletes while inference or refresh is in flight | No late publication/recreation; private artifacts cannot be reused by another owner; provider cleanup tracked |
| AT26 | Tire image is blurred, partial, malformed or gives conflicting fields | Quarantine or abstain; manual recovery; confirmation before use, no inferred tread/pressure/roadworthiness claim |
| AT27 | Crawler or ad script sees public/private routes under each consent state | Useful public content and correct metadata; no private URL/token/index leaks; forbidden slots absent and layout budgets pass |
| AT28 | Existing client accesses data after a phase upgrade or scope revocation | Web/app/MCP share contract results and permissions; compatible migrations, rollback and cross-channel deletion proven |

## Release gates

| Gate | Required evidence | Decision owner |
| --- | --- | --- |
| G0 Feasible foundation | S0 evidence, data rights, configuration list, reviewed scoring method, vendor/workload budget, CMP/ESP choice, headless auth/CMS proofs and revised estimates | Owner + technical/data leads |
| G1 Trustworthy engine | Coverage report, provenance, 50 scenarios, freshness, recall and partial-replacement handling, specialist review | Data lead + tire specialist |
| G2 Permission and data safety | Notices, server purpose enforcement, GPC, suppressions, token isolation, privacy deadlines, deletion/recovery, email authentication | Privacy lead + backend lead |
| G3 Complete launch experience | Core screens, 25 articles, CMS/admin, required monitoring, no critical placeholders/fake facts, explicit unavailable integration states | Product/design/content leads |
| G4 Tested operation | Acceptance suite, accessibility/performance, restore test, no critical/high security defects, on-call runbooks | QA + technical lead |
| G5 Public release | Approved policies, support mailbox/address, measured cost envelope, production smoke, rollback/kill switches, owner launch decision | Owner |
| G6 Reseller pilot | Tenant isolation, pen test, verification/moderation, code/budget races, disputes process, pilot agreements | Owner + partner/security leads |
| G7 AI/photo/market/app/MCP/data product | Separate rights/privacy/provider/store/protocol checklist for the capability being activated | Relevant product lead + owner/privacy lead |

For P1, G0 may remain open during synthetic local construction under the owner-directed deferral; it must close by P1-PR-031 and before any beta/public activation. Each earlier external-use trigger still blocks its affected work. Apply G0–G5 to each live phase with scoped evidence; G6 additionally gates P2 partners and G7 gates P2 AI/photos, P3 app/MCP and each conditional P4 activation. P1 includes E35–E38 and AT21/22/27; P2 adds AT23–AT26; P3/P4 demonstrate AT28 and regressions. E42 closes core completion.

Alpha is internal with synthetic data. Beta uses invited participants with clear notices and limited coverage. Public rollout starts with core assessment and report delivery, then activates approved affiliate/ad modules only after consent/performance checks. Stop rollout on unsafe recommendations, permission leakage, repeat-send defects, or missing deletion controls. Feature kill switches should preserve education and support access.

## P2 assisted advice and reseller pilot

P2 includes E36 admin and E39–E41 AI/reuse/photos as well as the partner pilot. All complete S1–S4 before any new P2 product UI. Existing P1 functionality remains live. For E21–E25, split schema/repository, service/API and presentation subpackages before scheduling: organization/offer/reservation/metrics/redemption/dispute APIs pass headless acceptance before reseller dashboards or portal screens start. E26 integrates the full pilot and security/operations evidence.

Re-estimate elapsed time after R1 stability using the same database → data access → services → API → frontend gates, staffing and partner onboarding. The former 6–10 week allowance is not a commitment under the amended sequence. Suggested work packages:

| ID | Scope | Dependencies | Acceptance |
| --- | --- | --- | --- |
| E21 | Organizations, business verification, agreements, roles/MFA and RLS | E04,E11,E17 | Pending/suspended cannot serve; all tenant boundary tests pass |
| E22 | Offer versions, targeting, moderation, uploads and unique pools | E21 | Malformed CSV/unsafe URLs rejected; approved version remains stable during edits; 100k-code import stays off request path |
| E23 | Matching, atomic reservations, send integration and simulation | E12,E13,E22 | Permission recheck, max three/one per seller, frequency cap, no paid term, deterministic audit and AT09 |
| E24 | Aggregate partner dashboards, reported redemption and disputes | E16,E23 | No recipient identity; scanner clicks excluded; correction ledger; explicit pilot credit |
| E25 | Deliverability admin, consented visitor explorer and internal Tier A | E14,E16,E17 | Masked roles, purpose restrictions, anti-small-cell rules and correct freshness |
| E26 | Pen test, operations training and 5–10 reseller rollout | E21–E25 | G6 passed; real moderated pilot offers, documented support and suspension procedure |

No inferred cash charges during a free pilot. Establish CPC economics from measured eligible clicks and merchant feedback before adding the P4 ledger/billing path.

## R3 and R4 workstreams

| Workstream | Earliest trigger | Implementation order | Completion evidence |
| --- | --- | --- | --- |
| E27 Commercial operations | P4; pilot stable and pricing approved | Ledger/reservation schema and repositories → billing/Stripe/reconciliation services → scoped reseller APIs/webhooks → billing/sponsorship screens | Charge/credit/refund tests, idempotent events, terms/approval and performance gates |
| E28 Markets and SEO | P4; P1 baseline SEO already live; licensed market coverage and policies | Each approved market: datasets/schema → repositories → unit/rule/retailer services and APIs → localized screens/SEO → programmatic quality gate and audits | Market-specific golden cases, consent/delivery tests and reviewed content; no translation-only market launch |
| E29 Public MCP | P3 commitment; web engine stable and redistribution permitted | Versioned adapter → seven public tools → schemas/quotas → golden replay → developer page → directory applications → later OAuth/user confirmations | Protocol/client compatibility, invariant rankings, no personal-data export, realistic latency, external listing not assumed |
| E30 Expo app | P3 commitment; shared APIs accepted | Ownership/device schema → repositories → account-merge/log/sync/reminder services → versioned API acceptance → guest garage/log/wallet UI → push and reuse of P2 confirmed photo extraction; optional VIN only with separate rights/privacy validation → store tests | Revocation/deletion/offline conflict tests, crash/startup/accessibility targets, privacy disclosures/store review |
| E31 Lifecycle and marketing | Basic reminders P3; remaining lifecycle P4, with confirmed consents | Reminder/permission schema and repositories → rules/quiet-hour/cap services → API acceptance → approved templates/admin controls → dry run → limited sends | No sends outside purpose, timezone and cap tests, pause/sunset behavior |
| E32 Tier A sales / Tier B evaluation | Optional P4; demonstrated demand and written approvals | Rights/contracts and aggregation review → export schema/repositories → scoped services/APIs → staff/buyer controls → clean-room evaluation and suppression/deletion acceptance | Two distinct approvals for B, current policy/contract rights, minimum-cell/differencing tests; may remain disabled |
| E33 Optional R4 capabilities | Separate business case | For each approved Tier C/onsite-offer/redemption/market/paid-API/app-ad capability: schema → repositories → services → APIs → presentation, with purpose-specific consent | Capability-specific consent, evidence, technical and commercial gates; no inherited blanket approval |

For every later workstream, implement required schema and repositories, then service behavior and exposed APIs, then its screens/adapters. Public MCP remains an API adapter over the same services. These workstreams compete for the same team. Sequence the P3 app and MCP workstreams against shared APIs; both must pass the P3 gate. Schedule remaining committed expansion in P4, with optional work identified explicitly. The app is not promised three months after kickoff simply because it appeared in the source roadmap.

## Operating cost and procurement plan

Use actual supplier quotes at G0. Do not budget on stale affiliate commissions or ad-network traffic thresholds. Track license costs separately from infrastructure: fitment rights may dominate early costs and constrain API redistribution.

```text
monthly cost = fixed data/content licenses
             + hosting/build/compute/network
             + application and CMS database base capacity + backups
             + Inngest workflow execution
             + PostgreSQL analytics/limit/cache capacity + observability
             + email volume + rendering QA
             + identity/MFA + CMP
             + object storage/KMS
             + bounded AI/image inference + artifact/refresh storage
             + SEO crawl/search metrics + ad operations/reporting
             + ongoing specialist/privacy/support work
unit cost per completed report = allocable monthly service costs / completed reports
```

Attribute analytics/limit/cache load within the PostgreSQL bill; do not count a second analytics database or separate cache subscription. Model 10k, 100k and 1m sessions/month, using measured form completion, events/session, report rate, email opt-in, average PDF size, retention and cache hit rate. Show forecast and 2×/10× stress cases. Set owner-approved service budgets, alerts at 50/80/100%, sampling for optional analytics, and explicit overage actions. No automatic shutoff may silently disable safety recalls or delete data needed for rights fulfillment. Affiliate earnings and data-sales revenue are upside scenarios, not assumptions that fund launch obligations.

Model AI costs by request rate, eligible reuse hits, input/output/image tokens, rejected attempts and bounded refreshes. Ad revenue scenarios include traffic, eligible consented inventory, fill and RPM; track net contribution without assuming approval or earnings. All new jobs share PostgreSQL capacity and require mixed-load measurements.

## Risk register and change control

| Risk | Consequence | Mitigation / owner |
| --- | --- | --- |
| Fitment or score rights insufficient | Cannot provide claimed recommendations or MCP redistribution | E01 coverage/contract gate; data lead |
| Performance evidence sparse | False precision or misleading comparison | Suppress unknown metrics; reviewed suitability bands; tire specialist |
| Scope overwhelms team | Partial product and late launch | R1 boundaries, weekly dependency review, explicit deferred IDs; product lead |
| Source data changes/recalls missed | Outdated safety guidance | Versioned imports, freshness gates, safety overlays, incident procedure; data lead |
| Email retry/coupon race | Duplicate mail or reused discount | Durable identity, uncertain-state queue, atomic reservations; backend lead |
| Public link or telemetry leak | Private report exposure | Capability separation, no-referrer/no-store, log scrubbing, safe ad shell; security lead |
| Privacy/data monetization conflict | Trust loss, vendor/legal problems | Off-by-default programs, purposes, legal review, export-time checks; privacy lead |
| CMS/auth/migrations collide | Privilege bypass or schema damage | R0 spike, separate logical CMS database and migration ownership, Clerk bridge and real-role tests; platform lead |
| Shared database contention or cost growth | Analytics/limits/cache churn slows report transactions | Separate bounded pools/jobs, query plans, retention, admission control, report SLO tests and measured reconsideration criteria; platform lead |
| AI output or stale reuse | Unsupported guidance or private-data exposure | Constrained claim validation, exact scope/version keys, invalidation, evaluations and fallback; data/privacy leads |
| Photo extraction error | Wrong inputs or false condition reassurance | Per-field confirmation, unknown/manual states and no roadworthiness diagnosis; product/data leads |
| SEO/ad growth harms trust or performance | Thin pages, private URL leakage or unusable layout | Editorial/index gates, public inventory, consent/slot policies and budgets; content/platform leads |
| Mobile/client compatibility shifts | Delayed stores/MCP distribution | Pin and test current contracts at release; app/connector lead |

Weekly delivery review records completed acceptance evidence, blocked dependencies, spend, scope changes, and next gate. A change affecting permissions, ranking, cost claims, report identity, or release scope gets a decision entry plus updated traceability and tests. “Final design” is the stable baseline for building, not permission to ignore new evidence.

## Definition of done

An implementation work package is done when its acceptance scenario works across its declared stage boundary (schema at S1, repository at S2, service at S3, API at S4, presentation at S5); new behavior has red/green evidence or a justified proportional exception; relevant unit, functional and use-case tests pass; real database/provider boundaries are verified where affected; errors and permissions are handled; performance/accessibility budgets are checked; telemetry is redacted and useful; operations can diagnose/recover it; and documentation/traceability match the shipped behavior. Apply the detailed [definition of ready and done](08-test-driven-development.md#definition-of-ready-and-done) and [coding review rules](10-coding-standards.md#security-privacy-and-review). Planning/source preservation and P1-PR-002 bootstrap are accepted. P1-PR-003 is proving local foundations; product-layer cards remain unstarted.
