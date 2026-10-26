# P1-PR-027 local-host validation

**October 26, 2026 · Local technical candidate; full S3 remains open.** Baseline: approved [PR #27](https://github.com/xmyqyl4x/tiresandtreads/pull/27), merged at `026a14c707c567ccbeffaabca8ff74f5aaf59b59`. [Contract](../../P1-PR-027-local-service-host.md), [runbook](../../../operations/local-service-host.md).

## TDD and proof scope

The new budget tests first failed with the planner absent. Unit tests cover all owned/external maxima, replicas, shared cluster accounting, role/database/URL/bounds mismatches, strict local settings and bounded redacted secret-file loading. Real PostgreSQL tests construct the actual factories with separate CMS, local S3/KMS and a signed filesystem journal. They exercise CMS publication and permission-scoped health, source refusal, privacy restriction through journal/restart, invalid key reuse, overbooking, failed CMS authentication, missing policy references and complete cleanup. Readiness is removed when the real CMS role is unavailable and restored after recovery. Shutdown waits for an admitted SQL-backed business call and rejects new work.

The fixture includes every configured harness pool maximum, including CMS administration, in its external allocation. Observed sockets are checked separately from planned maxima. The packaged healthy host runs from a temporary directory without workspace `node_modules`; SIGTERM closes it and its pools. A production runner also exercises configuration refusal with no network. The worker exposes only existing health/internal workflow paths; product URLs remain 404.

The first host run rejected a loopback HTTP canonical origin under existing content policy. Settings now require a reserved HTTPS `.test` origin rather than weakening that policy. PostgreSQL backend disappearance is checked with a bounded observation window after pool drain because server-side teardown is asynchronous. No test threshold, database constraint, permission rule or acceptance gate was weakened.

## Measured verification

Exact-commit Linux tests, coverage, lifecycle and dump/restore evidence will be recorded after the complete run. No pass is claimed in advance.

## Remaining acceptance

Local service composition does not close `S3-service-host` or any other S3 evidence row. Selected-provider/hosted networking/signing, actual key/journal custody and retention policy, topology/pooler capacity, deployed schedules and monitored/staffed response remain outstanding. The generic SQL-only runner does not invent product handlers; accepted product queues are driven by the separate bounded maintenance function. Required real provider/human evidence stays separate from local emulator and synthetic-policy proofs.

Specialist review and licensed adapters remain pending: 98 draft cases, zero actual accepted specialist reviews. Report issuance, real mail, product analytics and external advertising stay inactive. Original completion boxes and full S3 acceptance remain open; APIs and P1-PR-028–030 are held. Original task IDs, dependencies, FR rows, source archives and historical approvals are preserved.
