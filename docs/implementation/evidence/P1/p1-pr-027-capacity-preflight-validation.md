# P1-PR-027 — SP06 local capacity/lifecycle validation

**October 28, 2026 (Pacific) · Local technical evidence only.** Baseline: owner-approved merged PR #37, `3e86d3e5fdddd944f6b9be76a92edcaa028fc3ac`. [Implementation contract](../../P1-PR-027-local-capacity-preflight.md). HS01–HS08 remain proposed, all six actual gates pending, specialist/licensed work pending and APIs/frontends held. No provisioning, purchases or hosted activation are authorized.

## TDD and focused measurements

The initial unit suite failed for the missing capacity/headroom modules. After implementation, all **17 unit cases** pass: exact usable boundary, reserved-slot subtraction, raw-versus-usable refusal, invalid/missing/noninteger capacity, low/inconsistent available bytes/percentage/inodes, and integer arithmetic beyond safe floating-point byte ranges. The runtime change strengthens actual admission in both service-host and worker composition; it does not change production schemas, credentials or resource caps.

The first focused Docker run passed all seven workflow cases in project `tt-test-76c152fb368e54cd`. A subsequent focused run includes restricted peer credential input, verified journal entry count, controller/peer/bundle process snapshots and provider process/resource samples. That superseding diagnostic, project **`tt-test-250c1033a1741d6b`**, passed seven of seven, zero failed/skipped, in **17.78 seconds** reported by Vitest; build/setup through result/provider capture took **40.729 seconds**, excluding final cleanup. It is a working-tree diagnostic, not final-commit evidence.

| Observation | Focused result | Meaning / limit |
| --- | --- | --- |
| PostgreSQL capacity | 75 raw − five server-reserved = 70 usable; 68 required; two usable unallocated | Complete declared fixture maxima, including operational reserve; proposed 45 usable refused |
| Physical full-host pools | 17 simultaneous lanes, maximum one each | Separate source/pool/bundle phases, no overlapping full hosts |
| Overload | 12 excess aggregate admissions refused in 503 ms; report lane succeeds | Bounded local backpressure, not a sustained load SLO |
| Mixed business work | 32 operations, concurrency four, 39 ms; 24 sampled client backends | Six harness pools/five direct clients and two-pool peer accounted for; sampled idle counts are not declared maxima or peak capacity |
| Journal and objects | Eight authenticated journal entries and eight exact-version 32 KiB object round trips, 134 ms | Shared local filesystem; ephemeral Moto; not off-host durability or throughput acceptance |
| Journal filesystem | 853,007,495,168 available bytes; 62,607,651 free inodes | Point-in-time local storage headroom; database/object samples independently pass the same guard but share Docker storage |
| Database-lane refusal/reconnect | Readiness and peer refuse under exact operations/CMS NOLOGIN/backend termination; recover after LOGIN | Same processes reconnect; no postmaster restart in this case |
| Forced drain | Client closed in 51 ms; server quiescent after 2,015 ms | Client socket close does not mean immediate cancellation of the server query |
| Bundled-process stop | SIGTERM, exit zero, no SIGKILL, owned lanes disappear; 27 ms | Bundle is a separate PID inside the test tooling container; health 200/product route 404 |

Mixed-work process sampling observed pnpm, Vitest/controller, peer and esbuild helpers; the bundle-phase sample additionally observed the standalone runtime. Snapshots record PID/parent/name/RSS/threads without command arguments or environments. PostgreSQL backend types include client, autovacuum, checkpointer, background writer, WAL, logical launcher and three I/O workers. Provider samples after the workflows reported PostgreSQL 69.66 MiB, Moto 80.8 MiB and Inngest 56.14 MiB within their unchanged 512 MiB container limits. Docker PIDs can include threads; point samples/RSS are not memory high-watermarks, additive budgets or production sizing acceptance.

All fresh project containers, volumes and network were removed and the cleanup assertion passed. The generated environment/private temporary files were removed. No retained/native resources or original receipts were modified. Earlier diagnostics cannot substitute for the exact committed gate below.

## Final committed gate and preservation

Commit the complete revision, require a clean worktree, and run `node scripts/verify/push.mjs`. Its ignored stamp binds SHA/tree/lockfile and all local proof results. Record measured test totals, coverage, SP06 evidence and independent final-head CI in the PR body/checks; do not relabel this working-tree receipt as final-commit evidence.

The gate retains source/format/lint/type/layer/contract/migration/model/S3 checks, combined unit/use-case/database coverage and negative gates; foundation/schema/HTTP/build/lifecycle; original S1 recovery; signed custody/deletion replay; approved-source image/TLS/migration/outage/rollback; provider restart/deletion proofs; and adds these seven capacity/lifecycle cases with exact machine-result assertions. Thresholds and cleanup guards are unchanged. All 24 new tests must run.

Documentation/authority audits preserve 119 original cards and dependencies, 137 FR rows, 75 checked/282 unchecked tasks, historical approval sections/source archives, all 15 pinned readiness digests and four preceding validation receipts. SP05 merge/SP06 local progress only; eight proposed HS decisions and authority/selection/cost values unchanged. Six actual gates retain empty records/pending status and false activation flags. Parent completion boxes remain open; APIs/frontends held.

Local admission and process/I/O observations do not accept actual provider/host capacity, sustained throughput/latency, growth, storage durability, independent custody, hosted deployment/identity, policy, specialist or licensed-source gates. SP07 local observability/alert/operator response is the proposed next step, with no provisioning, purchases or actual recipient notifications.
