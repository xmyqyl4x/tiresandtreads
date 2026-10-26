# P1-PR-027 validation evidence

**October 26, 2026 · Technical validation in review as [PR #27](https://github.com/xmyqyl4x/tiresandtreads/pull/27); full S3 acceptance stays open.** Baseline: PR #26 merge `ac258ac7fbe63e62791993de634cbb5ec9b2f559`. [Contract](../../P1-PR-027-s3-validation-gate.md), [disposition](../../P1-PR-027-s3-gate-review.md).

## TDD and scope

Maintenance tests first failed with the module absent. Real PostgreSQL journeys exercise source refusal, report/consent/cancellation/erasure interactions, privacy selection behind 101 manual cases, notification expiry and masked alarms. Fixtures align synthetic notice policy with stored notices and use actual schema references. No trigger, FK or identity constraint is disabled. Settling time advances only without in-flight real external I/O.

Evidence/encryption/mail/object/journal and empty source/CMS bindings in the new combined fixture are explicit technical stand-ins. Existing real repositories, separate Payload, source adapters, local AWS-compatible and workflow tests run again in the full gate. Their success cannot close licensed-source/provider/specialist acceptance. The actual catalog-backed report factory refuses absent trusted coverage.

## Measured verification

`pnpm verify:push` passed on implementation commit `b8225e7b3a766ba9dd4b95a01284ab82e2bd4509` at `2026-10-26T19:12:14.050Z`. The [redacted machine record](p1-pr-027-verification.json) pins that complete run. The final documentation/review commit receives the same complete exact-commit gate before push, followed by independent GitHub CI. This is technical verification; it does not close S3 acceptance.

| Check | Observed result |
| --- | --- |
| Unit/use-case | 686 passed; 11 new gate/maintenance tests |
| Database/provider | 277 passed; eight new combined real-role journeys |
| Foundation/schema/recovery | Six / 63 / 11 passed |
| Total | **1,043 passing tests**, including 19 new tests |
| Coverage | 97.3% lines, 94.06% statements, 98.67% functions, 90.19% branches; thresholds unchanged |
| Quality/build | Frozen Linux build/advisory audit, hygiene, formatting, lint, TypeScript, layer boundaries, health contract and migration checksums passed |
| Storage | 141 app tables, 54 views, 1,785 table/view columns, 28 CMS tables; 33 app/three CMS migrations; generated Drizzle parity passed; 250 codec fields/25 fact families unchanged |
| Gate inventory | 14 component cards/all 26 application service modules; six pending actual-evidence gates; acceptance false; strict command exits 2 as required |
| Runtime/failure handling | Seven deliberately invalid verification cases rejected; standalone production bundles, shutdown/configuration refusal and HTTP health passed |
| Recovery | Actual application/CMS dump/restore with synthetic data, including ownership/ACL/leading FK indexes, fresh roles, corrupt archive refusal, journal/quarantine/incomplete deletion and CMS crash retry |
| Documentation | 119 cards, 137 original FR rows, dependencies, source archives and historical approvals preserved; 75 checked tasks/282 unchecked |

Retained Docker dev/stage both have **33 app/three CMS applied, zero pending**, and are stopped with volumes retained. No role credential was added or replaced. Native PostgreSQL and unrelated projects were untouched. Disposable test/recovery projects were removed with their own volumes.

The first coverage run caught an incorrect test expectation for an invalid maintenance result: the project contract redacts unknown failures to `unavailable`. The expectation now follows that existing contract. Combined-fixture setup was corrected to match stored notice policy and schema references; stale-token refusal uses an otherwise valid event batch. No coverage threshold, constraint, trigger or gate was weakened.

## Acceptance result

`s3:check` verifies the inventory; `s3:acceptance` must fail with the current pending evidence. The [register](s3-service-register.json) preserves 98 draft cases/zero actual specialist reviews and pending provider/source/privacy/host proof. Full S3/G1/G2 and dependent endpoint work remain open/held. Four live phases, PostgreSQL consolidation, app/DB outside Vercel and APIs before UI remain unchanged.
