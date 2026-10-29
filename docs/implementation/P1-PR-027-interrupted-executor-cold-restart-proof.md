# P1-PR-027 — disposable interrupted-executor and cold-restart handoff proof

**October 29, 2026 (Pacific) · Local technical proof only.** Approved [PR #46](https://github.com/xmyqyl4x/tiresandtreads/pull/46) merged at `b7e159075cc3159aea2dfb061a1add42e25ca101`, accepting the [paired local proof](P1-PR-027-paired-lifecycle-handoff-proof.md). The owner authorized this interrupted-executor proof in disposable test support. Production bootstrap/CLI/preflight/policy remain unchanged. HS01–HS08 proposed; operators/coverage/rates unconfirmed; six actual S3 gates open with empty records; specialist/licensed work pending; APIs/frontends held. No provisioning, purchases or notifications.

This continues P1-PR-027 under `S3-service-host` without accepting a provider or operating model. [Measured preparation evidence/source pins](evidence/P1/p1-pr-027-interrupted-executor-local.json), [official references](evidence/P1/p1-pr-027-interrupted-executor-sources.json), [validation receipt](evidence/P1/p1-pr-027-interrupted-executor-validation.md).

## Test-only implementation

[Protocol](../../tests/fixtures/lifecycle-restart/protocol.ts), [owned process controller](../../tests/fixtures/lifecycle-restart/parent.ts), [private executor](../../tests/fixtures/lifecycle-restart/executor.ts), [no-argument disposable runner](../../tests/fixtures/lifecycle-restart/run.mjs), [unit tests](../../tests/unit/lifecycle-restart.test.ts), [real SQL/process use cases](../../tests/database/lifecycle-restart.test.ts). These six new code files are under `tests/`; no production entry point imports them. Existing reader, pair coordinator, fixture, tests/guards, scripts, dependencies/lockfile, migrations, CI and runtime pins remain unchanged. Existing unit/database test discovery includes the new files automatically.

The parent admits a copied, exact private IPC envelope for a random `tt-test-*` project in test-local/fixture mode. It reuses existing exact owner/DB/TLS/phase guards, verifies current source/baseline identity and requires primitive synthetic operation/release/generation labels. Only a fixed child module with fixed Node arguments is forked. A caller cannot choose a PID, executable, SQL, repair action or native/retained/hosted target. Plan size is bounded to 65,536 UTF-8 bytes, output events to 16,384 bytes; excessive stdout/stderr crosses an 8,192-byte kill threshold per stream. Public diagnostics expose counts/closure booleans and secret checks, never raw output. No new credential/receipt files or target arguments are written; fixture owner URLs and CA are sent over private IPC.

The child re-admits configuration and calls the unchanged pair coordinator. For deterministic interruptions only that child's PG query prototype is wrapped: it executes the original real SQL, then pauses after an actual advisory-lock or inspection rollback result. Counts record completed inspection transactions, not mocked successful reports. The wrapper is restored on ordinary completion. Forced termination deliberately bypasses finally blocks; the proof must observe process death, both owned stdout/stderr stream closures, zero inspection sessions and zero matching advisory locks. A signal request alone is not considered proof of exit.

## Five interruption windows across three profiles

Each interrupt run first validates a seed pair. The checkpoint exports that seed's redacted receipt. It is not a fresh result of the interrupted batch; a subsequent validation invalidates the seed and a handoff consumes it. The receipt checkpoint uniquely retains the live unused seed until process death.

| Checkpoint | Actual state before SIGKILL | Completed app/CMS reads |
| --- | --- | --- |
| `validation-locked` | Second validation holds the real pair lock, before its first inspection | 1 / 1 seed reads |
| `app-read` | Second app inspection rolled back on server; CMS second inspection has not started; pair lock held | 2 / 1 |
| `cms-read` | Both second inspections rolled back; lock held, new pair receipt not issued | 2 / 2 |
| `receipt` | Seed receipt issued and live; no pair lock or inspection session remains | 1 / 1 |
| `handoff-locked` | Seed consumed; fresh handoff batch acquired lock before inspection | 1 / 1 |

All five run against foundation, migrated and synthetic quarantined-recovery profiles: **15 actual SIGKILL runs**. The parent signals only its own child handle, waits for the actual exit signal and both stream closures, then polls the existing inspection-session tag and exact advisory key to zero within a bounded window. Complete before/after catalog/history/role/ACL snapshots remain equal. Foundation creates no future metadata. All 17 actual quarantined runtime login attempts remain denied after each restart.

Each cold restart forks a different Node PID with fresh module memory against the **same disposable databases**, keeping logical operation/release/generation labels deliberately identical. It first tries the exported old receipt: refused, with zero inspection reads. It then validates both DBs and performs a fresh handoff, recording **two completed inspections per target**. Imported JSON never recovers live-object authority. Every process summary and receipt retains `runtimeAdmission=false`, `hostedAccepted=false` and `productActivation=false`.

| Additional control | Measured outcome |
| --- | --- |
| Resume a paused real second validation in each profile | Three total reads per target: seed, second validation and handoff; actual success path runs without a fake crash/result |
| Parent IPC channel disconnect in each profile | Child's orphan handler exits with code 72; actual exit, both stream closures, zero DB sessions/locks and unchanged durable snapshots required |
| Actual CMS schema ACL drift after receipt-time crash in each profile | Fresh process refuses the defective pair, leaves drift unchanged and skips handoff; repair requires another new process and fresh both-DB evidence |
| Wrong environment/phase/source/target, caller PID/executable/SQL/repair, coercible labels, oversized ASCII or multibyte payload | Refuse before spawn/connect; no raw input echo |
| Unsafe/expanded/contradictory child result or wrong process identity | Refuse/terminate owned child; no authority inferred from a success label |

The process controller waits up to ten seconds for a checkpoint/result and five seconds for exit plus both stream closures; initialization without a valid private plan is bounded to five seconds. Tests' finally blocks stop their owned children; the outer runner removes only its generated project. These are test diagnostic limits, not production supervision or policy changes.

## Test-first evidence and cleanup finding

The unit and SQL workflow tests preceded their support; initial collection failed for the missing protocol module. The first implemented run passed **37/40**: three IPC-disconnect cases timed out while awaiting the aggregate `ChildProcess.close` event. A network-isolated diagnostic using both plain fork and the pinned TypeScript loader observed exit code 72 and both stream closures, while the aggregate event did not arrive within two seconds. This is a measured fixture behavior, not an upstream root-cause or provider compatibility claim. The controller now explicitly waits for actual exit **and both streams**, retaining all real DB/session/lock/state assertions; the next run passed **49/49**.

A further meaningful multibyte boundary control failed with **25 unit cases passing/one failing**: character counting admitted an envelope above the intended UTF-8 byte limit. Bounds now use UTF-8 byte counts and test labels avoid echoing large payloads. Final focused preparation project `tt-test-4bb6ee091240f2c5` passed **50/50** in **30.42s**: **26 unit and 24 real PostgreSQL/process use cases**, zero failed/skipped; exact generated-project cleanup passed. No test threshold, production guard or acceptance policy was relaxed.

The [Node 24 API reference](https://nodejs.org/download/release/v24.21.0/docs/api/child_process.html) distinguishes process exit from stream closure and documents child IPC/signaling. That accessible reference is 24.21.0; the exact 24.22.1 documentation URL was inaccessible to the browser tool. Actual execution remains on pinned Linux Node 24.22.1, with no version waiver or patch selection. Existing [PostgreSQL advisory locking](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS) is cooperative; this proof measures release of the existing transaction lock and never creates a lock/journal table.

## Reproduce, limits and next review

Run `node tests/fixtures/lifecycle-restart/run.mjs`. It accepts no arguments, generates a random disposable Docker project using existing TLS tooling and pinned PostgreSQL 18.6, exposes no DB host port, executes the two new test files, closes owned processes/streams and PG sessions, removes its generated containers/volumes/network, asserts exact-label removal and deletes its generated environment file. `stage`/URI arguments refuse before environment creation. The executor itself is not a CLI and refuses direct invocation without private IPC or with arguments. Native PostgreSQL and retained dev/stage data/settings/credentials/keys/journals/provider manifests are not inputs. Final clean-commit/full-suite/independent CI evidence is recorded in the PR description after those gates run; these artifacts record preparation evidence.

Cold restart here means **validation executor process restart**. No database engine/container/host/provider restart, archive restore, current signed-journal continuity, durable provisioning journal/replay, rotation executor, unknown provider effect reconciliation, image/config compatibility, signer/custody acceptance or actual runtime activation is implemented. Seed and expected catalogs are controlled fixture evidence. Separate DB snapshots and cooperative per-batch locking still do not provide an atomic pair, continuous release window or protection against unrelated administrator changes. Current source/identity checks do not establish hosted attestation or absence of transient/later drift.

This extends local subsets of BLC-T02/T03/T12/T16/T19/T20. All original 22 case records remain proposed/historical; no whole-lifecycle acceptance, core task checkbox or actual S3 record advances. Prior receipt models remain frozen except append-only local reference entries in the two registers.

Recommend a **local-only lifecycle evidence reconciliation and remaining-gap review** next: reconcile phase-aware, paired and interruption proofs against the original 22-case design, separating local coverage from unresolved provider/operating/custody/acceptance work. Review only; no new implementation, production policy change or gate closure. This is proposed only, not implemented or automatically authorized.

Four usable live phases, option C outside Vercel, PostgreSQL consolidation without Redis/ClickHouse and database → repositories → services → APIs → frontends remain unchanged. HS01–HS08 proposed; operators/coverage/rates unconfirmed; six actual S3 gates open; specialist/licensed work pending; APIs/frontends held. No provisioning, purchases or notifications.
