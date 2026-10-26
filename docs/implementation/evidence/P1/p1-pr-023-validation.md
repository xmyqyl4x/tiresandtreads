# P1-PR-023 validation evidence

**October 25, 2026 · S3 implementation in [PR #23](https://github.com/xmyqyl4x/tiresandtreads/pull/23) for review.** Baseline: approved PR #22 merge `5e6d4cd4866b3258d9f22978966a9adfe46f0e94`. See the [service contract](../../P1-PR-023-mail-events-actions.md). Licensed adapters and specialist review remain pending.

## TDD and scope

The initial callback/redirect test failed because the modules did not exist. Unit tests then cover exact byte signatures, stale/future delivery times, key overlap, tampering, bounded body/header/secret handling, malformed signed JSON, conservative scanner classification, key rotation and unsafe destinations. Use-case tests exercise scanner navigation without final actions and deliberate confirmation delegation. The first real PostgreSQL run exposed a stored bytea link-digest decoding error; it was fixed, and stable duplicate fixture bytes were corrected so the concurrency test models actual callback replay. A reviewed learning-route functional test also guards the existing publication view's actual column contract.

Migrated PostgreSQL tests cover durable callback duplicates/conflicts, independent reordered facts, suppression/tombstones, atomic rollback, early callback and timeout correlation, unknown/conflicting IDs, unsupported semantics, current engagement permission/withdrawal, known-ID provider retrieval, safe recovery commands, ordinary GET/HEAD safety, RFC8058 POST without session input, purpose-bound preferences, immutable feedback, fixed reviewed learning destinations, withdrawal, expiry/revocation and denied public roles. Provider callbacks/retrieval are synthetic signed/HTTP fixtures; no real email, sender credentials or public route is activated.

## Full verification

`pnpm verify:push` passed on implementation commit `b0387ccd5e829a729a4887a31756e71e1033b13d` at `2026-10-26T05:57:11.257Z`. The [redacted machine record](p1-pr-023-verification.json) captures that exact run. The evidence/task-list commit receives the complete gate again before push; its final head and independent CI status are recorded in [PR #23](https://github.com/xmyqyl4x/tiresandtreads/pull/23).

| Check | Observed result |
| --- | --- |
| Unit/use-case | 612 passed; 36 new signature/link/policy tests and two scanner/action use cases |
| Database/provider | 211 passed; 25 new migrated callback/action service tests |
| Foundation/schema/recovery | Six / 63 / 11 passed |
| Total | **903 passing tests**, including 63 new email action tests |
| Coverage | 97.25% lines, 94.1% statements, 98.49% functions, 90.24% branches; thresholds unchanged |
| Quality/build | Frozen Linux build/advisory audit, hygiene, format, lint, TypeScript, 177-module boundaries, health contract and migration checksums passed |
| Storage | 130 app tables, 42 views, 1,662 table/view columns, 250 codec fields/25 fact families, 28 CMS tables; 28 app/three CMS migrations; generated Drizzle parity passed |
| Failure propagation | Seven deliberate verification failures rejected |
| Runtime | Production stop/restart and bundled worker/import/source/mail-recovery configuration refusal passed without workspace dependencies |
| Recovery | Complete synthetic app/CMS restore and deletion replay passed at 28 app/three CMS, including corrupt restore, stale/missing journal, incomplete deletion and crash retry |
| Documentation | 119 cards/137 original FR rows/dependency edges/source archives/historical approvals preserved; 66 checked tasks/291 unchecked |

Retained Docker dev and stage both have **28 app/three CMS applied, zero pending**, and are stopped with volumes retained. Native PostgreSQL, credentials and unrelated projects are unchanged. Disposable projects `tt-test-b2622be6ec015f5d` and `tt-test-d11d481ac02632de` and their volumes were removed by exact identity. The restore fixture does not establish the future actual callback/link/feedback erasure graph, hosted recovery or external provider recovery.

## Acceptance limits

Headless S3 only. S4 owns HTTP routes, request streaming/header parsing, CSRF/browser headers, token log redaction and abuse quotas. S5/release owns rendered templates, real sender authentication, DKIM header coverage, provider/client acceptance and actual user journey. P1-PR-024 owns privacy-aware aggregate analytics; 025 owns the complete erasure/retention graph; 027 owns scheduled recovery and alarms. Full-schema restore uses synthetic fixtures and does not establish actual new-table erasure or hosted recovery. Licensed feeds and specialist acceptance remain open, with report issuance disabled.
