# Requirements traceability

This matrix covers every one of the **137 distinct `FR-*` IDs** in the supplied [v2.1 requirements](sources/originals/product-requirements-v2.1.md). All implementation work is **unstarted**. “Reconciled” identifies an intentional change, not a delivered feature. Release codes R1–R4 and work packages E01–E33 are defined in the [implementation plan](04-implementation-plan.md); D-codes refer to the [decision register](00-source-review.md).

Rows that span releases retain an explicit first slice and completion slice. The verification column describes evidence required before marking the requirement implemented. The source remains available for detailed field lists where there is no stated change.

## Extended assessment

Design: [refinement](01-final-product-design.md#refinement-and-versioning) and [engine](02-technical-architecture.md#recommendation-engine).

| ID | Release | Work | Disposition | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FR-EXT-01 | R1 | E10 | Retained | Progressive panel autosaves draft; failure/retry and reload preserve allowed inputs |
| FR-EXT-02 | R1 | E08,E10 | Reconciled D10 | Immutable versions and older views; owner edit authority separate from stable view-only share |
| FR-EXT-03 | R1 | E06,E10 | Retained | Added/removed/reranked reasons distinguish input changes from data refresh |
| FR-EXT-04 | R1 | E06 | Retained | AT02 safety filter precedes budget; above-budget suggestions clearly separate |
| FR-EXT-05 | R1 | E07,E10 | Retained with calibrated bounds | Shared client/server schemas reject impossible values; domain-specific tread ranges reviewed for supported tire classes |

## Comparison

Design: [four-item compare](01-final-product-design.md#four-item-compare-and-shop-quote).

| ID | Release | Work | Disposition | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FR-CMP-01 | R1 | E10 | Reconciled D01,D06 | Four sources/types, max four, explicit excluded-item status; no buy action on unsafe item |
| FR-CMP-02 | R1 | E06,E10 | Reconciled D08 | Quote verdict splits fit, strategy and comparable price; unknown product remains unverified |
| FR-CMP-03 | R1 | E09,E10 | Reconciled D08,D09 | All source rows represented; unknowns explicit; best highlights only on comparable evidence |
| FR-CMP-04 | R1 | E06,E10 | Reconciled D08 | Deterministic approved contrast templates; no unsupported stopping-distance or life claims |
| FR-CMP-05 | R1 | E06,E10 | Reconciled D07,D09 | Same horizon/mileage/fees; two-set distances do not double count; partial replacement allowed only by verified rules |
| FR-CMP-06 | R1 | E08,E10,E12 | Reconciled D10 | Fixed version comparison appears consistently in web/email/PDF and redacted share |
| FR-CMP-07 | R1 | E03,E10 | Retained and extended | Sticky labels, scroll buttons/keyboard and stacked alternative at 320px |

## Delivery controls

Design: [communication UX](01-final-product-design.md#get-this-report-and-communication-design) and [permissions](03-delivery-and-privacy.md#email-permissions-and-suppression).

| ID | Release | Work | Disposition | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FR-DEL-01 | R1; sharing R4 | E11,E12,E33 | Retained | Report-only and offers-only submissions work independently; no coupled permission |
| FR-DEL-02 | R1; sharing R4 | E07,E11,E33 | Retained | Email revealed/validated when a selected purpose needs it |
| FR-DEL-03 | R1 | E04,E11 | Reconciled D14,D25 | Separate immutable purpose events, notice proof and erasable subject links; no inferred grant |
| FR-DEL-04 | R1, later markets R3 | E11,E12,E28 | Reconciled D16 | Double opt-in all markets as product policy; report unaffected; pending users receive no offers |
| FR-DEL-05 | R1 | E11,E12 | Retained | Turnstile + 3/hour, 10/day email and 10/hour IP limits; current global suppression blocks |
| FR-DEL-06 | R1 | E12,E13 | Reconciled D11 | AT07 scheduled copy, actual 60s cancellation, atomic claim, later acceptance status |
| FR-DEL-07 | R1 | E11 | Reconciled D10 | Prefill only with permitted verified/browser context; arbitrary address cannot reveal/update preferences |
| FR-DEL-08 | R1 | E03,E12,E19 | Retained | Native labeled controls, announced errors, 44px targets, keyboard and reflow pass |

## Email report

Design: [rendering and education](03-delivery-and-privacy.md#education-selection-and-report-rendering).

| ID | Release | Work | Disposition | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FR-EML-01 | R1 | E12,E19 | Retained | React Email 600px; Gmail/Apple/Outlook/Yahoo render matrix checked on template changes |
| FR-EML-02 | R1 | E12 | Retained | Under 100KB HTML; absolute images/alt; no JS; usable dark mode/images-off |
| FR-EML-03 | R1 | E08,E12 | Retained with scoped token | Equivalent text output; expiring browser-view access cannot edit report |
| FR-EML-04 | R1 | E12 | Reconciled D27 | Private linked PDF; on-demand generation; 30-day cache never overrides access expiry/revocation |
| FR-EML-05 | R1; markets R3 | E03,E12,E28 | Retained | Locale catalog/Intl shared; pseudo-localized email/PDF render tests |
| FR-EML-06 | R1 | E15 | Retained | Controlled topic tags required on publish; invalid tags rejected |
| FR-EML-07 | R1 | E06,E12,E17 | Retained | Engine reason codes map to versioned, previewable topic weights |
| FR-EML-08 | R1 | E12 | Reconciled D15 | Deterministic 3–6 eligible links, max two/topic, checklist once; novelty only with permitted tracking |
| FR-EML-09 | R1 | E12 | Retained | First term mention links to valid reviewed glossary route |
| FR-EML-10 | R1 | E12,E13 | Reconciled D25 | Slot/content IDs and safe UTM; no contact/report capability in parameters |
| FR-EML-11 | R1 | E04,E12 | Retained | Selection ledger shows offered links even without a click |
| FR-EML-12 | R1 | E12,E13 | Reconciled D16 | Every message has sender/address/preferences; commercial classification tested on rendered content; immediate opt-out target |
| FR-EML-13 | R1 | E02,E12 | Retained with qualification | Domains/authentication validated; commercial content routed correctly; no reputation-isolation guarantee |
| FR-EML-14 | R1 | E13 | Retained | RFC 8058 header/POST and visible footer; no login required |
| FR-EML-15 | R1 | E04,E12,E13 | Reconciled D11,D12 | Durable send identity, bounded provider retry and uncertain state; event facts separate from dispatch |

## Resellers

Design: [reseller UX](01-final-product-design.md#reseller-portal-from-r2) and [coupon integrity](03-delivery-and-privacy.md#offers-and-coupon-integrity).

| ID | Release | Work | Disposition | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FR-RSL-01 | R2 | E21 | Retained | Business email policy/override, verification and MFA; cannot skip onboarding |
| FR-RSL-02 | R2 | E21 | Retained with minimization | Business/location/services fields; tax ID encrypted and collected only when operationally required |
| FR-RSL-03 | R2 | E21 | Retained | Versioned terms/policy/DPA acceptance and actor/time evidence |
| FR-RSL-04 | R2 | E21,E26 | Retained | Domain/registry/manual evidence; only active verified org serves offers |
| FR-RSL-05 | R2 | E21 | Retained | Owner/Manager/Analyst permissions, invites/revocation and visible org audit |
| FR-RSL-06 | R2 | E22 | Retained | Seven source discount types represented; terms/inclusions determine comparable value |
| FR-RSL-07 | R2 | E22 | Retained | Valid content/dates/redemption/minimum/terms; verified-domain link and logo rights |
| FR-RSL-08 | R2 | E22 | Retained | Shared/generated/unique pools; 100k CSV async import, dedupe and 10% low-pool alert |
| FR-RSL-09 | R2 | E22,E23 | Retained | Geographic and product targeting; specific matches outrank store-wide when otherwise comparable |
| FR-RSL-10 | R2 | E23 | Retained | Atomic total/day/budget/frequency caps across concurrent workers |
| FR-RSL-11 | R2 | E22 | Retained | At least three-day duration, safe URL/claim/length validation and email preview |
| FR-RSL-12 | R2 | E22 | Retained with versioning | New/material edits require review; trusted date/code edits still validated/audited |
| FR-RSL-13 | R2; billing R3 | E24,E27 | Retained with qualification | Aggregated includes/clicks/issues/reported redemptions; open estimates labeled; no recipient disclosure |
| FR-RSL-14 | R2; API R3 | E24,E27 | Reconciled attribution language | Authenticated portal/CSV/API, immutable corrections; reported redemption distinct from verified sale |
| FR-RSL-15 | R3 | E27 | Reconciled D19 | Stripe ledger/invoices/tax, prepaid reservations, exhaustion pause; pilot never charges |
| FR-RSL-16 | R3 | E27 | Retained | Scoped hashed API keys, signed webhook delivery, per-key quotas and tenant tests |

## Offer matching

| ID | Release | Work | Disposition | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FR-OFR-01 | R2 | E23 | Retained | Every eligibility condition plus current consent/suppression rechecked before dispatch |
| FR-OFR-02 | R2; paid R3 | E23,E27 | Reconciled D19 | Pilot no bid; R3 max 0.10 bid weight; bounded factors and reproducible simulation |
| FR-OFR-03 | R2 | E23 | Retained | Max three offers, one per reseller, sponsored label and match explanation |
| FR-OFR-04 | R2 | E23 | Reconciled D13 | Single atomic reservation, uncertain outcomes quarantined; AT09 passes |
| FR-OFR-05 | R2 | E23 | Retained | Consideration/eligibility/score/reason/selection records support dispute reconstruction |
| FR-OFR-06 | R2 | E12,E23 | Retained | No eligible offers removes entire block |
| FR-OFR-07 | R1 invariant; R2 offers | E06,E23 | Retained | AT03 identical core recommendations with every monetization setting varied |

## Tracking

| ID | Release | Work | Disposition | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FR-TRK-01 | R1 | E13,E16 | Reconciled D26 | Raw-body signatures, provider delivery-time replay rules, event-ID dedupe, 30-day payload expiry |
| FR-TRK-02 | R1 | E13 | Reconciled D21,D25 | Fixed destination, no open redirect, <100ms internal target, redirect works if logging fails |
| FR-TRK-03 | R1; markets R3 | E11,E13,E28 | Reconciled D15 | Pixels/linked engagement off without required purpose; aggregate permitted measurement only |
| FR-TRK-04 | R3 | E31 | Retained with permission gate | 180-day sunset; repermission only where allowed and capped |
| FR-TRK-05 | R1 alerts; R2 imports | E13,E25 | Retained | Complaint/bounce alerts; Postmaster/SNDS data imported where access/volume supports it, unavailable is explicit |
| FR-TRK-06 | R1 core; R2 detail | E13,E17,E25 | Retained | Denominators and machine uncertainty visible; slot/topic metrics and feedback in detail |

## SEO

Design: [education](01-final-product-design.md#education-and-trust-pages), [caching/publishing](02-technical-architecture.md#caching-and-deployment).

| ID | Release | Work | Disposition | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FR-SEO-01 | R1 | E15 | Retained | Per-page metadata, safe overrides, previews, generated hreflang; private-route invariants cannot be edited away |
| FR-SEO-02 | R1 | E15 | Retained | Typed template variables with page overrides and locale-aware previews |
| FR-SEO-03 | R3 | E28 | Retained | Strategic register, owner/review dates, Search Console trend and >20% decline flag |
| FR-SEO-04 | R1 related; R3 suggestions | E15,E28 | Retained | Managed related links; suggested links and orphan report later |
| FR-SEO-05 | R1 | E15 | Reconciled D21 | 301/302/410, CSV, reviewed bounded regex, loop/chain detection, safe snapshot publish |
| FR-SEO-06 | R1 | E15 | Retained and hardened | Environment robots/crawler settings; staging protected by auth, not robots alone |
| FR-SEO-07 | R1; programmatic R3 | E15,E28 | Retained | Accurate lastmod and locale maps; no private/draft/unapproved programmatic pages |
| FR-SEO-08 | R1 | E15 | Retained | Validated typed JSON-LD matches visible content; no self-review or rich-result promise |
| FR-SEO-09 | R1 IndexNow; R3 search metrics | E15,E28 | Retained | Publish/update/delete notification retry; daily Search Console import later |
| FR-SEO-10 | R3 | E28 | Retained | Noindex until unique data, at least three eligible options and editor approval |
| FR-SEO-11 | R3 | E28 | Retained | Nightly metadata/link/canonical/schema/orphan/CWV findings with severity/owner; sparse CrUX explicit |
| FR-SEO-12 | R1 | E15,E17 | Retained | Draft/review/schedule/publish/rollback with server roles and immutable history |

## Cookies and permissions

Design: [collection controls](03-delivery-and-privacy.md#consent-enforcement-and-collection).

| ID | Release | Work | Disposition | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FR-CKE-01 | R1; regional expansion R3 | E11,E28 | Reconciled D15,D16 | Restrictive default everywhere at launch; equal choice and reviewed jurisdiction policies |
| FR-CKE-02 | R1 | E11 | Retained | Header/browser GPC honored server-side; visible acknowledgement; no silent override |
| FR-CKE-03 | R1 | E11 | Retained and signed | Server-readable, tamper-resistant state mirrored with policy/version |
| FR-CKE-04 | R1 | E11,E19 | Retained | Consent loader, lint/build checks and browser network tests catch bypass tags |
| FR-CKE-05 | R1 | E11,E18 | Reconciled D15 | Four Google signals denied before permission; updates sequenced before tags |
| FR-CKE-06 | R1 | E11 | Retained | Persistent settings, equally easy withdrawal; re-prompt on policy change/12 months |
| FR-CKE-07 | R1 | E11,E17 | Retained | Storage inventory drives public table; weekly scan detects undeclared keys |
| FR-CKE-08 | R1 | E03,E11,E19 | Reconciled focus behavior | Correct modal semantics, accessible choices, no covered CTA or trapped focus |
| FR-CKE-09 | R1 | E11,E14 | Reconciled D14 | Evidence retention policy and export proof; erasable personal linkage |

## Visitor data and audience products

Design: [retention](03-delivery-and-privacy.md#retention-and-deletion-design) and [later products](03-delivery-and-privacy.md#audience-products-from-later-releases).

| ID | Release | Work | Disposition | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FR-DAT-01 | R1 | E16 | Reconciled D15,D25 | SDK <8KB gzip within form budget; versioned envelope strips forbidden identifiers |
| FR-DAT-02 | R1 core; later feature events | E16,E25 | Reconciled D15 | Allowed structured interactions only, visible-time heartbeats, no keystrokes/free text/raw searches |
| FR-DAT-03 | R1 | E16 | Reconciled D25 | Coarse enrichment, scoped HMAC and bounded linkage; raw IP only restricted security use |
| FR-DAT-04 | R1 | E11,E16 | Reconciled D15,D25 | Deterministic identity linkage only when permitted; email submit/click alone does not grant analytics |
| FR-DAT-05 | R1 | E16 | Retained | Staff/bots excluded from business metrics; heuristics versioned and uncertainty reported |
| FR-DAT-06 | R1 | E11,E16 | Reconciled D15 | Ingest drops denied processing; no client-forged sale flag; necessary counts stay aggregate |
| FR-DAT-07 | R2 internal; segments R3 | E25,E32 | Reconciled D15 | Only permitted structured fields, explicit versus inferred budget separated, no sensitive inference |
| FR-DAT-08 | R2 | E25 | Retained with authorization | Consented explorer; Owner/Privacy only for logged contact reveal |
| FR-DAT-09 | R3 A/B; R4 C | E32,E33 | Retained and gated | Buyer verification/contracts/purpose limits; registration and supplier rights checked |
| FR-DAT-10 | R3 A/B; R4 C | E32,E33 | Retained | Export ledger/checksum/current suppression and two distinct B/C approvals |
| FR-DAT-11 | R3 A/B; R4 C | E32,E33 | Retained and hardened | Revalidate at release; changes rebuild/reapprove; downstream deletion acknowledgements |
| FR-DAT-12 | R1 current; update per program | E11,E14,E32 | Reconciled D05,D16 | Notices describe actual enabled uses; incentive applicability reviewed, no categorical legal claim |
| FR-DAT-13 | Before R3 B / R4 C | E32,E33 | Reconciled current obligations | Market-specific broker/DROP and contract assessment; no assumption of exemption |
| FR-DAT-14 | R1; later stores as introduced | E14,E25 | Reconciled D14,D15 | 13-month raw/linked session TTL; 24-month email/profile ceiling; only deidentified aggregates potentially indefinite |

## Privacy rights

| ID | Release | Work | Disposition | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FR-PRV-01 | R1 | E14 | Retained | Supported rights and appeal paths; programs not live are accurately described |
| FR-PRV-02 | R1 | E14 | Retained | Email/browser/agent proof proportional to request; no unnecessary account |
| FR-PRV-03 | R1; new stores per release | E14 | Reconciled D16 | Jurisdiction/type clocks; idempotent fulfillment graph, not universal 45 days |
| FR-PRV-04 | R1 | E14 | Reconciled D25 | Restricted HMAC tombstone blocks reimport; reconsent cannot silently lift hard-bounce/complaint |
| FR-PRV-05 | R1 | E14,E17 | Retained | Counts/timing retained without unnecessary identity; annual reporting where required |

## Advertising

| ID | Release | Work | Disposition | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FR-ADS-01 | R1 web; app file when needed | E18,E30 | Reconciled D18 | Validated ads.txt history/network checks; app-ads only when app ad configuration requires it |
| FR-ADS-02 | R1 | E18 | Reconciled D02 | Registry enforces exclusions/max two after picks; no house/sponsor exception |
| FR-ADS-03 | R1 | E18,E19 | Retained | Mobile density ≤30%, reserved dimensions, CLS ≤0.1; refresh disabled initially, later ≥30s/in-view only if approved |
| FR-ADS-04 | R1 | E18 | Retained | Block categories/URLs in network; weekly served-ad review and evidence |
| FR-ADS-05 | R1 | E11,E18 | Reconciled D15 | Certified CMP/current vendor protocol, no default nonpersonalized-cookie bypass; no ads for known under-13 |
| FR-ADS-06 | R3 | E27 | Reconciled D02,D18 | Approved sponsor dates/caps/creative; no home sponsor while it contains assessment; no ranking influence |
| FR-ADS-07 | R1 | E18 | Retained | Reserved permitted slots use useful house content without third-party tracking |
| FR-ADS-08 | R1 | E16,E18 | Retained | Staff/synthetic/bot exclusions; anomalous CTR alert vs 28-day median with low-volume guard |
| FR-ADS-09 | R1 | E18 | Retained | Clear Advertisement/Sponsored labels adjacent to placements |
| FR-ADS-10 | R1 slots; R3 imports/sponsors | E18,E27 | Retained | Viewable counts, consent coverage, earnings freshness, cap delivery and engagement impact |

## Mobile application

Design: [native app](01-final-product-design.md#native-app-and-connector-from-r3).

| ID | Release | Work | Disposition | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FR-APP-01 | R3 | E30 | Retained | Expo/Router/EAS pinned; OTA limited to approved compatible native runtime |
| FR-APP-02 | R3 | E30 | Retained | Versioned API, short access/rotated refresh tokens in secure store, forced-update handling |
| FR-APP-03 | R3 | E30,E14 | Retained and hardened | Guest/account merge ownership proof; in-app deletion propagates to all stores |
| FR-APP-04 | R3 | E30,E31 | Reconciled D23 | In-context push, server/local dedupe, quiet hours/caps; reinstall recovery only with account |
| FR-APP-05 | R3; data activation later gate | E30,E32 | Retained | Platform tracking permission plus product purpose permission; no hashed-ID workaround after denial |
| FR-APP-06 | R3 | E30 | Retained | SDK/data inventory matches store disclosures/privacy manifest before each relevant release |
| FR-APP-07 | R3 | E30 | Retained | Universal/App Links verified; web fallback retains view-only/report scopes |
| FR-APP-08 | R3 | E30 | Reconciled D23 | Last five reports/cache/queued writes; conflicts explicit for safety data, append-only maintenance events |
| FR-APP-09 | R3 | E30 | Retained | <2s cold-start target defined device, ≥99.5% crash-free, native accessibility measured |
| FR-APP-10 | R3 | E30 | Retained | Internal testing, staged rollout, signed config and safe kill switches |
| FR-APP-11 | R3 | E30 | Retained with review | No app ads/IAP at launch; verify actual store classification rather than declaring blanket exemption |
| FR-APP-12 | R3 | E30,E17 | Retained | Localized listing assets/reviews managed; manual handoff when store API cannot perform action |

## AI connector

| ID | Release | Work | Disposition | Acceptance evidence |
| --- | --- | --- | --- | --- |
| FR-AI-01 | R3 | E29 | Reconciled D21,D24 | Official SDK/versioned transport, Node handler, protocol/client compatibility checks |
| FR-AI-02 | R3 | E29,E06 | Retained | Same normalized inputs/versions yield identical engine output; monetization invariance |
| FR-AI-03 | R3 | E29 | Retained with privacy | Typed JSON/text, units, attribution and uncertainty; no private capabilities in public metadata |
| FR-AI-04 | R3 public then authenticated | E29 | Retained with protocol validation | Public 60/hour baseline, key quotas, OAuth scoped user flows; human confirmation for email/consent |
| FR-AI-05 | R3 | E29,E16 | Retained and minimized | No raw prompts/free text; coarse quality/aggregate telemetry; connector records excluded from B/C |
| FR-AI-06 | R3 | E29 | Retained | Schemas/output caps, no arbitrary URL fetch, factual descriptions, safe error codes |
| FR-AI-07 | R3 | E29 | Retained | Versioned contracts, 90-day breaking-change deprecation and compatibility fixtures |
| FR-AI-08 | R3 | E29 | Retained | Developer setup/OpenAPI, directory submissions after current terms review; acceptance not guaranteed |
| FR-AI-09 | R3 | E29,E16 | Reconciled D24,D25 | Client/request metadata per pinned protocol; aggregate timing/errors/cache and safe attribution |
| FR-AI-10 | R3 | E29,E19 | Retained | Golden replay, Inspector, actual-client evaluation and phrasing checks |
| FR-AI-11 | R4 | E33,E27 | Retained | Approved B2B plans, quota/billing/SLA tests, licensed redistribution scope |

## Core requirements without source FR identifiers

The source's early sections and nonfunctional requirements are also in scope. These planning IDs do not replace source IDs.

| ID | Source | Release/work | Acceptance evidence |
| --- | --- | --- | --- |
| CORE-01 | 4.1 assessment | R1 E03,E07 | Vehicle/size, wheel package, location, roads, priorities, distance, quantity, seasonal setup; no email gate |
| CORE-02 | 4.2 climate | R1 E05,E09 | Correctable conditions, dataset/source/review dates; regional legal guidance reviewed separately |
| CORE-03 | 4.3 engine | R1 E05,E06 | Deterministic eligibility, tiers where possible, evidence/exclusions, 50 golden scenarios |
| CORE-04 | 4.4 results | R1 E08,E09 | Cost/quantity/unit/date, score meaning, known limitations, maintenance, questions, private share |
| CORE-05 | 4.5 lifecycle | R3 E31 | Separate consent and scheduling; never inferred from one-time report request |
| CORE-06 | 4.6 hub/tools | R1 E15; extra tools R3 E28 | 25 terms, decoder, checklist; DOT/tread/alternate-size/recall tools require reviewed data rules before release |
| CORE-07 | 4.7 checklist | R1 E15 | 14 questions with answer guidance, printable and permissioned local scorecard |
| CORE-08 | 4.8 internationalization | R1 E03,E15; new markets R3 E28 | Locale routes/messages/Intl/reason codes/pseudolocale; market distinct from language |
| CORE-09 | 4.9 admin modules | R1 E17; R2 E21–E25; R3 E27–E32 | Module table in product design, MFA/roles/audit, masked contact data, disabled later modules absent |
| CORE-10 | 6 data | R0/R1 E01,E05 | License/provenance/coverage, no copied proprietary tests, nightly recall and daily prices |
| CORE-11 | 8–9 monetization | R1 E18; R3 E27 | Disclosure/approved destinations/applications; commission cannot rank tires; live terms checked |
| CORE-12 | 10 KPIs | R1 E16,E17 | Definitions, denominators, attribution and consent-coverage; zero distinct from missing |
| CORE-13 | 11 trust/legal | R1 G2,G3; each later gate | Methodology/policies/support, review dates, market-applicable requirements and disclosures |
| CORE-14 | 15 screens | R1–R4 | Every source screen represented in final route/module inventory and phased UX specification |
| NFR-01 | 5 performance | R1 E19 | Form LCP <2s, JS <120KB incl. CMP/SDK, CLS ≤0.1; agreed lab and field definitions |
| NFR-02 | 5 accessibility | R1 E19; all releases | WCAG 2.2 AA, keyboard/screen reader/reflow, email/PDF equivalents |
| NFR-03 | 5 reliability | R1 E19,E20 | 99.9% targets; durable jobs/queue; email cancellation-adjusted target; DLQ and recovery |
| NFR-04 | 5 privacy/security | R1 E11,E14,E19; partner E26 | Purpose controls, encrypted PII, RLS, safe links/uploads/webhooks, no fingerprinting |
| NFR-05 | 5 integrity | R1 E04,E19 | Outbox/inbox dedupe, immutable snapshots, migration/backup/restore evidence |
| NFR-06 | 5 observability/freshness | R1 E05,E13,E16 | Synthetic journey, job/lag alerts, redacted logs and safety freshness gates |
| NFR-07 | 5 mobile/MCP | R3 E29,E30 | Versioned APIs, native quality, tool performance and real-client compatibility |
| NFR-08 | 5 ads | R1 E18,E19 | Layout/density/consent/placement invariants and kill switch |

## Implementation tracking rule

At implementation, add PR/test evidence and shipped version to each completed row. A design decision, stub screen, passing mock-only test, or provider signup is not completion evidence. Requirements deferred by release remain explicit; no ID is silently dropped.
