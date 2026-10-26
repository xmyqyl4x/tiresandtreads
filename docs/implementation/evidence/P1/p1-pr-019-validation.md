# P1-PR-019 validation evidence

**October 25, 2026 · technical implementation approved and merged as PR #19 at `2bacfc78`; specialist/source acceptance pending.** Baseline: owner-approved PR #18 merge `752760736ecc9ab70186503bf27cd942768f7e83`. See the [implementation contract](../../P1-PR-019-report-services.md). The owner explicitly retained specialist review and licensed adapters as pending when authorizing 019. Actual named specialist reviews remain zero; DD01/DD02/DD06/G1 and verified production issuance remain open.

## TDD and workflow evidence

The initial report-record test failed before its implementation module existed. Unit/use-case tests then exercised exact canonical JSON/money, source/right/region/freshness binding, unavailable source contracts, quote quantities/tax/service declarations, known-but-incompatible products, unknown evidence, DTO redaction, HMAC audience separation and retained bearer-key versions. Stable command identities survive bearer-key rotation. Pure scenario/ranking mathematics stays in the existing engine; no paid terms enter it.

Real restricted-role PostgreSQL tests exercise concurrent duplicate creation with one immutable outcome, original-receipt replay after later edits/data failure, draft revision conflicts, immutable refinement/diffs, encrypted quote text, fixed/latest and chosen-comparison shares, forks, PDF scope, owner/share revocation races, quote edits racing comparisons and complete rollback on receipt failure. Owner retrieval decrypts outside SQL and rechecks permission. Historical report output remains fixed while the live safety overlay can add a warning; failed refresh cannot clear a known historical match.

The policy-head proof keeps published rule documents unchanged while moving the explicit regional pointer. Role tests separate catalog/private/source metadata access. Batch reads enforce pinned source rights, bounded identities and permitted fields. The report-source role reuses the existing approval-digest/current-rights/exact-dataset/48-hour recall check, with only metadata and lock privileges. Synthetic source/reviewer fixtures establish technical behavior, not actual licensed coverage or specialist review.

## Full verification

`pnpm verify:push` passed on implementation commit `7fbeeccf35e2852423503844ea3ca4a5d7fe010c` at `2026-10-26T02:09:47.369Z`. The [redacted record](p1-pr-019-verification.json) captures that run. The final evidence/documentation commit is verified again before push; its exact head and independent CI status are recorded in [PR #19](https://github.com/xmyqyl4x/tiresandtreads/pull/19).

| Check | Observed result |
| --- | --- |
| Unit/use-case | 447 passed, including 67 new report/quote/DTO/capability/resolver cases |
| Database/provider | 117 passed, including 14 new report workflow/transaction/access cases; the existing source suite also proves the new metadata role's readiness read and denied feed update |
| Foundation/schema/recovery | Six / 63 / 11 passed |
| Total | **644 passing tests**, including 81 new report tests |
| Coverage | 96.49% lines, 93.09% statements, 97.98% functions, 89.17% branches; thresholds unchanged |
| Quality/build | Frozen Linux production build/advisory audit, source hygiene, formatting, lint, TypeScript, 141-module boundaries, health contract and reviewed migration checksums passed |
| Storage | 124 app tables, 40 views, 1,605 table/view columns, 250 codec fields/25 fact families, 28 CMS tables; 23 app/two CMS migrations; generated Drizzle parity passed |
| Failure propagation | Seven deliberate verification failures rejected |
| Runtime | Production image stop/restart, worker/import/source CLI loading and invalid hosted-configuration refusal passed |
| Recovery | Separate synthetic backup/restore/deletion replay passed at 23 app/two CMS, including corrupt restore, stale/missing journal, incomplete deletion and inter-database crash retry |
| Documentation | 119 cards/137 original FR rows/dependency edges/source archives/historical approvals preserved; 54 checked tasks/303 unchecked |

The initial missing-module red test preceded implementation. Preliminary runs exposed a bigint test-serialization issue and an attempted edit of an immutable published rule; the corrected tests use exact canonical JSON and explicit policy-head movement. The final suite above includes the extra rights/expiry cases, known-warning fallback and real metadata-role permission proof. No failing safety, authorization or money test is skipped or quarantined.

Both retained Docker dev/stage targets passed bootstrap/migrate/status with **23 app/two CMS applied, zero pending**, then were stopped with their volumes retained. Bootstrap added only the missing source-metadata role credential and preserved existing credentials. Native PostgreSQL and unrelated Docker projects were untouched.

Disposable projects `tt-test-3798d5766cd85201` and `tt-test-083ee1bc511e1913` and their fixture volumes were removed by exact identity; preliminary verification projects were also removed. Local synthetic logical restore does not establish hosted RPO/RTO, PITR or external-provider/object recovery.

## Acceptance limits

All reports and comparisons remain technical evaluations with `issuanceAuthorized: false`. The repository-backed resolver requires actual current source rights, published regional policy/head, reviewed freshness and current recall receipt. Missing mappings do not establish positive recall clearance. Licensed provider contracts, positive clearance/marking/inspection coverage, genuine reviewer identities and specialist explanation/calibration acceptance remain pending. The 98 draft specialist scenarios from 017 are unchanged and have zero actual named reviews.

Private quote encryption is composed through the existing context-bound envelope adapter; workflow tests use an explicit ciphertext substitute, and the earlier 014 Moto/KMS/object proofs remain regression gates. Local substitutes do not accept hosted key custody or provider behavior. New capability code has deterministic audience/key-version tests; production secret custody/rotation and transport-level review remain required.

PDF authorization covers an already registered scoped asset; actual rendering belongs to 022. Authentication transport/anonymous-session establishment, public HTTP/CSRF/abuse contracts, physical privacy/retention jobs, UI/browser accessibility and hosted/live-release acceptance remain at later cards. No public route, frontend, paid provider, dependency or hosted activation is introduced.
