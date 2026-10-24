# P1-PR-001 — Launch scope and deferred decisions

**Accepted October 23, 2026 · [PR #1 merged](https://github.com/xmyqyl4x/tiresandtreads/pull/1) at `b9e02f07be87422f30f7a5c3c18c57965bd59313`.** Branch: `codex/p1-pr-001-launch-scope`. Baseline: `48751c1f5e314fde59f36a2bc53101225a40c3c4`. Implementation owner: Codex; product reviewer/decision owner: repository owner. Specialist, editorial, privacy and production operations reviewers remain unassigned. The owner approved PR #1 and instructed the merge and start of P1-PR-002. This accepts the preparation/deferral packet, not G0 or real data rights. This packet starts the [Phase 1 task list](../tasks/phase-1-prs.md#p1-pr-001); it does not accept G0 or claim verified tire coverage.

## Direction and construction gates

The owner instructed us to start implementation, then clarified that licensed tire/fitment/pricing providers and hosting budget are undecided and should be covered when necessary. This updates the timing of those decisions, not the four live phases or the required source rights.

Local work can use synthetic fixtures, isolated PostgreSQL, portable Linux containers and provider interfaces. A fixture must identify itself as synthetic; it cannot be published as verified fitment, a real price or a real recall clearance. Development must not depend on choosing a cloud host, buying a data feed or knowing a monthly production budget.

For P1, **S0 construction acceptance and full G0 business/provider acceptance are separate**. P1-PR-003 may accept the local foundation after real local integration checks and an explicit open-decision register. That permits S1 database and S2 repository work. It must record G0 as open. Each external dependency becomes blocking at its trigger below; complete G0 no later than P1-PR-031, before the complete API gate and frontend work. S1 → S2 → S3 → S4 → S5 remains mandatory. Provider-specific acceptance cannot be replaced with fixture results.

This sequencing adjustment implements the owner's current direction. Earlier approval records describe the plan at their reviewed commits and remain unchanged. No account signup, purchase, vendor outreach, cloud provisioning or production deployment is authorized by this document.

## First implementation batch

| PR | Concrete outcome | Next action / acceptance boundary |
| --- | --- | --- |
| P1-PR-001 | Scope, coverage/refusal criteria, rights register and decision triggers | Review this packet and document checks; actual licensed coverage remains zero |
| P1-PR-002 | Headless pnpm/TypeScript workspace; Node 24/Linux containers; isolated local dev/test/stage; TDD, import-boundary and CI commands | Start after 001 is merged and accepted; no product screens or native workstation DB resets |
| P1-PR-003 | Local app/DB/Payload/runtime compatibility, migration/runtime permissions, lifecycle and networking proofs | Accept local S0 with real PostgreSQL evidence; record open G0 items and provider proofs separately |
| P1-PR-004–007 | App/CMS ownership, domain/import, report/privacy/delivery and content/SEO/ad/analytics schemas | Tests and migrations first, synthetic seeds; production data import remains gated |
| P1-PR-008 | Empty/upgrade migrations, role denials, backup/restore and database integrity gate | Real isolated PostgreSQL evidence before repositories |

Repository LF line endings, case-sensitive Linux paths, portable package scripts and Linux CI belong to 002. Windows and WSL are development options. Next come entities/repositories (009–013), services (014–027), APIs (028–031), then frontend work (032 onward). The phase is complete only after a usable live release in 043.

## Exact trace and scope

This PR binds **CORE-10** in [core requirements](../05-requirements-traceability.md#core-requirements-without-source-fr-identifiers), **CAP-01/CAP-04** in [capability coverage](../05-requirements-traceability.md#capability-amendment-coverage), and **ENG-06/ENG-07** in [engineering requirements](../05-requirements-traceability.md#engineering-requirements-from-the-requested-expansion). Work packages: E01/E35/E42. It defines acceptance inputs; it does not complete these capability rows, UC13/UC18, AT21/AT22/AT28 or DB21/DB22/DB28.

| P1 commitment | Boundary |
| --- | --- |
| US English assessment, deterministic eligible recommendations and explanations, refinement, four-item compare and shop-quote preparation | No email gate; no unsupported fitment or invented performance; rankings independent of advertising/commissions |
| Private report access/share, optional email/PDF delivery, cancellation, purpose controls and privacy operations | Existing ownership, immutable report, consent, suppression and deletion contracts apply |
| Script imports and reviewed reference data, staff operations and published content | Admin CSV workflow is P2; schema/import services remain shared |
| Public education, technical SEO and advertising readiness | Existing 25-term/article launch inventory must be reconciled by the editorial owner; no double-counting or claim it is written. Private reports stay unindexed; assessment remains ad-free |
| Affiliate links and third-party advertising where approved | Provider approval, consent, disclosures, layout/performance checks and kill switches required; house/no-fill fallback is not ad-network acceptance |

P2 retains grounded AI, persistent exact-match reuse, confirmed photo extraction, admin CSV and the reseller pilot. P3 retains the native app and MCP integration. P4 retains the remaining lifecycle/growth/operations scope. Optional markets, audience products and other parked tickets remain gated. No AI call or photo inference is introduced in P1 to compensate for absent licensed data.

## Coverage and refusal register

**Planning target: about 100 verified US vehicle configurations and 50 tire models with explicit size/SKU records. Actual verified configurations: 0; licensed tire models/SKUs: 0.** These counts describe repository evidence, not upstream catalog size. No brand, vehicle or tire is declared supported by this PR.

A configuration is a source-backed year/make/model/trim, market, wheel package, drivetrain and axle arrangement. Each applicable axle needs its own size/load/speed/construction constraints, permitted replacement rules, source revision, rights, review and expiry. A model name or a vPIC lookup result is not a configuration. Tire model counts are distinct model identities, not SKU counts; every recommended SKU still needs its own evidence.

The data reviewer will select a varied candidate cohort after permitted samples exist. For each cohort below, record tested count, supported count, rejected count, unknown count and reasons. Do not invent percentage coverage now or count the same configuration twice when it has several attributes. Final release coverage is the explicitly reviewed supported set; any reduced launch target requires owner review.

| Scenario cohort | Required evidence / supported path | Unknown or unsupported path |
| --- | --- | --- |
| Standard square OE package | Exact configuration and per-axle fitment match, current safety evidence | Ask for the missing configuration/placard details; refuse verified recommendation until resolved |
| Optional wheel package | Explicit package identity and authoritative constraints | Never infer package from trim name or diameter alone |
| Staggered front/rear | Both axle specifications and compatible replacement set | No single-size shortcut or unverified axle substitution |
| AWD / partial replacement | Vehicle-specific compatibility and replacement constraints | No generic circumference/tread tolerance; refer for inspection when constraints are absent |
| EV | Exact vehicle requirements, including load/speed and any source-backed special constraints | EV label alone cannot establish compatibility or a ranking bonus |
| LT / light truck | Applicable load range, service and pressure constraints with reviewed source meaning | No passenger-to-LT conversion or pressure advice inferred from a size string |
| Manual tire size / vehicle unknown | Size identification and general education with explicit limits | No claim of vehicle compatibility from tire size alone |
| Active, ambiguous or stale recall information | Retain affected source targets and uncertainty; use existing safety/freshness rules | Do not call an unresolved/partial-DOT search a clearance; stale required recall evidence blocks new verified issuance |
| Missing price / fewer eligible products | Disclose unavailable prices, basis/date and actual eligible count | Never fill a tier or five-result target with an unsafe or fabricated product |

Before publication, each configuration/SKU register row must contain: stable internal ID; source/provider key; market and identity; axle/package constraints; dataset and license revision; evidence locator; reviewer/date; supported/conditional/refused disposition and reason; next review/expiry. This is the existing schema's publication contract, not a new competing catalog. See [domain data](../13-domain-data-and-imports.md) and [database design](../09-database-design.md).

## Source and rights register

Reviewed public documentation on October 23, 2026. Candidate capability is distinct from license permission and measured project coverage. **U = unresolved/not approved for production use**; it is not a statement that a use is forbidden. Rights must cover the actual source material and agreement, including retention and termination/deletion conditions. No license is invented from public accessibility.

| Source candidate | Intended use and observed evidence | Display | Persistent storage | Derived output | AI input/reuse | App/MCP redistribution | Next decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| NHTSA vPIC | Vehicle/manufacturer identity and form candidates; documented plant endpoint; model probe returned identity fields only | U | U | U | U | U | Record applicable government data terms, attribution, field coverage and limits before production ingestion |
| NHTSA recalls bulk + dictionary | Tire campaign/target ingestion; dictionary is reachable and identifies tire product type | U | U | U | U | U | Review terms and complete bulk/target mapping; do not substitute vehicle-only queries |
| Fitment Group | Commercial candidate for fitment/catalog/pricing; no sample, agreement or coverage benchmark obtained | U | U | U | U | U | Request a scoped sample/quote only when owner authorizes procurement work |
| Wheel-Size | Fitment API candidate; public FAQ limits bulk export, while home page advertises custom enterprise bulk delivery | U | U | U | U | U | Clarify the actual contract for local storage, versioned snapshots and downstream use; standard API access is not assumed sufficient |
| Reviewed manufacturer material | Possible evidence for specific specifications and constraints | U | U | U | U | U | Identify exact materials, rights and specialist validation before copying or publishing |
| Retailer/affiliate feed, climate/regional source | Provider and data format undecided | U | U | U | U | U | Select and validate each domain before its adapter or public claim; no arbitrary scraping |
| Project-authored synthetic fixtures | Local parser, schema, repository and behavior tests only | Internal only | Local/test only | Test only | No live calls | No public advice | Mark synthetic, keep separate from published source bundles; never inflate coverage counts |

Primary references: [vPIC API](https://vpic.nhtsa.dot.gov/api/), [NHTSA datasets](https://www.nhtsa.gov/nhtsa-datasets-and-apis), [recall dictionary](https://static.nhtsa.gov/odi/ffdd/rcl/RCL.txt), [Fitment Group](https://fitmentgroup.com/), [Wheel-Size FAQ](https://developer.wheel-size.com/api-faqs), [Wheel-Size enterprise description](https://developer.wheel-size.com/). These support candidate discovery and endpoint descriptions, not signed rights or safety validation.

The vPIC documentation limits year-filtered plant queries to 2016 onward and distinguishes new, updated, closed and all-code reports. Preserve historical uncertainty. The Wheel-Size FAQ and enterprise description need reconciliation with an actual agreement before selecting a storage/import design. Neither candidate has been selected, contacted or purchased.

## Deferred decision register

Review each item when its trigger approaches during PR readiness; no recurring notification or arbitrary spending deadline is scheduled. Owner means repository/product owner; Codex prepares the technical comparison and evidence when needed. No real specialist or on-call operator is implied by a role name.

| ID | Deferred decision | Work allowed now | Blocking trigger and required evidence | Decision owner |
| --- | --- | --- | --- | --- |
| DD01 | Fitment/catalog/reference source and usage rights | Generic schema, import interfaces and synthetic parsers/tests | Before importing protected samples or accepting the applicable P1-PR-016 connector: permitted access, field contract, display/storage/derived rights and retention; before engine acceptance in 027: reviewed coverage and safety evidence | Owner + data/tire reviewer (reviewer unassigned) |
| DD02 | Pricing/retailer feed and commercial terms | Price schema and unknown/stale behavior | Before accepting the price connector in 016 or live price calculations in 018: allowed fields, update policy, display/basis and historical retention; unavailable pricing stays explicit | Owner + data reviewer |
| DD03 | Production host, region, registry and managed/self-operated DB | Linux images, portable standard PostgreSQL, local migrations/restore and generic release manifests | Before first remote provisioning or host-specific adapter assumption; no later than 031 hosted smoke: owner choice, US data location, supported versions, TLS/networking, measured limits and recovery owner | Owner + technical/operations reviewer (unassigned) |
| DD04 | Monthly hosting/backups/staging budget | Local synthetic workloads and measured resource use | Before any paid provision or accepting a hosted plan: full app/DB/storage/backup/egress/observability/stage cost envelope and ceiling; data licenses itemized separately | Owner |
| DD05 | Actual provider credentials and production operators | Package compatibility, local contract tests and no-send fixtures | Before accepting an affected real adapter or external action (for example 014 jobs/assets, 022 delivery, 026 staff/ads, 030 callbacks); selected provider proofs and accountable permissions. Hosted networking evidence completed by 031 | Owner + relevant technical/privacy reviewer |
| DD06 | Production editorial, tire and privacy reviewers | Source research and draft cases/content | Before accepting reviewed scoring/content/notices: named reviewers, actual review evidence and expiry; complete release inventory at G1/G2/G3 | Owner |
| DD07 | Whole-P1 effort, staffing and elapsed forecast | Size/refine the next ready card using measured progress | At full G0 and each S2/S4 rebaseline: bottom-up remaining-card estimates, overlap removal, external lead times and actual staffing; no promised launch date in this packet | Owner + implementation lead |
| DD08 | AI and third-party channel rights | Preserve planned source/license fields and provider boundaries | Before P2 AI evaluation or P3 app/MCP redistribution: explicit channel/use rights, privacy and deletion evidence under G7 | Owner + data/privacy reviewer |

Absence of DD01/DD02 approval must not prevent local schema design, but it prevents accepting the affected live import. Absence of DD03/DD04 must not prevent local builds, but it prevents remote deployment. Splitting a blocked provider card requires the existing stable child-card/dependency process; a synthetic pass cannot silently satisfy its real-provider acceptance. No public beta with actual users proceeds while G0 or the applicable safety/privacy gates are open.

## Responsibilities, review cadence and sizing

Codex prepares code, tests, source mappings and evidence. The repository owner reviews scope/merges and makes commercial/hosting decisions. Specialist, editorial, privacy and operations work is not automatically delegated to Codex or deemed staffed. Record real reviewers before their acceptance gate.

Data publication requires review before first use, when a source schema/license changes, and when safety mappings change. Retain existing daily recall checks (including successful no-change checks), 48-hour stale-recall block, provider-specific price freshness, and explicit advice expiry. Advice is reviewed at least quarterly and on relevant change. Editorial drafts need source, scope, owner and review date; reconcile the 25-item inventory before G3 rather than creating an unsupported completion claim.

Initial sizing is provisional: 001 is a small evidence/documentation card; 002 is large and should be split if workspace, local environments and verification cannot be reviewed together; 003 is medium for local proofs, with external proof effort tracked against DD01–DD07. Each card receives an effort estimate at readiness after its concrete scope is known. The historical 166–239 engineering days is not a Phase 1 forecast. Provider negotiations, specialists and a production monthly budget remain unknown; this packet does not make a staffing or calendar commitment.

## Evidence and limits

The [read-only probe record](evidence/P1/p1-pr-001-source-probes.json) contains UTC observation times, URLs, HTTP status, byte lengths and SHA-256 digests. The UTC date is October 24; the local review date is October 23 in America/Los_Angeles.

- vPIC model lookup: HTTP 200, 22 identity records, fields `Make_ID`, `Make_Name`, `Model_ID`, `Model_Name`. No tire size, axle/package, load or speed fields in this response. This proves endpoint reachability and the need for a separate fitment source.
- Recall dictionary: HTTP 200, 3,053 bytes; campaign, component and recall-type markers found, with tire text. No full recall feed or campaign-target accuracy was tested.
- Only response metadata is committed. No VIN, consumer data, credential, proprietary feed or raw bulk data was imported. Rights review, import completeness, live source freshness and specialist verification remain unrun.

To repeat the probes, GET each recorded URL without credentials, hash the received bytes with SHA-256, compare the JSON result count/field names or dictionary markers, and record a new observation. Upstream content may change; the old digest is evidence of the observed response, not an expected permanent value. A successful HTTP request is not a data-quality test.

Documentation validation must check links/anchors, stable task IDs/dependencies, preserved source/approval history, unchanged source requirement IDs, consistent deferral triggers, and the probe record shape/counts. Unit/application/UI/database tests are not applicable to this documentation-only PR. P1-PR-002 will implement executable test commands. Product capabilities remain unimplemented; task completion and G0/S0 acceptance are separate review decisions.

Validation results are recorded in [the preparation verification record](evidence/P1/p1-pr-001-validation.md).
