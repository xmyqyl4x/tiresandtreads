# P1-PR-010 validation evidence

**October 24, 2026 America/Los_Angeles · accepted after owner approval and merge.** Baseline: approved PR #9 merge `7ac3ed2051a22703c0b9d72fea55e0dfa292a36f`. See the [implementation packet](../../P1-PR-010-catalog-ingestion.md) for protocols, permissions and limitations.

## TDD and focused evidence

- Bounded JSON/cursor tests first failed twice before the helpers existed. Credential expansion first failed its preservation case before implementation. Both suites then passed.
- Real repository tests exposed an outbox UUID/text parameter ambiguity (SQLSTATE 42P08); one explicit cast corrected publication. The real-role suite then passed all 25 fact-family round trips and competing-head tests.
- Combined focused coverage passed 110 tests before the two final stored-bound/source-identity cases were added. Coverage was 97.42% lines, 93.33% statements, 99.24% functions and 90.34% branches; thresholds were not reduced. Final full-pipeline counts follow below.
- The bounded query was measured before/after refinement: the initial 20,000-SKU fixture selected 1,000 IDs in 10 pages, 70 ms and about 2.06 MB heap growth. The refined query measured 60 ms, 1,757,800 bytes heap growth and 1.261 ms first-page EXPLAIN execution in a warm local run. These single-run timings are descriptive, not a statistically established speedup. The [compact plan](p1-pr-010-query-plan.json) records 1,000 index matches and top-N sorting; 101 rows maximum reached the application per page. The 32 MiB heap-delta assertion is a smoke bound, not total-process RSS or a production capacity guarantee.
- All applied app/CMS migrations and dependency versions/lockfile are unchanged; the new migration and inventory extend the accepted baseline. Native type/lint/format/boundary/source/contract checks pass.

## Full verification

`pnpm verify:push` passed on implementation commit `2ee08865667b36be74b3f416faea851efa677adf` with pinned Node 24.22.1/PostgreSQL 18.6 Linux containers and Payload 3.92.0. Main project: `tt-test-329a1d6c2523e81f`. The [redacted verification record](p1-pr-010-verification.json) retains versions, image, inventory/archive hashes, recovery timing and injected failures.

| Check | Observed result |
| --- | --- |
| Unit/use-case | 87 passed |
| Database | 25 passed: 14 catalog/import cases, nine transaction cases and two harness cases |
| Foundation | Six passed |
| Schema | All 63 passed with existing ownership/upgrade/retention constraints preserved |
| Recovery | All 11 passed in `tt-test-c1d73fd414c77a53`; 120 app/28 CMS tables and 31 app views preserved |
| Quality | Strict types, expected type failures, lint, formatting, source hygiene, boundaries, OpenAPI and 12 app/two CMS checksums passed |
| Dependencies | Frozen pinned install and advisory audit passed; versions/lockfile unchanged |
| Failure gates | All seven deliberate failures rejected |
| HTTP/lifecycle | Health-only routes, absent product routes, invalid hosted config, shutdown and restart passed |
| Retained dev/stage | Each added three role credentials and one app migration; 12 app/two CMS, zero pending, replay zero; old credentials/CMS secret preserved |
| Cleanup | Both random test environments removed their own containers/networks/volumes; dev/stage stopped with volumes retained |

Total: **192 passing tests**. Recovery elapsed 22967 ms including image preparation; synthetic backup window 4225 ms. These are local proof measurements, not production RTO/RPO. The final row-bound test uses a recall description so the new serialized-row constraint is exercised independently of older short-label bounds.

Final head `dc80a500ef5ff50df2b1919e64f2d4d07b6aaf0d` passed full local verification and [independent GitHub CI](https://github.com/xmyqyl4x/tiresandtreads/actions/runs/40112309790). The owner approved [PR #10](https://github.com/xmyqyl4x/tiresandtreads/pull/10), merged at `18a264a7056c11f2b7a2fe90c8698337f20d3e3a`. P1-PR-010 is accepted; the complete S2 gate at 013 remains open.

## Remaining gates

The repository proves persistence and bounded local query behavior with synthetic data. Upstream completeness/rights, real provider contracts, staff authorization/MFA/approval issuance, ingestion CLI/services, outbox delivery, retention cleanup, current recall safety overlays and API DTOs remain their assigned cards. Hosted capacity/recovery and RPO/RTO remain unproven. Product UI remains behind P1-PR-031.
