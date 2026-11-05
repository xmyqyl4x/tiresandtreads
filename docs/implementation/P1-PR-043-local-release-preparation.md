# P1-PR-043 — Local release preparation; live release held

This packet completes the currently permitted preparation for the Phase 1 release card. It does not release Phase 1. The three original live-release checkboxes remain open: owner G5 approval and activation, production smoke and operations ownership, and the production URL/build/observations. The six S3 gates remain pending, HS01–HS08 proposed, and operator coverage, rates and budget unconfirmed. No provisioning, purchase, actual notification or production activation is authorized by this packet or its merge.

**Trace:** CAP-01, CORE-10, ENG-06/ENG-07, UC18, AT28, DB28 and E20. These are trace links, not acceptance claims. The approved [release gates](../04-implementation-plan.md#release-gates), [release scaffold](../../infra/release/README.md) and [local handover](../operations/phase-1-local-handover.md) continue to govern the work.

## Verified construction baseline

The [machine-readable inventory](evidence/P1/p1-pr-043-release-inputs.json) identifies the last fully verified main revision, its source tree, lockfile and separate app/CMS migration manifest hashes. At preparation time main is `03fc439c34c847b54db7ad28a1d5fced48ef3442`, with tree `9e615e3481632b3090913ec3b74cda00fd4da86f`. It contains 33 app and three CMS migrations. The PR #87 source revision and merge have the same tree; this is a verified local construction baseline, not an approved production candidate.

| Evidence | Result and limit |
| --- | --- |
| [PR #86](https://github.com/xmyqyl4x/tiresandtreads/pull/86) | Local supported/unsupported/error/browser journeys, keyboard/reflow and real email/PDF rendering into a synthetic sink; actual inbox, assistive-technology and specialist/source acceptance pending |
| [PR #87](https://github.com/xmyqyl4x/tiresandtreads/pull/87) | 2,966 full local test executions; nine PR and nine post-merge main checks verified against their actual checkout trees/logs; local quota/security/cache/mixed-load/recovery evidence |
| [Product journey evidence](P1-PR-041-local-product-validation.md) | Synthetic end-to-end observations; no live recipient or production journey |
| [Security/capacity evidence](P1-PR-042-local-security-capacity-recovery.md) | Bounded local workload and recovery; no production SLA, cost, replica, RPO/RTO or independent security certification |
| [S3 register](evidence/P1/s3-service-register.json) | Six pending gates with empty acceptance records; unchanged by this preparation |

The inventory deliberately leaves the approved candidate SHA, published registry digest, configuration version, rollback digest, environment, production URL and sign-offs null. An ignored local image ID is not a remotely published deployment digest. A later documentation or code change creates a different candidate: rebind the eventual release manifest to that exact approved revision and evidence; do not promote this historical baseline by default.

## Inputs that prevent a live release

| Input | Decision responsibility; still unassigned unless already explicitly recorded | Required completion evidence |
| --- | --- | --- |
| Specialist and licensed source acceptance | Owner, data lead, tire specialist | Actual permitted contracts/fields, supported coverage, provenance/freshness, prices and reviewed golden scenarios; close the three corresponding S3 source/specialist gates only through their defined process |
| Provider effects and privacy | Owner, backend/privacy reviewers | Accepted sender/provider configuration, purpose enforcement, notices/retention, deletion deadlines and recovery; actual delivery authentication and reconciliation; remaining provider/privacy S3 gates |
| Hosted service topology | Owner and platform/DB reviewers | Accepted HS01–HS08, real TLS/DB ownership and target limits, custody, workload and host evidence; S3-service-host acceptance |
| Operations and cost | Owner and prospective primary/backup operators | Named accepted roles, coverage/escalations, support address, independent key/journal/backup custody, rates, hours, total recurring and one-time costs, contingency and cutoff; no scenario estimate is approval |
| Complete launch experience | Product/content/accessibility reviewers | Actual 25 reviewed articles, supported journey content, screen-reader/PDF assistive-technology and inbox-client evidence, editorial acceptance and permitted live SEO ownership checks |
| Performance/security/recovery | QA/platform reviewers | Approved workload and targets, actual topology measurements, no critical/high security defects, restore/deletion replay, rollback and operator acknowledgment; local measurements alone do not accept G2/G4 |
| Commercial serving | Owner/commercial/privacy reviewers | Separate live approvals and trusted CMP/provider binding, consent/network/performance evidence, permitted publisher/affiliate identities; ads remain disabled until approved |
| Public release | Owner | G0–G5 and applicable S0–S6 evidence, exact candidate manifest, explicit controlled activation/smoke authorization and witnessed release decision |

Keep commercial approval separate from core release acceptance, as the original card requires. Leaving advertising disabled is not permission to drop committed core product, privacy, accessibility or source requirements. A smaller actual release would need an explicit owner scope amendment.

## Promotion and migration handoff for the future approved target

1. Select and review the actual environment, protected deployment identity and registry. Record server-side protections and scoped permissions; workflow names do not establish protection. Keep Linux images and standard PostgreSQL portable under option C, with app and DB outside Vercel.
2. Produce one immutable approved artifact. Bind its exact source SHA/tree and lockfile hash, published `registry/image@sha256:<64 hex>` digest, configuration version, target, app/CMS revisions and checksums, gate evidence and rollback digest. Promotion consumes that artifact and does not rebuild it. Do not put secrets or private DSNs in the manifest.
3. Review compatibility against both the current and rollback application images. Preserve the migration ledgers and existing checksums. Serialize migration ownership separately from runtime startup; use the selected target's accepted migration identity. Current local restore and migration proofs do not establish compatibility with an unselected production owner/provider.
4. Back up and witness recovery for the actual topology, including private object versions, independently held keys/journal and deletion reapplication before reopening access. Record measured recovery targets. A process restart or same-host copy does not establish independent recovery.
5. Apply only reviewed compatible migrations, verify health/readiness and drain behavior, and run explicitly permitted authenticated smoke. Roll back to the recorded compatible image/configuration if needed. Do not run destructive down migrations or erase persistent data to repair a release.
6. After explicit activation permission, verify supported and unsupported assessments, immutable reports, access isolation and optional consented delivery under the approved smoke scope. Any actual recipient notification requires permission. Record source/provider freshness, masked outcomes, performance, support/alert acknowledgment, rollback/kill-switch status and the actual production URL/release SHA.
7. Obtain the owner G5 decision with actual observations. Keep Phase 1 open if committed scope fails. Merge status and local green checks cannot substitute for the live usable outcome.

These are review requirements, not executable commands for an unknown target. Production bootstrap, CLI, preflight, admission policy, grants and deployment workflows are unchanged.

## Phase 2 dependency and next work

The next planned cards are [P2-PR-001](../tasks/phase-2-prs.md#p2-pr-001), scope/evaluation/pilot readiness, and [P2-PR-002](../tasks/phase-2-prs.md#p2-pr-002), organization/offer/coupon schemas. Their ordinary dependency is accepted Phase 1 live release plus accepted Phase 2 feasibility. Neither is satisfied here. Early local Phase 2 design/schema implementation needs an explicit sequencing exception; it must preserve actual phase acceptance, provider/rights, specialist, budget and deployment decisions. Do not infer that exception or choose a provider/model/price from a generic request to continue implementation.

## Review and verification

This is documentation and inventory work; TDD does not require artificial behavioral tests. Validate inventory hashes against repository bytes, confirm all linked evidence exists, reconcile the master ledger with merged local implementation, and preserve original source pins, six pending S3 records and all historical case statuses. Run the repository's required exact-commit build/regression and PR/main checks before merge completion. Record new run results in the PR; the baseline counts above remain historical observations from PR #87.
