# P1-PR-005 validation evidence

**October 23, 2026 America/Los_Angeles · owner acceptance pending.** Baseline: approved PR #4 merge `4f00c3054f0fcfd706098a0c3fd66af72449e1f4`. See the [implementation packet](../../P1-PR-005-domain-catalog-import-schemas.md) for exact scope and remaining gates.

## Development evidence

- Before adding migrations, 14 new behavior/denial scenarios failed against real PostgreSQL with missing source/catalog tables; all 12 existing foundation cases passed. Disposable project: `tt-test-5a13b3def5263584`.
- The first migration run passed 25 of 26 cases. The remaining test supplied a JavaScript array as a PostgreSQL array instead of JSON; the fixture now serializes that JSON value explicitly.
- The next focused run passed all 27 schema cases, including a new two-connection test proving edit/publication contention in both lock orders. Disposable project: `tt-test-b358e46564a340d2`. The runner cleaned each owned test cluster/volume afterward.
- Upgrade starts from the actual populated 004 schema, preserves its synthetic identity/registry records, applies the three new migrations and replays as a no-op. Existing checksum-drift, failed-DDL rollback, executor-lock, CMS/runtime and all-FK-index assertions continue to run.
- Strict TypeScript, lint, formatting, source hygiene, boundaries, OpenAPI drift and migration manifest checks passed. The concurrency fixture cleanup was adjusted to preserve errors through `finally`; partial recall date bounds remain nullable and staging-expiry fixtures use relative future dates.
- Local dev and stage each applied three new app migrations and zero CMS migrations. Both report five app/one CMS applied, zero pending. Staging replay applied zero migrations. Both project services were stopped with their migrated volumes and existing credentials preserved; native PostgreSQL and unrelated Docker resources were untouched.
- Document checks preserve all 119 task cards/dependency edges, 137 original FR rows, historical approval sections and source archives. Fifteen key tasks across cards 001–005 are checked; later work remains unstarted. Accepted app/CMS migration sources and dependency lockfile remain unchanged.

## Final verification

`pnpm verify:push` passed on implementation commit `31e3ca53f446225e75e3c14bc478fef56af6de9f` using pinned Node 24.22.1/PostgreSQL 18.6 Linux containers, disposable project `tt-test-cde2f9eed25d96e0` and app image `ef66912ec720b8da3dd699b711d0c3a710af4f56b2e10c5723fd240ffddcc91d`.

| Check | Observed result |
| --- | --- |
| Unit/use-case | 39 passed |
| Existing PostgreSQL harness | Two passed |
| Foundation integration | Six passed |
| Schema integration | 27 passed: original 12 and 15 domain/catalog/import/concurrency cases |
| Quality and dependencies | Types, lint, formatting, source hygiene, boundaries, OpenAPI and five app/one CMS checksums passed; no new dependencies; audit reported no known vulnerabilities at verification time |
| Deliberate failures | All six rejected: failing test, forbidden domain import, direct/transitive client imports, application imports of test fixtures and database operator modules |
| HTTP and lifecycle | Health/absent product routes passed, invalid hosted fixture config rejected; idle shutdown exit 143 in 667 ms; restart HTTP passed |
| Local dev/stage | Three additive app migrations applied to retained databases; five app/one CMS with zero pending; replay zero; data volumes preserved |
| Cleanup | Owned disposable containers/network/volume removed; local dev/stage stopped; unrelated Docker resources retained |

The total is **74 passing tests**. Small-package code coverage still covers configuration/health contracts only; schema SQL and operator behavior are verified through real integration cases. No production throughput claim is made.

The final review-link commit must pass the same exact-commit verification before push. [PR #5](https://github.com/xmyqyl4x/tiresandtreads/pull/5) records that final SHA and independent GitHub CI; owner acceptance remains pending.

## Limits

Tests use synthetic source facts and no provider credentials or network ingestion. SQL integrity, immutable publication records and role denials do not prove source licensing, actual fitment, recall completeness, rights enforcement, worker fencing or complete publication/API behavior. S2 query plans, S3 ingestion/recovery, S1 backup/restore and selected-host verification remain at their planned cards. No repository, service, frontend or live product phase is marked complete by this schema PR.
