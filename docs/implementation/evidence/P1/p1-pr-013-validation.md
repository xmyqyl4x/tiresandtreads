# P1-PR-013 validation evidence

**October 25, 2026 America/Los_Angeles · owner S2 acceptance pending.** Baseline: approved PR #12 merge `4a37b95807b0209b29e6f4b03caf46bf5cb0a1ce`. See the [gate packet](../../P1-PR-013-s2-data-access-gate.md) and [audit](../../P1-PR-013-s2-contract-audit.md).

## TDD and focused checks

- The new real-PostgreSQL model test first failed because the promised generated Drizzle model file did not exist. `pnpm db:models` then generated it from a new migrated disposable database, and the gate verified exact regeneration plus runtime column metadata for all 123 tables/39 views/1,574 columns.
- Every one of 247 fields across 25 fact codecs matches its base SQL type/nullability and safe catalog projection. A real Drizzle query returns bigint/Date; raw `pg` returns bigint text. Strict type fixtures reject lossy money/revision conversion, unvalidated IDs, generated event-day writes and public reviewer identity access.
- The import-state regression initially failed with `Cannot convert null to a BigInt`. Corrected mapping rejects malformed/noncanonical/overflow counters and checkpoints, unsupported schema versions and unknown states as safe integrity failures while preserving exact legal int64 values.
- Actual two-connection pool saturation times out without executing the queued callback, releases held connections and recovers capacity. Existing transaction tests cover atomic visibility, caught SQL errors, deferred commit rejection, bounded statement/execution and stale/foreign scopes.
- A 20,000-report fixture with 2,000 records for the selected owner uses `reports_owner_cursor_idx`, fetches at most 101 records and rejects another owner's cursor. Existing 20,000-SKU and 10,000-SEO-page workloads remain applicable. These are isolated synthetic measurements, not production capacity claims.
- Focused Linux verification passed **160 tests**: 95 unit/use-case and 65 database. Coverage was **97.63% lines, 92.47% statements, 99.65% functions, 87.47% branches**, with thresholds unchanged. Generated declarations are excluded from behavioral coverage and checked comprehensively against actual schema instead.

## Full verification

`pnpm verify:push` passed on implementation commit `da3dac6ba61923dd43ec0a768c36ee17bea7f8ba` with pinned Node 24.22.1/PostgreSQL 18.6 Linux containers, Payload 3.92.0 and Drizzle 0.45.2. Main project: `tt-test-ef2986f1066606ae`. The [redacted verification record](p1-pr-013-verification.json) retains storage/source audit totals, image/recovery hashes, timing and injected recovery failures.

| Check | Observed result |
| --- | --- |
| Unit/use-case | 95 passed |
| Database | 65 passed: three S2 model/codec/query cases, ten real transaction/pool cases, 14 catalog/import, 20 private, 16 operations and two harness cases |
| Foundation | Six passed |
| Schema | All 63 passed |
| Recovery | All 11 passed in `tt-test-143ef9e086dee37e`; 123 app/28 CMS tables and 39 app views preserved |
| Coverage | 97.63% lines, 92.47% statements, 99.65% functions, 87.47% branches; executable thresholds unchanged |
| Model parity | All 1,574 columns, generated source, SQL types/nullability/defaults/generated fields and real Drizzle/raw-pg representations match |
| Quality | Strict types/negative fixtures, lint, formatting, hygiene, dependency boundaries, OpenAPI and 14 app/two CMS checksums pass |
| Dependencies | Frozen pinned install/advisory audit pass; versions and lockfile unchanged |
| Failure gates | Seven deliberate failures reject correctly |
| HTTP/lifecycle | Health-only contracts, absent product routes, invalid hosted configuration, shutdown/restart pass |
| Retained dev/stage | Both report 14 app/two CMS, zero pending; read-only status checks preserve credential files; stopped with volumes retained |
| Documentation | 119 cards/137 original FR rows/dependency edges/source archives/historical approvals preserved; 190 relations and 30-card forecast inputs verified |

Total: **240 passing tests**. Recovery elapsed 23596 ms including preparation; synthetic backup window 4345 ms. Selected query fixtures remain bounded at 101 fetched rows and use their measured indexes. These local results are not production capacity or hosted RTO/RPO claims.

The review/evidence commit repeats exact-commit verification before push. [PR #13](https://github.com/xmyqyl4x/tiresandtreads/pull/13) records its final tested SHA and independent CI. Technical S2 validation is complete; owner gate acceptance remains pending before dependent S3 work starts.

## Evidence and limits

[Source inventory](p1-pr-013-source-audit.json) covers 48 non-generated source files, 79 interfaces and 83 repository methods. [Storage ownership inventory](p1-pr-013-storage-audit.json) covers all 190 app/CMS relations and assigns first-use extensions. [Forecast inputs](p1-pr-013-forecast.json) preserve all 30 remaining P1 cards and dependency edges. Previous source archives, 137 original FR rows and historical approval records remain unchanged.

No SQL migration, runtime grant, role, credential, dependency version or lockfile change is required. Dev/stage retain their existing 14 app/two CMS history. Runtime/provider composition, complete policy/permission/erasure workflows, hosted capacity and product API/UI acceptance remain the assigned later cards. Owner approval of 013 closes the internal S2 gate before dependent S3 work starts.
