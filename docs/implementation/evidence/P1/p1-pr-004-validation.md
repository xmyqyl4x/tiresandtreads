# P1-PR-004 validation evidence

**October 23, 2026 America/Los_Angeles · owner acceptance pending.** Baseline is approved PR #3 merge `ebcf9361a495547f9d9445d89f64131cf0ebef68`. Scope, role grants, migration behavior and remaining gates are in the [implementation packet](../../P1-PR-004-database-foundations.md).

## Observed development evidence

- Nine migration-integrity cases failed against placeholder behavior, then passed with SHA-256, ordering and applied-prefix validation. Parameterized cases were corrected to pass whole arrays; the complete red/green sequence was repeated afterward.
- Strict TypeScript and targeted lint passed after adapting Payload's common `unknown` migration argument at the checked PostgreSQL boundary.
- The first real schema run passed nine of eleven cases. It exposed Payload's unqualified DDL targeting `pg_catalog` under the initial migrator search path; the owned `public` schema is now first for migration credentials. The deletion-denial assertion was also corrected to PostgreSQL 18's observed `23001` restrict violation and named FK.
- Payload 3.92 generated the initial committed migration/snapshot in a disposable database. The generator left idle toolchain handles after writing; its owned container was stopped and cleaned up after retrieving the files. The committed operator command exits only after awaiting all work and client/SDK teardown.

## Completed integrated verification

`node scripts/verify/local.mjs` passed on the pinned Node 24.22.1/PostgreSQL 18.6 Linux containers using disposable project `tt-test-e9f097c39e6872fe`. App image ID: `9de977e988049809333374f9f2f9a3da8a22e7ac63ec60a824e92789d472c6d9` (local content-addressed image, not a registry release).

| Check | Observed result |
| --- | --- |
| Unit/use-case | 39 passed, including nine migration-source/history cases |
| Existing PostgreSQL harness | Two passed |
| Local foundation integration | Six passed |
| New schema integration | 12 passed: populated upgrade/no-op seed/replay; concurrent executor denial; atomic DDL/history rollback; source/history drift denial; restricted runtime/owner roles; cross-database denial; session digest/FK/expiry constraints; asset readiness/purpose/location/deletion checks; staff grant integrity; leading FK indexes; real Payload migration/initialization; CMS checksum/native-ledger/schema-push drift refusal |
| Quality | Source hygiene, formatting, lint, strict TypeScript, import boundaries, OpenAPI drift and both migration manifests passed |
| Failure checks | All six rejected as required: intentional failed test, forbidden domain import, direct/transitive client imports, production import of test fixtures and production import of database operator scripts |
| Dependencies | No new packages or lockfile changes. Audit reported no known vulnerabilities at the time of verification |
| Lifecycle/HTTP | Existing health contracts and absent product/fixture/admin routes passed; invalid production+fixture startup rejected; idle SIGTERM exit 143 in 666 ms and post-restart HTTP passed |
| Local operator workflow | Dev and stage bootstrap, migrate, status and synthetic seed succeeded. Each reports two app/one CMS migration, zero pending. Staging migration replay applied zero versions. Credential sets are distinct; temporary admin env files were removed |
| Cleanup | Disposable test databases/containers/network/volume removed. Dev/stage services stopped with migrated volumes retained. Native PostgreSQL and unrelated Docker resources untouched |

The integrated run totals **59 passing tests**. Source review preserves all 119 cards/dependency edges, 137 original FR rows, source archives and historical approval sections. Local Markdown targets/anchors and UTF-8/LF checks pass.

`pnpm verify:push` must repeat verification after committing the final source; the PR records that exact SHA and its independent GitHub CI run. A working-copy result is not a substitute for those final checks. Owner acceptance remains pending.

## Limits

Package coverage still measures the small executable config/contract packages; operator scripts and SQL are verified by behavioral unit and real integration checks, not represented as 100% product coverage. No source rights, real identity verification, S3/KMS delivery, signed asset grants, partner RLS, report APIs, UI, production restore or live deployment is claimed. DB12/DB15 are only partially supported by foundational keys and asset metadata. Their complete enforcement follows the accepted stage ordering.
