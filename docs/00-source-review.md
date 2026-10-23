# Source review and design decisions

**Design baseline:** 1.0, October 22, 2026. **Product owner named in the source:** Paul Were. **Status:** complete planning baseline for implementation; this document does not represent vendor procurement, legal approval, or a deployed product.

The supplied requirements describe a useful core experience and a large surrounding business platform. The final design retains that direction, preserves every numbered requirement in the [traceability matrix](05-requirements-traceability.md), and resolves inconsistent or unsafe details before implementation.

**Architecture amendment, October 22, 2026:** the user approved [AS01–AS07](07-stack-and-layer-signoff.md#7-signoff-decisions). D22 now selects a separate logical CMS database from the outset; R1 analytics uses the first-party pipeline, with GA4/PostHog activation separately gated. Integration evidence and release approvals remain required.

**Engineering expansion, October 22, 2026:** the user subsequently requested test-driven development with unit, functional and use-case tests, a comprehensive database design, and coding principles for maintainability/performance and separation of concerns. [ENG-01–ENG-06](05-requirements-traceability.md#engineering-requirements-from-the-requested-expansion) record this additional direction. The [TDD](08-test-driven-development.md), [database](09-database-design.md), and [coding standards](10-coding-standards.md) specifications elaborate the approved stack; they do not mark implementation or specialist/provider validation complete.

## Engineering approval record

On **October 22, 2026 (America/Los_Angeles)**, the requesting user approved engineering specifications 1.0 for [TDD](08-test-driven-development.md), [database design](09-database-design.md), and [coding standards](10-coding-standards.md), together with their associated architecture, implementation plan, traceability, contribution guide, and PR template updates. The reviewed baseline is commit [`08c787d`](https://github.com/xmyqyl4x/tiresandtreads/commit/08c787da3cab4aa00057a020f577e067ce38ef28).

The user's approval was: “Approve these updates and merge the TDD, database design, and coding standards branch into main.” This approves the documentation and its merge into `main`. Implementation remains unstarted; R0 validation, specialist/provider evidence, and release gates remain required.

## Review findings

The [source inventory](sources/README.md) distinguishes three kinds of evidence: the editable v2.1 requirements, a PDF export of those requirements, and the visual designs supplied as PDF and PNG. The requirements PDF contributes no additional numbered requirements. There is no finished HTML email, printable report layout, admin design, reseller design, or native-app design among the supplied screens; those are specified in the final package.

The strongest existing decisions are the deterministic engine, independent rankings, visible conditions assumptions, installed-cost breakdowns, optional education, progressive refinement, and explicit consent choices. The main delivery risks are licensed fitment coverage, insufficient evidence for fine-grained performance scores, report-link permissions, an oversized launch scope, and the coupling of personal-data collection to future monetization.

## Reconciled decisions

These are deliberate implementation decisions. They supersede only the conflicting source details identified below.

| ID | Source conflict or gap | Final decision and consequence |
| --- | --- | --- |
| D01 | PRD 4.4 and original compare screen say three; FR-CMP-01 says four | Four items everywhere; fifth selection gives a replacement action. Use the v2 comparison layout. |
| D02 | Home/form PDF page 2 includes an ad; PRD bans form ads | The entire combined home/form route has no external, house, or sponsor ads. Results permit at most two units after all picks. |
| D03 | Original form collects email; PRD 4.11 defines a results delivery panel | Collect email only after results, in Get this report. No account or address is needed to see results. |
| D04 | v2 screen shows checked choices and an always-visible identity-sharing option | All optional choices start unchecked. Identity sharing is absent until its market and program are enabled. Existing preferences appear only in a verified contact/browser context. |
| D05 | Mockup says “We never sell your email” but PRD proposes Tier C leads | Launch copy states the current purpose precisely: “Your report is available without email. Offers are optional.” Publish factual current disclosures; no promise contradicted by a later program. |
| D06 | Exactly five picks and five avoids can force bad matches | Return up to five verified eligible picks and up to five evidenced exclusions. Never manufacture a fifth option or relax safety for diversity, budget, or sponsorship. |
| D07 | Snow-city sample mixes year-round all-season, all-weather, and dedicated winter rankings | Separate year-round and two-set strategies. A winter-only option cannot be a year-round recommendation. Climate eligibility precedes ranking. |
| D08 | Numeric snow/ice/noise scores, “stops shorter,” and lifespan examples lack comparative evidence | Publish only licensed/sourced metrics with provenance and comparable methods. Show “Not measured” where unknown. Match score is preference fit, not a probability of safety or a physical test result. |
| D09 | Copy equates UTQG/warranty with miles, promises “safe until,” or rejects all stock older than three years | Remove deterministic safety-life forecasts and blanket age exclusions. Use sourced manufacturer guidance and inspection prompts; model economic life only with disclosed assumptions. See [tire guidance reference](references.md#tire-guidance). |
| D10 | Share token can edit versions, send email, and expose historical inputs | Split view-only share capability from owner edit capability. Shared views omit contact details and personal quote/shop text; recipients fork their own report to refine. |
| D11 | “Sent” immediately, 60-second undo, and request-to-ESP p95 under 60 seconds conflict | Queue for a genuine 60-second cancel window. Say “Scheduled”; show “Sent” only after provider acceptance. Target p95 acceptance within 60 seconds after cancellation closes, within 120 seconds total. |
| D12 | One linear email status treats open/click as delivery milestones | Separate dispatch state, delivery facts, engagement events, and suppression. A click cannot undo a later complaint or bounce. |
| D13 | Release coupon codes on any failed send | Release only on definitive non-acceptance. Quarantine codes after ambiguous provider timeouts; retry with the same send identity. Never reissue a possibly delivered code. |
| D14 | Append-only consent records also require identifier edits on deletion | Keep non-identifying event facts immutable; store identifying linkage in a separately erasable table. Audit privileged deletion without rewriting history. |
| D15 | Analytics and US sale/share default on; all data is broadly reused internally | Launch with explicit analytics/ad choice and no sale/share activation. Purpose-based authorization applies to internal profiles too. GPC denial overrides sharing/targeted ads. This is a stricter product default than the source. |
| D16 | 45-day privacy deadline and mandatory double opt-in are presented as universal | Store jurisdiction- and request-specific policies. Double opt-in is the product default for offers in every enabled market, not a claim about universal law. Counsel validates market rules before activation. |
| D17 | Offers consent collected before an offers program exists | At launch show a truthful “Email me tire offers when available, up to 4 per month” choice only when a monitored confirmation/preferences flow is ready. It grants no reseller access. Unconfirmed requests expire. |
| D18 | Ads operations, sponsorship, and connector appear in multiple release phases | Basic ads controls ship with launch ad capability. Resellers are R2; public MCP is R3 after web stability; app and market expansion are R3; sponsorship is R3; lead exports are R4. |
| D19 | Broad beta includes paid bidding before billing works | R2 is an explicitly free-credit pilot, with paid influence zero. R3 enables billing and a bid term capped at 0.10 of normalized offer score, never tire ranking. |
| D20 | Source predicts 12-week launch without staffing/data assumptions | Plan 16 weeks with three engineers and named fractional specialists, contingent on data/vendor readiness by week 2. Rebaseline at the first gate; no date promise. |
| D21 | “Edge” handlers and Edge Config are prescribed broadly | Use Node.js Route Handlers for application work; CDN for public caches; Global Config for small public redirect/config snapshots. Avoid a runtime choice driven by old terminology. |
| D22 | Payload and Drizzle both own the same database tables | AS03 selects a separate logical Payload database from the outset, with separate credentials/migrations. Prove grants and recovery isolation at R0; use stable content IDs and a retryable publication bridge. |
| D23 | Consumer account optional but reminders survive reinstall; all sync is last-write-wins | Anonymous installs retain local data until cleared; cross-device/reinstall recovery needs an account. Use conflict detection for safety-related records and immutable logs for maintenance. |
| D24 | Source lifecycle includes MCP initialize-centric telemetry and fixed auth assumptions | Pin a supported protocol/SDK at implementation and test negotiated client compatibility. Record request metadata supported by that version; do not hardcode a legacy handshake model. |
| D25 | Raw IP hashing, email SHA-256, and report IDs in affiliate sub-IDs invite linkage | Use purpose-specific keyed HMAC lookups, encrypted addresses, coarse analytics geography, and opaque attribution IDs. No report token, email, full ZIP, or free-text quote in third-party telemetry. |
| D26 | A five-minute webhook event-age cutoff rejects delayed valid retries | Verify the provider's signed delivery timestamp and signature per its contract; dedupe event IDs. Accept old event occurrence times in legitimately re-signed retries. |
| D27 | PDF cache lasts 30 days but share authorization may expire/revoke earlier | Cache private bytes by immutable version, issue short-lived downloads after authorization, and purge/revoke on deletion. Cache lifetime never grants access. |

## Decisions still requiring external evidence

| Decision | Default implementation direction | Owner and deadline | Evidence needed |
| --- | --- | --- | --- |
| Fitment licensing and coverage | Licensed US year/make/model/trim and wheel-package dataset | Product owner + data lead, gate G0 | Written display, derived-output, caching, and API redistribution rights; coverage benchmark |
| Tire scores and usable catalog | About 50 models, sufficient size-level SKUs for about 100 selected vehicle configurations | Data lead + tire specialist, G1 | Source provenance, age/freshness, recall coverage, allowed comparison language |
| Domain and brand | Tires & Tread remains product name | Owner, G0 | Domain control and trademark review; no purchase made by this plan |
| CMP | Certified CMP passing server-readable state, GPC, accessibility, and bundle tests | Privacy lead + frontend lead, G0 | Current vendor listing and trial results; no default-on fallback |
| ESP and domains | Resend + React Email, report and offers subdomains | Backend lead + owner, G0 | Verified domains, commercial-mail acceptance, suppression behavior, signed webhook/retry tests |
| Auth and CMS integration | Clerk for staff/organizations; explicit Payload adapter | Backend lead, G0 | Staff MFA enforcement, role mapping, session revocation, no alternate CMS login bypass |
| Retention and privacy policy | Proposed schedules in delivery/privacy spec | Privacy lead, G2 | Applicability, notices, exceptions, deadlines, data-broker/DROP assessment before later data products |
| Operating spend | Usage-based model and monthly caps | Owner + lead, G0 | Current quotes, including data licenses, backups, testing, monitoring, and legal review |

These gates block the relevant production capability, not the preparation of this plan. No source instruction to contact a provider, register a company, send email, bill a reseller, create accounts, or export data was executed.
