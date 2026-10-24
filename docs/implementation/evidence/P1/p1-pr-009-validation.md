# P1-PR-009 validation evidence

**October 24, 2026 America/Los_Angeles · accepted after owner approval and merge.** Baseline: approved PR #8 merge `beccd8efe28e6df1eef6fe99fd088787521b8d9a`. See the [implementation packet](../../P1-PR-009-entities-transactions.md) for scope, limits, mapping and failure contracts.

## Development evidence

- Red: the initial value stubs failed six of seven tests covering exact money, UUIDs, revisions, calendar dates, immutable unknown evidence and quantities. Validation then passed those cases; additional boundary, mapping and type tests followed.
- Transaction fault injection exposed one failure out of 19 cases: a definitive deferred-FK rejection at commit was being reported as unknown outcome. The adapter now distinguishes explicit PostgreSQL integrity/transaction-rollback errors from lost commit acknowledgement. Neither path retries automatically. Unexpected callback exceptions are separately normalized as internal failures.
- Native Node 24 unit/use-case run passed **81 tests**, including 33 new value/mapping/transaction cases. Measured coverage was 100% lines, 98.46% statements, 97.92% branches and 97.61% functions for the instrumented package behavior; this does not claim full product coverage.
- Focused Linux/PostgreSQL 18.6 run passed **11 database tests**, including nine new transaction cases, in `tt-test-59e5f4563489ad04`. Its app database applied the accepted migrations and used `tt_app_runtime`, with a fixture-only deferred FK for commit rejection. Two writers used one backend connection; an outside observer saw neither write before commit. Typed/caught database failures rolled back all writes, timeouts recovered the pool, expired contexts failed, and concurrent expected-revision updates produced one winner.
- Real driver bigint/date results crossed explicit mappers without numeric precision loss or private-field leakage. Runtime DDL stayed denied and SQL parameters remained literal. Test-only fixture grants exist only in the disposable database; no production migration or grant is changed.
- All 11 application/two CMS migrations, generated snapshots and the dependency lockfile remain unchanged. No dev/stage migration/reset is needed. The focused runner removed its own container, network and volume; native PostgreSQL and unrelated Docker resources were untouched.
- The first full run exposed a fixture interaction: PostgreSQL roles are cluster-wide, so roles created by the transaction suite retained its credentials when the later schema fixture bootstrapped its database. The transaction fixture now refuses existing application roles and removes only its own database and newly created roles after closing its connections. The full suite exercises this handoff; production bootstrap behavior is unchanged.

## Final verification

`pnpm verify:push` passed on implementation commit `dbca4d198fdbad3c804a8e8b613fadb2593121bb` with pinned Node 24.22.1/PostgreSQL 18.6 Linux containers and Payload 3.92.0. Main project: `tt-test-9a27029fe4743491`. The [redacted machine-readable record](p1-pr-009-verification.json) retains its image, recovery inventory/archive hashes, versions, timings and injected failures.

| Check | Observed result |
| --- | --- |
| Unit/use-case | 81 passed, including 33 new value/mapping/transaction cases |
| Database | 11 passed, including nine new restricted-role transaction cases |
| Foundation integration | Six passed |
| Schema integration | All 63 passed after transaction-fixture cleanup; app/CMS ownership, upgrades and constraints preserved |
| Recovery integration | All 11 passed in `tt-test-fac20fae2d704cf2`; 119 app / 28 CMS tables and two app views preserved |
| Quality | Strict types, expected type failures, lint, format, source hygiene, layer boundaries, OpenAPI and 11 app/two CMS checksums passed |
| Dependencies | Frozen pinned install and advisory audit passed; dependency versions/lockfile unchanged |
| Deliberate failure gates | All seven rejected, including an engine type-only dependency on consent |
| HTTP/lifecycle | Headless health, absent product routes, invalid hosted config, shutdown and restart passed |
| Cleanup | Both random test projects removed their containers, networks and volumes |

Total: **172 passing tests**. Recovery elapsed 22454 ms including image preparation; the synthetic backup window was 3688 ms. These measurements do not establish production capacity or RTO/RPO. Dev/stage retain the previously accepted migrations and volumes; this change requires no schema upgrade.

Final review commit `9e7d05aee6fa9d1425aef49b07e171d7884dde3e` passed full local verification and [independent GitHub CI](https://github.com/xmyqyl4x/tiresandtreads/actions/runs/40070401916). The owner approved [PR #9](https://github.com/xmyqyl4x/tiresandtreads/pull/9), merged at `7ac3ed2051a22703c0b9d72fea55e0dfa292a36f`. P1-PR-009 is accepted; the complete S2 gate remains P1-PR-013.

## Limits

Only typed contracts, selected mappers and the transaction primitive are implemented. Real repository query plans, permission/idempotency/dispatch protocols, complete snapshot/transport decoders, provider adapters, live capacity and production recovery remain the existing later cards. No new UI, business endpoint, live source or paid infrastructure is activated.
