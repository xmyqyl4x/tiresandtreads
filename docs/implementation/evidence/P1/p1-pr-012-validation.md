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

Exact-commit pipeline, coverage, retained dev/stage upgrades and final independent CI evidence will be recorded after verification. No owner acceptance, production throughput or live product release is claimed.

## Remaining gates

S2 acceptance is 013; credentials, transport/job composition and CMS/object propagation are 014/021. Authentication, editorial approval, legal permission/retention policy, HTTP enforcement, fleet workload budgets and complete multi-store privacy erasure remain their S3/S4 cards. Production capacity and provider behavior require later measured evidence; the original task dependencies and 137 FR rows remain unchanged.
