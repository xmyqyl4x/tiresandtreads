# P1-PR-008 — S1 database validation and recovery

**October 23, 2026 · in progress; owner acceptance pending.** Implementer: Codex. Acceptance owner: repository owner. Prerequisite [PR #7](https://github.com/xmyqyl4x/tiresandtreads/pull/7) was owner-approved and merged at `ad3822ae51ed969c6d575ff7e661d8e6a1362623`. This is the P1/S1 gate for E04/E19 and ENG-03, DB13 and DB28, following the [task card](../tasks/phase-1-prs.md#p1-pr-008).

## Scope and S1 decision

This gate assembles the complete P1 physical database evidence from accepted 004–007 and adds a real logical backup/restore rehearsal in a second isolated PostgreSQL cluster. The [inventory contract](../../infra/database/s1-contract.json) names **119 application tables, 28 CMS tables and two application views**, including each database's migration ledger. The manifests remain at **11 application / two CMS migrations**. No applied migration, generated CMS snapshot or checksum is changed.

Recommended decision after the [validation record](evidence/P1/p1-pr-008-validation.md) and exact-commit CI pass: **accept the local P1 S1 database stage**, permitting S2 entities/repositories in 009–013 after owner approval. This is a construction gate, not a usable live phase or production recovery certification. Product services/APIs, full G0 and chosen-host evidence retain their existing gates; frontend work remains behind 031. Source licences, production hosting and budget remain deferred at the approved triggers.

## Repeatable checks

| Command | Boundary verified |
| --- | --- |
| `pnpm verify:database` | Fresh and populated upgrades, drift and failed-DDL refusal, real role restrictions, existing schema invariants and Payload operations |
| `pnpm verify:recovery` | Two disposable clusters, real app/CMS dumps, corrupt restore, catalogue/data comparisons, current deletion replay and CMS reconciliation |
| `pnpm verify:push` | Clean exact commit; quality, unit/use-case, PostgreSQL, schema, recovery, dependency audit and Linux build/lifecycle checks |

The same recovery runner executes through `scripts/verify/local.mjs` in GitHub CI. The focused runner creates only random `tt-test-*` resources, exposes no database port and removes its own containers, network and volumes in `finally`. Dumps and the synthetic journal stay in a disposable shared volume. Only redacted checksums, counts, versions and timings are copied to ignored `.local/recovery-evidence`; exact-commit verification includes these in its local evidence stamp. Each Docker step has a ten-minute bound; PostgreSQL statements/connections and Vitest cases have shorter limits. Retained dev/stage volumes and native PostgreSQL are outside the drill.

## Backup and restore procedure

1. Build the pinned Linux tooling image (Node 24.22.1, PostgreSQL 18.6, Payload 3.92.0). Bootstrap separate app and CMS databases/roles on source and recovery clusters. Generate fresh target role credentials; do not restore cluster passwords. Revoke database `CONNECT` from every target runtime role before restoring. These are new databases, so there are no pre-existing runtime connections.
2. Apply all reviewed migrations on the source using the application and Payload runners. Seed synthetic reference/import records, a private report/contact/asset graph, analytics, scheduled delivery and outbox work. Use real Payload writes to create versioned reviewed content and pending publication work. Capture the catalogue inventory and bounded row-count/content fingerprints for every table.
3. Create separate custom-format `pg_dump` archives as each database's migrator. Include schema/data/ACLs; omit tablespaces. Record kind, run identity, PostgreSQL major, byte length, SHA-256 and the ordered migration manifest. Admission rejects missing/malformed or mismatched metadata and archives outside the synthetic 64 MiB budget. These hashes detect corruption/mismatch; they are not a signature or proof of source authenticity.
4. Record a current deletion/suppression journal **outside both database backups**, then erase the source subject and add a later source write. This proves that restoring the earlier snapshot alone would resurrect deleted data and lose the later write. The fixture journal uses a run-bound HMAC and is checked for identity and capture time; production journal authentication, completeness, freshness and independent durable storage remain chosen-host/privacy-service work.
5. Deliberately truncate a copy of the app archive. Its `pg_restore --exit-on-error --single-transaction` must fail, leave no partially restored tables and leave runtime access closed. Restore the intact app/CMS archives independently as their matching migrators with `--no-owner --no-tablespaces`; preserve reviewed grants. Normal restores must succeed before the negative case counts as useful evidence.
6. Compare all table fingerprints and full catalogue metadata with the source: columns/defaults, owners, ACLs, constraints, indexes, triggers, routines, default privileges, enums and views. Check the exact table/view contract, valid constraints/indexes, enabled triggers and a leading index for every application **and CMS** FK. Recheck immutable history, wrong-owner inserts, runtime isolation and fresh target passwords. Restored migration histories must replay with zero changes.
7. Keep access closed while replaying current restrictions, deleting dependent private records, rebuilding privacy-sensitive metrics and reconciling CMS publication. The cases below deliberately fail intermediate steps and retry. Only after baseline comparisons and final readiness checks succeed does the fixture restore the existing restricted runtime `CONNECT` grants. Read and denied-access probes then verify the reopened target.

PostgreSQL logical dumps cover one database and do not include cluster roles. These separate app/CMS snapshots are **not** a coordinated cross-database snapshot; publication work provides the tested reconciliation path. See the primary [pg_dump documentation](https://www.postgresql.org/docs/18/app-pgdump.html) and [pg_restore documentation](https://www.postgresql.org/docs/18/app-pgrestore.html). Restore only trusted reviewed archives: restoring database definitions can execute source-supplied code.

## Deletion and independent CMS recovery

The [replay fixture](../../tests/fixtures/recovery/replay.ts) rehearses a bounded dependency graph. It is intentionally test-only, not a deployable privacy worker. First restrict the subject, retain deletion/suppression markers, revoke sessions/grants, anonymize and suppress scheduled mail, cancel old outbox work and block affected analytics days. Then remove event/grant/report-asset/private-input/version/report/contact/session dependencies and the subject, preserving unrelated import assets and the surviving subject. Rebuild the dirty day's metrics before clearing its privacy barrier. A second replay leaves the same erased outcome and one copy of each tombstone.

An injected unhandled report child forces an FK failure. The deletion transaction rolls back, private input remains recoverable for retry, and runtime access stays closed. This exercises safe failure when the retention graph is incomplete, rather than disabling constraints. The proof covers database object metadata only; deleting bucket versions, caches, provider files and every later schema dependency remains the owning privacy/asset service's responsibility.

CMS recovery uses reviewed source content plus its durable pending publication row. An injected crash occurs after inserting the immutable application DTO but before acknowledging CMS work. Readiness stays blocked; retry verifies the same hash, publishes the acknowledgement and does not duplicate the projection. This proves the storage recovery boundary. Production authorization, stale-worker fencing, out-of-order revisions and full DTO sanitization remain 012/021 and subsequent editorial service/API cards.

## Applicable invariant matrix

All 28 design invariants are accounted for below; “storage” does not mean the later business use case is accepted. See [database invariants](../09-database-design.md#10-transaction-boundaries-and-concurrency) for complete behavior and the 004–007 packets for individual tests.

| Invariant | S1 evidence / retained obligation |
| --- | --- |
| DB01 | Idempotency identity/body-hash and transaction/outbox storage tests in 006; duplicate command service races remain later |
| DB02–DB03 | Immutable report/comparison versions, same-parent FKs, bounded distinct slots in 006; rerun/save concurrency remains S2/S3 |
| DB04–DB08 | Delivery identity/deadline/lease, provider inbox dedupe, consent provenance and durable outbox constraints in 006; dispatch/permission/provider races remain services |
| DB09–DB11 | Partner codes/caps and billing/budget are later-phase schemas, outside P1 S1 |
| DB12 | Composite owner FKs tested before and after restore; partner tenant/RLS schemas remain later phases |
| DB13 | Current journal refusal, restriction-first replay, FK rollback, tombstone retention and closed-access restore in 008; complete privacy worker and external erasure remain later |
| DB14 | Published immutable coherent bundle/version constraints in 005; current safety/atomic import services remain later |
| DB15 | Exact asset/report/version/scope ownership and grant metadata in 004/006 and restore; request-time authority and object-byte access remain services |
| DB16 | Payload transaction/version storage in 007 and independent CMS crash/retry propagation in 008; production publishing remains later |
| DB17–DB18 | Event dedupe and dirty/privacy generation storage in 007; restored event purge and blocked metric rebuild in 008; intake/worker races remain later |
| DB19 | Capped bucket FK/checks and real two-connection last-slot race in 007; multi-window HTTP enforcement/key rotation remain later |
| DB20 | Optional pure computation cache is absent; no additional cache dependency or acceptance claim |
| DB21–DB22 | Versioned source/reference, recall targets, import identity and bundle constraints in 005; licensed ingestion and publication concurrency remain later |
| DB23–DB26 | AI/reuse/photo schemas and use cases are P2 work, outside P1 S1 |
| DB27 | Public route/ad/SEO dimensions, revisioned reporting, private exclusions and runtime denials in 007; rendering/consent/network behavior remain later |
| DB28 | Fresh/populated upgrades, immutable checksums, role isolation, full restored inventory and deletion replay in 004–008; live web/app/MCP upgrade compatibility awaits those clients |

## Failure handling and remaining operational gates

Any checksum/history/inventory mismatch, corrupt archive, missing/stale journal, incomplete deletion, unreconciled CMS work or failed permission check blocks reopening. Preserve restricted access, record redacted diagnostics, fix the cause and repeat from a new isolated target. Never alter applied checksums, disable FKs/triggers or reuse the damaged target as proof of recovery. A selected production host must additionally stop ingress/workers/schedulers and close existing sessions before maintenance; `REVOKE CONNECT` alone does not terminate existing sessions.

The approved targets remain **RTO four hours / RPO at most 24 hours**, with a 15-minute RPO only after a proven PITR configuration. Small local logical snapshots and their elapsed times do not certify either target. The test explicitly observes a missing post-backup write. Before hosted release, prove scheduled encrypted off-host backups, retention/expiry, independent current journals and keys, full-size restore timing, WAL/PITR if selected, object-version recovery/purge, compatible application deployment, mail/webhook/queue reconciliation and monitored reopening on the selected host. No hosted deployment, paid integration, real user data or new infrastructure dependency is introduced here.
