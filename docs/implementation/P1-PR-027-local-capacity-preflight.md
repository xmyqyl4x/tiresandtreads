# P1-PR-027 — SP06 local capacity and lifecycle preflight

**October 28, 2026 (Pacific) · Local implementation in review; actual hosted proof not run.** The owner approved [PR #37](https://github.com/xmyqyl4x/tiresandtreads/pull/37), merged into main at `3e86d3e5fdddd944f6b9be76a92edcaa028fc3ac`, and authorized SP06 local-only capacity/lifecycle preflight. SP01–SP05 local proofs are approved; actual hosted proofs remain pending. HS01–HS08 remain proposed, without approved provider, region, budget or operators. No provisioning, purchases, accounts, cloud authentication, DNS changes, remote deployment or recipient notifications are authorized.

This continues S3-service-host under P1-PR-027. It does not implement frontend card P1-PR-038. All [six actual acceptance gates](P1-PR-027-s3-gate-review.md) remain pending with empty actual records and false activation flags. Specialist review and licensed adapters remain pending; APIs/frontends held. Four live phases, option C, PostgreSQL consolidation and database → repositories → services → APIs → UI remain unchanged.

## Capacity contract

The dedicated [disposable profile](../../infra/local/compose.capacity.yaml) sets raw `max_connections=75`, `superuser_reserved_connections=3` and `reserved_connections=2`. Ordinary usable capacity is **70**, separate from the plan's operational reserve. The complete fixture requires **68**: 17 owned lanes + 31 external allocations + 20 operational reserve. This leaves two usable slots unallocated. Normal declared allocations total 48; unused reserve is not permission to add undeclared consumers.

| Physical consumer / phase | Maximum PostgreSQL allocation | Execution and scope |
| --- | --- | --- |
| Full service host | 16 application + one CMS = 17 | All maxima one. Explicit pool saturation, source-composed business host and copied standalone bundle run in separate phases; SQL checks require the preceding host's connections to disappear |
| Fixture harness | 20 application + six CMS = 26 | Six pools, maximum three each (five app, one CMS), plus five direct clients (three app, two CMS) use at most 23; three slots are conservative padding. One logical controller has pnpm/Vitest/tsx/esbuild helper processes; this is not one OS process |
| CMS migration setup | Included in harness allocation | Separate migration child has maximum three Payload pool connections plus its advisory-lock connection, before runtime phases; no additional simultaneous full-host replica |
| Separate peer process | One app + one CMS = two | Two bounded runtime pools; a private 0600 file supplies only the catalog/CMS runtime DSNs, with no migrator/admin credentials or host key rings |
| Temporary forced-drain probe | One app | Maximum one, separate from the host pool set |
| Dormant web reservation | Two app | Retained from the fixture plan; no web/frontend process starts |
| Operational reserve | 20 | Counted once for the shared cluster, after declared consumer maxima |
| PostgreSQL server reserve | Five, excluded from usable 70 | Counted separately from the operational reserve; runtime roles receive no reserved-slot privileges |

Thus external allocations are harness 26 + peers two + drain one + dormant web two = 31. Application and CMS databases share this physical server; capacity is never allocated twice. PostgreSQL background, I/O and WAL processes consume compute/memory but are not additional client-pool maxima. Moto and Inngest use no application PostgreSQL pool; the local Inngest dev server uses its own local state. The certificate helper is an exited setup process. No actual provider connection quota has been accepted.

The fixture explicitly refuses the proposed **45 usable slots**: raw 50 minus five reserved still cannot fit 68. It also refuses a 71-slot plan that fits raw 75 but exceeds usable 70, before opening the other 16 lanes, then proves no owned host connections remain. This revised *test fixture* budget does not change the proposed HS sizing, select a hosted plan or accept either real topology.

The shared [capacity helper](../../packages/config/src/postgres-capacity.ts) now strengthens both [service-host pool admission](../../packages/integrations/src/service-host-pools.ts) and [standalone/shared worker composition](../../packages/integrations/src/runtime.ts): query actual server reservations and compare required maxima with usable capacity. Unknown, inconsistent or insufficient values refuse with masked errors. Existing role/database checks, bounded pools and drain guards remain. Metadata retains raw `capacity` / `maximum` for compatibility and adds `serverReserved` and `usableCapacity`. Default local raw 100 with three superuser-reserved slots means usable 97; the earlier required 42/65 budgets still fit. Historical measured receipts are unchanged.

## Executable lifecycle proofs

The [seven-case workflow suite](../../tests/capacity/preflight.test.ts) uses real PostgreSQL roles, accepted business-host factories, versioned Moto S3 and a separate peer process:

1. Reconcile the complete budget against actual raw/reserved settings; refuse 45-slot and raw-versus-usable overbooking and assert connection cleanup.
2. Hold all 17 lanes concurrently and observe each maximum of one in `pg_stat_activity`. Hold the aggregate lane, refuse 12 excess admissions within 1.5 seconds and prove the independent report lane still runs. No report is issued and source acceptance is not bypassed.
3. Publish one synthetic CMS document through the actual content service, then complete 32 page-read, SQL quota-cleanup, CMS-reconcile and authorized masked-health-review operations with **global concurrency four**. The separate two-pool peer remains usable. Sample client backends below the 48 declared allocations; idle counts do not replace declared maxima.
4. Check available bytes/inodes on actual journal, database and object-container filesystems. Perform eight signed journal appends and verify the captured eight-entry signature; perform eight exact-version 32 KiB S3 round trips with SHA-256 equality.
5. Set only the operations/CMS runtime roles to `NOLOGIN` and terminate their exact host/peer backends. Readiness and peer work refuse. Restore `LOGIN`, then prove the same host/peer reconnect without process replacement. This is runtime database-lane failure, **not a PostgreSQL postmaster restart**; the earlier SP05 and provider-recovery drills supply distinct cold-restart evidence.
6. Block an admitted public-page business read on a real table lock, begin shutdown, refuse new calls, release the lock and complete admitted work. Repeated shutdown is safe. Separately close a forced one-connection client after a 50 ms drain deadline while a two-second server query runs; report client-close time and eventual PostgreSQL quiescence separately.
7. Build/copy the standalone service-host bundle into an isolated temporary directory without workspace dependencies, launch it as a distinct OS process, require readiness 200 and product route 404, then send SIGTERM. Require exit zero without SIGKILL and disappearance of every owned host connection. The source host, explicit pool test and bundle never overlap as full-host replicas.

The [headroom guard](../../scripts/capacity/headroom.ts) uses integer byte arithmetic, including large values: at least 64 MiB available, five percent available capacity and 128 free inodes. This is a bounded local precondition, not a production storage alert policy, growth forecast or required hosted reserve. Refusal cases cover low bytes, low percentage, low inodes and inconsistent values without filling a real disk.

Linux `/proc` snapshots record PID, parent, name, RSS and threads during mixed work and while the bundle is alive. Provider samples record only `pid,ppid,comm` and Docker resource counters after the workflows; commands/environments are not collected. Record helpers, children and PostgreSQL backend types, not just application entry points. Snapshots are point-in-time observations, not high-watermarks; shared RSS is not additive. Existing caps remain 1,536 MiB/two CPUs for the shared tooling container and 512 MiB/one CPU for each provider container. The bundle runs inside the tooling cap, **not** an independently proven production 768 MiB host.

## Reproduction, evidence and limits

```sh
pnpm verify:capacity-preflight
```

The [runner](../../scripts/verify/capacity-preflight.mjs) accepts no target/credential arguments and creates only a fresh `tt-test-<hex>` internal Docker project with no published ports. It uses existing pinned runtime/engine/provider images and migrations; neither production DDL nor retained configuration changes. Fixture keys and DSNs stay in private temporary files. Only nonsecret metrics and machine-readable results are copied to ignored `.local/capacity-evidence`. All seven cases must pass, with zero failures or skipped cases. Generated containers, volumes, network, environment and guarded temporary directories are removed; project-label assertions check cleanup. Native PostgreSQL and retained dev/stage data, secrets, journals and manifests are not targets.

The full clean-commit Linux gate includes this proof after SP05 and before provider restart/replay. Its stamp binds SHA/tree/lockfile and capacity evidence. Independent final-head CI and measured totals belong in the PR/checks. [Focused validation receipt](evidence/P1/p1-pr-027-capacity-preflight-validation.md).

These low-volume fixtures do not establish launch throughput, p95/p99 SLOs, sustained saturation, WAL/storage growth, independent failure domains, object durability, provider quotas, actual CPU/memory sizing, signed registry provenance, rolling business-host compatibility or hosted RPO/RTO. Database/object/journal filesystems share the local Docker failure domain; Moto is ephemeral. No durable report, mail recipient, source-rights or policy acceptance is manufactured. The current operations view's raw-capacity telemetry is not this usable-capacity admission result; SP07 must reconcile alert semantics before real-host acceptance, without rewriting historical schema evidence.

Only SP05 local merge/SP06 local progress and evidence references change in the decision/service registers. All eight HS decisions and authority/selection/cost values remain unchanged. All six actual gate records stay empty/pending and activation flags false. Original 119 cards/dependencies, 137 FR rows, 75 checked/282 unchecked tasks, historical approvals/source archives, 15 pinned readiness receipts and four preceding validation receipts remain intact; parent P1-PR-027's three completion boxes remain open.

After owner review/merge, propose **SP07 local-only observability, alerting and operator-response preflight**, including usable-capacity versus raw-capacity telemetry and refused/stale dependency evidence. Keep every hold and all actual gates open. No provisioning, purchases or actual recipient notifications.
