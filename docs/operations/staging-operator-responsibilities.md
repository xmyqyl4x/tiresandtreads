# Proposed private-staging operator responsibilities — HS05

**October 28, 2026 (Pacific) · Proposal only; no appointments or operational authority.** Prepared under P1-PR-027 following acceptance of the SP08 local handoff in [PR #40](https://github.com/xmyqyl4x/tiresandtreads/pull/40), main `8965bd72f1a7746191511756b7df159ee2450a25`. [Budget and decision detail](../implementation/P1-PR-027-staging-operations-budget.md), [machine-readable planning inputs](../implementation/evidence/P1/p1-pr-027-staging-operations-budget.json). All HS01–HS08 remain proposed. All six actual S3 gates remain pending with empty records, specialist/licensed work pending and APIs/frontends held. No provisioning, purchases, notifications, cloud authentication, account creation or remote deployment.

## Roles and assignment contract

These are responsibilities to staff later. Every actual person, accepted date, coverage window and destination remains **null/unconfirmed**. The repository owner remains the decision maker; this document does not appoint the owner to operate systems. Codex can prepare reviewed code, diagnostics and evidence during an authorized task; it is not a human responder, credential custodian, spending approver or continuous on-call service.

| Role | Responsibility | Assignment evidence required later |
| --- | --- | --- |
| O — Budget/account owner | Account/billing ownership, explicit cost envelopes, access sponsorship, provider/support contracts and scope approval | Named person, billing entity/currency, accepted commercial responsibility and approval record |
| P — Primary platform operator | Inventory, OS/container patches, deployment/rollback, health/schedules/capacity, incident coordination and routine evidence | Named person, practical access/drain/rollback drill and accepted coverage |
| B — Backup platform operator | Independent access, takeover, peer review and restore/incident rehearsal when primary unavailable | A different actual human, independently tested access and accepted backup coverage; no shared login |
| D — Database/recovery owner | App/CMS ownership and migration procedure, usable pool budget, backups, WAL/PITR conditions, quarantine, restore/replay and reconciliation | Named qualified person, provider administration compatibility and witnessed recovery evidence |
| K — Security/key custodian | MFA/recovery identities, scoped secrets, retained key versions, independent journal custody, access reviews and revocation | Named person, verified independent recovery path, custody and rotation/revocation record |
| V — Privacy/policy reviewer | Applicable notices, deadlines, retention/deletion/holds, evidence minimization and authorization for destructive privacy work | Actual reviewer and scoped policy decision under the existing G2 gate; currently pending |
| R — Release/evidence reviewer | Review immutable images/config/migrations, permitted actions, cost/capacity/rollback plan and acceptance evidence | Named reviewer with recorded scope/date; technical review does not approve spending, policy or source rights |

One qualified human may hold multiple roles. P and B must be different humans. The person executing a sensitive access/key change, restore promotion or destructive action must have a separate human review of that exact scope; combining job titles does not create independent review. A two-operator commercial-access example is a cost assumption, not proof every reviewer fits two seats. Add seats or a separately reviewed access path when required. Each responsibility must have an accepted owner and backup mapping before hosted acceptance; a managed database does not supply this project staffing.

## Responsibility matrix

Each row has one accountable role (A); responsible roles (R) perform authorized work and produce the listed evidence. Other consulted roles do not inherit approval authority. The same operation cannot be billed twice merely because one person holds two roles.

| Activity | A | R | Review / evidence |
| --- | --- | --- | --- |
| Billing inventory and monthly forecast | O | P | B checks resources/subscriptions, invoice allocation and unknown amounts |
| Account ownership, MFA and break-glass custody | O | K | B verifies independent recovery; approvals scoped to identity/access |
| Private ingress, TLS, firewall/trusted sources and operator access | P | P, K | B/R checks denied paths, certificate rotation and least privilege |
| App OS/container patches, immutable release and image rollback | P | P | R/B reviews source/digests, migration compatibility, drain and rollback |
| PostgreSQL version/roles/ACLs, app/CMS separation and pool maxima | D | D | R/B reviews restricted administration, complete physical capacity and refusals |
| Backup completion, storage/key/journal continuity | D | D, K | B checks independence, inventory, retained keys and recovery eligibility |
| Isolated restore, quarantine and signed-journal replay | D | D, P | K/V review applicable custody/policy; B witnesses; no promotion without exact review |
| Workflow registrations, cron freshness, leases and uncertainty | P | P, D | R checks schedule/concurrency and unknown-effect reconciliation; no blind replay |
| Masked observation, delivery failure and incident coordination | P | P, B | Distinguish destination receipt, human acknowledgment and fresh recovery evidence |
| Secret rotation and operator offboarding | K | K | Independent B/R review; preserve required key/journal continuity before revocation |
| Retention, holds and destructive privacy requests | V | D, K | Policy acceptance plus exact owner-authorized fulfillment; remains held now |
| Temporary resource retirement and residual billing | O | P, D | K/V review custody/retention; B reconciles disks/backups/keys/addresses after teardown |
| Service-host acceptance recommendation | O | P, D, R | Actual scoped gate review remains separate from this role plan |

## Proposed coverage and response

Before any operational commitment, record an IANA time zone, days/hours, holidays, primary/backup handover, real contact methods, access approver and independently tested alert destination. None is configured or contacted here. This is a private synthetic staging proposal; no 24×7 coverage or production availability commitment is staffed or priced.

Candidate response-drill targets **inside a later accepted staffed window** are acknowledgment within 30 minutes, backup escalation at 30 minutes without acknowledgment and owner escalation at 60 minutes. These are planning targets, not demonstrated delivery or human response. The primary/backup must agree to coverage and a drill must measure actual detection/delivery/acknowledgment/response before acceptance. Alerts may not be enabled or sent under this request.

The existing recovery targets (RTO ≤4 hours, RPO ≤24 hours; a ≤15-minute claim only after accepted PITR evidence) remain unchanged. A business-hours-only arrangement cannot promise a four-hour event-to-recovery result outside its staffed window. Resolve that coverage/cost gap, or obtain a separate explicit staging-scope decision, before acceptance. Do not reset the clock at acknowledgment or silently weaken recovery targets. Production availability remains a separate release obligation.

| Cadence | Proposed operator work and output |
| --- | --- |
| Each staffed test window | Check private readiness, real completed cron age, queues/leases, usable DB capacity, disk/headroom, current backup/journal/key status and forecast; record masked status |
| Before every release or replay | Review exact image/config/migration scope, role/capacity budget, known external effects, maintenance lock, rollback and resource allowance |
| Weekly | Review failed/uncertain work without automatic replay, patch advisories, access changes, retained image/backup sizes and subscription usage |
| Monthly | One witnessed isolated restore and backup takeover rehearsal, key/access and cost reconciliation, runbook update; reassess actual hours and service tiers |
| On material change | Re-review HS01–HS08 dependencies, rights/policy/provider gates, new replicas/connections, resource quantities and spending assumptions |

Routine staffing allowance is **12 combined person-hours/month** for managed-DB staging; activity allocation is in the budget model. Self-operated DB staging adds an estimated six hours/month. Initial setup is estimated at 28 combined person-hours managed or 36 self-operated. These are estimates, not staffing commitments or delivery promises. They exclude incidents beyond routine work, continuous standby, policy/specialist review and provider-support retainers. Record actual effort and replace assumptions after each accepted trial. Included contract hours must be credited before adding hourly charges.

## Incident and handover procedure for later review

1. Record the affected environment, source/image/config identities, canonical time, masked symptoms and known/unknown effects. Preserve evidence; never copy credentials, raw reports or private journals into Git or an incident notification.
2. A later authorized operator may contain an affected lane according to its reviewed runbook. Permission loss, stale observations, missing keys/journal or unconfirmed provider effects remain unresolved; an acknowledgment is not recovery. No destructive repair, real send, source publication or policy acceptance is inferred.
3. Coordinate P/B/D/K as appropriate. Use a separately reviewed scoped rollback or isolated restore with runtime quarantine and current signed-journal/deletion replay. Do not replay unknown mail or deletion effects, truncate queues or delete evidence to clear an alarm.
4. Resolve only with fresh end-to-end evidence, residual-risk review and the required human disposition. Reconcile spend and retained resources; document actual detection-to-recovery timing and missed coverage.

Handover must include actual assignments/accepted availability, independent MFA access, approved resource inventory and billing ledger, private runbook/key references, immutable release/rollback identities, backup/restore/journal evidence, unresolved incidents, supplier escalation paths and review dates. Access revocation must leave a tested accepted custodian. Until those records exist, HS05 remains proposed and no staffed-service acceptance is claimed.

## Lifecycle responsibility supplement

The [October 29 bootstrap/provisioning lifecycle contract review](../implementation/P1-PR-027-bootstrap-lifecycle-contract.md#authorities-and-credential-boundaries) maps these same unassigned O/P/B/D/K/V/R slots to provisioning, read-only validation, owner migrations, runtime admission, rotation and quarantined recovery. It proposes no new actual appointment, coverage, rate, spending or operational authority; all existing independent-review, custody and S3 conditions remain unchanged. No provisioning, purchases or notifications.
