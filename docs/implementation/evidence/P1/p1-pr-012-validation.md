# P1-PR-012 validation evidence

**October 24, 2026 America/Los_Angeles · owner acceptance pending.** Baseline: approved PR #11 merge `e94c7cd1f415e303193c546e8a8c7c3ca026e4d5`. See the [implementation protocol](../../P1-PR-012-content-operations-analytics.md) for scope and caller responsibilities.

## TDD and focused evidence

- The new operations database suite first failed because the content adapter did not exist. After implementation, real PostgreSQL tests exposed a missing event row-lock privilege for purge; granting UPDATE on the immutable ID column permits locking while the immutable trigger still rejects edits.
- The 10,000-page workload exposed that a security-barrier wrapper prevented ordered LIMIT pushdown. The SEO view is a column-only public projection with no secret row predicate; allowing normal view optimization restores the primary-key access path without granting base-table access.
- Repository tests cover duplicate/conflicting/out-of-order/withdrawn/expired publications, immutable configuration, current consent and replay contention, complete aggregate replacement, new intake during rebuild, privacy invalidation, expired worker fences, bounded purge, quota contention/all-window rollback/HMAC overlap and least-privilege projection reads.
- Configuration tests cover SQL/object parity, exact schema/checksum validation, restart, monotonic adoption, invalidation during a pending read, cache/expiry, bounded waits, oversized objects and outages. Object transport is injected at the S3 boundary; hosted credentials and full CMS/S3 publication are later composition/service work.
- Reporting tests preserve missing-versus-zero, nullable denominators, signed revenue, latest complete ad snapshots, expired affiliate checks and private-route exclusions. All records are synthetic; no advertising, analytics collection or external provider is activated.

- A deterministic PostgreSQL statement-trigger barrier reproduced snapshot drift: intake committed after capture started but before its row lock, and a single UPDATE CTE returned generation two with only one event. Capturing under the day lock and then taking a fresh source snapshot restores the correct two-event result. The barrier is synthetic fixture code only.

## Full verification

`pnpm verify:push` passed on implementation commit `6c5ace9996c4cd7f2ac7f07aca2c979b0b710f87` with pinned Node 24.22.1/PostgreSQL 18.6 Linux containers and Payload 3.92.0. Main project: `tt-test-9e9de381c569fb2d`. The [redacted verification record](p1-pr-012-verification.json) retains image, inventory/archive hashes, timing and injected recovery failures.

| Check | Observed result |
| --- | --- |
| Unit/use-case | 94 passed |
| Database | 61 passed: 16 operations, 20 private, 14 catalog/import, nine transaction and two harness cases |
| Foundation | Six passed |
| Schema | All 63 passed, preserving ownership, upgrades and constraints |
| Recovery | All 11 passed in `tt-test-6748c117b2145eb7`; 123 app/28 CMS tables and 39 app views preserved |
| Coverage | 97.54% lines, 92.37% statements, 99.65% functions, 87.34% branches; thresholds unchanged |
| Quality | Types, lint, formatting, hygiene, boundaries, OpenAPI and 14 app/two CMS checksums passed |
| Dependencies | Frozen pinned install and advisory audit passed; dependencies and lockfile unchanged |
| Failure gates | All seven deliberate failures rejected |
| HTTP/lifecycle | Health-only routes, absent product routes, invalid hosted config, shutdown and restart passed |
| Retained dev/stage | Each added five role credentials and one app migration; 14 app/two CMS, zero pending, replay zero; existing data/credentials preserved |
| Cleanup | Random test resources removed; dev/stage stopped with volumes retained |

Total: **235 passing tests**. The 10,000-page SEO fixture used its primary-key index with a bounded 101-row fetch. Recovery elapsed 25398 ms including preparation; synthetic backup window 4795 ms. These local proof measurements are not production throughput or RTO/RPO promises.

The review-link/evidence commit repeats full exact-commit verification before push. [PR #12](https://github.com/xmyqyl4x/tiresandtreads/pull/12) records the final tested SHA and independent CI. Owner acceptance and the full S2 gate at 013 remain pending.

## Remaining gates

S2 acceptance is 013; credentials, transport/job composition and CMS/object propagation are 014/021. Authentication, editorial approval, legal permission/retention policy, HTTP enforcement, fleet workload budgets and complete multi-store privacy erasure remain their S3/S4 cards. Production capacity and provider behavior require later measured evidence; the original task dependencies and 137 FR rows remain unchanged.
