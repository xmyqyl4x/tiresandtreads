# Planning package verification

**Review date:** October 22, 2026. **Scope:** documents, source preservation, requirements coverage and internal consistency. This record does not certify an application, legal compliance, tire data, provider integration or production deployment.

## Checks performed

| Check | Result |
| --- | --- |
| Input inventory | All four supplied files archived with stable repository names and original filenames in the manifest |
| Original-byte preservation | SHA-256 and byte counts verified for four source files; source Markdown is excluded from Git text normalization |
| PNG extraction | Eight extracted files verified against their ZIP member bytes; no image alteration |
| PDF inspection | Requirements PDF: 59 pages, including two trailing print-only pages; design PDF: 13 pages. Text extracted, design pages rendered, all eight source screen layouts inspected through the PNG/PDF reference set |
| Requirements cross-check | Both requirements formats contain the same 137 unique FR identifiers; each appears exactly once as a traceability row |
| Source conflicts | Comparison count, ad placement, consent defaults, tire evidence, access tokens, email timing, coupon retries, data retention and release scope reconciled explicitly |
| Documentation links | Relative file links and local heading anchors checked; final results have no missing targets |
| Structure/data | Markdown code fences balanced; design-token JSON and source-manifest JSON parse successfully |
| Original roadmap arithmetic | Reviewed E01–E20 baseline summed to 151–217 engineering days; superseded by the PostgreSQL/build-order supplement below |
| Token contrast | Primary text 16.40:1, secondary text 6.46:1, white on primary action 7.97:1, dark on yellow accent 10.36:1; semantic text colors exceed 4.5:1; control border on white 3.66:1 |
| Repository hygiene | Only planning documents, design tokens and source assets included; review renders/extractions ignored; staged whitespace check passes |
| Scope boundary | No application scaffold, dependency installation, service purchase, outbound email, reseller charge, audience export or site deployment performed |

The archive manifest is [sources/manifest.json](sources/manifest.json). Integrity verification compares file bytes, not filenames. The [requirements matrix](05-requirements-traceability.md) maps original IDs; the additional CORE/NFR rows cover source sections that had no FR identifier.

## Implementation validation still required

The current repository has no running application and no application test suite to execute. All product acceptance scenarios, provider/auth/CMS proofs, golden tire cases, accessibility checks on implemented UI, email-client/PDF rendering tests, live-data freshness checks, performance measurements, privacy fulfillment tests, and recovery drills remain implementation work. Color-token calculations establish useful defaults but do not replace accessibility testing of actual screens.

Vendor selections are implementation directions contingent on R0 evidence. Staffing/effort figures are planning estimates. The source's example tire names, fitments, prices, ratings, lifespan statements and market rules are not verified catalog data. Legal applicability and data-program activation require the explicit gates in the implementation plan.

## Stack and layer review supplement

The [stack and layer signoff](07-stack-and-layer-signoff.md), dated October 22, 2026, records the user's approval of AS01–AS07 against reviewed proposal commit `8d896e7fae6780250ba51a209db3a1c9e35b2b3d`. The technical architecture, decision register, implementation plan, and README incorporate the approved stack, separate CMS database, package boundaries, and analytics activation choices. Local documentation targets/anchors, balanced code fences, JSON parsing, and unique AS01–AS07/L1–L7 definitions were checked. Existing source assets and requirements mappings are unchanged. Provider documentation supports the integration design; runtime compatibility, identity bridging, deployment, and performance remain R0 implementation checks.

## TDD database and coding standards expansion

The requesting user approved the reviewed documentation baseline at commit `08c787da3cab4aa00057a020f577e067ce38ef28` on October 22, 2026 and authorized its merge into `main`; see the [engineering approval record](00-source-review.md#engineering-approval-record).

The requested expansion adds the [TDD strategy](08-test-driven-development.md), [database design](09-database-design.md), [coding standards](10-coding-standards.md), contribution guide and PR template. Structural checks cover relative links/heading anchors, balanced code fences, consistent Markdown table columns, and JSON parsing. UC01–UC12 and DB01–DB16 are unique; all AT01–AT20 scenarios map into the use-case catalogue; ENG-01–ENG-06 capture the new engineering requirements. All 137 original FR rows remain unchanged and appear exactly once; source assets are untouched.

Consistency review aligns the detailed schema with separate CMS ownership, immutable report/compare revisions, erasable identity links, durable send identities, and the existing release boundaries. Database constraints, RLS, query plans, TDD suites, API behavior, performance, and migrations are specified for future execution. No application scaffold, test harness, migration, database provisioning, provider operation, or application test was executed as part of this documentation update. E02/E04 and subsequent work packages must supply that evidence; the new specifications do not certify an implemented system.

## PostgreSQL and build-order review supplement

The user requested database-first construction and review/removal of unnecessary analytics/cache dependencies after baseline `e4aa24c38d203182b2c684ad74245e18c54e27f4`. The [amendment](11-postgresql-and-build-order.md) records the decision and official technical references. Current stack tables, diagrams, database ownership/catalogue, privacy lifecycle, APIs, TDD gates, standards, contribution checklist, cost model and README now use PostgreSQL analytics/limits and conditional caching. Removed service names remain only in rationale, superseded approval history and original source material; they are not active dependencies.

At reviewed commit `fc34cb54ae8ed9c3e3ef63aed9ab822f22ec00bf`, documentation checks covered 16 Markdown files, 71 consistent tables, 130 local links/anchors, balanced fences and valid design-token/source-manifest JSON. The original 137 FR rows remain unchanged; UC01–UC12 and AT01–AT20 coverage remain, with DB01–DB20, ENG-01–ENG-09 and D01–D29 uniquely defined. E01–E20 plus E34 total 166–239 engineering days; split-package estimates are counted once. The old elapsed calendar is withdrawn pending dependency-based re-estimation. The 28 split-package dependency nodes form an acyclic graph with no backward stage edges; every product frontend explicitly depends on E34/S4. S1–S4 precede product UI, and backend dependencies do not require frontend packages. Original source assets and unaffected approval decisions remain preserved.

These are documentation/consistency checks, not executed SQL, application, provider or load tests. This repository contains no runtime dependency manifests or provisioning artifacts to migrate; this work changes documentation and does not remove live infrastructure. S1/S2 must prove schema/repository integrity, S3/S4 service/API behavior and shared-database capacity, and S5/S6 real frontend/template and release acceptance. The requesting user explicitly approved the reviewed amendment commit `fc34cb54ae8ed9c3e3ef63aed9ab822f22ec00bf` and authorized its merge into main on October 22, 2026; see the [approval record](11-postgresql-and-build-order.md#approval-record). Earlier approvals remain tied to their original reviewed commits.

## Four-phase and domain/AI capability review

The amendment was prepared against approved main commit `4d849c4cc76fb0227199aad27f349546c4a5709d`. D30–D35 record the new direction; [the eight-point review](12-live-product-phases-and-gap-review.md) maps CAP-01–CAP-08 to four live phases. [Domain data/imports](13-domain-data-and-imports.md) and [AI/reuse/photos](14-ai-analysis-and-photo-design.md) extend the relational, privacy, layer and test contracts. The owner approved reviewed commit `67249397934550090ee994c5d4436e599db97e96` and its merge into main on October 23, 2026; see the [approval record](12-live-product-phases-and-gap-review.md#approval-record).

At reviewed commit `6724939`, structural validation covered 19 Markdown documents, 83 consistent tables, balanced fences, 182 local links/anchors and valid design-token/source-manifest JSON. The initial pass found one stale native-app section anchor; it was corrected. D01–D35, DB01–DB28, UC01–UC18, AT01–AT28 and AS01–AS07 are uniquely defined; every AT scenario maps into a UC row. The original 137 FR IDs remain exactly once. Twenty-six FR rows intentionally change release/acceptance assignments under D30/D31; original rows are available in the prior commit. Original source assets are unchanged.

Consistency review preserves database → data access/entities → services → APIs → UI within each live phase, PostgreSQL application state and separate CMS ownership, bounded Inngest execution, deterministic recommendations, consent and commercial independence. Required AI artifact persistence is explicitly distinct from optional computation caching. P1 adds source/SEO/ad readiness; P2 adds AI/reuse/photo/admin CSV; P3 commits real app/MCP delivery; P4 closes committed lifecycle/SEO/operations while optional markets/audience products remain disclosed and gated.

The prior 166–239 engineering-day subtotal does not include E35–E42 and is not a full-project forecast. New scope is explicitly unestimated until phase feasibility and dependency rebaselining; no new elapsed date is promised. Documentation checks are not evidence that imports, schemas, API calls, models, image recognition, advertising or any product phase work. No live provider/model evaluation, application unit/functional/use-case test or production deployment was performed. Those checks remain explicit phase acceptance work.


### Approval verification on October 23, 2026

The approval update rechecked 19 Markdown documents, 83 tables and 188 local links/anchors, balanced fences, JSON parsing and requirement/use-case identifiers. All checks passed. The 137 reviewed FR rows and original AS01–AS07 approval rows are unchanged from `6724939`; source assets are untouched. No application tests were run because implementation has not started.

## Implementation PR working backlog verification

The October 23, 2026 task-list decomposition starts from approved main commit `3743a11d6457f418cc3e0a7268aed333b801b160`. The [master tracker](15-project-task-list.md) contains 119 planned core PRs: 43 in P1, 27 in P2, 25 in P3 and 24 in P4. Each has a stable ID, stage, responsible role, dependencies, trace references, three key-task checkboxes and verification/acceptance criteria. Ten separately gated optional activation tickets remain parked and are excluded from the core count. All core statuses are Not started and all assignees are Unassigned; no implementation completion is claimed.

File-based checks verified matching card/ledger IDs and counts, 357 unchecked core tasks, ten unique optional tickets, all E01–E42 package mappings, valid trace references and existing relative link/heading targets. The dependency graph has no cycles or forward references: every card transitively depends on all earlier construction stages in its phase, and each later phase starts after the preceding live-release acceptance. All S5 interfaces therefore wait for the complete phase API gate. Optional activation requires explicit scope and child-PR decomposition before it can become release work.

Structural validation passed for 26 Markdown documents and 96 tables, including balanced fences, local links/anchors, valid design-token/source-manifest JSON and whitespace checks. The original 137 FR rows and the AS01–AS07 signoff file are unchanged from the approved baseline; archived sources are untouched. The contribution guide, PR template and implementation/traceability entry points now reference the working tracker. These checks validate the planning artifacts only; application tests, migrations, provider evaluations and live release evidence remain tasks in the backlog.

### Task-list approval verification

On October 23, 2026, the requesting user approved reviewed commit `c984bcf04098d465e521bd0ee12215faba6d6978` and authorized merging `codex/implementation-pr-task-list` into main. The approval record and README now identify the accepted working backlog. The approval update rechecked 26 Markdown documents, 96 tables, 1,301 local links/anchors, balanced fences, JSON parsing and whitespace. All checks passed. Card/ledger counts, dependency ordering, all 42 package mappings, 137 original FR rows, the AS01–AS07 signoff file and archived sources remain preserved. All 119 core task statuses remain Not started, and ten optional activation tickets remain parked. No application tests were run because implementation has not started.

## Deployment and local-environment planning review

The October 23, 2026 [deployment proposal](16-deployment-and-local-environments.md) was prepared against approved main commit `58ddb7d36915827cd67efac4b037b7b0c422c259`. DP01–DP08 propose isolated local dev/test/stage, verification before GitHub push, standard PostgreSQL portability, explicit hosting selection, controlled migrations/releases and recovery ownership. Vercel + Neon remains the approved production baseline pending a recorded alternative decision. Original PR cards, ledger statuses and the historical approval record remain intact; the deployment supplement maps work into existing IDs.

Read-only host checks confirmed Docker client/engine 29.1.3 with a Linux engine (8 CPUs, approximately 15.4 GiB reported memory), the native PostgreSQL 18 service running and port 5432 accepting connections, psql client 18.1, default Node 20.19.6 and pnpm 11.25.0. The Vercel CLI was absent from PATH. Initial sandbox access limitations were resolved with host-permitted read-only checks. No database authentication/schema query, image download, container creation, service/global-runtime change or cloud provisioning was performed. The plan calls for Node 24 project/runtime parity; the installed tools alone do not prove application compatibility or performance.

Official Vercel, Next.js, Payload, PostgreSQL/PgBouncer, Docker, Inngest, Clerk and Moto documentation was reviewed for the deployment mechanisms and local-provider limits, with direct references in the proposal. Static IP pricing and plan availability are dated observations to recheck at procurement. Structural validation passed for 27 Markdown files and 106 tables, balanced fences, local links/anchors, JSON and whitespace. All 119 core cards, 357 task checkboxes, ten optional tickets, 42 package mappings, 137 original FR rows and seven historical AS rows remain consistent; dependencies remain acyclic and retain stage/phase ordering. The eight DP identifiers are unique. Archived source files are unchanged. No application tests, migrations, local app deployment or hosted release were executed; those are implementation deliverables.

## Deployment approval and option-C reconciliation

On October 23, 2026, the requesting user approved DP01–DP08 from reviewed proposal commit `3973116f7e33327abc89795d30b4811f523788af` and authorized merging `codex/deployment-local-environments-plan` into main, explicitly selecting **C: app + PostgreSQL outside Vercel**. The [approval record](16-deployment-and-local-environments.md#approval-record) supersedes the proposal's option-A preference and the former AS02 Vercel/Neon default. The earlier planning-review paragraph above describes the state before this approval.

The current architecture, stack, database, build-order, contribution workflow and task-list entry points now use portable Linux Node.js 24 containers, standard PostgreSQL and isolated Docker dev/test/stage. D21's public-config delivery uses a portable SQL/S3 publication adapter with bounded expiry and cross-replica invalidation. The selected host, region, image registry and managed-versus-self-operated production database remain S0 choices within option C. Historical approvals and alternative comparisons remain identifiable; they do not prescribe Vercel services for current implementation.

Approval validation passed for 27 Markdown files, 106 tables, 1,341 local links/anchors, balanced fences, both JSON artifacts and whitespace. All eight DP rows are approved and DP03 records C. The 119 core PR IDs, phase counts (43/27/25/24), 357 unchecked tasks, ten parked options, 42 work-package mappings and acyclic stage/phase dependency ordering remain intact. Seven P1 cards (001, 002, 003, 012, 014, 021 and 042) intentionally refine deployment/configuration tasks and acceptance; card metadata and dependencies remain unchanged, as do all P2–P4 card bodies. The 137 FR rows, seven historical AS rows, original task-list approval record and archived sources are unchanged from the reviewed proposal.

These are documentation checks. No application tests, database migrations, local or hosted app deployment, service purchase or infrastructure provisioning occurred. Phase 1 implementation remains Not started; its unit, functional/use-case, provider, performance and recovery evidence is still required before live release.
