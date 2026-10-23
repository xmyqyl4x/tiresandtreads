# Tires & Tread — Product Design & Requirements Document

**Site name:** Tires & Tread (previous working name: TireWise)\
**Owner:** Paul Were\
**Status:** Draft v2.1 · October 2026\
**Change log:**\
v2.1 — Advertising and ad operations (4.20), mobile app (4.21), AI platform connector via a public MCP server (4.22); admin modules 13–15; optional consumer accounts for the app; stack, data model, architecture, API, phasing, KPIs, legal, risks, roadmap and screens updated. Items added in this version are marked **\[v2.1\]**.\
v2.0 — Extended assessment with compare-and-contrast (4.10); report delivery panel with email and reseller-offer opt-ins (4.11); tailored HTML report email with education links (4.12); reseller portal and coupon program (4.13) with offer matching (4.14); email engagement tracking and feedback (4.15); admin-managed SEO (4.16); cookie and consent management (4.17); visitor data platform and audience data program (4.18); privacy rights handling (4.19); platform architecture, databases and API surface (7.3–7.5); six new admin modules (4.9). Items added in this version are marked **\[v2.0\]**.\
v1.1 — English-only launch with an internationalisation-ready build (4.8); admin portal refocused on marketing, affiliate partner management and traffic/engagement analytics (4.9).\
**Purpose of this document:** a single, agreed description of what we are building, why, how, and how it makes money. Items marked **\[NEW\]** were improvements added on top of the original conversation. Functional requirements added in v2.0 carry IDs (e.g. `FR-EXT-01`) so they can be traced into tickets and tests.

**Key v2.0–v2.1 design decisions (summary)**

- Reseller offers and audience data are new revenue streams, but they sit *beside* the recommendations, never inside them. Neither can change which tires we recommend or their order (extends the v1.1 editorial guardrail).
- Every new data use is tied to a recorded permission: the report email, reseller offers, and identity-linked data sharing are three separate, unticked checkboxes. Consent records are append-only and versioned.
- Visitor data is collected broadly through a first-party event pipeline, but what we *sell* is tiered: aggregated insights (lowest risk), pseudonymous audience segments (opt-out in US states; opt-in in EU/UK), and identity-linked leads (opt-in only). Raw IP addresses, precise location and data from minors or opted-out visitors are never sold (rationale in 4.18).
- SEO moves from "MDX in the repo" to a CMS built into the same Next.js app, so titles, descriptions, structured data, redirects and robots rules change from the admin in seconds without a deploy.
- **\[v2.1\]** The website acquires (SEO, ads, AI connector); a native React Native/Expo app retains (garage, reminders, offers wallet). On iOS, any data-broker sharing from the app requires the App Tracking Transparency permission.
- **\[v2.1\]** A public MCP server exposes the same engine to AI assistants, with attributed links and the same no-paid-influence guardrail.
- **\[v2.1\]** Advertising gets an operations layer (ads.txt, slot registry, brand safety, sponsorships) with hard rules that keep ads out of recommendations and protect page speed.
- Email opens are tracked but treated as a weak signal (Apple Mail Privacy Protection inflates them); clicks, site return visits and offer redemptions are the primary engagement measures.

---

## 1. Vision and goals

**One-line vision:** Anyone can find the right tires for their car, understand exactly what they are buying, and walk into a shop knowing what to ask — in about a minute.

### 1.1 Goals

| # | Goal | How we know it works |
| --- | --- | --- |
| G1 | Make tire buying simple and understandable | ≥ 70% form completion rate; median completion time ≤ 75 seconds |
| G2 | Give trustworthy, explainable recommendations | ≥ 25% of results viewers expand a "Why this tire" panel or term tooltip |
| G3 | Teach the basics (sizes, ratings, maintenance) | Glossary pages earn ≥ 50% of organic traffic within 12 months |
| G4 | Build a sustainable business (ads first, affiliates alongside) | Revenue per 1,000 sessions (RPS) tracked from launch; affiliate click-through ≥ 8% of results views |
| G5 | Serve multiple regions correctly, in English first | Correct units, legal tread depths, ratings systems and retailers per market; adding a new language later requires no code or URL changes, only translations |
| G6 | Run the business from one admin portal | Owner can see traffic, engagement, affiliate and ad performance, and manage partners and campaigns without touching code or third-party dashboards for routine tasks |
| G7 \[v2.0\] | Turn one-off visitors into a reachable, permissioned audience | ≥ 35% of completed reports request the email; ≥ 15% of email requesters opt into reseller offers; spam-complaint rate \< 0.1% |
| G8 \[v2.0\] | Run a reseller offer marketplace that users find useful | ≥ 50 verified resellers within 6 months of portal launch; offer click rate ≥ 4% of offer-bearing emails; reported redemption rate tracked per reseller |
| G9 \[v2.0\] | Monetise visitor data without losing user trust or breaking the law | 100% of exports traceable to a legal basis and suppression list version; zero exports containing opted-out, GPC or minor-flagged records; privacy-rights requests closed within statutory deadlines |
| G10 \[v2.0\] | Manage SEO from the admin, quickly | Title/description/redirect changes live in under 60 seconds without a deploy; zero strategic pages with critical SEO audit findings for more than 7 days |
| G11 \[v2.1\] | Keep drivers coming back after they buy | App: ≥ 40% of installers save a vehicle with a tire set; day-30 retention ≥ 20%; reminder push open rate ≥ 15% |
| G12 \[v2.1\] | Be the tire source AI assistants call | AI connector listed on at least 2 AI platforms within 6 months of launch; ≥ 5% of new site sessions from `ai_connector` by month 12 |
| G13 \[v2.1\] | Earn ad revenue without hurting speed or trust | Ad-bearing page types keep CLS ≤ 0.1 and LCP within budget; zero ads in recommendations; ads.txt always matches network requirements |

### 1.2 Non-goals (for now)

- We do not sell tires, hold inventory, or process payments for tires. (We do bill resellers for offer placement — see 4.13.)
- We do not run our own physical tire tests or copy third-party test data.
- No consumer accounts in the MVP: saved results work via a private link and the emailed report. Reseller and staff accounts are in scope **\[v2.0\]**. Optional consumer accounts arrive with the mobile app **\[v2.1\]**.
- No China market (data localization and blocked services make it a separate project).
- No languages other than English until English-speaking markets are proven (the site is built so languages can be added later with minimal impact; see 4.8).
- **\[v2.0\]** No device fingerprinting, no sale of raw IP addresses or precise geolocation, no sale of data from people who opted out or are known or flagged to be under 18, and no data products used for credit, insurance, employment or housing eligibility decisions (see 4.18).

---

## 2. Users and core jobs

| Persona | Situation | What they need from us |
| --- | --- | --- |
| **The Confused Replacer** (primary) | Tires are worn, a shop quoted a price, they don't know if it's fair | Plain-English options, a fair price range, questions to ask |
| **The Climate Changer** | Just moved somewhere with snow/heat/rain | Whether they need all-weather or winter tires, legal rules |
| **The Researcher** | Reads everything before buying | Detailed specs, comparisons, methodology |
| **The Budget Driver** | Wants the cheapest safe option | Budget-tier picks that still meet safety specs; cost-per-mile view |
| **The EV/SUV/Truck owner** \[NEW\] | Heavier vehicle, special needs | Load ratings, EV-specific tires (noise, range), LT tires, AWD rules |

**Core jobs to be done**

1. "Tell me which tires fit and suit my driving."
2. "Tell me what I should pay, all-in."
3. "Explain what these numbers mean."
4. "Tell me what to avoid."
5. "Tell me how long they'll last and how to look after them."
6. "Prepare me for the conversation at the shop."

---

## 3. Scope by phase

| Phase | Scope |
| --- | --- |
| **MVP (Phase 1)** | US market, English only (i18n-ready build); \~top 100 vehicles; \~50 tire models across tiers; one-page form; rules engine; results page; 25 core glossary pages; "Before you buy" questions; display ads; first affiliate programs; admin portal core. **\[v2.0\] added to MVP:** extended assessment and compare (up to 4, incl. shop quote); report delivery panel with email checkbox and reseller-offers checkbox (collect offer consent from day one so the list grows before resellers are live); tailored HTML report email with education links; email event tracking via webhooks plus first-party click redirect; certified CMP with Consent Mode v2 and GPC; CMS-based SEO manager (meta, templates, redirects, sitemaps, robots); first-party event collection into the analytics store; privacy centre with request queue. **\[v2.1\] added to MVP:** ads.txt manager, slot registry, brand-safety blocks, house ads; PWA manifest |
| **MVP+ (launch + 6–10 weeks) \[v2.0\]** | Reseller portal beta (registration, manual verification, offer and coupon upload incl. unique code pools); offer moderation; offer matching into report emails; admin email and deliverability module; visitor/session explorer; Tier A aggregated insights (internal first) |
| **v2** | UK, Ireland, Australia (still English, with UK/AU spelling such as "tyre"); live affiliate price feeds; admin: network report import, reconciliation, email campaigns, Search Console data; auto-generated "best tires for \[vehicle\]" and size-decoder pages; price-drop and reminder emails \[NEW\]. **\[v2.0\]:** Stripe billing for resellers; reseller API and webhooks; segment builder; Tier A insight sales; Tier B pseudonymous segments through a clean room after privacy review; strategic-pages SEO workflow and nightly SEO audits. **\[v2.1\]:** mobile app v1 (iOS + Android); AI connector v1, then OAuth tools; sponsorship scheduler |
| **v3** | First non-English language (e.g. German) added through the existing i18n framework, then FR/ES/IT/NL; core EU markets (opt-in consent model throughout); AI-written plain-English summary layered on the rules engine; sidewall-photo size reader \[NEW\] on the web (the app gets it first in v2, 4.21); post-purchase feedback loop \[NEW\]. **\[v2.0\]:** Tier C identity-linked leads (opt-in only); POS/redemption integrations; on-site "offers near you" module. **\[v2.1\]:** paid AI connector API plans; Sign in with Apple/Google; app ads only if retention unaffected |
| **v4** | South Africa, Japan, Singapore, India; wider Africa and Asia using price bands instead of live prices; more languages, right-to-left support; market-by-market privacy review before any data program activation |

---

## 4. Functional requirements

### 4.1 The one-page form

Target: completed in about 60 seconds, works one-handed on a phone.

| Field | Behaviour | Required |
| --- | --- | --- |
| **Vehicle** | Year → Make → Model → Trim cascading dropdowns, type-ahead. Alternative: "I know my tire size" free entry (e.g. 225/65R17) with live validation and a mini sidewall diagram highlighting each part. | Yes |
| **Staggered / multiple sizes** \[NEW\] | If the trim has different front/rear sizes or optional wheel packages, ask "Which wheels do you have?" with picture-style choices. | Conditional |
| **Location** | Auto-detected country (edge geolocation) + postal code / city search. "Use my location" button. Drives climate profile, units, currency, laws. | Yes |
| **Driving mix** | Chips (multi-select): Highway, City, Mountain/winding, Gravel/unpaved, Off-road, Towing/heavy loads. Optional "mostly" toggle on one. | Yes (≥1) |
| **Priorities** | Pick up to 2: Lowest price, Longest life, Quietest/comfiest, Best in rain & snow, Sporty handling, Best EV range \[NEW\] | Yes |
| **Annual distance** | Under 8k / 8–12k / 12–18k / 18k+ (miles or km by locale) | Yes |
| **Replacing how many?** \[NEW\] | 4 / 2 / 1 — triggers AWD and "new tires go on the rear" guidance | Default 4 |
| **Seasonal setup** \[NEW\] | "One set all year" vs "Open to a separate winter set" (shown only in snowy climates) | Conditional |
| **Email** | Optional, last; "Email me my report". Separate unticked box for tips/deals. | No |

**Form rules**

- Single page, progressive reveal; no page reloads.
- Smart defaults from location (e.g. snowy zip pre-highlights "Best in rain & snow").
- Inline validation; never block on optional fields.
- Results shareable via private link without giving an email \[NEW\].
- Bot protection on submit (invisible challenge) and rate limiting \[NEW\].

### 4.2 Climate and location profile

- Inputs: postal code / coordinates.
- Outputs per location: average snow days, days below freezing, annual rainfall/wet days, summer heat days, elevation band, plus local legal rules (winter tire mandates, min tread depth, studded tire seasons).
- Displayed to the user as a small "Your conditions" card so they can see (and correct) what we assumed \[NEW\].

### 4.3 Recommendation engine (rules-based first)

**Pipeline**

1. **Fitment filter** — exact size(s); load index and speed rating ≥ OE spec; LT vs P-metric correctness; XL where required.
2. **Market filter** — sold in user's country; not on an active recall list.
3. **Climate filter** — e.g. heavy-snow profile excludes summer tires; recommends 3PMSF-marked all-weather or winter.
4. **Weighted scoring** — each tire scored 0–100 on: dry, wet, snow, ice, treadwear/longevity, noise/comfort, efficiency, value. Weights come from driving mix + priorities + climate.
5. **Tier selection** — pick top 5 across Budget / Mid / Premium so every result set has price spread.
6. **Avoid list** — 5 "poor fit for you" entries with a reason each (e.g. summer tire in snow country, low treadwear for high mileage, below-spec load, recalled line, mismatched for AWD).
7. **Explanation** — each pick gets "Why this tire" with the top 3 factors and their bar values \[NEW\].

**Engine requirements**

- Deterministic and versioned (engine version stored with each report).
- Golden test suite: \~50 vehicle/location/driving scenarios with expected outcomes, run in CI \[NEW\].
- Affiliate status must never influence ranking; documented on the "How we choose" page \[NEW\].

### 4.4 Results page

For each of the 5 recommendations:

- Name, tier badge, category (all-season/all-weather/winter…), match score.
- **Personal sidewall decoder** — their exact size, each segment tappable to its glossary page.
- **Expected price** — per tire range, set of 4, and estimated **out-the-door total** (mounting, balancing, valve/TPMS service, disposal, alignment, local tax estimate) \[NEW: itemised + tax\].
- **Cost per 1,000 miles (or km)** = out-the-door ÷ expected life \[NEW\]. Makes cheap-but-short-lived tires visible.
- **Weather & conditions ratings** — Dry, Wet, Snow, Ice, Noise, Comfort; simple 5-step scale + one sentence each.
- **Expected lifespan** — warranty/treadwear-based estimate ÷ annual distance, adjusted for driving mix; capped by age (6–10 yrs).
- **"Check price" buttons** to 1–3 retailers (affiliate), clearly labelled.
- **Compare** checkbox (up to 3 side by side) \[NEW\].

Also on the page:

- "5 to avoid for your car" section.
- **Maintenance plan** — rotation interval, alignment checks, pressure source (door placard), replacement tread depth, tire age limit.
- **Before you buy** — top 6 questions to ask the retailer, with link to full checklist.
- **Two-set strategy** (snowy areas) — all-season only vs all-season + winter set cost over 5 years \[NEW\].
- Actions: **Refine and compare** (4.10), **Get this report** panel with email and offers checkboxes (4.11), Copy link, Print/PDF. **\[v2.0\]**

### 4.5 Email report

Superseded in v2.0 by sections 4.11 (how the user asks for it), 4.12 (what the email contains and how it is built), 4.14 (offers attached to it) and 4.15 (tracking and feedback). Summary:

- HTML email with a plain-text alternative; a link to a hosted PDF replaces the attachment (smaller email, better deliverability) **\[v2.0\]**.
- Contains their inputs, the 5 picks, any extended comparison, avoid list, decoder, maintenance plan, questions checklist, a tailored "Learn more for your situation" block, link back to saved results, and — only if they opted in and a good match exists — up to 3 sponsored reseller offers.
- **Lifecycle emails** (opt-in) \[NEW\]: price-drop alert on saved tires; rotation reminder based on stated mileage; seasonal winter-swap reminder by climate; "6 months on — how are your tires?" feedback survey.

### 4.6 Education hub & glossary (SEO engine)

**Hub:** "Tire Basics" with sections — Reading the sidewall · Ratings & labels · Tire types · Maintenance · Buying.

**Each term page template**

1. One-sentence plain definition (snippet-ready)
2. Annotated original SVG illustration
3. What it means for you
4. Impact by condition (dry, wet, snow, ice, heat, noise)
5. How it differs in your region
6. Common myths
7. Related terms
8. Call to action: "Find tires for your car" (prefilled where possible)
9. Short FAQ + structured data
10. "Last reviewed" date and reviewer \[NEW\]

**Programmatic pages (v2)**

- "Best tires for \[Year Make Model\]" — generated from engine output with unique data (sizes, OE ratings, climate notes), not thin templates.
- "What does \[size\] mean?" for the most common sizes.

**Interactive tools (link magnets)** \[NEW\]

- Sidewall decoder (type any size)
- DOT date code / tire age checker
- Tread depth guide (coin test by country's coin)
- Tire size calculator (alternative sizes with speedometer error)
- Recall checker (by brand/model or DOT code)

### 4.7 "Before you buy" questions

Full checklist (from the conversation) — out-the-door price, tire age/DOT code, load & speed ratings, why this tire, warranty terms, rotation/balancing, alignment evidence, where 2 new tires go, AWD rules, matched sets, pressure source, lug-nut torque, road hazard coverage, return/trial policy — each with "good answer" and "red flags", localised, printable, and each linking to its glossary page. **\[NEW\]** Add a "Shop scorecard" mode: user ticks answers on their phone while at the counter and gets a simple green/amber/red summary.

### 4.8 Internationalisation — English first, built to expand

**Decision:** launch in English only, but build every part of the site so a new language can be added later by supplying translations, without code changes, URL changes or redesigns.

**Separate "market" from "language".** These are two different settings:

- **Market** (country) decides units (mi/km, °F/°C, psi/bar/kPa), currency, ratings system (UTQG vs EU label), legal tread minimum, winter-tire rules, retailers and affiliate programs. Multiple markets launch in English.
- **Language** decides only the words on the page. At launch the only language is English, with small spelling overrides per market (en-US "tire", en-GB/en-AU "tyre").

**What we build from day one (cheap now, expensive to retrofit)**

| # | Practice | Why it matters later |
| --- | --- | --- |
| 1 | **Locale-prefixed URLs from launch** (`/en-us/`, later `/en-gb/`, `/en-au/`) | Adding `/de-de/` later needs no redirects; avoids losing SEO rankings during a URL migration |
| 2 | **No hardcoded text** — every UI string lives in an English message file (next-intl), referenced by key | Translation becomes "add a file", not "edit hundreds of components" |
| 3 | **ICU message format** for plurals, numbers and variables ("{count, plural, one {# tire} other {# tires}}") | Many languages have complex plural rules |
| 4 | **Formatting through `Intl`** (dates, numbers, currency, units) driven by market, never string concatenation | Correct formats for any locale automatically |
| 5 | **Engine returns codes, not sentences** (e.g. `reason: "SUMMER_IN_SNOW_ZONE"`, params) and the UI renders text from the message file | Recommendations and avoid-reasons translate with no engine change |
| 6 | **Content keyed by (slug, locale)** in the database/CMS even though only `en` exists | Glossary, guides and emails gain languages by adding rows |
| 7 | **Illustration text kept as separate text layers** pulled from message files, not baked into SVG paths | Diagrams translate without redrawing |
| 8 | **Layouts allow \~35% longer text**; no fixed-width buttons with text | German/French text runs longer than English |
| 9 | **CSS logical properties** (`margin-inline-start`, not `margin-left`) | Right-to-left languages (Arabic) later need far less rework |
| 10 | **Fonts with broad character coverage** chosen at design time | Avoids a typography redesign for accented or non-Latin scripts |
| 11 | **Email and PDF templates use the same message files** | Reports translate with the site |
| 12 | **Pseudo-localisation check in CI** (a fake "lóńgér áççéñtéd" locale) | Catches hardcoded strings and truncation before they ship |
| 13 | **Slugs stay English-stable at first**; localised slugs added per language later via a slug map | Prevents broken links when languages arrive |

**Adding a language later (expected effort):** translate message files, glossary/guide content and email templates (via a translation management tool such as Crowdin or Lokalise connected to the repo); enable the locale in config; add hreflang entries (automatic from config); native-speaker review of tire terminology. No component, engine or database schema changes.

**Still market-specific at launch (English):**

- Per-market explanations (UTQG page in US; EU-label page for UK/IE).
- Fallback location input where postal codes are unreliable (city search, map pin).

### 4.9 Admin portal — marketing, partners and insight first

**Purpose:** the admin portal is primarily the business cockpit: marketing the site, managing affiliate partners, and understanding traffic and what people interact with. Data maintenance (catalog, fitment) is a secondary module.

**Approach:** build a thin, focused admin inside the same Next.js app (protected `/admin` route group) that pulls data from our own event tracking plus external reports (analytics, Search Console, affiliate networks, ad networks) into one place. Use specialist tools underneath rather than rebuilding them: product analytics (PostHog) for funnels/flags, GA4 and Search Console for traffic and search data, network APIs for affiliate results.

#### Module 1 — Overview dashboard (home)

- Headline tiles with trend vs previous period: sessions, users, pageviews, form starts, form completions, reports generated, emails sent, affiliate clicks, estimated affiliate commission, ad revenue, revenue per 1,000 sessions.
- Filters: date range, market, device, traffic channel.
- "What changed" callouts: biggest movers among pages, channels and partners.
- Weekly email digest of the same summary to the owner.

#### Module 2 — Traffic and content analytics

- Top pages, top landing pages, exit pages; pageviews, average engaged time and scroll depth per page.
- Traffic channels: organic search, email, social, referral, direct; top referring sites.
- Search performance (Search Console): queries, impressions, clicks, average position per page; pages gaining or losing.
- Geography and device breakdown; new vs returning visitors.
- Content health: pages with falling traffic ("content decay"), pages past their review date, pages missing meta description or structured data.

#### Module 3 — Engagement and interaction insights ("what people use")

- Form funnel with drop-off per field and median time to complete.
- Most-entered vehicles, sizes, locations/climates, driving mixes and priorities (aggregated).
- Results engagement: card expansions, "Why this tire" opens, compare usage, share/email/print actions.
- Most-opened tooltips and most-clicked glossary terms (site and email, via UTM tags) — shows what confuses buyers.
- Most-recommended tires vs most-clicked tires.
- Tool usage: decoder, DOT age checker, size calculator, scorecard.
- Optional session recordings/heatmaps on selected pages (consent-gated, sampled).

#### Module 4 — Affiliate partner management

- **Partner directory:** retailer, network, program ID, markets, commission terms, cookie length, payment terms, contact/manager, key restrictions (e.g. no brand-term bidding), notes.
- **Application tracker:** pipeline Not applied → Applied → Approved / Rejected → Active → Paused / Closed, with dates and reapply reminders.
- **Links and placements:** link templates per partner/market, deep-link test tool, automated nightly link-health checks (broken or redirected links flagged), on/off switch per partner and placement.
- **Performance:** clicks, orders, commission, EPC, conversion and reversal rates by partner, market, placement (results card, compare, email, vehicle page) and tire.
- **Reconciliation:** our tracked clicks vs network-reported clicks and sales by sub-ID, with discrepancies highlighted.
- **Payouts:** expected vs received payments per network, thresholds and dates.
- **Alerts:** program closed, commission change, link failure, EPC drop.
- **Editorial guardrail:** partner settings can change *which retailer links appear* and their order, never which tires are recommended. The portal shows this rule on the placements screen.

#### Module 5 — Ad revenue

- Imported earnings from the ad network: revenue, RPM by page type and market.
- Ad slot settings per page type (enable/disable, lazy-load), with the hard rule that the form page has no ads.
- Page-speed impact view (Core Web Vitals by page type) so ad changes can be checked against performance.

#### Module 6 — Marketing tools

- **Campaign and UTM builder:** create tracked links for social, newsletters, partner outreach; see results per campaign.
- **Email marketing:** subscriber growth, consent breakdown, segments (market, vehicle type, climate, interests), lifecycle automation status (price drops, rotation and winter reminders, feedback survey), campaign composer from approved templates, send/open/click/unsubscribe stats.
- **SEO and content planning:** content calendar, page status (draft → review → published), target keywords per page, internal-link suggestions, review-date reminders.
- **Experiments:** simple A/B tests on headlines, CTAs and form copy using feature flags, with results tied to completion and click rates.
- **Social/share assets:** auto-generated share images for pages and tools.
- **Site announcements:** banner text and seasonal promotions (e.g. "Winter tire season starts soon in your area").
- **Outreach tracker (light CRM):** backlink outreach, installer partners, sponsors — contact, status, next step.

#### Module 7 — Data operations (secondary)

- Tire catalog editor, fitment import and review queue, scoring weights with preview against golden scenarios, recall sync status, price feed freshness, market rules editor.

#### Module 8 — Resellers and offers \[v2.0\]

- Verification queue (domain check result, registry lookup, documents, approve/reject with reason).
- Reseller directory with status, tier, trust flag, balance, linked affiliate record, complaint count.
- Offer moderation queue with rendered email preview, policy checklist and approve/reject.
- Matching settings: ranking weights, paid-influence cap, max offers per email, frequency caps; "simulate" tool showing which offers a sample report would receive and why.
- Code pool health (remaining, issue rate, days left), budget burn, billing and invoices (Stripe), disputes.
- Performance by reseller and offer: inclusions, clicks, codes issued, redemptions, revenue to us.

#### Module 9 — Email and deliverability \[v2.0\]

- Sends and events: volume, delivery, bounces, complaints, estimated human opens, clicks, unsubscribes; by template, market and date.
- Link performance: clicks by slot and by education topic; which topics drive return visits.
- Code-to-topic mapping editor for tailored education links (4.12) with preview against sample reports.
- Template manager: versions, locale coverage, test sends, rendering-test results.
- Deliverability health: SPF/DKIM/DMARC status, Postmaster/SNDS data, suppression list browser, sunset policy status.
- Feedback inbox: helpfulness votes, survey answers, replies.

#### Module 10 — SEO manager \[v2.0\]

- Pages and SEO fields, page-type templates with SERP preview, strategic pages register with Search Console metrics, internal-link suggestions and orphan list, redirect manager, robots and AI crawler toggles, sitemap status, structured data validation, nightly audit findings with owners. (Backed by the embedded CMS, 4.16.)

#### Module 11 — Consent and privacy \[v2.0\]

- Consent rates by region and category, GPC rate, banner interaction funnel.
- CMP configuration status, notice versions, cookie registry and scan alerts.
- Privacy request queue with deadlines and fulfilment status.
- Records of processing (what we collect, why, where it goes, retention).

#### Module 12 — Visitors and audience data \[v2.0\]

- Pseudonymous visitor and session explorer: visits, repeat visits, time on site, paths, vehicles entered, intent stage.
- Segment builder (rules over profile fields, live size estimate split by legal basis: saleable / internal-only).
- Data products catalogue (Tier A/B/C), buyer directory with contract status and permitted uses, export jobs with two-person approval, delivery log, revenue.
- Suppression list version and last propagation to buyers.

#### Module 13 — Ad operations \[v2.1\]

- ads.txt / app-ads.txt editor with validation, network-required-lines check and change history.
- Slot registry (page types, sizes, reserved heights, lazy-load, density) with a live CLS and LCP view per page type.
- Brand-safety settings: blocked categories per network, advertiser URL block list, weekly served-ad sample review.
- Sponsorship scheduler: advertisers, creatives, placements, dates, caps, pricing, approvals, delivery vs booked.
- House-ad library and fallback rules; invalid-traffic alerts.

#### Module 14 — Mobile app \[v2.1\]

- Installs, active users (daily/monthly), retention cohorts (day 1/7/30), crash-free sessions, app ratings and reviews by version.
- Push notifications: reminder delivery and open rates by type; marketing push composer (segment, consent check, frequency cap, quiet hours, preview); opt-in rates for notifications and ATT.
- Releases: versions in the field, minimum supported version (forced update), feature flags and remote config, kill switches.
- Store listing (ASO): title, subtitle, keywords, descriptions, screenshots per locale; review replies.
- Privacy disclosures checklist per release (nutrition label, Data safety, privacy manifest, SDK inventory).

#### Module 15 — AI connector \[v2.1\]

- Calls by tool, client (Claude, ChatGPT, others), day; latency and error rates; top inputs (aggregated: vehicles, sizes, regions).
- Click-throughs and downstream conversions from `utm_medium=ai_connector`.
- API keys and OAuth clients: issue, scope, quota, revoke; per-client rate-limit settings.
- Tool catalogue with versions and deprecation dates; tool description editor (reviewed and versioned).
- Directory listings status per AI platform.

#### Access, security and privacy

- Roles: **Owner** (all), **Marketing** (campaigns, email, content, analytics), **Partner manager** (affiliate modules), **Reseller manager** \[v2.0\] (verification, offer moderation, billing), **Content editor** (content only), **SEO editor** \[v2.0\] (SEO fields, redirects, templates), **Privacy officer** \[v2.0\] (consent, privacy requests, export approvals), **Ad ops** \[v2.1\] (ad operations, sponsorships), **App manager** \[v2.1\] (mobile app, push, releases), **Developer relations** \[v2.1\] (AI connector keys and listings), **Analyst** (read-only, aggregated).
- Sign-in through SSO with mandatory two-factor authentication; session timeout 12 hours; audit log of all changes (who, what, before/after, when) including every data export and every view of a contact record.
- Contact-level personal data (email addresses, lead records) visible only to Owner and Privacy officer; everyone else sees pseudonymous IDs and aggregates.
- Respects visitor consent: non-consented visits counted only through privacy-safe aggregate measures.

#### Admin phasing

| Phase | Admin capabilities |
| --- | --- |
| MVP | Overview dashboard, traffic & top pages, form funnel, partner directory + application tracker, click tracking, link-health checks, content status, catalog basics, roles + 2FA. **\[v2.0\]:** SEO manager core (fields, templates, redirects, robots, sitemaps), email sends/events, consent dashboard, privacy request queue |
| MVP+ \[v2.0\] | Resellers and offers module, email link/topic performance, deliverability health, visitor/session explorer |
| v2 | Network report import + reconciliation, payouts, Search Console data, email campaigns and lifecycle status, UTM builder, ad revenue import, weekly digest. **\[v2.0\]:** reseller billing, strategic pages and SEO audits, segment builder, Tier A/B data products and exports |
| v3 | Segments for marketing, A/B experiments, alerts, outreach tracker, sponsorship management, heatmaps. **\[v2.0\]:** Tier C lead delivery, redemption integrations |
| v2.1 | Ad operations (MVP+), Mobile app module (with app v1), AI connector module (with connector v1) |

### 4.10 Extended assessment and compare-and-contrast \[v2.0\]

**Why:** the one-minute form is deliberately short. Users who are close to buying want to tell us more and weigh options side by side. Extending the assessment improves recommendation accuracy, and the extra answers (budget, timeframe, current tires) are the same signals that make reseller offers and audience insights valuable.

**Entry points:** a "Refine your results (about 2 minutes)" panel directly below the 5 picks; "Compare" checkboxes on every pick and avoid-list card; a "Got a quote from a shop?" link; deep link from the report email.

**Extended questions** (all optional; each shows a one-line "this changes…" hint):

| Question | Input | Effect on results |
| --- | --- | --- |
| Current tires | Brand/model type-ahead, or "Don't know" | Compares against what they have now; flags like-for-like vs upgrade |
| Current tire age | DOT year picker, link to DOT age checker | Urgency: replace now / within 6 months / fine |
| Current tread depth | Measured depth or coin-test result (country's coin) | Urgency and "safe until" estimate |
| Budget | Max per tire or per set, local currency slider | Hard filter with "1 option above budget, shown because…" exception |
| How long keeping the car | Under 1 yr / 1–3 yrs / 3+ yrs | Cost horizon: favours cheaper tires if selling soon, longevity if keeping |
| Noise and comfort sensitivity | Low / Normal / High | Re-weights noise and comfort scores |
| Towing detail | Trailer weight band | Enforces XL/LT and load index margin |
| Winter wheel option | Use alternative (smaller) winter size? | Unlocks cheaper winter set on minus-size wheels from fitment data |
| Wheels/run-flat/TPMS | Confirm run-flat fitted, TPMS present | Filters run-flat, adds TPMS service cost |
| Purchase timeframe | This week / This month / Within 3 months / Just researching | Shown back as a timeline; used for offer relevance and intent stage |

**Requirements**

- `FR-EXT-01` The extended form is a progressive panel on the results page; no page reload. Partial answers are saved to the report as the user goes.
- `FR-EXT-02` Submitting re-runs the engine with base + extended inputs and creates a new **report version** (v1, v2…) linked to the same share token. Older versions remain viewable.
- `FR-EXT-03` A "What changed" summary lists picks that moved in, out, up or down, each with the reason code that caused it (rendered from message files, per 4.8).
- `FR-EXT-04` Budget is applied as a filter after fitment and safety filters; tires failing load/speed/climate safety rules are never shown to meet a budget.
- `FR-EXT-05` All extended inputs are validated with the shared Zod schema client- and server-side; out-of-range values (e.g. tread depth > 15/32") are rejected with plain-English messages.

**Compare and contrast**

- `FR-CMP-01` Compare up to 4 items. Items may be: any of the 5 picks, any avoid-list tire (shown with its "poor fit because…" reason), any other tire that fits the vehicle (search), or a **shop quote**.
- `FR-CMP-02` **Shop quote check:** user types or picks the quoted tire and enters the quoted price (per tire or out-the-door). We report: does it fit and meet OE load/speed; is it suited to their climate; where the price sits against our range (below / within / above); cost per 1,000 miles vs our picks. Unknown tires are accepted as free text with a "we couldn't verify this tire" state.
- `FR-CMP-03` Compare rows: category, 3PMSF/M+S, dry/wet/snow/ice/noise/comfort/efficiency scores, price per tire, set of 4, out-the-door estimate, expected life, cost per 1,000 miles/km, warranty, meets OE load/speed, EV suitability, match score. Best value per row is highlighted; a "Show only differences" toggle hides identical rows.
- `FR-CMP-04` **Plain-English contrast summary** generated by rules from score deltas (e.g. "Tire A should last about 18,000 miles longer; Tire B stops shorter in the rain"). Deterministic and versioned with the engine; no generative text in MVP.
- `FR-CMP-05` **Scenario compare** (separate tab): one all-season set vs all-season + winter set over the "keeping the car" horizon; budget vs premium over 5 years; replace 2 vs 4 (only where the engine allows 2 and with the "new tires go on the rear" rule and AWD warnings).
- `FR-CMP-06` A saved comparison attaches to the report version, is included in the email and PDF, and is shareable by private link.
- `FR-CMP-07` Mobile: compare renders as swipeable columns with a sticky row header; desktop as a table with sticky first column.

### 4.11 Report delivery and consent panel (results page) \[v2.0\]

A "Get this report" panel appears below the picks (and after the compare, if used). It is also reachable from the sticky action bar on mobile.

**Controls (in this order)**

1. **Email me this report** — unticked by default. Ticking reveals an email field (`type="email"`, `autocomplete="email"`, inline validation, common-typo suggestion such as "gmial.com → gmail.com").
2. **Send me tire discount offers from local and online tire sellers** — unticked, independent of the report. Helper text: "Offers come from sellers who pay to be featured. We pick offers that match your tires and area. Up to \[N\] emails a month. Unsubscribe any time." Link to the offers explainer.
3. **Share my vehicle and tire-shopping details with selected partners so they can contact me with offers** — unticked; shown only when the identity-linked lead program (Tier C, 4.18) is live in the user's market. Lists partner categories and links to the current partner list.
4. **I'm 18 or older** — required only when box 2 or 3 is ticked.
5. Short privacy notice line with links to the privacy policy, the "notice of financial incentive" (California, because offers are given in exchange for marketing consent) and "Your Privacy Choices".
6. Button: **Send my report** (or **Save my choices** if only offers were ticked and an email exists).

**Requirements**

- `FR-DEL-01` The report email is sent whether or not offers are ticked. Offers never require the report, and the report never requires offers.
- `FR-DEL-02` If box 2 or 3 is ticked without an email, the email field appears with a prompt; submission is blocked until it is valid.
- `FR-DEL-03` Each ticked box writes a separate row to `consents` with purpose, notice text version (hash), method (checkbox / double opt-in / GPC), source (`results_panel`), report ID, timestamp, truncated IP and user agent. Unticked boxes write nothing; consent is never inferred.
- `FR-DEL-04` **Double opt-in:** required for offers in EU/EEA, UK and Canada markets: the report email carries a "Confirm offers" button and no offers are sent until confirmed. US launch uses single opt-in with a confirmation notice in the first email; switchable per market in admin.
- `FR-DEL-05` Abuse controls: Cloudflare Turnstile token required; max 3 report sends per email address per hour and 10 per day; max 10 per IP per hour; suppression list checked before send (hard bounce, complaint, deleted).
- `FR-DEL-06` On success, the panel shows "Report sent to p•••@example.com" with a "Wrong address?" link that cancels a queued send within 60 seconds.
- `FR-DEL-07` Returning visitors (same browser, consent permitting) see their address prefilled and their current choices; changes write new consent rows (grant or withdraw).
- `FR-DEL-08` The panel works without JavaScript-heavy widgets (native checkboxes and inputs) and meets WCAG 2.2 AA: labels tied to inputs, error messages announced, 44px touch targets.

### 4.12 HTML report email and tailored education links \[v2.0\]

**Build**

- `FR-EML-01` Templates written in React Email, rendered server-side to HTML with inlined CSS, 600px single column, tested in Gmail (web/iOS/Android), Apple Mail, Outlook (Windows and new Outlook), Yahoo. Rendering tests (Litmus or Email on Acid) run in CI on template changes.
- `FR-EML-02` Total HTML size kept under 100 KB so Gmail does not clip it (and hide the unsubscribe link). Images on CDN with absolute URLs, `alt` text on every image, bulletproof (table-based) buttons, dark-mode-safe colours, no JavaScript, no web fonts required for legibility.
- `FR-EML-03` Plain-text alternative generated from the same data. "View in browser" link opens a hosted version via a signed, expiring token.
- `FR-EML-04` PDF is a link to a hosted, signed download (generated on demand, cached 30 days), not an attachment.
- `FR-EML-05` All copy from locale message files (4.8); units, currency and spelling per market.

**Content blocks (in order):** header and one-line summary ("Your 5 tires for \[city\] winters"); "Your car and conditions" (inputs and the conditions card); the 5 picks as compact cards (tier, match, price range, out-the-door, cost per 1,000, top reason); your comparison (if saved); 5 to avoid; your size decoded; **Learn more for your situation**; maintenance plan; top 6 questions with checklist link; **Sponsored offers** (only if opted in and matched, 4.14); "Was this report helpful? Yes / No"; footer.

**Tailored education links**

- `FR-EML-06` Every published content item (term page, guide, tool) carries topic tags from a controlled vocabulary (e.g. `winter`, `3pmsf`, `awd`, `ev`, `load-index`, `towing`, `staggered`, `tread-depth`, `tire-age`, `cost-per-mile`, `alignment`, `rotation`).
- `FR-EML-07` The engine emits reason and condition codes for each report (e.g. `CLIMATE_HEAVY_SNOW`, `AWD_REPLACE_2`, `EV_VEHICLE`, `TOWING_MEDIUM`, `TREAD_LOW`, `TIRE_AGE_OVER_6`, `PRIORITY_PRICE`). An admin-editable mapping table links codes to topics with weights.
- `FR-EML-08` Selection: score each eligible item = Σ(topic weight) × freshness factor (reviewed within 12 months = 1.0, older = 0.7) × novelty (0.3 if this contact already clicked it). Pick the top 3–6, at most 2 per topic, always append the "Before you buy" checklist. Only published, reviewed items in the recipient's locale and market are eligible.
- `FR-EML-09` The first mention of each term in the email body links to its glossary page.
- `FR-EML-10` Each link has a slot ID and content ID and carries UTM parameters (`utm_source=report_email`, `utm_medium=email`, `utm_campaign=report_v{n}`, `utm_content={slot}`) so the admin can report click-through by topic and slot.
- `FR-EML-11` Selection decisions are logged (`email_links`) so we can see which education links were offered, not only which were clicked.

**Compliance and infrastructure**

- `FR-EML-12` Report emails that contain sponsored offers are treated as commercial messages. To keep things simple, **every** report email includes a physical postal address, a working unsubscribe/preferences link and accurate sender and subject lines (CAN-SPAM), and honours unsubscribes within 2 business days (target: immediately).
- `FR-EML-13` Two sending subdomains with separate reputations: `report.` (report and service emails) and `offers.` (offers and lifecycle marketing). SPF, DKIM (2048-bit) and DMARC on both (start `p=none` with reporting, move to `quarantine` then `reject`); optional BIMI later.
- `FR-EML-14` One-click unsubscribe headers (`List-Unsubscribe` with `List-Unsubscribe-Post`, RFC 8058) on all marketing and offer-bearing email, as required by Gmail and Yahoo bulk-sender rules (and Microsoft's equivalent).
- `FR-EML-15` Sending runs as a durable job with an idempotency key (`report_id + version + contact_id + template`), exponential retry, and a status machine: queued → sent → delivered → (opened) → clicked, or bounced / complained / failed.

### 4.13 Reseller portal and coupon program \[v2.0\]

**Who:** tire retailers, installers, mobile fitters, regional chains, online sellers and dealer service departments. Resellers are separate from affiliate networks (4.9 Module 4), though one company can be both; the admin links the two records.

**Where:** `partners.[domain]`, a separate app area in the same codebase with its own authentication realm (organisations, roles and MFA) and row-level security on every reseller table.

**Registration and verification**

- `FR-RSL-01` Sign-up with business email (free-mail domains blocked by default, overridable by admin), email verification, mandatory MFA.
- `FR-RSL-02` Business profile: legal name, trading name, tax ID (EIN/ABN/VAT; encrypted), website, markets, contact, one or more locations (address, geocoded coordinates, service radius, phone, hours), services (fitting, mobile fitting, alignment).
- `FR-RSL-03` Accept current Reseller Terms, Offer Policy and Data Processing Addendum; acceptance stored with version, user, timestamp and IP.
- `FR-RSL-04` Verification: website domain ownership (DNS TXT record or email at the domain), business registry lookup where an API exists, and a manual review queue in admin. Status: `pending → verified → active → suspended → closed`. Only `active` resellers can run offers.
- `FR-RSL-05` Organisation team management: roles Owner, Manager, Analyst; invites; every change written to an audit log visible to the reseller Owner.

**Offers and coupons**

- `FR-RSL-06` Offer types: % off, fixed amount off, amount off a set of 4, buy 3 get 1, free fitting/alignment/TPMS service, mail-in rebate, price match.
- `FR-RSL-07` Offer fields: title, description, terms and conditions, start/end dates, redemption method (online code, in-store code with barcode/QR, link), landing URL (must be on the verified domain), minimum purchase, exclusions, logo (uploaded, reseller warrants rights).
- `FR-RSL-08` Codes: single shared code; **unique code pool** uploaded by CSV (up to 100,000 codes per upload, deduplicated, format-checked) or generated by us with a reseller-defined prefix; pool-low alerts at 10%.
- `FR-RSL-09` Targeting: markets, states/regions, postal-code lists, radius from chosen locations; tire brands, models, categories (all-season, winter…), rim diameters, sizes, vehicle types (EV, SUV, truck), tiers. "Store-wide" is allowed but ranks below specific matches.
- `FR-RSL-10` Limits: total issues, issues per day, budget, per-recipient frequency (default: same offer at most once per 30 days).
- `FR-RSL-11` Validation on save: required fields; end date at least 3 days after start; URL safety check (Safe Browsing API); banned unsubstantiated claims list ("guaranteed lowest price" etc.); terms length limits; preview of how the offer renders in the email.
- `FR-RSL-12` Moderation: every new or edited offer enters `pending_review`; admin approves or rejects with a reason. Trusted resellers (admin flag) get auto-approval for edits that change only dates or codes.

**Reporting, redemption and billing**

- `FR-RSL-13` Dashboard per offer: emails included, unique opens (estimated human), clicks, codes issued, redemptions reported, spend, cost per click and per redemption. Data is aggregated; resellers never see who received an offer unless that person opted into identity sharing (Tier C).
- `FR-RSL-14` Redemption reporting: mark codes redeemed in the portal, upload a CSV, or call the API. Unique codes make attribution exact; shared codes report clicks only.
- `FR-RSL-15` Billing (Stripe Billing): pricing models configurable per reseller — cost per click (default), cost per 1,000 inclusions, flat monthly listing, or cost per reported redemption; prepaid balance with auto top-up; invoices and tax handled by Stripe. Offers pause automatically when the balance or budget runs out.
- `FR-RSL-16` API and webhooks (v2): scoped API keys (hashed at rest), REST endpoints for offers, code pools and redemptions; signed webhooks for `offer.approved`, `offer.rejected`, `offer.paused`, `code.issued`, `offer.clicked`; per-key rate limits.

### 4.14 Offer matching engine (attaching coupons "as fit") \[v2.0\]

Runs when building a report email for a contact with active offers consent, for lifecycle emails, and (v3) for an on-site "Offers near you" module.

- `FR-OFR-01` **Eligibility filters** (all must pass): offer `live`, within dates, budget and caps remaining, reseller `active` and in good standing; offer market = recipient market; recipient postal code inside the offer's area or radius; product applicability intersects the recipient's picks, comparison items or size (store-wide offers pass); recipient not suppressed for this reseller; frequency cap not hit.
- `FR-OFR-02` **Ranking score** = 0.40 relevance (exact tire/size match 1.0 > model 0.8 > brand 0.6 > category 0.4 > store-wide 0.2) + 0.25 value to user (estimated saving ÷ typical set price) + 0.15 proximity (for in-store offers) + 0.10 reseller quality (redemption rate, complaint rate, review status) + 0.10 normalised bid. Weights editable in admin; paid influence capped at 10–20%.
- `FR-OFR-03` Show at most 3 offers, at most one per reseller, under a "Sponsored offers" heading with a one-line explanation of why each matches ("For your 235/60R18 size · 4.2 miles away").
- `FR-OFR-04` Unique codes are assigned at send time inside a database transaction (`SELECT … FOR UPDATE SKIP LOCKED`), tied to the recipient and send, and shown in the email. Unused codes from failed sends are released.
- `FR-OFR-05` Every evaluation is logged (`offer_decisions`: offer, eligible, score, reasons, selected) for audit and reseller disputes.
- `FR-OFR-06` No eligible offers → the block is omitted entirely.
- `FR-OFR-07` **Guardrail:** offers are computed after recommendations and cannot change picks, order, scores or the avoid list. An automated test asserts identical recommendation output with offers on and off.

### 4.15 Email engagement tracking and feedback \[v2.0\]

**Signals captured**

| Signal | Source | Notes |
| --- | --- | --- |
| Sent, delivered, delivery delayed | ESP webhooks | Signed webhooks (verify signature), idempotent ingest keyed by provider event ID |
| Bounced (hard/soft), complained | ESP webhooks; feedback loops | Hard bounce or complaint → suppression immediately |
| Opened | Tracking pixel via ESP | Flag machine opens (Apple Mail Privacy Protection proxy, security scanners); report "total opens" and "estimated human opens" separately |
| Clicked | First-party redirect `/e/c/{token}` | Token = signed send ID + link ID; logs click, then 302 to target with UTM; flag bot clicks (clicked within 2s of delivery, all links clicked at once, known scanner ranges, HEAD requests) |
| Return visit | Site events with `utm_source=report_email` + click token | Links the email click to the resulting session when consent allows |
| Conversions | Affiliate `/go/` clicks, offer code reveals, redemptions | Attributed to send, slot and offer |
| Unsubscribed / preferences changed | One-click header, footer link, preference centre | Reason captured optionally |
| Feedback | "Was this helpful? Yes / No" links; follow-up survey at 14 and 30 days ("Did you buy tires? Which?"); monitored reply-to mailbox | One-click answer recorded without login; optional comment page |

**Requirements**

- `FR-TRK-01` Webhook endpoint verifies signatures, rejects replays older than 5 minutes, stores raw payloads for 30 days, and writes normalised rows to `email_events` (Postgres) and the analytics store.
- `FR-TRK-02` Click redirect resolves in under 100 ms at the edge, never exposes the destination in a way that enables open redirects (destination must match the logged link), and degrades to a plain redirect if logging fails.
- `FR-TRK-03` Open tracking is disabled for recipients in markets where it requires consent (EU/EEA/UK under ePrivacy rules) unless they consented; click tracking there is aggregate-only unless consented.
- `FR-TRK-04` Engagement-based sunset: marketing emails stop after 180 days without a human click or site visit; a single re-permission email is sent first.
- `FR-TRK-05` Deliverability monitoring: daily import of Google Postmaster Tools and Microsoft SNDS data; alerts when complaint rate > 0.1% (hard limit 0.3%), hard-bounce rate > 2%, or domain reputation drops.
- `FR-TRK-06` Metrics shown in admin: delivery rate, bounce and complaint rates, human open estimate, click rate, click-to-open, clicks by slot and by education topic, offer click and redemption rates, unsubscribe rate and reasons, helpfulness score.

### 4.16 SEO management from the admin \[v2.0\]

**Strategy:** technical SEO lives in code (server rendering, speed, structured data components, sitemaps); editorial SEO lives in a CMS that editors change from the admin and that publishes without a deploy. The CMS is **Payload CMS** embedded in the same Next.js app and stored in the same Neon Postgres database (separate `cms` schema). On publish, a webhook calls on-demand revalidation (`revalidateTag`) so changes are live in seconds.

**Requirements**

- `FR-SEO-01` **Per-page fields** on every content item and route: SEO title (with character and pixel-width meter), meta description, canonical override, robots (index/noindex, follow/nofollow), Open Graph/social title, description and image (auto-generated share image if blank), breadcrumb label, sitemap inclusion. Hreflang is generated from the locale config, not edited by hand.
- `FR-SEO-02` **Templates per page type** (term, guide, tool, vehicle, size): title and description patterns with variables, e.g. `Best tires for {year} {make} {model} ({size}) | Tires & Tread`. Page-level values override the template. Live search-result preview for desktop and mobile.
- `FR-SEO-03` **Strategic pages register:** priority pages (hub, top terms, top vehicles, tools) with target keyword, secondary keywords, intent, owner, priority, status, review date and Search Console metrics (clicks, impressions, average position, trend). Pages losing more than 20% clicks over 28 days are flagged for refresh.
- `FR-SEO-04` **Internal linking:** editors manage "Related" modules per page; the system suggests links from pages sharing topic tags and target keywords and flags orphan pages (no internal links in).
- `FR-SEO-05` **Redirect manager:** 301, 302, 410; exact and regex rules; CSV import/export; loop and chain detection; automatic 301 when a slug changes; hit counters. Rules sync to Vercel Edge Config so middleware applies them without a database call.
- `FR-SEO-06` **Robots and crawlers:** robots.txt editor per environment (staging is always `Disallow: /`) with validation; toggles per AI crawler (e.g. GPTBot, ClaudeBot, Google-Extended, PerplexityBot, CCBot); optional `llms.txt`.
- `FR-SEO-07` **Sitemaps:** generated per locale and page type with accurate `lastmod` from content update times; programmatic pages are only included after passing the quality gate (`FR-SEO-10`).
- `FR-SEO-08` **Structured data:** JSON-LD components for Organization, WebSite, BreadcrumbList, Article (with author, reviewer, published and modified dates) and DefinedTerm for glossary entries; editors fill fields, never raw JSON. Validated on save; link to Google's Rich Results Test. FAQ and HowTo markup are not relied on for rich results (Google restricted FAQ rich results to authoritative government and health sites and retired HowTo rich results). No self-serving review markup.
- `FR-SEO-09` **Index notifications:** IndexNow ping (Bing and others) on publish, update or delete; Google discovers via sitemaps; Search Console API pulls performance daily.
- `FR-SEO-10` **Programmatic quality gate:** vehicle and size pages start `noindex` and are indexed only when they have a minimum set of unique data (sizes, OE ratings, climate notes, at least 3 eligible tires) and an editor approves; protects against scaled-content penalties.
- `FR-SEO-11` **Nightly SEO audit job:** missing or duplicate titles and descriptions, canonical conflicts, noindex on strategic pages, broken internal links, redirect chains, orphan pages, missing structured data, Core Web Vitals per page type (CrUX API). Findings appear in admin with severity, owner and resolution tracking.
- `FR-SEO-12` **Workflow:** draft → in review → scheduled/published; version history with one-click rollback; role permissions (Content editor and SEO editor can edit; Marketing or Owner publishes strategic pages).

### 4.17 Cookie and consent management \[v2.0\]

**Platform:** a Google-certified CMP that supports IAB TCF 2.2, the IAB Global Privacy Platform (GPP) for US state signals, Google Consent Mode v2 and Global Privacy Control. Candidates to evaluate: Didomi, Usercentrics, OneTrust, CookieYes. Selection criteria: script weight (target \< 30 KB, async, no layout shift), geo-rules, API for server-side consent reads, consent log export, auto cookie scanning, cost.

**Categories**

| Category | Examples | Default (EU/UK) | Default (US privacy states) |
| --- | --- | --- | --- |
| Strictly necessary | Session, security, load balancing, Turnstile, consent cookie | Always on | Always on |
| Preferences | Units, saved vehicle, prefilled email | Off until accepted | On (notice) |
| Analytics | GA4, PostHog, first-party events beyond essential counts | Off until accepted | On (notice), opt-out available |
| Advertising | AdSense and ad partners (TCF vendors) | Off until accepted | On; opt-out of targeted ads available |
| Audience data sharing ("sale/share") | Data program Tiers B/C | Off unless explicitly opted in | On with notice; opt-out via "Your Privacy Choices" and GPC |

**Requirements**

- `FR-CKE-01` Region-aware experience from edge geolocation: EU/EEA/UK/Switzerland get an opt-in banner with **Accept all**, **Reject all** and **Customize** of equal prominence; nothing non-essential loads before a choice. US visitors get a notice, a persistent **Your Privacy Choices** link with the opt-out icon, and an opt-out toggle for sale/sharing and targeted ads. Quebec gets opt-in for profiling and tracking technologies. Other markets get notice plus settings.
- `FR-CKE-02` **GPC:** a `Sec-GPC: 1` header or `navigator.globalPrivacyControl` is honoured automatically as an opt-out of sale, sharing and targeted advertising (required in Colorado, California and several other states), shown to the user as "Your browser's privacy signal was honoured".
- `FR-CKE-03` Consent state lives in a first-party cookie (consent ID, choices, notice version) and is mirrored server-side (`cookie_consents`). Middleware reads it so server-side tags, the event pipeline (4.18) and the data program enforce it, not only the browser.
- `FR-CKE-04` All non-essential scripts load only through a consent-aware tag loader; hardcoded third-party `<script>` tags are blocked by a lint rule and a CI check.
- `FR-CKE-05` Google Consent Mode v2 defaults to denied for `ad_storage`, `analytics_storage`, `ad_user_data` and `ad_personalization` in EEA/UK and updates on choice; TCF string passed to ad tags.
- `FR-CKE-06` A preference centre (modal) is reachable from every page footer; withdrawing is as easy as giving. Re-prompt after 12 months or when purposes/vendors change (notice version bump).
- `FR-CKE-07` **Cookie registry:** every cookie and storage key declared with name, provider, category, purpose and duration. A weekly crawler scans production pages; undeclared cookies raise an admin alert. The public cookie table in the cookie policy is generated from the registry.
- `FR-CKE-08` Banner accessibility: focus moves into the banner, keyboard-operable, screen-reader labels, 4.5:1 contrast; on mobile it never covers the form's primary button.
- `FR-CKE-09` Consent records retained for as long as the consent is relied on plus the limitation period set by counsel; exportable as proof.

### 4.18 Visitor data platform and audience data program \[v2.0\]

**Requirement as stated:** capture detailed visitor data (vehicle, vehicle age, budget, location, IP, time on site, clicks, repeat visits) so it can be sold to data brokers and other buyers.

**Design position:** we collect broadly through our own first-party pipeline, use everything internally for product and reseller relevance, and *sell* in three tiers matched to the permission we hold. This keeps the revenue stream legal across launch markets, protects deliverability, ad-network and affiliate relationships, and avoids the patterns regulators have recently penalised (selling browsing or location data without clear, affirmative consent, or contrary to privacy promises). Buyers mostly want segments and in-market signals, not raw logs, so the tiering costs little revenue.

**Collection layer**

- `FR-DAT-01` First-party JavaScript SDK (\< 8 KB gzipped) plus server-side events. Common envelope: event ID, timestamp, `anon_id`, `session_id`, `contact_id` (if known), event name, page path, referrer, UTM fields, device type, OS, browser, viewport, language, time zone, consent snapshot (analytics, ads, sale/share, GPC).
- `FR-DAT-02` Events captured: page views; engaged time (visibility-aware heartbeats every 15s); scroll depth milestones; clicks on elements tagged `data-track`; form step and field interactions (field focus/complete timings, **never keystrokes or free-text content**); vehicle and size selections; results interactions; extended-assessment answers; compare actions; shop quotes; tool usage; site search; outbound affiliate and offer clicks; email-click landings; consent changes.
- `FR-DAT-03` IP handling: at ingest, IP is enriched to coarse location (country, region, city, postal prefix, DMA/metro) via MaxMind GeoIP2, then stored only as a salted hash (salt rotated every 90 days) for deduplication and fraud. Raw IP is kept only in security logs for 30 days.
- `FR-DAT-04` Identity: `anon_id` in a first-party cookie (subject to 4.17); `contact_id` linked when the user submits an email or lands from an email click token. Cross-device linking is deterministic only (email/click token). **No device fingerprinting.**
- `FR-DAT-05` Bot filtering: known-bot lists, Turnstile results and behavioural heuristics produce a `bot_score`; flagged traffic is excluded from profiles, segments, insights and ad/affiliate reporting.
- `FR-DAT-06` Consent enforcement at ingest: events from visitors who declined analytics (where consent is required) are dropped except strictly necessary counts; `sale_allowed = false` is stamped on events from GPC/opt-out/unknown-age visitors so downstream jobs cannot include them.

**Pipeline and storage**

- Browser/server → `/api/collect` (edge; schema-validated, consent-checked, enriched) → queue (Upstash QStash at launch; Kafka-compatible stream such as Redpanda if volume demands) → **ClickHouse Cloud** (raw events, sessions, aggregates). Nightly and hourly jobs build profiles and segments into Postgres.
- `FR-DAT-07` Profile (per `anon_id`, merged into `contact_id` when known): vehicles (year, make, model, trim), vehicle age and class (SUV, EV, truck), tire size, driving mix, priorities, budget band (explicit budget > inferred from tiers clicked), purchase timeframe and intent stage (research → comparing → ready), intent score, climate zone, coarse location (state, postal prefix, DMA), visit count and recency, email engagement, consent flags, `minor_flag`.
- `FR-DAT-08` Repeat visits, sessions, time on site and click paths are queryable in admin (pseudonymous visitor and session explorer). Contact email addresses are visible only to Owner and Privacy officer roles.

**Data products (what we sell)**

| Tier | Product | Contents | Legal basis / gating | Delivery |
| --- | --- | --- | --- | --- |
| **A — Aggregated insights** | Demand reports and API (e.g. winter-tire intent by metro by week; budget bands by vehicle class; shop-quote price benchmarks) | Counts and rates only; minimum cell size 50 with small-cell suppression; no IDs | De-identified/aggregate data with a public commitment not to re-identify and contractual bans on re-identification | Dashboards, CSV, API subscriptions |
| **B — Pseudonymous audience segments** | e.g. "In-market for winter tires · SUV · Denver metro · mid budget · next 30 days" | Segment membership keyed by hashed email or partner match key; coarse geography only | US: notice at collection + opt-out (Do Not Sell/Share link, GPC). EU/UK: explicit opt-in only. Excludes minors, opted-out and unknown-age records | Clean room or data marketplace (e.g. LiveRamp, AWS Clean Rooms, Snowflake) — buyer never receives a raw file |
| **C — Identity-linked leads** | Email + vehicle + size + timeframe + postal prefix for a named partner category | Per-person record | Explicit opt-in (checkbox 3 in 4.11), 18+ attestation, named partner categories | Reseller portal or secure API to vetted buyers |

**Never sold:** raw IP addresses; precise geolocation (anything finer than postal prefix/metro); full identity-linked clickstreams; free-text inputs; data from people who opted out, sent GPC, are flagged under 18, or withdrew consent; inferred sensitive characteristics (e.g. financial distress).

**Governance requirements**

- `FR-DAT-09` **Buyer onboarding:** business verification, declared use case, signed data licence (purpose limits, no re-identification, no onward sale without flow-down terms, security standards, deletion propagation within 15 days, audit rights). Prohibited uses: eligibility decisions for credit, insurance, employment or housing (would bring FCRA obligations), discriminatory targeting, surveillance, sale to people-search services.
- `FR-DAT-10` **Export workflow:** every export is a recorded job (buyer, product, segment, record count, legal basis per record group, suppression list version, destination, checksum). Exports of Tier B/C need two approvals (Owner + Privacy officer).
- `FR-DAT-11` **Suppression at export time**, not only at collection: opt-outs, GPC, deletions, minors and withdrawn consents are removed using the latest suppression list; deletions after export are propagated to buyers via notice API or file.
- `FR-DAT-12` **Disclosures:** privacy policy lists categories collected, purposes, categories of buyers, whether data is "sold" or "shared", retention per category and rights; notice at collection on the form and results panel; California notice of financial incentive for offers.
- `FR-DAT-13` **Data broker registration review** before Tier B/C launch: state registries (e.g. California, Texas, Oregon, Vermont) generally target businesses selling data about people they have no direct relationship with; we do have a direct relationship, but counsel should confirm per state and per product.
- `FR-DAT-14` **Retention:** raw events 13 months rolling; sessions and aggregates indefinitely (aggregate only); profiles deleted after 24 months of inactivity; email events 24 months; security logs 30–90 days; consent records per `FR-CKE-09`.

### 4.19 Privacy rights and requests \[v2.0\]

- `FR-PRV-01` Self-service privacy centre: access/export, delete, correct, opt out of sale/sharing/targeted ads, withdraw marketing, limit use (where applicable), and appeal a decision (required in states such as Colorado and Virginia).
- `FR-PRV-02` Verification: email magic link for email-linked data; browser-scoped requests (cookie ID) for anonymous data; authorised-agent flow for California.
- `FR-PRV-03` Request queue in admin with statutory clocks (generally 45 days, extendable once), templated responses, and automated fulfilment jobs across Postgres, ClickHouse, ESP, CMS form data, reseller lead deliveries and buyers.
- `FR-PRV-04` Deletion leaves a hashed tombstone in the suppression list so the person is not re-added by imports or later events, unless they come back and opt in again.
- `FR-PRV-05` Request metrics retained (counts, median response time) for annual disclosure where required.

### 4.20 Advertising and ad operations \[v2.1\]

**Why:** sections 8.1–8.3 covered which networks to join and where ads go. Running ads well also needs the operational layer networks expect (authorised-seller files, brand safety, consent signals), control over sponsorships we sell ourselves, and guardrails that protect page speed and user trust.

**Model by stage**

| Stage | Ad stack | Who controls the stack |
| --- | --- | --- |
| Launch | Google AdSense (Auto ads off; manual slots only) | Us |
| \~1k–25k sessions/month | Journey by Mediavine or Raptive (when eligible) | Managed network: their script, header bidding and demand. Check their terms on direct-sold sponsorships and other ad tags before signing |
| Direct-sold sponsorships | House-rendered sponsor units from our own campaign scheduler; move to Google Ad Manager if direct-sold volume grows | Us |
| Mobile app | No ads at app launch; Google AdMob considered later | Us |

**Requirements**

- `FR-ADS-01` **ads.txt / app-ads.txt manager:** lines stored per network in admin, served at `/ads.txt` (and `app-ads.txt` on the developer website listed in the app stores). Validates syntax, flags duplicates, and records who changed what. Nightly check compares our file with each network's required lines and alerts on missing entries.
- `FR-ADS-02` **Slot registry:** each ad slot defined once (ID, page types, position, sizes, reserved height per breakpoint, lazy-load distance, max per page) and rendered by the `AdSlot` component. Hard rules enforced in code: no ads on the form, in recommendation cards, in the compare table, in the consent banner or privacy pages; results page max 2 units, both below the picks.
- `FR-ADS-03` **Density and speed budget:** ad content never exceeds 30% of the main column on mobile; reserved space prevents layout shift (CLS budget ≤ 0.1 per page type); ads load after the main content; refresh only when in view, at most every 30 seconds and only where the network's policy allows. A Core Web Vitals regression on any page type blocks new slot changes until fixed.
- `FR-ADS-04` **Brand safety and category blocking:** blocked categories configured in each network (e.g. gambling, payday and high-interest loans, dating, political, alcohol, get-rich-quick, sensational content); advertiser URL block list maintained in admin (including any brand or retailer we've agreed to exclude). Weekly sample of served ads (screenshots from the synthetic checks) reviewed in admin.
- `FR-ADS-05` **Consent-aware delivery:** TCF 2.2 string and Google Consent Mode v2 passed to ad tags (4.17); declined personalisation → non-personalised ads; US opt-out or GPC → restricted data processing flag and no personalised ads. Ads are never loaded on pages where a visitor is known or flagged to be under 13.
- `FR-ADS-06` **Direct-sold sponsorships:** campaign scheduler in admin for fixed placements — homepage sponsor strip, "Presented by" on a guide or tool, newsletter/lifecycle email sponsor slot, seasonal takeover (e.g. "Winter tire season, presented by \[BRAND\]"). Fields: advertiser, creative (image + text, alt text), landing URL, dates, markets, page types, impression cap, flat fee or CPM, approval. Delivery tracked first-party (impressions in view, clicks). Sponsor units are labelled "Sponsored" and are never placed inside recommendations; sponsors cannot be recommended because of the sponsorship (same guardrail as offers).
- `FR-ADS-07` **House ads:** when a slot is unfilled or blocked by consent, show our own promotions (app download, a tool, the checklist) so slots never collapse into blank space.
- `FR-ADS-08` **Invalid traffic protection:** staff IPs excluded from ad delivery; bot-scored sessions (4.18) excluded from house and sponsor counts; no incentivised traffic; no ads on pages served to the synthetic monitors; alert when click-through rate on any slot exceeds three times its 28-day median (possible invalid clicks).
- `FR-ADS-09` **Labelling:** every unit marked "Advertisement" or "Sponsored"; sponsored editorial content follows FTC native-advertising guidance (clear label at the top, not only in the footer).
- `FR-ADS-10` **Reporting:** network earnings import (existing Module 5) plus first-party viewable impressions, CTR by slot, sponsor delivery against booked caps, RPM by page type, and ad load vs bounce/engaged-time correlation so we can see when ads start costing engagement.

### 4.21 Mobile app \[v2.1\]

**Decision:** a native app built with **React Native + Expo** (TypeScript), released for iOS and Android, plus a lightweight **progressive web app** manifest on the website so mobile web users can "add to home screen". The app shares the web's Zod schemas, API client, i18n message files and engine (via the API), so features are built once on the server and twice only in the UI.

**Why native rather than PWA only:** the app's value is ownership after the purchase — reminders by push notification, a saved garage, the camera reader, and coupon codes at the counter. iOS push for PWAs requires the user to add the site to the home screen first, and camera OCR and wallet-style coupon display are far better native. The website stays the acquisition channel (SEO, AI connector); the app is the retention channel.

**Feature scope**

| Area | MVP app (v2) | Later (v3) |
| --- | --- | --- |
| Account | Optional: email magic link; use without an account on one device. Account adds sync across devices | Sign in with Apple and Google (Sign in with Apple becomes mandatory on iOS once any third-party social login is offered) |
| Garage | Multiple vehicles; add by year/make/model, tire size or **VIN scan** (barcode on door jamb/windshield, decoded via NHTSA vPIC) | Plate lookup where a licensed data source exists |
| Assessment | Same form, extended assessment, results, compare and shop-quote check as web, rendered natively; last reports cached offline | AI plain-English summary |
| Camera | **Sidewall reader:** on-device text recognition (Apple Vision / Google ML Kit) reads tire size and DOT date code; user confirms; manual fallback | Tread-depth estimate from photo (research spike only) |
| Tire log | Installed tires per vehicle (model, date, mileage, shop, price, optional receipt photo), tread checks, pressure checks, rotations | Shareable service history |
| Reminders | Rotation (by stated mileage), winter swap (by climate and first-frost forecast), tire age (6 years), tread re-check, price drop on saved tires, offer expiry | Odometer from connected-car APIs |
| Offers wallet | Saved codes with barcode/QR for the counter, expiry, seller distance; "near me" sellers on a map (location permission optional; postal code otherwise) | Redemption confirmation at counter |
| Shop scorecard | Full scorecard mode offline | — |
| Learn | Education content from the CMS, cached; links to web for long reads | Audio summaries |

**Requirements**

- `FR-APP-01` **Stack:** Expo (managed workflow) with Expo Router, EAS Build and EAS Submit for store releases, EAS Update for over-the-air JavaScript updates (only within store-approved behaviour; native changes go through store review).
- `FR-APP-02` **API:** the app talks only to a versioned mobile API (`/api/v1/…`, 7.4) with short-lived access tokens and refresh tokens stored in the secure keystore (iOS Keychain / Android Keystore). Minimum supported app version enforced by the API (forced-update screen).
- `FR-APP-03` **Accounts:** optional consumer accounts (email magic link). Anonymous device data merges into the account on sign-in. **In-app account deletion** is required by both stores and runs the same deletion pipeline as 4.19.
- `FR-APP-04` **Push notifications:** Expo Notifications over APNs and FCM; reminders scheduled server-side by Inngest (so they survive reinstall and sync across devices) with local notifications as offline fallback. Notification permission requested in context (after the user creates their first reminder), never at first launch. Per-type toggles, quiet hours, max 4 marketing-type pushes per month; offer pushes require the offers consent from 4.11.
- `FR-APP-05` **Tracking and consent in the app:** same event schema and collector as the web (4.18), sent in batches. First-launch privacy screen mirrors the region rules in 4.17. On iOS, any sharing of a user's data with data brokers or ad networks for advertising counts as "tracking" under Apple's rules and requires the **App Tracking Transparency** prompt; if the user declines, that user is `sale_allowed = false` for Tier B/C and no identifier (including hashed email) is shared for tracking. On Android, declare the advertising ID permission only if used, show a prominent disclosure and get consent before sharing data for advertising, and honour advertising-ID deletion.
- `FR-APP-06` **Store disclosures:** App Store privacy "nutrition label", Google Play Data safety form and Apple privacy manifest (`PrivacyInfo.xcprivacy`, including third-party SDKs) generated from the same data inventory as the privacy policy and reviewed at every release that adds an SDK or data type. Mismatches block release.
- `FR-APP-07` **Deep links:** Universal Links (iOS) and App Links (Android) for report share links, email links and offers; if the app is installed, links open the matching screen, otherwise the website.
- `FR-APP-08` **Offline:** last 5 reports, garage, tire log, saved offers and scorecard available offline; writes queue and sync when online, with last-write-wins conflict handling per record.
- `FR-APP-09` **Quality:** cold start \< 2 s on mid-range Android; crash-free sessions ≥ 99.5% (Datadog RUM mobile with crash reporting, matching the web observability stack); accessibility with Dynamic Type/font scaling, VoiceOver and TalkBack labels, 44 pt targets, 4.5:1 contrast.
- `FR-APP-10` **Release process:** TestFlight and Play internal testing; staged rollout (Play) and phased release (iOS); feature flags and remote config from the admin; kill switch per feature.
- `FR-APP-11` **No in-app purchases** and no ads at app launch; coupons are seller offers, not digital goods, so store payment rules don't apply.
- `FR-APP-12` **App store listing (ASO):** title, subtitle, keywords, descriptions, screenshots and preview text per locale managed in admin (Module 14) and pushed through store APIs where possible; review monitoring and replies.

### 4.22 AI platform connector \[v2.1\]

**What:** a public **remote MCP server** at `mcp.[domain]` so AI assistants (Claude, ChatGPT and any MCP-compatible client) can call the Tires & Tread engine directly when someone asks "what tires should I get for my 2019 CR-V in Minneapolis?". Answers carry links back to the site, so the connector is an acquisition channel for AI search, alongside the SEO work.

**Tools (v1)**

| Tool | Input | Returns |
| --- | --- | --- |
| `decode_tire_size` | Size string (e.g. `235/60R18 103H`) | Each part explained, load and speed limits, link to decoder |
| `recommend_tires` | Vehicle (year/make/model/trim) or size; country + postal code; driving mix; up to 2 priorities; annual distance; optional budget | Top 5 picks with tier, category, key ratings, price range, top reasons, the avoid-list reasons, `report_url` |
| `compare_tires` | 2–4 tire IDs from a recommendation, plus vehicle context | Row-by-row comparison and plain-English contrast summary |
| `check_shop_quote` | Vehicle or size, quoted tire, price, price basis, location | Fit, climate suitability, fair-price position, cost per 1,000 miles |
| `explain_term` | Term (e.g. "treadwear", "3PMSF") | Definition, why it matters, page link |
| `get_maintenance_plan` | Vehicle, tire category, annual distance, climate | Rotation, pressure, alignment, replacement guidance |
| `find_offers` | Postal code, size | Live public seller offers, clearly marked sponsored; no personal data required or collected |

Also exposed: glossary entries as MCP **resources**, and a "Help me choose tires" **prompt** template.

**Requirements**

- `FR-AI-01` Built with the official MCP TypeScript SDK, Streamable HTTP transport, hosted on Vercel behind the same edge protections; stateless request handling so it scales with the site.
- `FR-AI-02` Tools call the same engine service and engine version as the website, so an assistant and the site never disagree. **Offers and sponsorships cannot influence tool results** — the same automated guardrail test runs against the MCP responses.
- `FR-AI-03` Responses return structured content (typed JSON matching published output schemas) plus a concise text summary, units and currency per market, and attribution ("Recommendations from Tires & Tread") with canonical links carrying `utm_source={client}&utm_medium=ai_connector`.
- `FR-AI-04` **Access tiers:** anonymous read-only access with per-IP and per-client rate limits (e.g. 60 calls/hour); free registered API keys with higher quotas; **OAuth 2.1** per the MCP authorization spec for user-linked tools in v2 (`save_to_garage`, `email_my_report`), which reuse the consent flows of 4.11 — an assistant can never tick a consent box on the user's behalf; the email tool returns a confirmation link the user must open.
- `FR-AI-05` **Data handling:** tool arguments (vehicle, postal code, priorities) are logged pseudonymously for quality and aggregate demand insights (Tier A only); they are never added to sellable profiles or segments, because the user never saw our notice. No free-text prompts are requested or stored.
- `FR-AI-06` **Safety:** strict input schemas (Zod), output size limits, no tool that fetches arbitrary URLs, tool descriptions written as plain factual descriptions and version-controlled (no instructions aimed at the model beyond what the tool does), errors returned as structured messages without stack traces.
- `FR-AI-07` **Versioning:** tool names and schemas versioned; breaking changes ship as new tool versions with a 90-day deprecation window announced in the server's tool descriptions and developer page.
- `FR-AI-08` **Distribution:** public developer page ("Use Tires & Tread in your AI assistant") with setup instructions per client; submissions to AI platform directories as their programs allow (e.g. Anthropic's connectors directory; an app for ChatGPT built on the same MCP server, with an optional compare-table UI component); an OpenAPI description of the same endpoints for non-MCP integrations. Check each platform's current submission requirements before applying.
- `FR-AI-09` **Telemetry:** per call: client name and version (from MCP `initialize`), tool, latency, result size, errors, cache hit; downstream: site sessions and affiliate/offer clicks attributed to `utm_medium=ai_connector`.
- `FR-AI-10` **Testing:** golden scenarios from the engine test suite replayed through the MCP server in CI; MCP Inspector checks; periodic manual evaluation of how major assistants choose and phrase tool results.
- `FR-AI-11` **Commercial (v3):** paid API plans for B2B partners (dealer sites, fleet tools) using the same server with higher quotas and SLAs; billing via Stripe.

---

## 5. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Performance | Form page LCP \< 2.0s on mid-range mobile; JS for form \< 120 KB gzipped (CMP and event SDK included in budget); no ads on the form; event collection never blocks rendering (`sendBeacon`/`fetch keepalive`) |
| Accessibility | WCAG 2.2 AA across site, consent banner, emails (semantic tables, alt text, 14px+ body) and reseller portal |
| Reliability | 99.9% availability for site and collection endpoint; report email p95 delivered to ESP within 60s of request; durable jobs with retries and dead-letter queues; event ingest tolerates 10× traffic spikes via queue buffering |
| Privacy \[v2.0\] | Privacy by design: purpose-tagged data, consent and suppression enforced server-side, emails stored as normalised SHA-256 hash for lookup plus envelope-encrypted original (KMS), IPs hashed after enrichment, retention jobs per 4.18, deletion within statutory deadlines, no fingerprinting |
| Security | Rate limiting, bot protection, signed share and click tokens, secrets in platform vault, dependency and container scanning, row-level security on reseller tables, scoped API keys, signed webhooks, third-party penetration test before reseller portal launch, least-privilege database roles per service |
| Data integrity \[v2.0\] | Append-only consent and export logs; idempotent webhook and event ingest; Neon point-in-time recovery (7+ days) and daily logical backups to separate storage; schema migrations tested on a Neon branch |
| Deliverability \[v2.0\] | Complaint rate \< 0.1%, hard bounces \< 2%, DMARC aligned on all sending domains, one-click unsubscribe processed immediately |
| SEO | Server-rendered pages, structured data, sitemaps per locale, canonical tags, fast pages; CMS changes live within 60s via on-demand revalidation |
| Observability \[NEW\] | Real-user monitoring on form funnel, error tracking, synthetic checks on form submit, email send and click redirect, job monitoring for price/data refreshes, ingest lag and webhook failure alerts |
| Data freshness | Prices refreshed daily; "prices as of \[date\]" shown; catalog changes logged; profiles hourly; segments nightly |
| Mobile \[v2.1\] | Cold start \< 2 s on mid-range Android; crash-free sessions ≥ 99.5%; core features offline; Dynamic Type, VoiceOver, TalkBack |
| AI connector \[v2.1\] | p95 tool latency \< 800 ms (cached \< 150 ms); 99.9% availability; strict schemas; per-client quotas |
| Ads \[v2.1\] | CLS ≤ 0.1 on ad-bearing page types; ads load after main content; no ads on form, picks, compare, consent or privacy pages |

---

## 6. Data requirements and sources

| Dataset | Use | Candidate sources | Notes |
| --- | --- | --- | --- |
| Vehicle → tire fitment | Sizes, OE load/speed ratings, staggered setups | Licensed fitment APIs (e.g. Wheel-Size API) or tire-industry fitment data vendors; NHTSA vPIC for VIN decode (v2) | Biggest dependency; evaluate coverage, licence terms, international data |
| Tire catalog & specs | Sizes, load/speed, UTQG, 3PMSF, M+S, warranty | Manufacturer spec sheets, retailer product feeds via affiliate networks, NHTSA UTQG ratings | Normalise into one global product table |
| EU tire label data | Wet grip, rolling resistance, noise, snow/ice | EU EPREL public database | Strong free structured data for EU/UK phases |
| Prices | Price ranges | Affiliate network product feeds/APIs | Show ranges + timestamp; price bands in thin markets |
| Climate | Snow, freeze, rain, heat profile | NOAA climate normals (US); global gridded climate datasets (e.g. ERA5-based) for other markets | Precompute per postal code / grid cell |
| Postal geocoding | Postal code → coordinates | GeoNames postal data or a geocoding API |  |
| Recalls | Exclude recalled lines | NHTSA recall data; EU Safety Gate | Nightly sync |
| Legal rules | Tread minimums, winter laws | Curated table, reviewed quarterly | Cite official sources on pages |
| Our own feedback \[NEW\] | Real-world satisfaction | Post-purchase survey emails | Becomes a long-term competitive moat |

**Rule:** never copy third-party test scores or reviews (Consumer Reports, Tire Rack tests, etc.). Link to them instead.

---

## 7. Implementation stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js (App Router) + TypeScript** | SSR/SSG/ISR for SEO, one codebase for site, admin, CMS and reseller portal |
| Hosting | **Vercel** | Edge geolocation (country/region for consent rules), middleware, preview deploys, cron, Edge Config for redirects |
| Operational database | **Neon Postgres** + Drizzle ORM; schemas `app`, `cms`, `partners`, `email`, `privacy`, `audience`, `admin` | Relational data with foreign keys and transactions (code issuance, consent logs); branching for safe migrations; point-in-time recovery |
| Analytics store \[v2.0\] | **ClickHouse Cloud** | High-volume event and email-event analytics, sessions and aggregates; keeps heavy queries off Postgres |
| Event queue \[v2.0\] | Upstash QStash at launch → Kafka-compatible stream (e.g. Redpanda) if volume requires | Buffers spikes; decouples collection from storage |
| Geo enrichment \[v2.0\] | MaxMind GeoIP2 (city/postal) | Coarse location from IP at ingest; IP then hashed |
| Cache / rate limit | Upstash Redis | Results caching, rate limiting, idempotency keys |
| Background jobs | Vercel Cron + durable job runner (Inngest) | Price refresh, recall sync, email sends, webhook processing, offer matching, profile/segment builds, exports, privacy-request fulfilment, SEO audits, cookie scans |
| Content and SEO \[v2.0\] | **Payload CMS** embedded in the Next.js app, Postgres-backed | Editors manage content, SEO fields, templates, redirects and robots from the admin; on-demand revalidation on publish; replaces the MDX-in-repo plan |
| i18n | next-intl (English message files at launch) + Intl APIs; Crowdin/Lokalise later | Unchanged from v1.1 |
| Email \[v2.0\] | Resend (or Postmark message streams) + React Email; separate `report.` and `offers.` sending subdomains; webhooks verified via signature | HTML + text emails, events for tracking, reputation separation |
| Email QA \[v2.0\] | Litmus or Email on Acid in CI; Google Postmaster Tools; Microsoft SNDS | Rendering and deliverability |
| PDF | Server-side React-PDF, hosted behind signed URLs | Linked from the email instead of attached |
| Forms/validation | React Hook Form + Zod | Shared validation client/server (incl. extended assessment) |
| Styling | Tailwind CSS + small component library | Fast, consistent |
| Bot protection | Cloudflare Turnstile | Invisible, privacy-friendly; required on report send and reseller sign-up |
| Consent \[v2.0\] | Google-certified CMP with TCF 2.2, GPP, Consent Mode v2, GPC (evaluate Didomi, Usercentrics, OneTrust, CookieYes) | Region-aware consent; server-readable state |
| Analytics | GA4 + PostHog + Search Console API + first-party event pipeline \[v2.0\] | First-party pipeline is the source of truth for profiles and data products |
| Staff auth | SSO (Google Workspace) via Auth.js or Clerk, mandatory 2FA, roles | Admin and CMS share one identity |
| Reseller auth \[v2.0\] | Clerk Organizations (or Auth.js with an org model), mandatory MFA | Multi-user reseller accounts with roles |
| Payments \[v2.0\] | Stripe Billing + Stripe Tax | Reseller prepaid balances, invoices, tax |
| File storage \[v2.0\] | Private object storage (S3 or Vercel Blob) with signed URLs | Reseller logos, code CSVs, PDFs, export files |
| Encryption \[v2.0\] | Application-level envelope encryption with a managed KMS | Emails, tax IDs, API secrets |
| Data activation \[v2.0\] | Clean room / data marketplace (e.g. LiveRamp, AWS Clean Rooms, Snowflake) — v2 | Tier B segments without shipping raw files |
| Admin portal | Protected `/admin` route group; charts with Recharts/Tremor | One codebase; no separate deployment |
| Reporting ingestion | Nightly jobs pulling affiliate network APIs, ad earnings, GA4 and Search Console; CSV fallback | Single view of performance |
| Observability | Datadog RUM, APM, logs, Synthetics, monitors on ingest lag, webhook failures, email bounce/complaint rates | Funnel, jobs, deliverability and uptime |
| Affiliate links | Own redirect service `/go/[retailer]/[tire]` | Central control and sub-ID tracking |
| Email click tracking \[v2.0\] | Own redirect `/e/c/[token]` at the edge | First-party click data, bot-click filtering |
| Mobile app \[v2.1\] | **React Native + Expo** (Expo Router, EAS Build/Submit/Update), TypeScript, shared Zod schemas and next-intl message files | One language and shared validation across web and app; OTA updates for JS changes |
| Push \[v2.1\] | Expo Notifications over APNs + FCM; schedules in Inngest | Reminders survive reinstall and sync across devices |
| On-device OCR \[v2.1\] | Apple Vision (iOS) and Google ML Kit text recognition (Android) via an Expo module | Reads sidewall size and DOT code without uploading photos |
| VIN decode \[v2.1\] | NHTSA vPIC API | Free US VIN decoding |
| App monitoring \[v2.1\] | Datadog RUM mobile (crashes, sessions) | Same observability as web |
| Ad operations \[v2.1\] | AdSense → managed network (Journey/Raptive); own sponsorship scheduler; Google Ad Manager if direct-sold grows; AdMob later for the app | Matches stage; avoids running header bidding ourselves |
| AI connector \[v2.1\] | Remote MCP server (official MCP TypeScript SDK, Streamable HTTP) on Vercel at `mcp.[domain]`; OAuth 2.1 for user-linked tools; OpenAPI mirror | Lets AI assistants call the engine; same engine and guardrails as the site |

### 7.1 Core data model (simplified)

- `vehicles` (year, make, model, trim, market)
- `vehicle_fitments` (vehicle_id, position front/rear/all, size, oe_load_index, oe_speed_rating, is_optional_package)
- `tire_models` (brand, model, category, season, 3pmsf, mplus_s, warranty_distance, ev_optimised)
- `tire_skus` (tire_model_id, size, load_index, speed_rating, xl, lt, run_flat)
- `tire_market_availability` (sku_id, market, local_name, status)
- `tire_ratings` (sku_id, system \[UTQG|EU_LABEL|…\], values json)
- `tire_scores` (tire_model_id, dry, wet, snow, ice, longevity, noise, comfort, efficiency, source_notes)
- `prices` (sku_id, market, retailer_id, price, currency, fetched_at)
- `retailers` (name, markets, network, program_id, link_template, status)
- `climate_profiles` (geo_key, snow_days, freeze_days, wet_days, heat_days)
- `market_rules` (market, min_tread, winter_law json, units, currency)
- `recalls` (brand, model, dot_range, source, date)
- `reports` (id, share_token, inputs json, results json, engine_version, locale, created_at)
- ~~`subscribers`~~ (replaced in v2.0 by `contacts` + `consents`, below)
- `content_terms` (slug, locale, reviewed_at, reviewer)
- `affiliate_clicks` (report_id, retailer_id, sku_id, sub_id, placement, market, ts)
- `messages` — not a table: UI strings live in versioned message files per locale (`en` only at launch)

**Admin and marketing tables**

- `partners` (name, network, program_id, markets, commission_terms, cookie_days, payment_terms, manager_contact, restrictions, status)
- `partner_applications` (partner_id, status, applied_at, decided_at, reapply_after, notes)
- `partner_links` (partner_id, market, template, last_checked_at, health_status)
- `partner_reports_daily` (partner_id, date, market, clicks, orders, sales, commission, reversals, sub_id)
- `payouts` (network, period, expected, received, received_at)
- `ad_revenue_daily` (date, page_type, market, impressions, revenue, rpm)
- `events` (first-party interaction events: form steps, card expansions, tooltip opens, compare, share; anonymous session id, consent flag)
- `page_metrics_daily` (path, date, pageviews, sessions, engaged_time, scroll_depth, source breakdown)
- `search_metrics_daily` (path, query, date, impressions, clicks, position)
- `campaigns` / `utm_links` (name, channel, url, created_by, results)
- `email_campaigns` (segment, template, status, sent, opens, clicks, unsubscribes)
- `experiments` (flag key, variants, metric, status, result)
- `outreach_contacts` (organisation, type, status, next_step)
- `admin_users` (role, 2fa_enabled) and `audit_log` (user, action, entity, before/after, ts)

**\[v2.0\] Assessment and compare**

- `report_versions` (report_id, version, extended_inputs json, results json, engine_version, diff json, created_at)
- `comparisons` (id, report_id, report_version, items json \[sku_id | shop_quote_id\], scenarios json, share_token, created_at)
- `shop_quotes` (id, report_id, tire_model_id nullable, raw_text, price, price_basis \[per_tire|set|out_the_door\], currency, evaluation json)

**\[v2.0\] Contacts, consent and privacy**

- `contacts` (id, email_hash unique, email_enc, email_domain, locale, market, postal_prefix, age_confirmed_at, status \[active|bounced|complained|unsubscribed|deleted\], created_at) — replaces `subscribers`
- `consents` append-only (id, contact_id or anon_id, purpose \[report_email|offers_email|identity_sharing|lifecycle\], action \[grant|withdraw\], method \[checkbox|double_opt_in|gpc|preference_centre|unsubscribe\], notice_version_id, source, report_id, ip_trunc, user_agent, created_at)
- `cookie_consents` (consent_id, anon_id, region, categories json, tcf_string, gpp_string, gpc, cmp_version, notice_version_id, created_at)
- `notice_versions` (id, type \[privacy|cookie|consent_text|financial_incentive\], locale, text_hash, url, published_at)
- `suppressions` (email_hash, scope \[all|marketing|reseller:{id}|data_sale\], reason, created_at)
- `privacy_requests` (id, type, contact_id/anon_id, verification_status, received_at, due_at, extended, status, actions json, closed_at, appeal_of)
- `cookie_registry` (name, provider, category, purpose, duration, first_seen, declared)

**\[v2.0\] Email**

- `email_templates` (key, locale, version, status, rendering_test_result)
- `email_sends` (id, contact_id, template_key, report_id, report_version, kind \[service|marketing\], sending_domain, esp_message_id, subject, status, idempotency_key unique, queued_at, sent_at)
- `email_links` (id, send_id, slot, url, content_id nullable, offer_id nullable, topic)
- `email_events` (id, send_id, provider_event_id unique, type, occurred_at, is_machine, ua_class, country) — mirrored to ClickHouse
- `email_feedback` (send_id, question, answer, comment, created_at)
- `preferences` (contact_id, frequency, topics json, offers bool, updated_at)
- `education_topic_map` (reason_code, topic, weight)

**\[v2.0\] Content and SEO (CMS-managed, `cms` schema)**

- `content_items` (id, type, slug, locale, market, status, body, topics\[\], reviewed_at, reviewer, published_at, updated_at, version)
- `seo_meta` (target \[route|content_id\], title, description, canonical, robots, og json, schema_fields json, breadcrumb_label, sitemap_include)
- `seo_templates` (page_type, locale, title_pattern, description_pattern, schema_type)
- `strategic_pages` (route, target_keyword, secondary_keywords json, intent, owner, priority, status, review_due)
- `redirects` (id, source, target, type \[301|302|410\], is_regex, hits, created_by, created_at)
- `robots_rules` (environment, user_agent, directives, updated_by)
- `seo_findings` (route, check, severity, details, detected_at, resolved_at, owner)

**\[v2.0\] Resellers and offers (`partners` schema, row-level security by org_id)**

- `reseller_orgs` (id, legal_name, trading_name, tax_id_enc, website, verified_domain, status, trusted, markets\[\], affiliate_partner_id nullable, stripe_customer_id, created_at)
- `reseller_users` (id, org_id, email, role, mfa_enabled, last_login_at)
- `reseller_locations` (id, org_id, address, lat, lng, service_radius_km, phone, hours json, services\[\])
- `reseller_agreements` (org_id, doc_type, version, accepted_by, accepted_at, ip_trunc)
- `reseller_verifications` (org_id, method, result, evidence, reviewer_id, created_at)
- `offers` (id, org_id, title, description, discount_type, value, currency, terms, start_at, end_at, redemption_method, landing_url, min_purchase, status \[draft|pending_review|approved|live|paused|expired|rejected\], review_notes, pricing_model, bid, budget_total, budget_spent, caps json, logo_asset)
- `offer_targeting` (offer_id, markets\[\], regions\[\], postal_prefixes\[\], location_ids\[\], brands\[\], models\[\], categories\[\], rim_sizes\[\], sizes\[\], vehicle_classes\[\], tiers\[\])
- `code_pools` (id, offer_id, kind \[shared|unique\], shared_code, total, remaining, low_alert_sent)
- `coupon_codes` (id, pool_id, code unique per pool, status \[available|issued|redeemed|void\], contact_id, send_id, issued_at, redeemed_at, redemption_source)
- `offer_decisions` (id, send_id, offer_id, eligible, score, reasons json, selected, created_at)
- `offer_events` (offer_id, type \[inclusion|click|issue|redeem\], send_id, occurred_at)
- `reseller_api_keys` (id, org_id, key_hash, scopes\[\], last_used_at), `reseller_webhooks` (id, org_id, url, secret_enc, events\[\])
- `billing_ledger` (org_id, type \[top_up|charge|refund\], amount, currency, offer_id, stripe_ref, created_at)

**\[v2.0\] Visitors and audience data**

- `events` (ClickHouse; envelope fields per `FR-DAT-01` + props json, ip_hash, geo fields, bot_score, consent flags, sale_allowed)
- `sessions` (ClickHouse materialised view: session_id, anon_id, start, end, engaged_seconds, pages, entry, exit, source, medium, campaign)
- `visitors` (anon_id, contact_id, first_seen, last_seen, visit_count, bot_score, consent_state)
- `profiles` (profile_id, anon_id/contact_id, vehicles json, vehicle_age, vehicle_class, tire_size, driving_mix, priorities, budget_band, timeframe, intent_stage, intent_score, climate_zone, state, postal_prefix, dma, visits_30d, last_seen, sale_allowed, minor_flag, updated_at)
- `segments` (id, name, definition json, tier, refresh, size_saleable, size_internal, status), `segment_members` (segment_id, profile_id, added_at)
- `data_buyers` (id, name, kyb_status, permitted_uses\[\], prohibited_uses\[\], contract_ref, contract_expiry, deletion_sla_days, status)
- `data_products` (id, tier, name, schema json, min_cell_size, pricing)
- `data_exports` (id, buyer_id, product_id, segment_id, record_count, legal_basis_breakdown json, suppression_version, destination, checksum, requested_by, approved_by\[\], created_at)
- `deletion_notices` (export_id, buyer_id, batch_ref, sent_at, acknowledged_at)

**\[v2.1\] Advertising**

- `ads_txt_lines` (id, network, line, required, status, updated_by, updated_at)
- `ad_slots` (slot_id, page_types\[\], position, sizes json, reserved_heights json, lazy_px, max_per_page, active)
- `ad_blocks` (type \[category|advertiser_url\], value, network, reason, created_by)
- `sponsors` (id, name, contact, contract_ref), `sponsorships` (id, sponsor_id, placement, creative json, landing_url, start_at, end_at, markets\[\], page_types\[\], impression_cap, pricing \[flat|cpm\], price, status, approved_by)
- `sponsorship_events` (sponsorship_id, type \[viewable_impression|click\], page, occurred_at) — ClickHouse
- `house_ads` (id, creative json, target_url, priority, active)

**\[v2.1\] Mobile app and consumer accounts**

- `consumer_users` (id, contact_id, email_hash, created_at, last_login_at, deleted_at)
- `devices` (id, user_id nullable, anon_id, platform \[ios|android\], app_version, os_version, push_token_enc, push_enabled, att_status, ad_id_consent, locale, last_seen)
- `garage_vehicles` (id, owner \[user_id|anon_id\], vin_hash, year, make, model, trim, tire_size, nickname, added_via \[picker|size|vin|sidewall_scan\])
- `tire_sets` (id, vehicle_id, tire_model_id, size, installed_at, installed_odometer, shop, price, receipt_asset, dot_codes\[\], status \[on_car|stored|removed\])
- `tire_checks` (id, tire_set_id, type \[tread|pressure|rotation|alignment\], value json, odometer, checked_at)
- `reminders` (id, vehicle_id, type, due_at, due_odometer, rule json, status, last_sent_at)
- `push_messages` (id, device_id, type \[reminder|price_drop|offer|marketing\], campaign_id, sent_at, opened_at, status)
- `push_campaigns` (id, segment_id, title, body, deep_link, schedule, consent_required, sent, opened)
- `saved_offers` (user_or_device, offer_id, coupon_code_id, saved_at, revealed_at)
- `app_releases` (version, platform, released_at, min_supported, notes), `remote_config` (key, value json, platforms\[\], rollout_pct)

**\[v2.1\] AI connector**

- `api_clients` (id, name, type \[anonymous|api_key|oauth\], owner_contact, key_hash, oauth_client_id, scopes\[\], quota_per_hour, status, created_at)
- `mcp_calls` (ClickHouse: id, client_id, client_name, client_version, tool, tool_version, args_summary json \[pseudonymous, no free text\], result_count, latency_ms, cache_hit, error_code, occurred_at)
- `mcp_tools` (name, version, description, input_schema json, output_schema json, status \[active|deprecated\], deprecate_at)
- `ai_directory_listings` (platform, status, submitted_at, approved_at, notes)

### 7.2 Key components

**User-facing UI**

- `VehiclePicker` (cascading + type-ahead), `SizeEntry` with live `SidewallDiagram`
- `LocationInput` with detect/fallback, `ConditionsCard`
- `DrivingMixChips`, `PriorityPicker`, `DistanceSelect`
- `RecommendationCard` (tier badge, score, ratings, price, lifespan, cost-per-distance, CTA)
- `WhyThisTire` factor bars, `AvoidCard`
- `SizeDecoder` (personalised, linked segments)
- `PriceBreakdown` (out-the-door itemised)
- `ConditionRatings` (dry/wet/snow/ice/noise/comfort)
- `MaintenancePlan`, `QuestionsChecklist` / `ShopScorecard`
- `CompareDrawer`, `ShareBar` (email, link, print)
- `TermTooltip` (hover/tap definition + learn more)
- `AdSlot` (lazy, reserved height to avoid layout shift), `AffiliateDisclosure`
- `ConsentBanner`

**Services**

- Fitment service, Climate service, Engine service (versioned, returns codes not prose), Pricing service, Report service, Email service, Link redirect/tracking service, Recall sync, Content service, Event tracking service, Reporting ingestion jobs, Link-health checker

**Admin UI components**

- `KpiTile` with trend, `DateRangeFilter`, `MarketFilter`, `TrendChart`, `FunnelChart`, `TopTable` (sortable, exportable)
- `PartnerDirectoryTable`, `ApplicationPipeline` (board view), `LinkHealthBadge`, `ReconciliationTable`, `PayoutTracker`
- `CampaignBuilder` / `UtmBuilder`, `EmailCampaignComposer`, `SegmentBuilder`
- `ContentCalendar`, `PageStatusBoard`
- `ExperimentCard`, `AlertFeed`, `AuditLogViewer`, `RoleManager`

**\[v2.0\] New user-facing components:** `RefinePanel` (extended questions with "this changes…" hints), `WhatChangedSummary`, `CompareTable` (up to 4, differences toggle, sticky header), `ShopQuoteCheck`, `ScenarioCompare`, `ReportDeliveryPanel` (email, offers, identity-sharing, 18+ checkboxes), `PrivacyChoicesLink`, `ConsentBanner` / `PreferenceCentre` (CMP-backed), `PrivacyCentre` forms, `SponsoredOfferCard` (site, v3).

**\[v2.0\] Email components (React Email):** `ReportHeader`, `InputsSummary`, `PickRow`, `CompareSummary`, `AvoidList`, `DecoderStrip`, `LearnMoreBlock`, `MaintenanceList`, `QuestionsList`, `OfferBlock` / `OfferCard` (code, terms, distance), `HelpfulVote`, `ComplianceFooter`.

**\[v2.0\] New services:** Contact & consent service, Email orchestration (selection, render, send, webhooks), Education link selector, Offer matching & code issuance, Reseller service (orgs, verification, offers, billing), Event collector, Profile & segment builder, Data export service, Suppression service, Privacy request service, SEO service (revalidation, sitemaps, IndexNow, audits), Cookie scanner.

**\[v2.0\] New admin components:** `VerificationQueue`, `OfferModerationCard`, `MatchingSimulator`, `CodePoolGauge`, `EmailEventsChart`, `TopicLinkTable`, `DeliverabilityPanel`, `SeoFieldEditor` with `SerpPreview`, `RedirectTable`, `RobotsEditor`, `AuditFindingsList`, `ConsentRatesChart`, `CookieRegistryTable`, `PrivacyRequestQueue`, `VisitorExplorer`, `SegmentBuilder` (with saleable/internal split), `ExportApprovalCard`, `BuyerDirectory`.

**\[v2.0\] Reseller portal components:** `SignupWizard`, `VerificationStatus`, `LocationManager`, `OfferEditor` with `EmailPreview`, `TargetingBuilder`, `CodePoolUpload` (CSV validation report), `OfferPerformance`, `RedemptionUpload`, `BillingBalance`, `ApiKeyManager`, `TeamManager`.

**\[v2.1\] App components:** `GarageList`, `VehicleCard`, `VinScanner`, `SidewallCamera` (OCR + confirm), `TireLog`, `TreadCheckForm`, `ReminderList`, `NotificationPrompt` (in context), `OffersWallet` with `CounterCode` (barcode/QR, brightness boost), `SellerMap`, `TrackingChoice` (explainer before the ATT prompt), `ForcedUpdate`, `OfflineBanner`.

**\[v2.1\] Ad and connector components/services:** `AdSlot` (driven by the slot registry), `SponsorUnit`, `HouseAd`; ads.txt service; sponsorship delivery service; MCP server (tool handlers over the engine, auth, quotas, telemetry); push scheduler; mobile API.

**\[v2.1\] Admin components:** `AdsTxtEditor`, `SlotRegistryTable`, `BrandSafetyPanel`, `SponsorshipCalendar`, `RetentionCohortChart`, `PushComposer`, `ReleaseTable`, `RemoteConfigEditor`, `AsoEditor`, `McpCallsChart`, `ApiClientTable`, `ToolCatalogue`.

### 7.3 Platform architecture \[v2.0\]

**Applications (one Next.js codebase, one Vercel project, separate route groups and auth realms)**

| App | Path / host | Users | Auth |
| --- | --- | --- | --- |
| Public site | `/[locale]/…` | Visitors | None (consent cookie, anon ID) |
| Admin portal | `/admin` | Staff | Staff SSO + 2FA, roles |
| CMS | `/cms` (Payload) | Content/SEO editors | Same staff identity |
| Reseller portal | `partners.[domain]` | Reseller users | Reseller realm, organisations, MFA |
| Privacy centre | `/[locale]/privacy-centre` | Visitors | Email magic link or browser scope |
| Workers | Inngest functions | — | Signed job events |
| Mobile app \[v2.1\] | iOS and Android | Drivers | Optional consumer account (magic link); device token otherwise |
| AI connector \[v2.1\] | `mcp.[domain]` | AI assistants on behalf of users; B2B partners | Anonymous rate-limited, API keys, OAuth 2.1 |

**Main data flows**

1. **Report:** form → engine → `reports`/`report_versions` → results page → "Get this report" → consent rows + contact upsert → `report.email.requested` job → education link selection + (if consented) offer matching + code issuance → render → ESP → webhooks → `email_events` → admin.
2. **Visitor data:** SDK/server events → `/api/collect` (validate, consent check, enrich, hash IP) → queue → ClickHouse → hourly profile build → Postgres `profiles` → nightly segments → (approved) export via clean room.
3. **Offers:** reseller creates offer → moderation → `live` → matching at send time → inclusion/click/issue events → reseller dashboard → billing ledger → Stripe.
4. **SEO:** editor publishes in CMS → webhook → `revalidateTag` + sitemap rebuild + IndexNow ping; redirects → Edge Config → middleware.
5. **Consent:** CMP choice → consent cookie + `cookie_consents` → middleware/tag loader/collector enforce → suppressions feed exports.
6. **App reminders \[v2.1\]:** app saves garage/tire set → API → `reminders` computed → Inngest schedules → push via Expo/APNs/FCM → open event → deep link into the app.
7. **AI connector \[v2.1\]:** assistant → MCP `initialize` → tool call → engine service (same version as site) → structured result + attributed links → `mcp_calls` → user clicks link → site session tagged `utm_medium=ai_connector`.
8. **Sponsorships \[v2.1\]:** sponsor booked in admin → approved → `AdSlot` renders sponsor unit on matching pages → viewable impressions/clicks → delivery vs cap → invoice.

**Environments:** production, staging (Neon branch, `noindex`, test ESP domain, Stripe test mode, synthetic data only), per-PR previews (Neon branch per preview, seeded fixtures). Production personal data never copied to non-production.

### 7.4 API surface (key endpoints) \[v2.0\]

| Endpoint | Purpose | Protection |
| --- | --- | --- |
| `POST /api/reports` | Run engine, create report | Turnstile, rate limit |
| `POST /api/reports/{id}/versions` | Extended assessment re-run | Share token, rate limit |
| `POST /api/reports/{id}/comparisons` | Save comparison / shop quote | Share token |
| `POST /api/reports/{id}/deliver` | Email request + consents | Turnstile, per-email and per-IP limits |
| `POST /api/collect` | Event ingest (batch, `sendBeacon`) | Schema validation, payload limits, bot scoring |
| `GET /e/c/{token}` · `GET /e/o/{token}` | Email click redirect · open pixel | HMAC-signed tokens |
| `POST /api/webhooks/esp` · `/stripe` · `/cms` | Provider webhooks | Signature verification, replay window |
| `GET/POST /api/preferences/{token}` · `POST /api/unsubscribe` (RFC 8058) | Preference centre, one-click unsubscribe | Signed tokens |
| `POST /api/privacy/requests` | Privacy rights requests | Email verification |
| `/partners/api/v1/offers`, `/code-pools`, `/redemptions` | Reseller REST API | Scoped API keys, rate limits, org isolation |
| `/admin/api/*` | Admin actions | Staff session, role checks, audit log |
| `/api/v1/*` \[v2.1\] (auth, garage, tire-sets, checks, reminders, devices, saved-offers, reports) | Mobile API, versioned | Access + refresh tokens, device attestation (App Attest / Play Integrity) on sign-in and offer reveal |
| `POST /mcp` \[v2.1\] | MCP server (Streamable HTTP) | Rate limits per IP/client, API keys, OAuth 2.1 bearer tokens for user-linked tools |
| `GET /.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server` \[v2.1\] | OAuth discovery for MCP clients | Public |
| `GET /ads.txt` \[v2.1\] | Authorised sellers file | Public, cached at edge |
| `GET /.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` \[v2.1\] | Universal Links / App Links | Public |

### 7.5 Database design rules \[v2.0\]

- One Neon project; schemas per domain; each service connects with its own least-privilege role (e.g. the collector cannot read `contacts`).
- Reseller-owned tables enforce Postgres row-level security on `org_id`; admin access uses a separate role that bypasses RLS and is audited.
- Personal data columns encrypted at the application layer; lookups by hash.
- Append-only tables (`consents`, `data_exports`, `audit_log`) have no UPDATE/DELETE grants; privacy deletions in them replace identifiers with tombstone hashes.
- All timestamps UTC `timestamptz`; money as integer minor units + ISO currency.
- Retention enforced by scheduled jobs with dry-run reports in admin.

---

## 8. Monetization

### 8.1 Revenue streams

| Stream | Phase | Integration points | Notes |
| --- | --- | --- | --- |
| **Display ads** | MVP | Glossary/guide pages (in-content + sidebar), results page below the 5 picks only, programmatic vehicle pages | Never on the form; reserved ad heights to protect page speed |
| **Retailer affiliates** | MVP | "Check price" on each pick, compare drawer, report email, vehicle pages | Likely higher earnings per visitor than display ads early on |
| **Local installer leads** \[NEW\] | v2 | "Find an installer near you" on results | Partner with installer networks or retailer installation programs; per-lead or per-booking |
| **Mobile fitting partners** \[NEW\] | v2 (UK/AU) | "Fitted at home" option on results | Several UK/AU tyre retailers offer mobile fitting via affiliate programs |
| **Email sponsorship** \[NEW\] | v3 | One clearly labelled sponsor slot in lifecycle emails (not the report) | Only with marketing opt-in |
| **Brand sponsorship of education content** \[NEW\] | v3 | "Presented by" on a guide, never on rankings | Strict editorial separation |
| ~~Data/API licensing~~ | — | — | Superseded in v2.0 by the tiered audience data program below (4.18) |
| **Reseller offers** \[v2.0\] | MVP+ | Report email "Sponsored offers" block; lifecycle emails; on-site offers module (v3) | CPC default; CPM, flat listing or per-redemption options; prepaid via Stripe; ranking mostly relevance, paid influence capped |
| **Audience insights (Tier A)** \[v2.0\] | MVP+ internal, v2 sold | Dashboards/API for brands, retailers, analysts | Aggregated, minimum cell size 50; lowest legal risk |
| **Audience segments (Tier B)** \[v2.0\] | v2 | Clean room / data marketplace activation | Pseudonymous; US opt-out model with GPC honoured; EU/UK opt-in only; replaces the v4 "Data/API licensing" line |
| **Identity-linked leads (Tier C)** \[v2.0\] | v3 | Delivered to vetted resellers and partners via portal/API | Explicit opt-in, 18+, named partner categories; priced per lead |
| **Direct-sold sponsorships** \[v2.1\] | v2 | Homepage sponsor strip, "Presented by" on guides/tools, lifecycle email sponsor slot, seasonal takeover | Flat fee or CPM; labelled "Sponsored"; check managed-network terms before selling; never in recommendations |
| **AI connector API plans** \[v2.1\] | v3 | Paid API keys for dealer sites, fleet tools | Same server, higher quotas and SLAs |
| **App** \[v2.1\] | v2 | No ads or purchases at launch; drives affiliate clicks, offer redemptions and reminders that bring buyers back | AdMob considered later only if it doesn't hurt retention |

### 8.2 Ad network ladder

Plan to move up networks as traffic grows (verify thresholds the week you apply; they change often):

1. **Launch:** Google AdSense — no minimum traffic.
2. **\~1,000 sessions/month:** Journey by Mediavine (entry program; reported to have dropped to 1,000 monthly sessions in January 2026).
3. **\~25,000 pageviews/month:** Raptive (lowered from 100,000; requires a share of traffic from tier-one markets).
4. **Main Mediavine:** reports conflict on the current requirement — check directly.
5. Note: Ezoic reportedly raised its minimum sharply for new publishers in February 2026, so don't plan around it.

Requirements common to all: original content, privacy policy, consent management (EEA/UK), GA4 access for traffic verification, organic traffic (no paid/incentivised), and a site that's not thin.

### 8.3 Placement rules (to protect trust and speed)

- Form page: **no ads**.
- Results page: max 2 ad units, both below the recommendations; never inside a recommendation card.
- Affiliate buttons labelled "Check price at \[Retailer\]" with an "Affiliate link" marker and disclosure near the top.
- Always show more than one retailer where available, so the user sees we're not steering.
- "How we choose" page states: rankings are computed before any retailer is attached.
- **\[v2.1\]** Direct-sold sponsor units and house ads follow the same placement rules as network ads, are labelled "Sponsored", and never appear in recommendations, compare or the consent banner.
- **\[v2.0\]** Sponsored reseller offers appear only in a labelled "Sponsored offers" block below the picks (email) or below the recommendations (site, v3), never inside a recommendation card, and never change rankings.

---

## 9. Affiliate programs — full sign-up playbook

### 9.1 Before applying (do these first)

Affiliate managers approve sites that look real, trustworthy and relevant. Get these in place:

| # | Prerequisite | Detail |
| --- | --- | --- |
| 1 | **Business entity** | Register an LLC (or operate as sole proprietor initially). Get an EIN (US) — needed for W-9 tax forms that networks require. |
| 2 | **Business bank account / payout method** | Networks pay via direct deposit, check or PayPal; some (Awin) have payment fees/thresholds. |
| 3 | **Live site with real content** | At minimum: working form + results, 15–25 glossary pages, About, Contact, How we choose. Applications from "coming soon" pages are routinely rejected. |
| 4 | **Policies** | Privacy policy, terms of use, cookie policy, affiliate disclosure page. |
| 5 | **Professional email** | e.g. partners@\[yourdomain\] — not a personal Gmail. |
| 6 | **Traffic & audience description** | Prepare a short paragraph: audience (car owners researching tires), regions, traffic sources (organic search, email), monthly visitors (be honest if new). |
| 7 | **Promotional methods statement** | Content site + email newsletter; no paid search on brand terms; no coupon sites; no incentivised clicks. |
| 8 | **Analytics in place** | GA4 + your own click tracking, so you can report and reconcile. |

### 9.2 Networks to join

Join the networks first (each is one application), then apply to individual retailer programs inside them.

| Network | Markets | Tire-relevant advertisers (examples; verify availability) |
| --- | --- | --- |
| **CJ Affiliate** | US, global | Tire Rack, Priority Tire |
| **Awin** (incl. former ShareASale) | US, UK, EU, AU | Priority Tire, Blackcircles (UK), Tyres on the Drive (UK), other EU tyre retailers |
| **Impact.com** | US, global | Large retailers and brands |
| **FlexOffers** | US, UK | Aggregates many programs incl. UK tyre retailers |
| **Tradedoubler** | EU | e.g. mytyres.co.uk and EU equivalents |
| **Commission Factory** | Australia | Tyroola |
| **Amazon Associates** | Most markets | Tires and accessories (pressure gauges, tread gauges, inflators) — useful for tools/maintenance pages |
| **Direct programs** | Varies | Some retailers run applications on their own site (e.g. Tire Rack and Priority Tire both have affiliate pages) |

### 9.3 Target retailer programs (starting list)

Commission rates and cookie lengths change; confirm on application.

| Retailer | Market | Reported commission | Cookie | Network |
| --- | --- | --- | --- | --- |
| Tire Rack | US | 6% per sale (states AOV over $400) | 60 days (reported) | CJ / direct application |
| Priority Tire | US | Up to 7% (own page); 4% reported elsewhere | 7 days on Awin | Awin, CJ |
| Discount Tire / Discount Tire Direct | US | \~4% reported | — | CPS program, verify network |
| SimpleTire | US | \~5% reported | — | verify network |
| Blackcircles | UK | Not public | 30 days | Awin |
| Tyroola | AU | 2% per sale | 30 days | Commission Factory |
| Tyres on the Drive (mobile fitting) | UK | Not public | — | Awin |

### 9.4 Step-by-step application process

1. **Create network accounts** (CJ, Awin, Impact, FlexOffers; Commission Factory for AU later). Fill in: website URL, site category (Automotive / Content & Reviews), promotional methods, audience regions, tax info (W-9), payment details.
2. **Network approval** — usually a few days. Awin charges a small refundable deposit for new publishers in some regions; check current terms.
3. **Apply to each retailer program** inside the network. Write a tailored note: "We're a tire recommendation and education site. Users enter their vehicle and conditions and get 5 suitable tires; we link to retailers for price checks. Audience: US car owners actively shopping for tires."
4. **If rejected:** ask the program manager why, fix it (more content, clearer disclosure), reapply in 30–60 days. New sites are often rejected by premium programs at first; start with programs that accept smaller publishers.
5. **Read each program's terms** and log key restrictions in the admin (e.g. Priority Tire prohibits bidding on its brand terms in paid search; some programs exclude certain states).
6. **Set up links**:
   - Use the network's deep-link generator or link template to point to the exact product page for the recommended size.
   - Store link templates per retailer in the `retailers` table; generate links server-side.
   - Route every outbound click through `/go/...` so we log the click and attach a **sub-ID** (report ID + placement + tire) for attribution.
7. **Import product feeds** (where offered) to get prices and product URLs per size; refresh daily.
8. **Disclose**: site-wide affiliate disclosure page; a short disclosure near affiliate buttons; disclosure in emails containing affiliate links.
9. **Test** every program's links (click → retailer page → test order where allowed or confirm tracking pixel in network dashboard).

### 9.5 Running the program after approval

- **Monthly reconciliation:** compare our click logs to network-reported clicks/sales by sub-ID (done in the admin portal's reconciliation view; see 4.9 Module 4).
- **Track EPC** (earnings per click) per retailer per market; rotate default retailer ordering only by user benefit (price, availability, installation) — not by EPC alone, and document this.
- **Handle reversals:** returns cancel commissions; expect some.
- **Payouts and tax:** networks issue 1099s (US) above thresholds; keep records.
- **Program changes:** subscribe to network notices; deactivate links automatically when a program closes (link manager status flag).
- **Negotiate:** once volume is real, ask program managers for higher rates, exclusive offers, or product data access.

### 9.6 Illustrative economics (assumptions, not forecasts)

- 10,000 completed reports/month × 10% click "Check price" = 1,000 retailer visits
- × 5% conversion = 50 orders × $400 average × 5% average commission ≈ **$1,000/month**
- Display ads on the same traffic depend heavily on network and geography; track RPS from day one and compare.

---

## 10. Analytics and KPIs

| Funnel step | Metric |
| --- | --- |
| Landing → form start | Start rate |
| Form start → submit | Completion rate, time to complete, field drop-off |
| Results | Card expansions, tooltip opens, compare usage |
| Monetization | Affiliate CTR per placement, EPC, ad RPS, revenue per report |
| Email | Report send rate, open/click rate, glossary clicks by term (UTM) |
| Content | Organic sessions per term page, return visits from emails |
| Quality \[NEW\] | Post-purchase satisfaction, "did you buy one of our picks?" |
| Extended assessment \[v2.0\] | Refine-panel start and completion rate; compare usage; shop quotes checked; % of quotes found above our range |
| Report delivery \[v2.0\] | Email request rate per report; offers opt-in rate; identity-sharing opt-in rate; double opt-in confirmation rate |
| Email engagement \[v2.0\] | Delivery, hard bounce, complaint rate; estimated human opens; click rate; clicks by education topic; return-visit rate; helpfulness score |
| Offers \[v2.0\] | Offer-bearing email rate; offer clicks; codes issued; redemptions; reseller revenue; reseller retention |
| SEO \[v2.0\] | Time-to-live for SEO edits; open critical audit findings; strategic page clicks and position trend |
| Consent and privacy \[v2.0\] | Consent acceptance by region and category; GPC rate; privacy requests and median close time |
| Audience data \[v2.0\] | Saleable vs internal profile share; segment sizes; export count; data revenue per 1,000 sessions; buyer deletion acknowledgements |
| Ad operations \[v2.1\] | RPM by page type; viewable impressions; CLS/LCP on ad pages; sponsor delivery vs booked; invalid-click alerts |
| Mobile app \[v2.1\] | Installs; DAU/MAU; day 1/7/30 retention; crash-free sessions; notification and ATT opt-in rates; reminder opens; sidewall scans; offers saved and revealed |
| AI connector \[v2.1\] | Calls by tool and client; error rate; p95 latency; click-through to site; affiliate clicks and offer clicks from AI sessions |

All of these KPIs appear in the admin portal (4.9), with the overview dashboard showing the headline set.

---

## 11. Legal, compliance and trust

- Disclaimer: general guidance; confirm with a qualified installer and the vehicle placard.
- Affiliate and advertising disclosures (FTC in US; ASA/CAP in UK; local equivalents).
- Privacy: CAN-SPAM, GDPR/UK GDPR, CASL, Australian Privacy Act, POPIA, DPDP as markets launch.
- Cookie consent via certified CMP.
- "How we choose" methodology page + editorial independence statement.
- Never present "avoid" items as bad products — always "poor fit for your conditions".
- Trademark use: brand names used descriptively only; no logos without permission.
- Accessibility statement.
- **\[v2.0\] Email:** CAN-SPAM (US), CASL (Canada, express consent), GDPR/UK GDPR + PECR/ePrivacy (soft opt-in not relied on for reseller offers; tracking pixels need consent), Gmail/Yahoo/Microsoft bulk-sender requirements.
- **\[v2.0\] US state privacy laws** (Colorado, California, Virginia, Connecticut, Texas, Oregon and others): notice at collection, "sale"/"sharing"/targeted advertising opt-outs, universal opt-out signals (GPC) honoured, appeal process, data protection assessments for selling personal data and targeted advertising, heightened duties for minors' data (e.g. Colorado's 2025 amendments), California notice of financial incentive for offers given in exchange for data, and passing deletion requests to third parties we sold or shared data with.
- **\[v2.0\] Data program:** data broker registration assessment per state; FCRA risk avoided by prohibiting eligibility uses; FTC Act Section 5 — never promise privacy we don't deliver, and keep disclosures prominent (recent FTC orders against sellers of browsing and location data are the cautionary examples); written data licences with every buyer; privacy counsel sign-off before Tier B and before Tier C.
- **\[v2.0\] Children:** site not directed to children under 13 (COPPA); 18+ attestation for offers and data sharing; records flagged as under 18 never sold.
- **\[v2.0\] Resellers:** Reseller Terms, Offer Policy (truthful offers, honoured codes, substantiated claims), Data Processing Addendum; sponsored offers labelled as paid placements per FTC Endorsement Guides and ASA/CAP; offers never influence rankings (published on "How we choose").
- **\[v2.1\] App stores:** Apple App Review Guidelines and Google Play Developer Policies — in-app account deletion, accurate privacy labels/Data safety, privacy manifest, App Tracking Transparency before any tracking on iOS (including sharing for data-broker purposes), Play prominent disclosure and consent for data sharing, no misleading coupon claims. Kids categories not used; app rated for general audiences, not directed to children.
- **\[v2.1\] Advertising operations:** ads.txt accuracy; network program policies (no encouraging clicks, ad placement limits); FTC native-advertising guidance for sponsorships; restricted data processing for US opt-outs.
- **\[v2.1\] AI connector:** each AI platform's directory and developer terms; terms of use for the connector/API (rate limits, attribution, no scraping or resale of results); data from AI calls not sold.
- **\[v2.0\] Cookies:** certified CMP; equal-prominence reject in EU/UK; cookie policy table generated from the registry.

---

## 12. Improvements added beyond the original plan (summary)

1. Staggered/optional wheel-package handling in the form.
2. "Replacing how many?" input to trigger AWD and rear-axle guidance.
3. Seasonal two-set option and 5-year cost comparison in snowy climates.
4. Visible "Your conditions" card so users can correct assumptions.
5. Cost per 1,000 miles/km metric on every pick.
6. Itemised out-the-door price including estimated local tax.
7. "Why this tire" factor bars for explainability.
8. Side-by-side compare (up to 3).
9. Shareable private results link (no email needed).
10. Lifecycle emails: price drops, rotation and winter-swap reminders, 6-month feedback survey.
11. Post-purchase feedback as proprietary data over time.
12. EV-specific priority and tire flag.
13. Interactive link-magnet tools: decoder, DOT age checker, tread guide, size calculator, recall checker.
14. "Shop scorecard" mode for the questions checklist.
15. Golden-scenario test suite and versioned engine.
16. Editorial independence: rankings computed before retailers attached.
17. Installer-lead and mobile-fitting revenue streams.
18. Central `/go/` link service with sub-ID attribution.
19. Content review dates and reviewers on every term page.
20. Bot protection, rate limiting, data minimisation and retention limits.
21. Full observability across the funnel and data jobs.
22. Sidewall-photo size reader and VIN lookup (later phases).
23. English-only launch on an internationalisation-ready foundation: locale-prefixed URLs, externalised strings, engine codes instead of sentences, pseudo-localisation checks (v1.1).
24. Market and language treated as separate settings, so new countries can launch in English before translation (v1.1).
25. Admin portal refocused as a business cockpit: overview dashboard, traffic and content analytics, interaction insights, affiliate partner management, ad revenue, marketing tools (v1.1).
26. Affiliate application tracker, link-health monitoring, reconciliation and payout tracking (v1.1).
27. Editorial guardrail built into the admin: partner settings can never change which tires are recommended (v1.1).
28. Admin roles, 2FA and audit log (v1.1).

**v2.0 additions**

1. **\[v2.0\]** Extended assessment with versioned reports and a "What changed" summary.
2. **\[v2.0\]** Compare up to 4 tires including a shop-quote check against our fair-price range, plus scenario comparisons (two-set, budget vs premium, 2 vs 4).
3. **\[v2.0\]** Report delivery panel with separate, unticked checkboxes for the report, reseller offers and identity sharing; append-only, versioned consent records.
4. **\[v2.0\]** Tailored HTML report email: education links chosen from engine reason codes and topic tags, Gmail-clip-safe size, linked PDF, compliance footer.
5. **\[v2.0\]** Reseller portal: verified business accounts, locations, offer editor, unique code pools, targeting, moderation, Stripe billing, API and webhooks.
6. **\[v2.0\]** Offer matching engine: relevance-first ranking with capped paid influence, at most 3 offers, audit-logged decisions, guardrail test that offers never change recommendations.
7. **\[v2.0\]** First-party email click redirect with bot-click filtering; machine-open flagging; engagement-based sunset; deliverability monitoring.
8. **\[v2.0\]** Embedded CMS for SEO: per-page fields, page-type templates, strategic pages register, redirects via Edge Config, robots and AI-crawler toggles, programmatic quality gate, nightly SEO audits.
9. **\[v2.0\]** Region-aware consent with GPC, Consent Mode v2, server-side enforcement and a scanned cookie registry.
10. **\[v2.0\]** First-party visitor data platform (ClickHouse) with profiles, sessions and repeat-visit analysis; tiered data products with two-person export approval and export-time suppression.
11. **\[v2.0\]** Privacy centre with automated fulfilment, tombstones and buyer deletion propagation.

**v2.1 additions**

1. **\[v2.1\]** Ad operations: ads.txt/app-ads.txt manager, slot registry with density and speed budgets, brand-safety blocks, consent-aware delivery, house ads, invalid-traffic alerts.
2. **\[v2.1\]** Direct-sold sponsorship scheduler with labelling and the same "never in recommendations" guardrail.
3. **\[v2.1\]** React Native/Expo app: garage, VIN and sidewall scanning, tire log, server-scheduled push reminders, offers wallet, offline scorecard.
4. **\[v2.1\]** App privacy built in: ATT on iOS gates any data-broker sharing, Play disclosure, privacy manifest, in-app account deletion.
5. **\[v2.1\]** Public remote MCP server so AI assistants call the same engine, with attributed links, rate limits, OAuth for user-linked tools and no paid influence.
6. **\[v2.1\]** Three new admin modules: Ad operations, Mobile app, AI connector.

---

## 13. Risks and open decisions

| Risk / decision | Impact | Mitigation / next step |
| --- | --- | --- |
| Fitment data licensing cost and coverage | Blocks MVP | Get quotes from 2–3 providers this month; start with top 100 vehicles |
| Performance scores without our own testing | Credibility | Score from specs + ratings + label data; publish methodology; add owner feedback later |
| Affiliate rejection as a new site | Revenue delay | Launch with content depth first; start with accepting programs; reapply |
| Low ad revenue early | Revenue | Lean on affiliates and email; move up ad ladder |
| Thin programmatic pages | SEO penalty | Only publish vehicle pages with unique data; noindex until reviewed |
| Legal rules drift by market | Wrong advice | Quarterly review, cited sources, "last reviewed" dates |
| Hardcoded English slipping into components, emails or illustrations | Expensive later translation | Lint rule against raw strings in JSX; pseudo-localisation CI check; code review checklist |
| Admin scope creep | Delays launch | Ship MVP admin modules only; use PostHog/GA4/network dashboards directly for anything not yet built |
| External reporting APIs change or rate-limit | Gaps in admin data | Nightly jobs with retries and freshness indicators; CSV upload fallback |
| **Open:** domain and trademark for "Tires & Tread" | Branding | Name chosen (v2.0); check domain availability and trademark conflicts before launch |
| **Open:** MVP vehicle list | Scope | Choose by US sales volume |
| **\[v2.0\]** Data sales erode user trust or breach ad/affiliate/partner terms | Brand, revenue | Tiered program; transparent notices; start with Tier A; review AdSense, network and ESP terms before Tier B; publish what we never sell |
| **\[v2.0\]** Regulatory change or enforcement on data sales | Legal, fines | Counsel review per tier; data protection assessments; buyer contracts; per-state toggles; export-time suppression |
| **\[v2.0\]** Offers hurt deliverability (spam complaints) | Report emails land in spam | Separate sending subdomains; opt-in only; frequency caps; complaint alerts; sunset policy |
| **\[v2.0\]** Fraudulent resellers or bad coupons | User harm, trust | Verification, moderation, URL safety checks, complaint tracking, suspension, honoured-offer clause in terms |
| **\[v2.0\]** Low consent rates in EU/UK | Smaller saleable audience | Model revenue on US first; EU/UK relies on Tier A insights and opted-in leads |
| **\[v2.0\]** Apple Mail Privacy Protection inflates opens | Misleading metrics | Clicks and return visits as primary metrics; machine-open flag |
| **\[v2.0\]** Event volume and ClickHouse cost growth | Cost | Sampling for low-value events, TTLs, rollups; cost dashboard |
| **\[v2.0\] Open:** pricing for resellers (CPC level, minimums) | Revenue | Pilot with 5–10 local resellers on free credit; set prices from click data |
| **\[v2.0\] Open:** CMP vendor | Cost, speed | Evaluate 3 vendors against criteria in 4.17 |
| **\[v2.0\] Open:** whether to launch Tier B at all in year one | Revenue vs risk | Decide after 6 months of Tier A demand and counsel review |
| **\[v2.1\]** App store rejection (privacy labels, ATT, account deletion, coupon content) | Launch delay | Pre-submission checklist in admin Module 14; TestFlight review early; mirror disclosures from one data inventory |
| **\[v2.1\]** Low ATT opt-in on iOS | Smaller saleable app audience | App's value is retention and affiliate/offer clicks, not data sale; model data revenue on web first |
| **\[v2.1\]** Managed ad network terms conflict with our sponsorships or slot rules | Lost ad revenue or rejected application | Read terms before signing; keep sponsorships in house-rendered units; negotiate exclusions |
| **\[v2.1\]** AI assistants misquote or strip attribution | Brand and traffic loss | Structured outputs with explicit fields; links in every result; monitor phrasing in periodic evaluations |
| **\[v2.1\]** Connector abuse or scraping | Cost, data leakage | Rate limits, API keys, output caps, anomaly alerts, terms of use |
| **\[v2.1\]** Two UIs (web + app) slow delivery | Scope | Shared API, schemas and message files; app ships after web is stable; feature flags |
| **\[v2.1\] Open:** app launch timing (v2 vs earlier) | Roadmap | Decide after 8 weeks of web data on return-visit demand and email reminder engagement |

---

## 14. Roadmap (indicative)

| Weeks | Milestone |
| --- | --- |
| 1–2 | Name + domain; fitment data provider chosen; design screens; **\[v2.0\]** CMP vendor and ESP chosen; sending subdomains with SPF/DKIM/DMARC; privacy counsel engaged |
| 3–6 | Data model (incl. contacts, consents, email, CMS schemas), catalog import, climate precompute, engine v1 + golden tests; i18n scaffolding; **\[v2.0\]** event collector + ClickHouse; Payload CMS with SEO fields, templates, redirects, robots |
| 7–9 | Form, results, **\[v2.0\]** extended assessment + compare + shop quote, report delivery panel, HTML report email with education links, click redirect and ESP webhooks; 25 glossary pages; policies (privacy, cookie, financial incentive, terms) |
| 10 | Apply to networks/programs; AdSense; analytics & observability; admin MVP **\[v2.0\]** incl. SEO manager, email events, consent dashboard, privacy request queue; consent and suppression end-to-end tests |
| 11–12 | Beta with friends/family; fix funnel issues; public launch (US) |
| +6–10 weeks \[v2.0\] | Reseller portal beta with 5–10 pilot resellers; offer moderation and matching in report emails; deliverability module; visitor explorer; pen test |
| +3–6 months | v2: UK/IE/AU, programmatic pages, lifecycle emails, reseller billing and API, SEO audits and strategic pages, Tier A insight sales, Tier B pilot after counsel sign-off |
| +6–10 weeks \[v2.1\] | Ad ops: ads.txt manager, slot registry, brand-safety settings; AI connector v1 (read-only tools, anonymous + API keys), developer page, first directory submissions |
| +3–5 months \[v2.1\] | Mobile app v1 (garage, VIN and sidewall scan, tire log, reminders, offers wallet, scorecard); TestFlight/Play testing; store launch US; admin Module 14 |
| +6 months \[v2.1\] | Sponsorship scheduler live; AI connector OAuth tools (save to garage, email report); ChatGPT app with compare UI; app v1.x improvements from reviews |

---

## 15. Screen inventory (input to the design phase)

1. Home / landing (value prop + form start)
2. One-page form (desktop + mobile)
3. Loading / "matching your tires" state
4. Results page (5 picks, avoid list, maintenance, questions, share)
5. Compare drawer / view
6. Email report (HTML email)
7. PDF report
8. Tire Basics hub
9. Glossary term page (template)
10. Sidewall decoder tool
11. Before-you-buy checklist + Shop scorecard
12. Best tires for \[vehicle\] page (template)
13. How we choose (methodology)
14. Saved results via share link
15. Consent banner, affiliate disclosure, footer
16. Admin — Overview dashboard
17. Admin — Traffic & content analytics
18. Admin — Engagement & interaction insights (form funnel, term clicks)
19. Admin — Affiliate partners: directory, application pipeline, partner detail with performance
20. Admin — Reconciliation & payouts
21. Admin — Ad revenue & ad slot settings
22. Admin — Marketing: campaigns/UTM, email campaigns, content calendar, experiments
23. Admin — Data operations: catalog, fitment review, scoring weights
24. Admin — Settings: users & roles, audit log

- **\[v2.0\]** Results — Refine and compare panel (extended questions, what changed)
- **\[v2.0\]** Compare (up to 4) with shop-quote check and scenario tab
- **\[v2.0\]** Get this report panel (email, offers, identity sharing, 18+)
- **\[v2.0\]** Email report v2 (education block, sponsored offers, compliance footer)
- **\[v2.0\]** Consent banner (EU/UK), US notice + Your Privacy Choices, preference centre
- **\[v2.0\]** Privacy centre (requests) and email preference centre
- **\[v2.0\]** Reseller portal — sign-up and verification, dashboard, offer editor with targeting and code upload, offer performance, billing, team, API keys
- **\[v2.0\]** Admin — Resellers and offers (verification, moderation, matching simulator)
- **\[v2.0\]** Admin — Email and deliverability
- **\[v2.0\]** Admin — SEO manager
- **\[v2.0\]** Admin — Consent and privacy
- **\[v2.0\]** Admin — Visitors and audience data (explorer, segments, exports)
- **\[v2.1\]** App — Garage and reminders (home)
- **\[v2.1\]** App — Sidewall camera reader
- **\[v2.1\]** App — Offers wallet with counter code
- **\[v2.1\]** App — Privacy and permissions (tracking choice, notifications)
- **\[v2.1\]** Public — "Use Tires & Tread in your AI assistant" developer page
- **\[v2.1\]** Admin — Ad operations (ads.txt, slots, brand safety, sponsorships)
- **\[v2.1\]** Admin — Mobile app
- **\[v2.1\]** Admin — AI connector

---

## Sources consulted for market facts

- Tire Rack affiliate page — [https://www.tirerack.com/affiliate](https://www.tirerack.com/affiliate)
- Priority Tire affiliate signup — [https://www.prioritytire.com/affiliate-signup](https://www.prioritytire.com/affiliate-signup)
- Priority Tire on Awin — [https://ui.awin.com/merchant-profile/78408](https://ui.awin.com/merchant-profile/78408)
- Blackcircles on Awin — [https://ui.awin.com/merchant-profile/99505](https://ui.awin.com/merchant-profile/99505)
- Tyroola on Commission Factory — [https://www.commissionfactory.com/advertiser-directory/tyroola-affiliate-program/23331](https://www.commissionfactory.com/advertiser-directory/tyroola-affiliate-program/23331)
- Raptive threshold change — [https://www.searchenginejournal.com/raptive-drops-traffic-requirement-by-75-to-25000-views/558780/](https://www.searchenginejournal.com/raptive-drops-traffic-requirement-by-75-to-25000-views/558780/)
- Ad network thresholds 2026 — [https://www.ritnerdigital.com/blog/how-many-sessions-a-month-makes-a-website-a-publisher-the-real-numbers-in-2026](https://www.ritnerdigital.com/blog/how-many-sessions-a-month-makes-a-website-a-publisher-the-real-numbers-in-2026)
- Discount Tire, SimpleTire, network listings — third-party affiliate directories (getlasso.co, postaffiliatepro.com, affilitizer.com); verify on application.