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

Full Linux verification and final exact-commit/GitHub CI results will be recorded before review completion. Initial focused results do not replace those checks.

## Limits

Tests use synthetic source facts and no provider credentials or network ingestion. SQL integrity, immutable publication records and role denials do not prove source licensing, actual fitment, recall completeness, rights enforcement, worker fencing or complete publication/API behavior. S2 query plans, S3 ingestion/recovery, S1 backup/restore and selected-host verification remain at their planned cards. No repository, service, frontend or live product phase is marked complete by this schema PR.
