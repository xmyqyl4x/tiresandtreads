# P1-PR-027 local-host validation

**October 26, 2026 · Local technical evidence in review as [PR #28](https://github.com/xmyqyl4x/tiresandtreads/pull/28); full S3 remains open.** Baseline: approved [PR #27](https://github.com/xmyqyl4x/tiresandtreads/pull/27), merged at `026a14c707c567ccbeffaabca8ff74f5aaf59b59`. [Contract](../../P1-PR-027-local-service-host.md), [runbook](../../../operations/local-service-host.md).

## TDD and proof scope

The new budget tests first failed with the planner absent. Unit tests cover all owned/external maxima, replicas, shared cluster accounting, role/database/URL/bounds mismatches, strict local settings and bounded redacted secret-file loading. Real PostgreSQL tests construct the actual factories with separate CMS, local S3/KMS and a signed filesystem journal. They exercise CMS publication and permission-scoped health, source refusal, privacy restriction through journal/restart, invalid key reuse, overbooking, failed CMS authentication, missing policy references and complete cleanup. Readiness is removed when the real CMS role is unavailable and restored after recovery. Shutdown waits for an admitted SQL-backed business call and rejects new work.

The fixture includes every configured harness pool maximum, including CMS administration, in its external allocation. Observed sockets are checked separately from planned maxima. The packaged healthy host runs from a temporary directory without workspace `node_modules`; SIGTERM closes it and its pools. A production runner also exercises configuration refusal with no network. The worker exposes only existing health/internal workflow paths; product URLs remain 404.

The first host run rejected a loopback HTTP canonical origin under existing content policy. Settings now require a reserved HTTPS `.test` origin rather than weakening that policy. PostgreSQL backend disappearance is checked with a bounded observation window after pool drain because server-side teardown is asynchronous. No test threshold, database constraint, permission rule or acceptance gate was weakened.

## Measured verification

`pnpm verify:push` passed on implementation commit `ab8af853c4f4d82e1a2f84b998261000b7b114d9` at `2026-10-26T21:34:40.988Z`. The [redacted machine record](p1-pr-027-host-verification.json) pins this run. The final review/documentation commit receives the same complete exact-commit gate before push and independent GitHub CI. Technical success does not close S3 acceptance.

| Check | Observed result |
| --- | --- |
| Unit/use-case | 693 passed; seven new budget/settings tests |
| Database/provider | 286 passed; nine new real-role host journeys |
| Foundation/schema/recovery | Six / 63 / 11 passed |
| Total | **1,059 passing tests**, including 16 new tests |
| Coverage | 97.21% lines, 93.99% statements, 98.02% functions, 90.27% branches; thresholds unchanged |
| Shared cluster budget | 17 owned pools (16 app/one CMS), 28 external harness/web slots and reserve 20: 65 required of 100; observed 17 physical host pools, all within maxima |
| Quality/build | Frozen Linux build/advisory audit, hygiene, formatting, lint, TypeScript, 213-module boundaries, health-only OpenAPI and migration checksums passed |
| Storage | Unchanged: 141 app tables, 54 views, 1,785 table/view columns, 28 CMS tables; 33 app/three CMS migrations; model/codec parity passed |
| Runtime | Healthy bundle without workspace dependencies, real role/readiness recovery and SIGTERM passed; runner image refuses invalid configuration with network disabled |
| Failure/recovery | Seven deliberate verification failure cases rejected; actual app/CMS logical dump/restore, ACL/ownership/FK indexes, quarantine, incomplete deletion and CMS crash retry passed |
| Documentation | 119 cards, 137 original FR rows, dependencies, source archives and historical approvals preserved; 75 checked tasks/282 unchecked |

Retained dev/stage credentials and data were not modified, and native PostgreSQL was untouched. Disposable test/recovery projects and their own volumes were removed. The first complete gate caught a cleanup-path assertion placed inside `finally`; it was moved before the test's `try/finally`, retaining path validation and unconditional cleanup without suppressing an earlier failure. No check or rule was weakened.

## Remaining acceptance

Local service composition does not close `S3-service-host` or any other S3 evidence row. Selected-provider/hosted networking/signing, actual key/journal custody and retention policy, topology/pooler capacity, deployed schedules and monitored/staffed response remain outstanding. The generic SQL-only runner does not invent product handlers; accepted product queues are driven by the separate bounded maintenance function. Required real provider/human evidence stays separate from local emulator and synthetic-policy proofs.

Specialist review and licensed adapters remain pending: 98 draft cases, zero actual accepted specialist reviews. Report issuance, real mail, product analytics and external advertising stay inactive. Original completion boxes and full S3 acceptance remain open; APIs and P1-PR-028–030 are held. Original task IDs, dependencies, FR rows, source archives and historical approvals are preserved.
