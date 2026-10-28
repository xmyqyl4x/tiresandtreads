# P1-PR-027 — SP07 local observation/response validation

**October 28, 2026 (Pacific) · Local technical evidence only.** Baseline: owner-approved merged PR #38, `fa25c6b7caa37843a3b43bd7dd0f6d66b72c4806`. [Implementation contract](../../P1-PR-027-local-observation-preflight.md). HS01–HS08 remain proposed; six actual gates pending, specialist/licensed work pending and APIs/frontends held. No provisioning, purchases or actual recipient notifications are authorized.

## TDD and focused evidence

The initial observer suite failed for the missing observation module; the response suite separately failed before its module existed. All **25 unit cases** now pass: usable/raw/reserved arithmetic, invalid/stale/future capacity, preserved alarms under failed or denied evidence, stale positive dependencies, masking, overlap refusal and unapproved transport; persistent incident identity, acknowledgment versus resolution/delivery, simulated escalation, fresh recovery after re-creation, unresolved-event retention, explicit exhausted retry, malformed/foreign data, outbox overflow without mutation and clock rollback. Schemas use the existing config package's Zod dependency; no dependency or lockfile change.

The first focused Docker run, `tt-test-2d74f868ef6ce299`, passed six of seven workflows but failed to detect added catalog-role connections. The initial ordinary-role query filtered `pg_stat_activity.backend_type`, whose other-session details are restricted. The revised proof explicitly observes masked details without `pg_read_all_stats` membership, then uses aggregate `pg_stat_database.numbackends`. This is a conservative database-backend count, not an exact ordinary-client count. [PostgreSQL's visibility and numbackends contract](https://www.postgresql.org/docs/18/monitoring-stats.html). Cleanup completed despite the failed test; no permissions were expanded to make it pass.

The revised seven-case diagnostic `tt-test-7122cb4a47852714` passed in **69.82 seconds** reported by Vitest; setup through evidence capture took **85.989 seconds**, excluding cleanup. Its real completed cron took 55.509 seconds. It supersedes the failed restricted-visibility query. A final additional regression covers the interrupted final-intent state and bounded automatic attempts.

The final focused working-tree project **`tt-test-7b0452ffd2695c21`** passed **eight of eight**, zero failed/skipped. Vitest reported **29.71 seconds** including hooks; setup/build through evidence capture took **43.748 seconds**, excluding cleanup. Actual cron wait varies with the minute boundary. These are working-tree diagnostics, not final-commit evidence.

| Observation | Final focused result | Scope |
| --- | --- | --- |
| Real maintenance cron | Completed in 18.128 seconds; one expired bucket removed, one unexpired preserved; admission disabled, product route 404 | Actual isolated Inngest/worker/SQL work, not invented run evidence or a hosted schedule SLA |
| Queue/operator drill | 101 owned synthetic callbacks; backlog/lag, stable-repeat suppression, queue/capacity withheld after role revocation, alarm retained, fresh recovery; 223 ms | Technical fixture execution; fifteen-second escalation uses simulated time and acknowledgment is synthetic |
| Physical budget | 69 required, 75 raw, five reserved, 70 usable | 17 host lanes + 28 harness/web + one reader + three pressure clients + reserve 20; hosted sizing unapproved |
| Controlled usage | Eight database backends at baseline, 11 with three added clients; fixture threshold 1,285 basis points; quota rows zero | Restricted aggregate visibility proved; deliberately low local threshold, not production alarm policy |
| Readiness/dependencies | Real CMS NOLOGIN/backend termination produces HTTP 503; restored access recovers; absent recent cron and stale positive receipt refuse; local storage-proxy fault alarms | No postmaster restart, provider shutdown or object/key custody claim in this drill |
| Delivery uncertainty | Lost acknowledgment retried twice with one receiver effect; same event ID after journal-controller close/reopen; exhausted failure visible after three attempts; explicit retry required | Receiver stays alive; no OS crash or durable provider deduplication acceptance |
| Interrupted final intent | Three real lost-ack attempts, then an exact pending-third-intent file state is injected; automatic fourth send refused, explicit retry retains ID, one receiver effect | Controlled file failpoint, not a claimed process/power-loss crash |
| Journal | Private 0600 file/exclusive lock; serialized work, malformed/foreign/oversized/symlink refusal; 128 KiB/32 unresolved/64 delivered bounds; five-minute delivered retention preserves unresolved incident | Same local authority/filesystem; no tamper-proof or independent custody claim |
| Transport refusal | Six actual HTTP rejection/wrong-ack/redirect/oversize/malformed/stall cases in 1,028 ms total; one-second deadline, 2 KiB body cap; recipient field refused before fetch | Loopback receiver only; zero actual recipients |

All generated project containers, volumes/network/environment and guarded temporary directories were removed; project cleanup assertions passed. Private fixture settings, keys, journals and tokens were not exported. Only nonsecret metrics and JSON test results remain in ignored local evidence. Native PostgreSQL and retained dev/stage credentials/data/settings/journals/provider manifests were not targets. Product, report, analytics, advertising and external-mail activation flags stayed false.

## Final committed gate and preservation

Commit the complete revision, require a clean worktree, and run `node scripts/verify/push.mjs`. The ignored stamp binds SHA/tree/lockfile and all proof results. Record measured totals, coverage, SP07 scope and independent final-head CI in the PR body/checks; working-tree measurements above do not substitute for that gate.

The complete gate retains source/format/lint/type/layer/contract/migration/model/S3 checks, combined unit/use-case/database coverage and negative gates; foundation/schema/HTTP/build/lifecycle; original S1 recovery; signed custody/deletion replay; approved-source image/TLS/migration/outage/rollback; SP06 capacity/lifecycle; provider restart/deletion proofs; and adds these eight observation/response workflows with exact result-count and cleanup assertions. All 33 new cases must run. No threshold, existing runtime guard, production schema or migration is weakened.

Documentation/authority audits preserve 119 original cards/dependencies, 137 FR rows, 75 checked/282 unchecked tasks, historical approvals/source archives, 15 pinned readiness digests and all five preceding preflight receipts. Only SP06 local merge/SP07 progress and local evidence references change in the registers. Eight HS decisions and authority/selection/cost fields remain unchanged. Six actual gates retain pending status, empty records and false activation flags; parent P1-PR-027's completion boxes remain open.

Actual hosted retention, destinations, recipient delivery, staffing/acknowledgment/escalation, clock policy, operating thresholds, independent custody and real-host acceptance remain unproved. SP08 local-only evidence handoff/readiness reconciliation is the proposed next step; all holds and no provisioning/purchases/actual-recipient-notifications continue.
