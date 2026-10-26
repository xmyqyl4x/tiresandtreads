# P1-PR-024 validation evidence

**October 26, 2026 · S3 implementation approved and merged in [PR #24](https://github.com/xmyqyl4x/tiresandtreads/pull/24) at `4ba7b446ee343eac9baabd3d98bb8ba228d11890`.** Baseline: approved PR #23 merge `c71df71471544868fd0a47b9ca7275508670e7ae`. See the [service/database/budget contract](../../P1-PR-024-analytics-limits-operations.md). Specialist review and licensed adapters remain pending.

## TDD and scope

The initial event policy test failed because the module did not exist. Unit cases then cover registered event/name/route/property schemas, UTF-8/body/replay bounds, purpose-separated context and quota HMACs, short expiry, key overlap, canonical address/IP aliases and connection-plan validation. Application use cases cover denied collection without a database, stale-publication retry intent, disabled quota refusal and invalid trusted signals. A 200-iteration uncached technical evaluation profile proves output parity and records local timings; it activates no cache or tire issuance.

Real migrated PostgreSQL cases exercise parallel duplicate receipts, context refresh, GPC/CMP/withdrawal/suppression, per-attempt admission persistence, changed digest refusal, privacy-hidden generations, old worker fences, partial purge/regrant/re-dated replay refusal, expiry/deadline changes, concurrent hour/day/burst quotas, global row-cap rollback, key alias/retirement checks, bounded expiry cleanup, staff dashboards, reader denial and physical pool isolation/budget failure. Initial runs found missing narrow schema usage and row-lock column grants; corrected grants preserve private ownership without granting history mutation. The deadline test checks the captured deadline and uses a migration-owner clock fixture, avoiding a fragile timed wait. Runtime constraints remain enabled.

## Full verification

`pnpm verify:push` passed on implementation commit `9270a08bf943a1210a5e64c750231041a9b9c55a` at `2026-10-26T14:50:30.966Z`. The [redacted machine record](p1-pr-024-verification.json) captures that exact run. An earlier run rejected an inconsistent clock fixture; both effective/expiry times were corrected without weakening the lifetime constraint. The evidence/task-list commit receives the complete gate again before push; its final head and independent CI status are recorded in [PR #24](https://github.com/xmyqyl4x/tiresandtreads/pull/24).

| Check | Observed result |
| --- | --- |
| Unit/use-case | 644 passed; 27 new policy/crypto/budget cases and five application/profile use cases |
| Database/provider | 227 passed; 16 new migrated analytics/limit/operations cases |
| Foundation/schema/recovery | Six / 63 / 11 passed |
| Total | **951 passing tests**, including 48 new analytics tests |
| Coverage | 97.31% lines, 94.19% statements, 98.56% functions, 90.47% branches; thresholds unchanged |
| Quality/build | Frozen Linux build/advisory audit, hygiene, format, lint, TypeScript, 186-module boundaries, health contract and migration checksums passed |
| Storage | 133 app tables, 44 views, 1,687 table/view columns, 250 codec fields/25 fact families, 28 CMS tables; 29 app/three CMS migrations; generated Drizzle parity passed |
| Quota race | 24 concurrent attempts, 3 accepted, 91.637ms locally; every shared window remains capped; fixed-window boundary semantics preserved |
| Pool isolation | One aggregate connection held; report query completed in 0.674ms with a separately budgeted lane; test envelope 16 total/reserved connections |
| No-cache profile | 200 equal-output technical evaluations: p50 0.086ms, p95 0.188ms, max 0.908ms; fixture evidence resolver, no SQL/provider/AI cost or real issuance |
| Failure propagation/runtime | Seven deliberate verification failures rejected; production stop/restart and existing bundled commands/configuration refusal passed |
| Recovery | Complete synthetic app/CMS restore and deletion replay passed at 29 app/three CMS, including corrupt restore, stale/missing journal, incomplete deletion and crash retry |
| Documentation | 119 cards/137 original FR rows/dependency edges/source archives/historical approvals preserved; 69 checked tasks/288 unchecked |

Retained Docker dev and stage both have **29 app/three CMS applied, zero pending**, and are stopped with volumes retained. Native PostgreSQL, existing credentials and unrelated projects are unchanged. Disposable projects `tt-test-38affb9294a74f0c` and `tt-test-20e2af0975572d58` and their volumes were removed by exact identity. Local pool/query/profile measurements do not establish production throughput, report/dashboard p95, five-minute steady-state freshness or hosted recovery. The restore fixture does not establish the future complete analytics rights/retention/erasure graph.

## Acceptance limits

Headless S3 only. No public collector, browser SDK, UI, real vendor, hosted capacity, or data product is enabled. Initial collector/security policies remain disabled pending S4/activation review. S4/S6 still owe report/dashboard p95, actual 10× forecast mixed load and client/HTTP/admission evidence. P1-PR-025 owns the complete rights/retention/deletion/restore graph; 027 owns automatic cadence and alarms. Local full-schema synthetic restore is not the future actual new-table erasure graph or hosted RPO/RTO. No optional cache table exists. Licensed adapters and specialist acceptance remain open; report issuance and real mail remain disabled.
