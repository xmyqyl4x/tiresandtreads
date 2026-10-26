# P1-PR-026 validation evidence

**October 26, 2026 · S3 technical scope accepted; owner-approved [PR #26](https://github.com/xmyqyl4x/tiresandtreads/pull/26) merged at `ac258ac7fbe63e62791993de634cbb5ec9b2f559`.** Baseline: approved PR #25 merge `7aa1b54216b50fc687ff8990fb7edb93a83f8d4c`. See the [staff/commercial service contract](../../P1-PR-026-staff-commerce-revenue.md).

## TDD and scope

The initial unit policy suite failed with the domain module absent; the initial database/application suite failed with the integration factory absent. Implementation then passed domain policy and real PostgreSQL scenarios. A fixture initially named a webhook column incorrectly; it was corrected to the actual signature-verification column without weakening the schema. Domain UTC arithmetic was kept pure after lint rejected use of host `Date` in that layer.

Tests cover route/shape/consent rejection, house fallback, category/URL gates, approved origins, bounded aggregate arithmetic, current roles/reviewer separation, concurrent CAS publication, masked queue pagination, role revocation, once-per-receipt recovery, failed/unknown recovery without resending, stale affiliate checks, suspended terms/accounts, global kill switch, real engine-output parity, exact revenue ratios, omitted-dimension/currency replacement, negative/finalized/empty corrections, complete-batch rollback and immutable approved history. A 10,000-callback fixture measures the actual indexed masked query. External mail, privacy recovery and affiliate checker ports use explicit fixtures; no live provider acceptance is inferred.

## Measured verification

`pnpm verify:push` passed on implementation commit `a06226e9263e336093892c99bb7207cddba118e1` at `2026-10-26T18:12:08.489Z`. The [redacted machine record](p1-pr-026-verification.json) pins that complete run. The final documentation/review commit receives the same complete exact-commit gate before push, followed by independent GitHub CI.

| Check | Observed result |
| --- | --- |
| Unit/use-case | 675 passed; 21 new commercial policy tests |
| Database/provider | 269 passed; 21 new real-role staff/commercial service scenarios |
| Foundation/schema/recovery | Six / 63 / 11 passed |
| Total | **1,024 passing tests**, including 42 new tests |
| Coverage | 97.29% lines, 94.01% statements, 98.58% functions, 90.14% branches; thresholds unchanged |
| Quality/build | Frozen Linux build/advisory audit, hygiene, formatting, lint, TypeScript, 203-module boundaries, health contract and migration checksums passed |
| Storage | 141 app tables, 53 views, 1,780 table/view columns, 28 CMS tables; 32 app/three CMS migrations; generated Drizzle parity passed; 250 codec fields/25 fact families unchanged |
| Queue profile | 10,000 synthetic callbacks; indexed query returned 100 rows in 0.105 ms; local synthetic measurement only |
| Runtime/failure handling | Seven deliberately invalid verification cases rejected; standalone production bundles, shutdown/configuration refusal and HTTP health passed |
| Recovery | Actual application/CMS dump/restore passed with synthetic data, including full leading FK indexes, fresh roles, corrupt archive refusal, current journal, incomplete deletion and CMS crash retry |
| Documentation | 119 cards, 137 original FR rows, dependencies, source archives and historical approvals preserved; 75 checked tasks/282 unchecked |

Retained Docker dev/stage both have **32 app/three CMS applied, zero pending**, and are stopped with volumes retained. Only the two new role credentials were added; every previous credential value was preserved. Native PostgreSQL and unrelated projects were untouched. Disposable test/recovery projects were removed with their own volumes. The first complete run caught a missing-link error-contract mismatch; the repository was corrected to return `not_found`, and the full gate passed without weakening tests, constraints or checks.

## Remaining gates

Headless S3 only. Actual staff identity/MFA, HTTP/browser/admin UI, real affiliate/network contracts, production link checker, network ads.txt validation, CMP protocol, vendor block synchronization, invalid-traffic monitoring, field performance and actual provider financial reconciliation remain required at their stage/activation gates. No live ads are clicked and no provider approvals or staff assignments are seeded. Specialist review and licensed adapters remain pending; 98 draft scenarios/zero actual specialist reviews. Report issuance, real email and product collection remain disabled. P1-PR-027 must preserve those distinctions when assembling S3 evidence.
