# Phase 1 local security, capacity and recovery handover

This is an executable local rehearsal packet and a pending production handover. It appoints nobody and authorizes no hosting, external activation, spending or notifications. Primary/backup operators, coverage, rates, production budgets and all HS01–HS08 decisions remain unconfirmed/proposed. All six S3 gates remain pending. Local APIs/frontends are permitted; production remains held.

## Reproduce and preserve evidence

Use the pinned Node/pnpm Linux Docker tooling from PowerShell, WSL or Linux. On a clean committed branch run `pnpm verify:push`; the existing pre-push hook binds the successful receipt to the exact source tree and lockfile. The full regression includes mixed product/security/cache proofs plus the existing capacity, deployment, observation, backup/restore, signed deletion replay, provider recovery and lifecycle suites. Do not run overlapping full regressions against the same resources. Disposable tests own randomly named projects and fixed synthetic targets; confirm that owned cleanup completes. Do not stop, prune, reset or bootstrap retained dev/stage or unrelated projects to fix a test.

Read `LOCAL_PRODUCT_MIXED_LOAD` for actual local operation counts, concurrency, elapsed time, request p95/p99 and a process RSS sample. The workload joins report writes, consented collection, registered script-first imports, SQL quotas and denied-ad configuration reads. Public commercial/provider acceptance is not implied. The sample is a bounded regression, not a production traffic forecast or sustained-load benchmark; RSS is a point sample, not a high-watermark. Root suite, capacity fixture and proxy/container metrics have different scopes and cannot be added into a host sizing claim.

Read `LOCAL_CACHE_PROCESS_EVIDENCE` for two actual child PIDs with separate one-connection public-reader pools and a real SQL/S3 redirect publication. Each session verifies transaction read-only state and the existing fixture identity. Both warmed caches retain revision 1 during the allowed cache interval and observe removal revision 2 after the existing 30-second TTL. No in-process invalidate call or synthetic clock drives the observation. This is bounded-age convergence, not instant push invalidation, CDN invalidation or production replica acceptance. A production rollout must account for all cache layers and accepted expiry/kill-switch deadlines.

Store raw local logs and runtime credentials only in ignored protected locations. Publish only masked counts, source/image/lock hashes, measured scope, allowed actions, limitations and CI links. Never copy cookies, bearer or email tokens, recipients, report inputs, private download links, environment dumps, SQL passwords, keys or provider errors into tickets. Current HTTP observations contain only operation/method/status. A passing token-leak regression is not an external penetration-test certification.

## Response and recovery sequence

| Trigger | Local action and evidence | Production requirement still pending |
| --- | --- | --- |
| Unauthorized/cross-owner access or unexpected token in output | Stop the affected journey, preserve masked route/status evidence; run permission, CSRF, staff and callback regression. Do not broaden roles or weaken CSP to make it pass | Accepted incident/security owner, independent access review and scoped security testing |
| Report/source coverage unavailable | Retain unavailable/no-pick/technical-only result. Check current source status without replacing unknown data or issuing advice | Licensed contracts, real fitment/prices and specialist approval |
| Quota/backpressure or sustained latency | Inspect bounded SQL/pool/queue metrics; throttle or stop the responsible producer. Quota cleanup and retry must preserve idempotency; never increase a limit merely to hide an alarm | Agreed workload, p95/p99/LCP/CLS definitions, usable connection budget, tested replica count and resource/cost ceiling |
| Readiness loss | Stop new admissions, let admitted work drain, preserve uncertain effects; inspect role/dependency health and recover through the existing local workflow | Hosted TLS/DB owner compatibility, actual dependency/secret custody and routing/drain integration |
| Bad image/config release | Select the recorded immutable prior image/config; follow the existing deployment preflight and readiness/drain proof. Do not run database-down migrations or erase persistent state; require forward/backward schema compatibility | Accepted production deployer, proxy/platform configuration, compatible image/migration manifest and witnessed rollback |
| Redirect/removal not yet visible | Respect the documented cache interval; observe both replicas after expiry and confirm authoritative revision/object parity. A stale/failed refresh must not be treated as fresh permission | Actual CDN/browser/server cache inventory, defined revocation deadlines and production measurements |
| Privacy due date approaching/overdue | Use the existing masked observer; preserve request/journal/holds and show uncertainty until reconciled. Follow authorized deletion replay and quarantine flow, including restore reapplication before opening access | Applicable jurisdiction/policy reviewer, owner/backup, escalation destinations and actual deadline coverage |
| Backup, provider/key custody or restore mismatch | Quarantine access; retain the last good manifest, exact object versions and independent journal. Run bounded restore/replay evidence; never regenerate missing key/journal state or count a process restart as data recovery | Accepted off-host backup/journal custody, RPO/RTO/PITR targets, restoration destination and witnessed promotion decision |
| Mail uncertainty or unexpected commercial serving | Keep actual providers disabled; preserve send/effect identity. Use existing audited recovery and current commercial configuration/kill-switch paths; never blindly resend or infer consent from a report request | Actual sender/CMP/provider contracts, verified identities, inbox rendering, effect reconciliation and policy acceptance |
| Alert delivery/telemetry failure | Preserve outstanding alarms; use the local observer/runbook. Local receiver acknowledgment and simulated operator acknowledgment are separate | Named staffed primary/backup, coverage, actual alert delivery/acknowledgment, retention and escalation evidence |

The tested local resource budgets remain those in the existing SP05/SP06/SP07 proofs. The preview proxy has its own 128 MiB/0.25 CPU cap; tooling, database and provider caps are separate. Existing usable-connection admission explicitly refuses overbooking. These observations do not approve the proposed hosted topology or a second full host replica. The cache peers consume two already reserved public-reader fixture slots, not another full service host.

## Production handover inputs required before release

1. Named, separately accepted primary/backup, coverage, custody and escalation responsibilities under [HS05](staging-operator-responsibilities.md).
2. Complete app/database/backups/object storage/journal/monitoring/domain/staging/egress/provider costs, contingency and operator hours/rates. Use the existing HS04 scenario worksheet; unknown rates stay unknown and no paid resource is approved by this packet.
3. Approved workload/concurrency/replica model, resource and SQL connection maxima, cost cutoff, performance targets and test environment. Ad/CMP payloads count toward page budgets.
4. Versioned secrets and independent recovery identities with MFA, current/retired key inventory, rotation/revocation drill and least-privilege owner evidence. Fixture credentials do not qualify.
5. Immutable image/config/migration inventory, preflight checks, readiness/drain and rollback decision owner; actual platform/proxy compatibility remains pending.
6. Measured RPO/RTO/PITR/restore/deletion replay evidence and custody for the actual chosen topology; opening access after restore is an explicit reviewed action.
7. Approved notices/retention/privacy deadlines, support intake and escalation; minimize sensitive evidence and distinguish uncertain effects from failure.
8. Specialist/licensed/provider/editorial/inbox/accessibility/CMP and all S3/G2/G3/G4/G5 sign-offs needed for actual production scope.

No item above is accepted automatically by a PR merge. Before P1-PR-043, reconcile current evidence and obtain actual inputs; do not substitute more synthetic tests for a missing human, contract, provider or deployment decision.
