# P1-PR-019 validation evidence

**October 25, 2026 · technical implementation for review; specialist/source acceptance pending.** Baseline: owner-approved PR #18 merge `752760736ecc9ab70186503bf27cd942768f7e83`. See the [implementation contract](../../P1-PR-019-report-services.md). The owner explicitly retained specialist review and licensed adapters as pending when authorizing 019. Actual named specialist reviews remain zero; DD01/DD02/DD06/G1 and verified production issuance remain open.

## TDD and workflow evidence

The initial report-record test failed before its implementation module existed. Unit/use-case tests then exercised exact canonical JSON/money, source/right/region/freshness binding, unavailable source contracts, quote quantities/tax/service declarations, known-but-incompatible products, unknown evidence, DTO redaction, HMAC audience separation and retained bearer-key versions. Stable command identities survive bearer-key rotation. Pure scenario/ranking mathematics stays in the existing engine; no paid terms enter it.

Real restricted-role PostgreSQL tests exercise concurrent duplicate creation with one immutable outcome, original-receipt replay after later edits/data failure, draft revision conflicts, immutable refinement/diffs, encrypted quote text, fixed/latest and chosen-comparison shares, forks, PDF scope, owner/share revocation races, quote edits racing comparisons and complete rollback on receipt failure. Owner retrieval decrypts outside SQL and rechecks permission. Historical report output remains fixed while the live safety overlay can add a warning; failed refresh cannot clear a known historical match.

The policy-head proof keeps published rule documents unchanged while moving the explicit regional pointer. Role tests separate catalog/private/source metadata access. Batch reads enforce pinned source rights, bounded identities and permitted fields. The report-source role reuses the existing approval-digest/current-rights/exact-dataset/48-hour recall check, with only metadata and lock privileges. Synthetic source/reviewer fixtures establish technical behavior, not actual licensed coverage or specialist review.

## Verification status

The preliminary disposable Linux coverage run passed **562 unit/use-case/database tests** before the final two source-rights/expiry cases and additional metadata-role assertions. It reported 96.40% lines, 93.03% statements, 97.87% functions and 88.93% branches; all existing thresholds passed. Quality checks passed source hygiene, formatting, lint, TypeScript, 141-module boundaries, the health contract and 23 app/two CMS migration checksums. The final clean committed source will run the complete Linux build/advisory/coverage/runtime/failure-gate/recovery suite before push; the redacted record and final head will be recorded here and in PR #19.

Storage parity is **124 application tables, 40 views and 1,605 table/view columns**, 250 codec fields/25 fact families and 28 CMS tables. Migration 0023 preserves previous migration checksums and adds the explicit policy pointer, share-comparison binding, scalar receipt fields and narrowed source-metadata role. Both retained Docker dev/stage targets passed bootstrap/migrate/status with **23 app/two CMS applied, zero pending**, then were stopped with their volumes retained. Bootstrap added only the missing role credential; existing credentials and native PostgreSQL were untouched.

The preliminary projects and fixture volumes were removed by exact identity. The final run will independently prove backup/restore and deletion replay at the new schema. Documentation preserves all 119 cards, original 137 FR rows, dependency edges, source archives and historical approvals; 54 technical tasks are checked and 303 remain unchecked. The full 016/017/018/019 cards retain their recorded external acceptance gates.

## Acceptance limits

All reports and comparisons remain technical evaluations with `issuanceAuthorized: false`. The repository-backed resolver requires actual current source rights, published regional policy/head, reviewed freshness and current recall receipt. Missing mappings do not establish positive recall clearance. Licensed provider contracts, positive clearance/marking/inspection coverage, genuine reviewer identities and specialist explanation/calibration acceptance remain pending. The 98 draft specialist scenarios from 017 are unchanged and have zero actual named reviews.

Private quote encryption is composed through the existing context-bound envelope adapter; workflow tests use an explicit ciphertext substitute, and the earlier 014 Moto/KMS/object proofs remain regression gates. Local substitutes do not accept hosted key custody or provider behavior. New capability code has deterministic audience/key-version tests; production secret custody/rotation and transport-level review remain required.

PDF authorization covers an already registered scoped asset; actual rendering belongs to 022. Authentication transport/anonymous-session establishment, public HTTP/CSRF/abuse contracts, physical privacy/retention jobs, UI/browser accessibility and hosted/live-release acceptance remain at later cards. No public route, frontend, paid provider, dependency or hosted activation is introduced.
