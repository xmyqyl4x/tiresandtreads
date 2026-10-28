# P1-PR-027 — SP01–SP02 local preflight validation

**October 27, 2026 · Local technical evidence; no hosted acceptance.** Baseline: merged PR #33, `7d0849b7e2c8618856da2c8968b2e3e8c8709c38`. [Implementation contract](../../P1-PR-027-local-hosted-preflight.md). HS01–HS08 remain proposed; all six S3 gates are pending, specialist/licensed work pending and APIs held. No remote provisioning, purchases, credentials, account access or provider effects are part of these tests.

## TDD and focused evidence

The initial unit run failed because the new configuration module did not exist. Configuration and inspector implementation followed. A later migration-manifest assertion failed before the complete ordered digest contract and fixed session options were added. Early real-database tests also exposed a fixture ownership-change/CONNECT-grant ordering error; fixture setup/cleanup was corrected without loosening the inspector or bootstrap. These are implementation iterations, not accepted passing runs.

The self-contained `pnpm verify:db-preflight` run then passed **15 tests in two files** on Linux Node 24.22.1 / pnpm 11.25.0 / PostgreSQL 18.6. The dedicated `tt-test-e7b9baf625213d47` project completed at approximately 20:31 UTC and was removed with its volumes. TypeScript validation also passed. The final full gate must include the later expanded CLI file/version/history assertions in the same test, and is reported against the exact committed SHA in the pull request/checks; this earlier focused run is not relabeled as that later evidence.

| Test group | What is demonstrated |
| --- | --- |
| Five unit cases | Explicit verified TLS options; ordered unique bounded migration manifest; remote/native/query/hash/wrong-role/cross-target refusal; disposable environment and insecure-option refusal; redaction and unchanged original local-host guards |
| Actual successful connections | Application and CMS migrators verify the synthetic CA/name and server TLS; read-only status and all 19 roles are checked; before/after schema inventories match |
| Real adverse TLS | Unrelated CA, hostname mismatch, expired server certificate and plaintext-only PostgreSQL refuse; restored fixture configuration becomes healthy again |
| Incompatible structure/privileges | Wrong database/schema/relation owner, missing/unsafe role, PUBLIC/default and cross-database privilege drift are detected without repair |
| Actual role creation | Non-superuser CREATEROLE creates automatic ADMIN membership with inheritance/SET disabled; preflight reports membership; the original bootstrap refuses and leaves membership intact |
| Version/history | Wrong engine minor/count and a different SHA-256 at the same migration count are incompatible; the original target remains unchanged |
| Process boundary | CLI success and redacted failures, plus final-gate assertions for wrong canonical version/history, group/world permissions, symlink, malformed JSON and oversized file |

No live parameter file, credentials, certificate bytes, database data or raw failure exception is included in this receipt. The committed tests and diagnostic reproduce the evidence in a new disposable project. The read-only inspector does not run the administrative fault injections; only the isolated test harness does so.

## Final revision validation requirements

Before push, commit the complete change and run `node scripts/verify/push.mjs` with a clean worktree. Its `.local/verified-commit.json` is private local output tied to the exact SHA/tree/lockfile. The PR body and GitHub checks record the measured totals, coverage and final-head outcome. A source change requires fresh exact-commit verification; an older stamp is not reused.

The mandatory gate includes advisory audit, source hygiene, formatting, lint, type checking, dependency boundaries, generated contracts, migrations/models and pending-S3 checks; combined unit/use-case/database coverage; mutation/negative gates; foundation/schema/HTTP checks; startup/shutdown; independent database dump/restore; provider restart/deletion evidence; and Linux production builds. The new focused tests participate in the ordinary combined gate. `pnpm verify:db-preflight` is a convenience diagnostic, not a substitute for that gate or strict S3 acceptance.

The documentation audit verifies 119 original cards (43/27/25/24), dependency edges, 137 FR rows, 75 checked / 282 unchecked original tasks, historical approval sections, source archives and all 15 readiness receipt digests. The acceptance-register audit permits only added local evidence, and the decision-register audit permits only SP01/SP02 local-progress fields. All six actual gate records remain empty; acceptance/public/API flags remain false. Current repository/check evidence must be inspected before merge; this document does not predeclare a future successful run.

## Limits

This receipt records local compatibility only. It is not a full schema/semantic ACL fingerprint, selected-provider bootstrap or restore proof, private network/access test, hosted runtime TLS rollout, CA rotation test, independent hosted custody or staffing acceptance. The existing broader schema/RLS/ACL/recovery regressions remain required. No retained local environment, native PostgreSQL, schema migration, product API or frontend is changed by this work. The parent P1-PR-027 and all six S3 gates remain open.
