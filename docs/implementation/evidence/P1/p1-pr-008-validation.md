# P1-PR-008 validation evidence

**October 23, 2026 America/Los_Angeles · owner acceptance pending.** Baseline: approved PR #7 merge `ad3822ae51ed969c6d575ff7e661d8e6a1362623`. See the [implementation packet](../../P1-PR-008-database-validation-recovery.md) for the inventory, recovery procedure, invariant matrix and scoped S1 decision.

## Development evidence

- Red: eight artifact-admission cases failed against the initial no-op validator; the valid case passed. Green: all nine pass after enforcing archive kind/run/major/checksum/size and ordered migration history.
- The first Docker drill completed fixture preparation but retained Payload SDK idle handles. The fixture now awaits all work/client cleanup and explicitly exits, matching the established migration CLI pattern. The stopped disposable run cleaned up only its own resources.
- The next drill passed nine of 11 cases. It exposed two incorrect assertions: an ownership UPDATE was rejected by the immutable-identity trigger before its FK, and deletion preserved an unrelated import asset. The revised proof attempts a wrong-owner INSERT and explicitly checks that unrelated asset preservation matches the source after deletion.
- The drill uses synthetic private report/contact/object metadata, pending delivery/outbox/analytics records, reference imports and actual Payload article/version/publication work. It restores separate custom-format archives into a fresh cluster, verifies the exact 119/28 table inventory and complete data fingerprints, and exercises current deletion replay plus CMS propagation after a crash.
- Focused final recovery run passed **11/11** in `tt-test-6b444badf8f5d4d5`: 19.699 seconds including cached image preparation and a 3.697-second synthetic backup window. App/CMS archives were 511,862 / 194,207 bytes. These local timings are not production RTO/RPO measurements. All owned containers, network and volumes were removed.
- Retained dev and stage were checked independently: **11 app / two CMS applied, zero pending** in each. They were stopped afterward with credentials and data volumes preserved. No migration/reset was needed, and native PostgreSQL was untouched.
- Documentation review preserves all 119 task cards/dependencies, 137 original FR rows, source archives and historical approvals. Twenty-four key tasks are checked; 333 remain unchecked. Types, lint, formatting, boundary checks and unchanged migration manifests passed before committing.
- Final review strengthened the incomplete-deletion check from any exception to a specific SQLSTATE. PostgreSQL 18 reports this `ON DELETE RESTRICT` violation as `23001` on `report_items_version_fk`; the initial `23503` expectation failed. The assertion now checks the observed code and named constraint. The failed run kept recovery quarantined and cleaned up its resources.
- Applied app/CMS migrations and generated snapshots remain unchanged at 11/two. All applicable P1 schema boundaries are represented; later service races, object-byte erasure, hosted recovery and live product acceptance remain open at their existing cards.

## Final verification

`pnpm verify:push` passed on implementation commit `a0fc0a1520961406a0dfe8e29957761d41c8ca88` with pinned Node 24.22.1/PostgreSQL 18.6 Linux containers and Payload 3.92.0. Main project: `tt-test-99d543480ec10cfd`. The [redacted machine-readable record](p1-pr-008-recovery.json) retains its app image, inventory hashes, archive hashes/sizes, versions, timings and injected failures.

| Check | Observed result |
| --- | --- |
| Unit/use-case | 48 passed, including nine archive-admission cases |
| Existing PostgreSQL harness | Two passed |
| Foundation integration | Six passed |
| Schema integration | All 63 passed, including empty/populated app/CMS upgrades and real role restrictions |
| Recovery integration | All 11 passed in `tt-test-365475c05fa67bfb` |
| Complete inventory | 119 app / 28 CMS tables, two app views; definitions, ACLs, indexes and all table fingerprints matched |
| Quality | Types, lint, format, source hygiene, boundaries, OpenAPI and 11 app/two CMS checksums passed |
| Dependencies | Frozen pinned install and audit passed; no dependency changes |
| Deliberate failure gates | All six rejected: failing test and forbidden dependency/client/test/operator imports |
| HTTP/lifecycle | Headless health, absent product routes, invalid hosted config, shutdown and restart passed |
| Local dev/stage | 11 app/two CMS, zero pending in both; stopped with retained volumes |
| Cleanup | Both random test projects removed their containers, networks and volumes |

Total: **130 passing tests**. Recovery elapsed 28232 ms including image preparation; the synthetic backup window was 4451 ms. Archives were 511,847 app bytes and 194,206 CMS bytes. These measurements do not establish production capacity or RTO/RPO. Existing 100% coverage applies only to the small runtime/health packages; SQL and recovery behavior use real PostgreSQL integration tests.

The review-link commit must pass the same full verification before push. [PR #8](https://github.com/xmyqyl4x/tiresandtreads/pull/8) records its final SHA and independent GitHub CI. Local S1 acceptance remains pending owner approval; P1-PR-009 is not started.

## Limits

This is a local S1 database construction gate. The known post-backup write is absent from the restored snapshot: no PITR, hosted RPO/RTO, production journal durability or external object/provider recovery is claimed. The test-only deletion and publication fixtures do not implement the full privacy/editorial services. Synthetic records carry no real contact addresses, capabilities or commercial data. No product UI, paid service or hosted resource is activated.
