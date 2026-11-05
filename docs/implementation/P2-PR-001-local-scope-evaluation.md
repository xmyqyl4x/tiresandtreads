# P2-PR-001 — Local scope, pilot and evaluation preparation

The owner authorized three local scopes: the Phase 1 release packet, draft Phase 2 scope/evaluation inputs, and local reseller-schema groundwork before Phase 1 live acceptance. [PR #88](https://github.com/xmyqyl4x/tiresandtreads/pull/88) completes the first scope. This packet completes the second; P2-PR-002 implements the third. The [authorization record](evidence/P2/local-phase-2-authorization.json) is a sequencing exception for these local scopes only. Actual Phase 1 release, Phase 2 G0/G6/G7, S1–S6 acceptance, provider/operator/budget decisions, specialist/licensed work and deployment remain held. No external inference, provisioning, purchases or actual notifications occur.

**Trace:** CAP-04/05/06/07, UC11/13/14/15/16, AT21/23/24/25/26, DB09/10/12/22–26; E21/E26/E36/E39/E40/E41. Partner preparation covers FR-RSL-01–14 with billing FR-RSL-15 explicitly deferred to P4. No original FR row or acceptance case closes. The [AI/photo contract](../14-ai-analysis-and-photo-design.md), [tenant database contract](../09-database-design.md#partner-offers-and-tenant-isolation), [TDD](../08-test-driven-development.md) and [coding standards](../10-coding-standards.md) remain authoritative.

## Scope and local entry evidence

Phase 2's intended live outcome remains confirmed photo inputs, bounded grounded AI assistance/reuse, staff CSV publication and 5–10 verified noncharging pilot resellers. Deterministic advice, ranking, prices, recall/fitment decisions, consent and existing P1 journeys retain their current owners. AI and offers cannot change tire ranking. Declining assistance/photos/marketing leaves deterministic assessment usable. Web, future app and MCP share the same application services.

The local P1 baseline is main `0fbd94aba6096d621bd75c0be3579a68dbcdeb44`, following the fully checked local implementation through PR #88. Its preceding product validation recorded 2,966 full test executions, nine PR and nine main checks, supported/unsupported synthetic journeys and recovery. This is construction evidence, not production stability: production URL, real traffic, on-call coverage, licensed/specialist and live recipient evidence are absent. [P1 release inputs](P1-PR-043-local-release-preparation.md) remain open.

| P2 workstream | Local direction | Actual input/acceptance still required |
| --- | --- | --- |
| Partner pilot | 5–10 target organizations; versioned noncharging terms; verification and moderated immutable offers; no billing activation | Real prospects, approved terms/DPA, reviewers, tenant security review and G6 |
| Script/admin imports | Extend existing registered source/import/publication services; review CSV before publication | Permitted samples, source rights, templates and reviewers |
| Report assistance | Server-only `AnalysisProvider` behind L6; asynchronous optional enrichment of immutable deterministic output | Account/region/contract, evaluated model/prompt/schema/validator pin and G7 |
| Exact PostgreSQL reuse | Owner scopes by default; reviewed nonpersonal shared templates only; exact versioned keys, leases, expiry and invalidation | Approved shared allowlist, source-to-AI rights, retention and evaluated correctness |
| Tire photos | Private bounded upload, quarantine/re-encode, extraction candidates, explicit per-field confirmation and manual fallback | Approved image notices/processing/retention, safe decoder/provider contract, specialist image labels and G7 |

## Noncharging pilot onboarding and operations draft

1. Recruit 5–10 prospects only after outreach is separately authorized. Nobody has been contacted or assigned by this packet. Maintain a reviewed market/location/service coverage matrix; do not invent verified businesses or commitments.
2. Verify the business email/domain or reviewed override, business identity, approved locations, service descriptions and current staff reviewer. Collect sensitive business identifiers only when necessary under an approved policy. Retain private verification evidence with expiry and correction history.
3. Obtain versioned terms/privacy/DPA and noncharging pilot acceptance, with actor, time, retained private asset and expiration. The pilot does not authorize fees, prepaid balances, payment methods or automatic conversion to paid service.
4. Provision membership only through a future authenticated onboarding service with MFA and current active membership checks. Owner/Manager/Analyst are separate roles; revocation takes effect for new operations. Each tenant child and parent relationship carries organization scope; tenant users never receive recipient identity, code ciphertext or frequency-subject records.
5. Submit bounded immutable offer terms, target/location/SKU applicability, validity and code pools for review. Quarantine/deduplicate imports. Material edits create a new reviewable version; current serving requires active verified organization, current agreement and reviewed nonexpired offer. No P2 serving is activated now.
6. In later services, reserve code, send slot, per-organization choice, total/day caps and subject frequency together. Unknown/uncertain sends retain reservations. Coupon/value/target policies and calendar/timezone decisions require actual review before use. Three selected offers maximum and one per organization do not grant marketing permission.
7. Provide only privacy-scoped aggregate includes/clicks/issues/reported redemptions; reported redemption is not a verified sale. Apply current consent/revocation and small-cell policy before release. Immutable correction/reversal and disputes preserve history. Publish support/escalation and exit/revocation procedures after actual operators accept them.

No real pilot agreement, identity provider selection, partner invitation, notifications or operator appointment is implied.

## Provider, prompt, schema and rights decision inputs

The approved target direction is the official OpenAI SDK and Responses API behind narrow server-only ports. No SDK is added or model chosen here. Keep model ID/snapshot, SDK version, account/project/region, provider agreement, source rights, cost ceiling, prompt/schema/validator hashes, reviewer and approval time **unconfirmed** until the real feasibility review. Do not use the coding assistant's model or a ChatGPT subscription as the application's provider contract.

The draft explanation packet contains only confirmed normalized parameters, market/locale, immutable report outcome/reasons, authorized claim IDs and source/version/rights expiry. Exclude owner/share/email tokens, contact addresses, precise location, VIN, raw notes, commercial bids and unrelated history. Imported/source text and images are data, not instructions. No tools, browsing, SQL writes or model-selected effects are allowed. The deterministic report returns before assistance work; calls occur outside a DB transaction after permission and atomic budget reservation.

Draft prompt `p2-explanation-direction-v0` asks for plain-text summary, supplied-claim tradeoffs, limitations and installer questions, with citations restricted to supplied claim IDs. Draft schema `p2-explanation-direction-v0` proposes a 1,200-character summary, up to six 500-character tradeoffs, six 300-character limitations, six 300-character installer questions and twelve supplied citation IDs, with a total accepted artifact bound of 64 KiB. These are review inputs, not installed runtime contracts or accepted numerical thresholds. Critical numbers come from deterministic DTOs. Refusal, truncation, invalid schema, unsupported citations/numbers, reranking and unsafe condition claims produce unavailable/rejected assistance and preserve the deterministic report.

For photo extraction, propose only brand/model/size/load-speed/DOT fragments/markings and image-quality candidates. Unknown, partial and conflicting readings remain explicit. Every field needs user confirmation or correction through the same manual validation. A sidewall size does not establish vehicle fitment; a partial date/DOT does not clear recalls; a normal photo cannot establish safe tread depth, pressure, internal condition or roadworthiness. Preserve the existing four-image, 10 MiB/image, 40 MP decoded and ten-minute grant limits; JPEG/PNG/WebP only until a separately tested conversion path exists.

Retain the existing proposed maximums: reuse no more than seven days and never past rights/evidence/permission expiry; unconfirmed images 24 hours; explicitly saved images 30 days; candidates no longer than their image. Owner analysis follows report retention or 30 days if unattached; minimal identifying cost records 30 days. Those remain privacy-review proposals. Confirm actual endpoint/model/account data controls and image exceptions before dispatch. `store:false` alone does not establish zero retention. Permission withdrawal/deletion invalidates reads and prevents late-worker publication; restored state needs deletion replay before reopening access.

Cost approval must include conservative input/output/image/retry bounds at the selected model's verified prices, daily and monthly currency/limits, per-owner/IP admission, unknown charged attempts, reconciliation owner and stop threshold. Unknown money is null, not zero. Preserve the proposed 30-second attempt/two-minute job/two automatic retry bounds until evaluated; each retry reserves its own bound. Do not enable any provider while account/rights/privacy/budget decisions remain missing.

## Evaluation dataset and decision rubric

The [versioned case templates](evidence/P2/p2-pr-001-evaluation-cases.json) provide synthetic descriptions and required behaviors. They contain no real photos, provider outputs, specialist labels or accepted model results. Every reference label/reviewer/result remains null; all actual evaluation counts are zero. These templates organize later collection; they are not the required specialist-reviewed benchmark.

Before acceptance, collect at least **50 specialist-reviewed explanation cases and 50 representative tire images**, plus every existing safety golden case. Cover supported/unsupported inputs, missing price/fitment/recall evidence, source expiry, locale/units, injection, refusal/truncation, rights revocation, blur/rotation/small text, partial DOT, conflicting sizes, withdrawal and deletion. Keep train/development examples separate from a locked held-out evaluation; prevent near-duplicate owner/image leakage between sets. Record provenance/permission, dataset/prompt/model/schema/validator hashes, reviewed labels, adjudication and sample counts for every measured rate.

| Measure | Proposed decision rule | Status |
| --- | --- | --- |
| Critical fitment/recall/condition or unsupported critical numeric/citation claims | Zero observed critical failures; any such failure blocks release | Existing required safety gate; not exercised by these templates |
| Confirmation before photo field use | 100% enforced by service and adversarial tests | Existing requirement; implementation later |
| Source/permission/deletion isolation and stale publication | No accepted output across invalid scope/rights/expiry/fence; invalid output cannot become reusable success | Required negative tests, later S1–S4 evidence |
| Per-field precision and abstention | Record denominator, confidence interval, field, lighting/rotation/partial-text cohort and correction rate | Thresholds and calibration require specialist/product acceptance; null now |
| Explanation usefulness, support and clarity | Blind human rubric with supported claims, uncertainty and disagreement adjudication; model grading only after calibration against human labels | Rubric draft; reviewers and acceptance threshold pending |
| Latency, cost, retries and warm reuse | Measure cold/warm p50/p95, accepted/rejected/refused, token/image costs, uncertain charges, invalidation/purge lag and fallback | Targets/budget unconfirmed; mocks cannot accept real provider behavior |

Keep local deterministic regression fixtures and a portable evaluation report format under repository version control. Real provider evaluation needs a separately approved budget and permitted data. No external evaluation job, hosted dataset upload or account resource is created here.

## Current official documentation review

Reviewed official guidance for this planning packet:

- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) distinguishes schema adherence from factual correctness and calls for handling refusals/incomplete responses. Keep application/domain validation and specialist evaluation.
- [Data controls](https://developers.openai.com/api/docs/guides/your-data) distinguishes application state, abuse monitoring and image/file exceptions. Verify the selected account and endpoint; no zero-retention claim follows from one request flag.
- [Vision limitations](https://developers.openai.com/api/docs/guides/images-vision) include small text, rotation and inaccurate descriptions. This supports confirmation/abstention testing; it does not establish tire-domain accuracy.
- [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices) emphasizes representative edge cases and calibration against human judgment. The exact tire rubric and thresholds remain a product/specialist decision.
- [Hosted Evals guidance](https://developers.openai.com/api/docs/guides/evals) currently describes a deprecation transition. Keep local versioned evaluation assets independent of that hosted API; recheck available execution tools at actual feasibility.

This review does not pin a model, SDK, price or account capability. Reverify those unstable inputs before actual integration and evaluation.

## Construction sequence and provisional forecast

Use the approved database → repositories/entities → services → exposed API → frontend order. The only newly authorized implementation is local P2-PR-002. Its reviewed SQL goes into an explicit opt-in local migration track, applied only to disposable synthetic targets by test support. Existing P1 manifests, generated P1 storage models, bootstrap/CLI/preflight, role/policy inventories and historical evidence remain unchanged. No automatic migration runs against persistent dev/stage or production. Before promoting that track into ordinary application migrations, require the relevant accepted phase/S1 upgrade, ownership, grants, privacy/restore and deployment evidence or a separate owner-approved local scope.

| Cards | Scope/dependencies | Provisional effort, engineer-days |
| --- | --- | --- |
| 001 | Local planning now; actual P1 stability/provider/privacy/pilot feasibility later | 2–3 planning; external lead time unknown |
| 002–005 | Partner, AI/reuse/budget/photo/import schema; real upgrade/constraint/grant/restore evidence | 10–16 |
| 006–008 | Scoped typed entities, explicit mappers/repositories, one-connection transactions | 8–14 |
| 009–017 | Verified pilot/offer/cap services, AI validation/reuse/budget/photo/CSV and real evaluations | 22–38 |
| 018–020 | Complete authorized APIs and headless service validation | 8–14 |
| 021–025 | Portal/CSV/AI/photo/operations UI after API gate | 15–25 |
| 026–027 | Integrated security/privacy/experience, operations and actual live release | 8–14 |

This is a high-uncertainty decomposition estimate, not a calendar schedule, staffing promise or spending approval. It excludes vendor/legal/specialist/operator/onboarding waits and applies no unconfirmed hourly rate. Re-estimate after actual P1 stability, P2 scope/provider review and schema work. Responsible roles remain unassigned. Only the three selected local scopes are authorized by the current continuation; no later gate, live rollout or capability activation is approved here.

## Validation and remaining acceptance

This is documentation/dataset preparation; use JSON/provenance/held-input/link review rather than invented behavioral tests. Re-run the exact-commit build/regression and required PR/main checks. P2-PR-001's original acceptance tasks remain open where they require real P1 stability, specialist-labeled images/explanations, model/provider/privacy approval or pilot agreement. Add the local completion record alongside them; never relabel synthetic templates as actual specialist evidence. All six S3 gates, HS01–HS08 proposals, unknown operators/coverage/rates, source/specialist/provider and deployment restrictions persist.
