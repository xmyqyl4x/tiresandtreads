# P1-PR-013 remaining-P1 effort and dependency forecast

**October 25, 2026; low-confidence planning allowance, owner review pending.** This re-estimates the 30 remaining P1 cards (014–043) after the S2 gate scenario. It is based on current scope and dependencies, not measured team velocity, AI throughput or a promised launch date. [Machine-readable inputs and paths](evidence/P1/p1-pr-013-forecast.json) retain each estimate and the unchanged dependency graph.

## Estimate basis

One engineering day means one contributor working day including TDD, implementation, review, documentation and local validation. The estimates assume the assigned engineer can work effectively across backend/data/platform/frontend tasks, with timely specialist, content, privacy and owner review. Actual staffing and throughput are not established. Existing S0/S1/S2 work is sunk effort and is excluded. New persistence extensions identified by the [S2 audit](P1-PR-013-s2-contract-audit.md#first-use-extension-register) are included in their owning service allowances.

The **132–215 engineering-day** total is effort for remaining P1 only. It includes normal integration/rework and relevant validation, with separate integrated and production proofs at 041/042. Unknown procurement, licensing, hosted account/region/budget selection, external approval waits and ongoing live operations are excluded. P2–P4 retain 76 scoped cards and require their own phase rebaseline at full G0/scope lock. The historical 166–239-day package subtotal and withdrawn 16-week calendar are not current project forecasts.

## Remaining work

| Card | Scope | Engineering days |
| --- | --- | --- |
| [P1-PR-014](../tasks/phase-1-prs.md#p1-pr-014) | Implement durable jobs, private assets and runtime composition | 5–8 |
| [P1-PR-015](../tasks/phase-1-prs.md#p1-pr-015) | Implement script-first ingestion and publication services | 5–8 |
| [P1-PR-016](../tasks/phase-1-prs.md#p1-pr-016) | Integrate NHTSA and licensed domain source adapters | 4–7 |
| [P1-PR-017](../tasks/phase-1-prs.md#p1-pr-017) | Implement deterministic eligibility and recommendation rules | 8–13 |
| [P1-PR-018](../tasks/phase-1-prs.md#p1-pr-018) | Implement prices, installed costs and comparison mathematics | 4–7 |
| [P1-PR-019](../tasks/phase-1-prs.md#p1-pr-019) | Implement report, refine, compare and access services | 5–8 |
| [P1-PR-020](../tasks/phase-1-prs.md#p1-pr-020) | Implement contact, consent and suppression services | 4–6 |
| [P1-PR-021](../tasks/phase-1-prs.md#p1-pr-021) | Implement content, public tools and SEO publication services | 5–8 |
| [P1-PR-022](../tasks/phase-1-prs.md#p1-pr-022) | Implement report delivery orchestration and cancellation | 5–8 |
| [P1-PR-023](../tasks/phase-1-prs.md#p1-pr-023) | Implement webhooks, preferences, feedback and safe redirects | 5–8 |
| [P1-PR-024](../tasks/phase-1-prs.md#p1-pr-024) | Implement PostgreSQL analytics, SQL limits and operations | 4–7 |
| [P1-PR-025](../tasks/phase-1-prs.md#p1-pr-025) | Implement privacy rights, retention and recovery services | 6–10 |
| [P1-PR-026](../tasks/phase-1-prs.md#p1-pr-026) | Implement staff, affiliate, advertising and revenue services | 5–8 |
| [P1-PR-027](../tasks/phase-1-prs.md#p1-pr-027) | Close business-service gate and engine safety review | 3–5 |
| [P1-PR-028](../tasks/phase-1-prs.md#p1-pr-028) | Expose public lookup and owner assessment APIs | 4–6 |
| [P1-PR-029](../tasks/phase-1-prs.md#p1-pr-029) | Expose consent, privacy, import and staff operations APIs | 4–7 |
| [P1-PR-030](../tasks/phase-1-prs.md#p1-pr-030) | Expose provider callbacks, event intake and workflow endpoints | 3–5 |
| [P1-PR-031](../tasks/phase-1-prs.md#p1-pr-031) | Accept the complete Phase 1 API before frontend work | 3–5 |
| [P1-PR-032](../tasks/phase-1-prs.md#p1-pr-032) | Build accessible web shell and design system | 4–6 |
| [P1-PR-033](../tasks/phase-1-prs.md#p1-pr-033) | Build assessment form and reference lookups | 4–6 |
| [P1-PR-034](../tasks/phase-1-prs.md#p1-pr-034) | Build results, explanation and refinement views | 5–8 |
| [P1-PR-035](../tasks/phase-1-prs.md#p1-pr-035) | Build comparison, shop-quote and sharing views | 4–6 |
| [P1-PR-036](../tasks/phase-1-prs.md#p1-pr-036) | Build delivery, cancellation, preferences and privacy controls | 4–6 |
| [P1-PR-037](../tasks/phase-1-prs.md#p1-pr-037) | Implement production email and PDF templates | 4–7 |
| [P1-PR-038](../tasks/phase-1-prs.md#p1-pr-038) | Build editorial CMS and reviewed education website | 5–8 |
| [P1-PR-039](../tasks/phase-1-prs.md#p1-pr-039) | Build staff operations, SEO and ad-revenue screens | 5–8 |
| [P1-PR-040](../tasks/phase-1-prs.md#p1-pr-040) | Build permitted affiliate and advertising placements | 3–5 |
| [P1-PR-041](../tasks/phase-1-prs.md#p1-pr-041) | Verify the full web product and accessibility journeys | 5–8 |
| [P1-PR-042](../tasks/phase-1-prs.md#p1-pr-042) | Prove production security, capacity and recovery | 5–9 |
| [P1-PR-043](../tasks/phase-1-prs.md#p1-pr-043) | Release Phase 1 and record the usable live outcome | 2–4 |

| Stage after S2 | Effort subtotal |
| --- | --- |
| S3 services and gate | 68–111 engineering days |
| S4 APIs and acceptance | 14–23 engineering days |
| S5 product UI/templates | 38–60 engineering days |
| S6 integrated verification/release | 12–21 engineering days |

## Dependency path and delivery decisions

Assigning one owner to each card and allowing unlimited parallel capacity on independent branches gives a **91–149 working-day dependency path**. This is a graph calculation with no resource leveling, review/owner wait or external wait. It is not an elapsed delivery commitment; multiple people within a card or constrained staffing changes the model. The computed longest path is:

`014 → 015 → 016 → 017 → 018 → 019 → 022 → 023 → 025 → 026 → 027 → 029 → 031 → 032 → 033 → 034 → 036 → 041 → 042 → 043`. Card 035 ties 036 under these allowances. Full IDs have the `P1-PR-` prefix.

After owner S2 acceptance, 014 and independent 020 are dependency-ready. Runtime/data-source/engine/report/delivery/privacy/staff work carries the main backend chain; content and analytics services can progress on their own accepted dependencies. All P1 services pass 027, all APIs pass 031, then UI/templates start at 032. A frontend-only contributor does not bypass these gates. Capacity planning must assign the actual people and preserve the test/review work inside each card.

The following conditions can extend or change that path:

- Licensed fitment/pricing choices and source rights remain deferred until the accepted decision triggers. Card 016 cannot claim a real licensed integration before those choices and access exist. Synthetic service construction follows the accepted fixture policy; full G0 closes no later than 031.
- Tire-specialist review and 50 golden safety scenarios are required for the engine/service acceptance, and reviewed content/SEO/ad policy for the content/commercial cards. Those human approvals are not implied by repository tests.
- Hosting vendor, region, PostgreSQL operating model, recovery ownership and budget remain open within option C until their provisioning/integration trigger. Provider credentials, real IAM/TLS/recovery and external callbacks need hosted evidence.
- Identity, storage/KMS, workflow and email sandbox behavior must be verified at their owning cards; local substitutes do not close production acceptance. Advertising/network approval and public placements retain their own gates.

Re-estimate each card at readiness, after 014/016 expose real integration costs, and at 027/031 using measured throughput, staffed roles, remaining source/host decisions and actual failure/rework. The full four-phase G0 rebaseline remains a separate readiness obligation. No completion date is assigned here.
