# P1-PR-010 validation evidence

**October 24, 2026 America/Los_Angeles · owner acceptance pending.** Baseline: approved PR #9 merge `7ac3ed2051a22703c0b9d72fea55e0dfa292a36f`. See the [implementation packet](../../P1-PR-010-catalog-ingestion.md) for protocols, permissions and limitations.

## TDD and focused evidence

- Bounded JSON/cursor tests first failed twice before the helpers existed. Credential expansion first failed its preservation case before implementation. Both suites then passed.
- Real repository tests exposed an outbox UUID/text parameter ambiguity (SQLSTATE 42P08); one explicit cast corrected publication. The real-role suite then passed all 25 fact-family round trips and competing-head tests.
- Combined focused coverage passed 110 tests before the two final stored-bound/source-identity cases were added. Coverage was 97.42% lines, 93.33% statements, 99.24% functions and 90.34% branches; thresholds were not reduced. Final full-pipeline counts follow below.
- The bounded query was measured before/after refinement: the initial 20,000-SKU fixture selected 1,000 IDs in 10 pages, 70 ms and about 2.06 MB heap growth. The refined query measured 60 ms, 1,757,800 bytes heap growth and 1.261 ms first-page EXPLAIN execution in a warm local run. These single-run timings are descriptive, not a statistically established speedup. The [compact plan](p1-pr-010-query-plan.json) records 1,000 index matches and top-N sorting; 101 rows maximum reached the application per page. The 32 MiB heap-delta assertion is a smoke bound, not total-process RSS or a production capacity guarantee.
- All applied app/CMS migrations and dependency versions/lockfile are unchanged; the new migration and inventory extend the accepted baseline. Native type/lint/format/boundary/source/contract checks pass.

## Full verification

Exact-commit pipeline, retained dev/stage upgrade, final test counts and review links will be recorded after verification. No claim of owner acceptance or production readiness is made.

## Remaining gates

The repository proves persistence and bounded local query behavior with synthetic data. Upstream completeness/rights, real provider contracts, staff authorization/MFA/approval issuance, ingestion CLI/services, outbox delivery, retention cleanup, current recall safety overlays and API DTOs remain their assigned cards. Hosted capacity/recovery and RPO/RTO remain unproven. Product UI remains behind P1-PR-031.
