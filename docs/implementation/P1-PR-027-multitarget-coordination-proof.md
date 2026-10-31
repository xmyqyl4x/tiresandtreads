# P1-PR-027 — disposable multi-target coordination proof

Approved [PR59](https://github.com/xmyqyl4x/tiresandtreads/pull/59) merged at `d6d9b170ba242e5b33870e176fafad81994d9748`. This implements the [reviewed MC01–MC20 local proof](P1-PR-027-multitarget-coordination-proof-design-review.md) in new disposable test support. It does not implement P1-PR-028, change production bootstrap/CLI/preflight/policy, or accept PJ13/BLC-T13 or any S3 gate. The owner explicitly directed continued local S3 work and kept APIs held.

## Components and boundaries

The [portable no-argument runner](../../tests/fixtures/multitarget-coordination/run.mjs) creates eight fresh generated local Compose projects, uses the existing pinned PostgreSQL 18.6/Node 24.22.1 tooling and owner-only foundation initializer, and removes only its owned resources. Setup and teardown are mutable synthetic harness work. There are no published ports, retained databases, app/worker/provider services or outbound product calls. Setup has a 120-second bound, cases 15 seconds, and teardown 120 seconds. Linux Docker executes the same sources from Windows development and independent CI.

The [candidate factory](../../tests/fixtures/multitarget-coordination/proof.ts) admits only the existing five-field, 4096-byte raw plan and private fixed endpoints. It opens/admit-checks common0 and common1 before the first allocation; attempts common0 then common1 once; then opens and attempts source app, source CMS, target app and target CMS inner channels. These are **six distinct physical clients**. All locks use exclusive nonblocking session-level two-integer keys: common `(7724054,1)`, inner `(7724004,1)`. No reentrant ownership check or lock retry is issued. A fixed app/CMS test entry label uses this same canonical path and does not extend the public raw envelope.

The four databases are foundation-only: all 19 scoped roles remain restricted/NOINHERIT, role memberships and user objects are absent, and every nonowner runtime role is denied CONNECT in both app/CMS databases in both domains. Positive catalog reads compare role/member/ACL/GUC/schema/catalog digests to setup baselines. After each profile, a separate [parent catalog audit](../../tests/fixtures/multitarget-coordination/preservation.ts) checks all four owner endpoints and baselines between fresh matching Docker/material seals. This audit admits no coordination participant and cannot resolve a candidate's unknown cleanup.

The observer mounts only owner material, trust material and its control sockets, all read-only. It has no root password, server key, Docker socket, fault socket or provider credentials. The new [resource custodian](../../tests/fixtures/multitarget-coordination/resource-supervisor.ts) makes fixed fresh Docker GETs and checks owned containers, incarnation, aliases, private network, volume ownership and material. It batches independent reads without caching successful observations. Its Docker socket still confers trusted daemon authority despite a read-only mount; this is not an API sandbox or independent attestation.

The separate [SQL inspector](../../tests/fixtures/multitarget-coordination/inspector.ts) holds exactly two privileged read-only clients, independently registers backend identities and samples `pg_stat_activity`/`pg_locks`. Each observation uses a fresh autocommit read-only repeatable-read transaction, avoiding statistics snapshots held across waits. Identity includes PID, server `backend_start::text` with full microseconds under UTC/ISO, database, role, exact bounded run/participant/channel application token and client-backend type. Advisory observations match database OID, key pair, `objsubid=2`, exclusive mode and granted state. No raw PID, password, row data or PEM appears in a receipt.

The separate [fault controller](../../tests/fixtures/multitarget-coordination/fault-controller.ts) accesses a private registry socket unavailable to the observer. It accepts only the fixed source/target loss selector, waits for independent observations of required grants and an actual opposite-domain `PgSleep`, corroborates the exact private backend identity and resource binding, then uses the entire identity predicate in its single `pg_terminate_backend` statement. Signal success is followed by independent backend/lock absence checks; a signal alone is not reported as death. The inspector must then observe the independent read still in `PgSleep` after that backend loss. Unknown-acknowledgement control instead observes common0's grant while its same simple-protocol query remains in a fixed sleep, then kills that exact backend before the complete grant acknowledgement can reach the candidate. These are synthetic controller effects, separate from lifecycle/provider dispatch.

## Bounds, transaction and cleanup semantics

The monotonic 4000ms candidate budget starts before context admission. Connection/query limits remain at most 1500ms and the remaining budget; statement/idle limits are 1000ms, lock 250ms, transaction 5000ms. Fixed commands use short explicit read-only repeatable-read groups followed by ROLLBACK. Session locks remain held across those rollbacks; no transaction is kept idle to retain a session lock, no heartbeat is added and no guard is disabled. SQL inspection and resource/context checks occur around candidate command awaits; all six grants are required before catalog work. These are sampled cooperative checks with check/use races, not distributed fencing or a globally atomic snapshot.

The deadline control completes its fixed SQL within normal limits and ends that short transaction, then deliberately withholds application delivery until 4025ms after the original start. It proves rejection of late delivery. It does not claim the database was allowed to execute beyond its per-command limit. Source/target loss permits an independent already-running read to finish; that result is counted and discarded, and no subsequent read dispatch is admitted. Resource-supervisor loss, SQL-inspector loss and a fixed post-await environment change also refuse provisional evidence.

For the two supervisor/inspector stop profiles, the parent first observes actual `PgSleep`, stops the exact owned service, then writes a fixed synthetic marker into the identity-checked observer's temporary filesystem. The candidate deliberately holds application delivery at that bounded handoff until the parent stop completes, then runs its ordinary post-read guard. SQL may finish before the stop. This is a disclosed test synchronization control within the original whole budget, not a claim that Docker stop latency precisely coincides with SQL execution, nor an authentication or cancellation mechanism.

Candidate/control connection reservations allow at most ten observer clients/six per domain in the standard profile, reserving two SQL inspectors. Adverse profiles reserve one additional fault client, limiting observer clients to nine/five per domain. Together these enforce the reviewed ceiling of twelve total/seven per domain. Synthetic setup and the independent sequential preservation audit occur outside candidate work.

Cleanup closes the reverse actual opened prefix, including ungranted/partially admitted handles, with inner channels before common1/common0. Each driver end has a separate 750ms observation bound; fresh exact backend/lock absence has a separate whole 2000ms window. Missing end or unavailable inspection remains unknown. Unknown disposition abandons the fixture process and refuses a fresh candidate; later parent audit/teardown does not turn that receipt clean. An unrelated registered witness is checked alive, and a fresh participant after known cleanup rereads all four baselines.

Receipts are frozen/redacted, with at most 64 fixed trace events and 16384 UTF-8 bytes. Open/end, attempted/acquired, started/completed/discarded work, semantic parity and cleanup observations remain distinct. Lifecycle/provider dispatch and actual notifications are zero. Independent durability, authentication, fencing, runtime admission, hosted acceptance and product activation remain false; original cases/gates closed remain zero.

## Local control coverage

The [pure tests](../../tests/unit/multitarget-coordination.test.ts) validate strict envelopes, ordering, bounded receipts and identity mismatches; they do not execute SQL. The [standard live cases](../../tests/multitarget-coordination/standard.test.ts) and [fixed adverse profiles](../../tests/multitarget-coordination/adverse.test.ts) exercise actual PostgreSQL behavior. Exact results are recorded separately in the [local evidence](evidence/P1/p1-pr-027-multitarget-coordination-local.json) and [validation](evidence/P1/p1-pr-027-multitarget-coordination-validation.md).

| Control | Local evidence scope | Original acceptance |
| --- | --- | --- |
| MC01 | Strict raw plan and private IPC refusal; caller SQL/URI/PID/key/timeout excluded | Open |
| MC02 | Six verified TLS owner channels; factory wrong CA, hostname and password refusal | Open; remaining TA negatives separate |
| MC03 | Both raw domain enumerations produce canonical order | Open |
| MC04 | Six grants, four baseline reads, reverse cleanup | Open |
| MC05 | First common busy for fixed app/CMS entry labels, no inner dispatch | Open |
| MC06 | Second common busy after exactly one first-common grant | Open |
| MC07 | Each of four inner busy positions stops at its acquired prefix | Open |
| MC08 | Equal keys independently grant in app/CMS databases; no cross-database exclusion claim | Open |
| MC09 | Early read/inner, reverse, reentrant and reused participant refusal | Open |
| MC10 | Actual exact-owned common0 termination during opposite target read; late result discarded | Open |
| MC11 | Actual exact-owned common1 termination during opposite source read; late result discarded | Open |
| MC12 | Actual observed grant with complete acknowledgement lost; no retry | Open |
| MC13 | Fixed late application delivery rejected at the original whole deadline | Open |
| MC14 | Resource supervisor actually stopped during awaited fixed read; no cached-map adoption | Open; not every drift variant |
| MC15 | Reverse close, actual driver end and fresh backend/lock absence; witness survives | Open |
| MC16 | SQL inspector actually stopped; cleanup stays unknown and fixture is abandoned | Open; forced driver-end hang separate |
| MC17 | All-four-endpoint foundation digest/quarantine audit after every profile | Open; populated history absent |
| MC18 | Fixed environment change after awaited SQL invalidates provisional observations | Open; not exhaustive every-await mutation |
| MC19 | Fresh participant after known cleanup; no participant after unknown cleanup | Open |
| MC20 | Bounded immutable redacted facts and separate synthetic fault evidence | Open |

## Validation and remaining local work

Run `node tests/fixtures/multitarget-coordination/run.mjs` for the dedicated proof. Its new independent [CI workflow](../../.github/workflows/multitarget-coordination.yml) uses pinned checkout/tooling; existing full/TLS workflows remain byte-for-byte unchanged. Run the existing full `node scripts/verify/push.mjs` separately from a clean committed tree; only its fresh exact-commit stamp authorizes normal push. Full, dedicated TLS and dedicated coordination CI must all pass before the already owner-authorized implementation merge.

The next local S3 work is evidence reconciliation against the original 18 journal scenarios, 22 lifecycle cases, 16 MT controls and 20 TA controls, explicitly distinguishing actual observations from untested variants and production authority. Remaining local candidates include unexecuted TA root/material/routing/end-hang negatives and populated source/target preservation. No remaining local proof can supply actual hosting/operator/custody, specialist, licensed data or privacy sign-off. Full S3, API and frontend acceptance therefore remains held.

HS01–HS08 remain proposed; operators/coverage/rates unconfirmed; all six S3 gates open; specialist/licensed work pending; APIs/frontends held. Four usable phases, option C app + DB outside Vercel, PostgreSQL consolidation and the database → repositories → services → APIs → frontends sequence remain unchanged. No provisioning, purchases or actual recipient notifications.
