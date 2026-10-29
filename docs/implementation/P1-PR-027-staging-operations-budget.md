# P1-PR-027 — HS05 operator responsibilities and HS04 full staging budget

**October 28, 2026 (Pacific) · Proposed details in review; no staffing, spending or host selection.** Baseline is owner-approved merged [PR #40](https://github.com/xmyqyl4x/tiresandtreads/pull/40), `8965bd72f1a7746191511756b7df159ee2450a25`, accepting SP08's local handoff only. The owner authorized defining HS05/HS04 while all HS01–HS08 remain proposed, all six S3 gates open with empty records, specialist/licensed work pending and APIs/frontends held. No provisioning, purchases, notifications, cloud authentication, account creation or deployment.

The [operator responsibilities](../operations/staging-operator-responsibilities.md), [integer-cent budget model](evidence/P1/p1-pr-027-staging-operations-budget.json), [fresh public sources](evidence/P1/p1-pr-027-operations-budget-sources.json) and [validation receipt](evidence/P1/p1-pr-027-operations-budget-validation.md) form one proposed decision supplement under existing P1-PR-027. This is not frontend/commercial task P1-PR-041. The earlier [staging packet](P1-PR-027-private-hosted-staging-decision.md) and [SP08 handoff](P1-PR-027-local-evidence-handoff.md) remain the historical baseline. Four live phases, option C, PostgreSQL consolidation and database → repositories → services → APIs → UI remain unchanged.

## Decision recommendation and limits

For review, use **USD 350/month for recurring infrastructure**, with a **separate USD 100/month temporary-resource envelope, at most USD 100 per event**. Model one combined restore/rollout trial window per month, not unlimited events. These are proposed funding envelopes, not approved ceilings, supplier quotes or total operating cost. Actual labor, standby/support, tax/FX, local costs and one-time setup/review costs must be added or explicitly resolved. All approved values remain null.

The expanded base model is **USD 284.10/month service allocation + USD 56.82 planning contingency = USD 340.92** before labor/tax/support/local costs. Adding a fully used USD 100 temporary reserve gives **USD 440.92** as a planning envelope, while the rounded proposed resource ceilings total USD 450. Do not add these two alternative expressions together. Contingency and unspent reserves are not invoices.

The historical USD 175 proposal and USD 161.88 base envelope omitted a defensible paid workflow tier and several separate cost categories. They remain preserved as historical planning data and are **insufficient for this expanded model**. This supplement refines the HS04 proposal; it does not approve the increase. A complete category inventory is now defined, but a funded all-in amount remains unknown until actual commercial/staffing inputs are confirmed.

## Operator responsibilities and staffing cost

HS05 now defines budget/account owner, primary and distinct backup operator, DB/recovery owner, security/key custodian, privacy reviewer and release/evidence reviewer. The [responsibility matrix](../operations/staging-operator-responsibilities.md#responsibility-matrix) assigns one accountable role per activity, evidence duties and independent review for sensitive changes. Qualified people may hold several roles; this does not appoint anyone or create two-person coverage from one person.

Actual people, acceptance dates, IANA time zone, coverage windows, hourly rates/retainers, contact methods and alert destinations remain **unconfirmed/null**. Codex is not appointed as a responder or on-call operator. The staffing question remains open; absent a reply, no name, availability or rate is inferred.

| Combined routine effort | Managed DB hours/month | Notes |
| --- | --- | --- |
| Health/schedules/capacity/private-access review | 3 | Staffed test windows; not continuous monitoring labor |
| Backup checks, scoped restore and DB housekeeping | 3 | One combined trial window; additional drills/incidents cost extra |
| Release/rollback and patch verification | 2 | One routine change window |
| Key/access/security review | 1 | Scoped approved changes only |
| Billing/inventory/retirement reconciliation | 1 | Includes persistent cost after stopping resources |
| Backup-operator rehearsal and handoff | 2 | Combined person-hours, including peer participation |
| **Total** | **12** | Hands-on estimate, not 24×7 standby or a staffing commitment |

Initial setup allowance is 28 combined hours (access four, configuration/network six, DB/provider/restore compatibility eight, observation/drill four, evidence/handoff six). Self-operated DB comparison adds eight setup hours and six routine hours/month. Actual compatibility problems can exceed these estimates. Independent policy/security/specialist work and paid support/on-call retainers need separate quotes. If a contract bundles included hours, subtract those hours before adding usage charges.

## Recurring candidate model

USD; one private synthetic staging environment for a full month. Listed prices were checked on October 28 Pacific / October 29 UTC using public official pages only. Exact region/account/edition/term/feature eligibility is unverified. DigitalOcean, Inngest and Tailscale appear as **pricing examples**, not selected providers. No credits, personal-use eligibility, free plans or speculative revenue are needed for the base model.

| Category | Monthly USD | Basis and scope |
| --- | --- | --- |
| Linux app VM | 24.00 | Listed Basic Regular 4 GiB / 2 vCPU; included app disk/transfer allocation |
| Managed PostgreSQL | 60.90 | Listed minimum Standard 4 GiB / 2 vCPU / 60 GiB; one primary, separate app/CMS logical DBs |
| Daily app VM backup | 7.20 | Listed 30% of app VM; convenience OS backup, separate from independent DB/journal custody |
| Active synthetic objects/requests | 2.00 | **Unquoted allowance**; 10 GiB effective bytes including versions; 10k writes/100k reads monthly |
| Independent encrypted DB/journal/object backup | 10.00 | **Unquoted allowance**; 100 GiB total retained effective bytes including generations/copies and verification requests |
| KMS and scoped secret custody | 8.00 | **Unquoted allowance**; four key identities + two charged rotation increments total + USD 2 request/secret allowance; more versions/replicas require repricing |
| Private release registry | 5.00 | Listed Basic 5 GiB plan; current/previous releases, not all tooling/build cache |
| Private operator access | 16.00 | Listed commercial Standard USD 8 × two seats; feature/billing-term eligibility unverified |
| Identity/MFA and credential vault | 10.00 | **Unquoted allowance**, separate from private-connectivity seats |
| Masked logs/metrics/health/incident handling | 20.00 | **Unquoted allowance**; up to 1 GiB/day ingest, 14-day engineering retention proposal; no actual notification configured |
| Domain renewal/DNS allocation | 2.00 | **Unquoted** USD 24/year amortized; annual cash timing differs; existing allocation counted once |
| Hosted workflow service | 99.00 | Listed Pro starting price; quota/other limits still need acceptance |
| CI/artifacts/build-cache allocation | 15.00 | **Unquoted allowance**; 100 ten-minute Linux jobs and 5 GiB retained artifacts/cache; actual account billing must replace it |
| Excess transfer/disk/routine retrieval | 5.00 | **Unquoted allowance**; up to 20 GiB external transfer; region/cross-provider/retained storage costs rechecked |
| **Service allocation subtotal** | **284.10** | Not a complete supplier quote |
| **Planning contingency, 20%** | **56.82** | Reserve, not a billed service |
| **Modeled recurring infrastructure envelope** | **340.92** | Excludes unresolved labor/tax/support/local amounts |

Compute/database minimums: [Droplet prices](https://www.digitalocean.com/pricing/droplets), [PostgreSQL prices](https://www.digitalocean.com/pricing/managed-databases). Daily VM backup percentage: [backup prices](https://docs.digitalocean.com/products/backups/details/pricing/). Registry capacity/tier: [registry prices](https://www.digitalocean.com/pricing/container-registry). These components do not accept hosting or provide HA. Included minimum DB storage/provider backup features are not charged a second time; independently controlled copies are separate.

Two access seats use the listed commercial plan; the personal plan is not assumed eligible. Confirm MFA/IdP, independent reviewer access, tagged resources and CI connectivity before acceptance. [Tailscale pricing](https://tailscale.com/pricing). Object/backup/secret rows remain allowances: resolve region, effective bytes including old versions, key rotations/replicas, operations, retrieval/replication and egress before procurement. [S3 dimensions](https://aws.amazon.com/s3/pricing/), [KMS dimensions](https://aws.amazon.com/kms/pricing/). Included transfer/storage and paid bundles must be credited before adding excess charges.

The log allowance is not an assertion that a supplier supports the proposed retention/access/export policy for USD 20. Include collector CPU/disk if self-hosted and revise the app footprint or quote a separate host; do not silently add an unbudgeted process or SQL pool. Domain/DNS/TLS paid minimums, registry growth beyond 5 GiB, more operator seats, premium security features and higher CI storage/runner usage invalidate their allowances until replaced. GitHub plan usage is not assumed free. [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Workflow metering: why a free plan is not the base

The current [local workflow definitions](../../packages/integrations/src/workflows.ts) register reconciliation every minute, and maintenance every minute when composed. Each scheduled run has at least one durable step. If that unchanged full-host shape ran continuously for 31 days, the minimum projection is `31 × 1,440 × 2 functions × (1 run + 1 step) = 178,560` executions, before recovered jobs, events, retries or replays. This is a sizing inference, not a deployed cloud measurement or an implemented/accepted hosted adapter.

Inngest lists Free 50,000 executions, Pro from USD 99 with one million, and metering for both runs and steps. The projected schedule alone exceeds Free. Trace/span/concurrency/worker/event limits are separate; Pro's built-in history does not establish the proposed independent log policy. [Inngest pricing and metering](https://www.inngest.com/pricing). No cadence, function registration, policy or code changes are made to fit a free quota. A later bounded-window or different-metering proposal would need workload/behavior review, new costing and actual contract acceptance; its savings are not included here.

## Temporary resources, setup and billing timing

| Separate resource allowance, one event | USD | Basis |
| --- | --- | --- |
| Extra app/rollback trial VM | 24.00 | Conservative full candidate app-month reservation |
| Isolated restore PostgreSQL cluster | 60.90 | Conservative full candidate DB-month reservation |
| Additional restore bytes/requests/transfer | 10.00 | Unquoted incremental allowance; steady retained copies excluded |
| **Modeled event allocation** | **94.90** | Before tax/operator work |
| **Proposed event and monthly ceiling** | **100.00** | At most one combined trial window/month; separate approval required |

This reserves a full service-month conservatively; actual short-lived billing must follow the chosen provider's rules, not an invented monthly/730 discount. A proposed 24-hour resource review and 48-hour maximum test TTL are operational review targets, not installed automation. Additional events, concurrent trials, larger restored volumes, longer rollout overlap or unexpected residual charges need a revised request. A reserve is not permission to create or delete resources.

Stopping compute may leave billed disks, snapshots, backups, keys, addresses or subscriptions. Record exact resource IDs/owner/expiry and verify invoice reconciliation after safely retiring resources. Preserve applicable custody/retention evidence and keys; do not delete recovery material to force compliance with a budget. No resource lifecycle controller, billing alert or actual notification is created by this document.

One-time allowances: four security devices at an **unquoted USD 50 each = USD 200**, with a proposed USD 250 hardware envelope; 28 managed-DB setup person-hours (36 self-operated); and separately quoted independent reviews. If the USD 24 annual domain allocation is actually paid in month one, replace its USD 2 monthly allocation with the USD 24 cash invoice (**USD 22 timing adjustment**). Do not add both full annual cash and monthly amortization as separate expenses. Existing equipment or prepaid domains can reduce incremental cash only after confirmation; economic allocation remains visible.

## Full operating cost, scenarios and unknown inputs

Actual monthly cash is **service invoices including actual usage + invoice tax/FX + incremental paid operator hours × agreed rate + support/coverage retainers + incremental local bills + actual temporary resource bills**. A funding plan can add contingency and temporary reserves; those are not actual spend. The following illustrations use the modeled recurring envelope and an arbitrary USD 75/hour sensitivity, **not a market-rate quote or approved rate**:

| Planning illustration | Monthly envelope before tax/support/local/temporary costs | Initial setup labor before hardware/reviews/tax |
| --- | --- | --- |
| Managed DB; accepted unpaid operator effort, if later agreed | 340.92 plus 12 unpaid person-hours | 28 unpaid person-hours |
| Managed DB; illustrative paid effort at USD 75/hour | **1,240.92** = 340.92 + 12 × 75 | **2,100.00** = 28 × 75 |
| Self-operated DB; illustrative paid effort at USD 75/hour | **1,655.28** = 305.28 + 18 × 75 | **2,700.00** = 36 × 75 |
| Managed DB; illustrative USD 150/hour | **2,140.92** = 340.92 + 12 × 150 | **4,200.00** = 28 × 150 |

The self-operated service model substitutes a separate USD 24 DB VM plus USD 7.20 daily DB-VM backup for USD 60.90 managed DB, preserving independent copies and other lines: USD 254.40 subtotal + 20% = **USD 305.28**. Its USD 35.64 infrastructure saving does not price additional operational risk or staffing. Extra hours are estimates and need acceptance; no self-operated fallback is selected.

The higher-usage scenario replaces app size/backup, active objects, backup storage, keys, registry tier, a third access seat, identity, observation, CI and excess-transfer allocations: **USD 420.30 subtotal + USD 84.06 reserve = USD 504.36**, before labor/tax/support/local/temporary costs. Exact replacement amounts are in the JSON model. It exceeds the proposed USD 350 infrastructure envelope and cannot be authorized through the base proposal. A different DB edition, AWS deployment, HA, load balancer or NAT would require a new topology/quote rather than inheriting this total.

Unresolved amounts remain **null, not zero**: actual operator rate/availability, standby/support retainer, billing tax/FX, independent policy/security review, local machine/electricity/internet/license allocation and any additional paid tier. Paid labor is cash; unpaid effort can be valued separately as economic cost without charging the same hours twice. New hardware, cloud dev clusters and subscriptions are not presumed purchased.

No ESP subscription or actual sends, AI inference/vision, licensed feeds, public frontend/CDN/load balancer, product advertising/CMP/analytics subscription or mobile/plugin distribution is activated or provisioned in this staging scope. Their planned incremental resource quantity is zero **because the activity remains held**, not because suppliers are free. Actual provider acceptance, sender/domain requirements, support minimums or later scope changes require new pricing and authorization. [Email pricing reference](https://resend.com/pricing). Production costs and a usable live-phase release remain separate obligations.

## Budget controls and next review

Proposed future checkpoints for an approved recurring envelope are 50% forecast review, 80% owner review of anomalies and optional work, and 100% refusal of new optional resources pending a revised plan. Forecast the full month, outstanding annual renewals and committed resource retention; a low current invoice is not remaining budget. Track temporary event/month totals separately. Vendor billing alerts do not enforce a hard cap, and this document enables none. Required security/custody work is not silently stopped or deleted at a threshold.

Before HS04/HS05 can become approved, record named willing primary/backup and DB/key/review owners, accepted coverage, actual rates or unpaid capacity, billing entity/currency, complete chosen-plan quotes, taxes/FX/support/local amounts, recurring and event/month ceilings, setup/review allowances and explicit approvers. Resolve the coverage gap against existing recovery targets. All actual assignment/approval fields remain null now.

The next review is these specific staffing and funding inputs, followed by a joint HS01/HS02 compatibility/cost decision. No extra runtime feature or hosted proof is justified by this proposal alone. All six actual gates remain open and even a future host decision does not release the API hold. Proposal merge accepts definitions/calculations only; provisioning, purchases, notifications and real-provider work require separate explicit authorization.

A separate [verification prerequisite](evidence/P1/p1-pr-027-operations-budget-validation.md#security-prerequisite-discovered-by-verification) scopes Payload’s transitive scalar dependency to its audited fixed release. It does not change operator assignments, budgets, product routes, framework versions or acceptance authority.
