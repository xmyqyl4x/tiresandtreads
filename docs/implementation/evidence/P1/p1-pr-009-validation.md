# P1-PR-009 validation evidence

**October 23, 2026 America/Los_Angeles · owner acceptance pending.** Baseline: approved PR #8 merge `beccd8efe28e6df1eef6fe99fd088787521b8d9a`. See the [implementation packet](../../P1-PR-009-entities-transactions.md) for scope, limits, mapping and failure contracts.

## Development evidence

- Red: the initial value stubs failed six of seven tests covering exact money, UUIDs, revisions, calendar dates, immutable unknown evidence and quantities. Validation then passed those cases; additional boundary, mapping and type tests followed.
- Transaction fault injection exposed one failure out of 19 cases: a definitive deferred-FK rejection at commit was being reported as unknown outcome. The adapter now distinguishes explicit PostgreSQL integrity/transaction-rollback errors from lost commit acknowledgement. Neither path retries automatically. Unexpected callback exceptions are separately normalized as internal failures.
- Native Node 24 unit/use-case run passed **81 tests**, including 33 new value/mapping/transaction cases. Measured coverage was 100% lines, 98.46% statements, 97.92% branches and 97.61% functions for the instrumented package behavior; this does not claim full product coverage.
- Focused Linux/PostgreSQL 18.6 run passed **11 database tests**, including nine new transaction cases, in `tt-test-59e5f4563489ad04`. Its app database applied the accepted migrations and used `tt_app_runtime`, with a fixture-only deferred FK for commit rejection. Two writers used one backend connection; an outside observer saw neither write before commit. Typed/caught database failures rolled back all writes, timeouts recovered the pool, expired contexts failed, and concurrent expected-revision updates produced one winner.
- Real driver bigint/date results crossed explicit mappers without numeric precision loss or private-field leakage. Runtime DDL stayed denied and SQL parameters remained literal. Test-only fixture grants exist only in the disposable database; no production migration or grant is changed.
- All 11 application/two CMS migrations, generated snapshots and the dependency lockfile remain unchanged. No dev/stage migration/reset is needed. The focused runner removed its own container, network and volume; native PostgreSQL and unrelated Docker resources were untouched.

## Final verification

Exact-commit full-pipeline evidence and PR/CI links will be recorded after the implementation commit passes. Owner acceptance remains pending.

## Limits

Only typed contracts, selected mappers and the transaction primitive are implemented. Real repository query plans, permission/idempotency/dispatch protocols, complete snapshot/transport decoders, provider adapters, live capacity and production recovery remain the existing later cards. No new UI, business endpoint, live source or paid infrastructure is activated.
