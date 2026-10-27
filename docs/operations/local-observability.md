# Local observability and response runbook

[Contract and limits](../implementation/P1-PR-027-local-observability.md). This is trusted local operator tooling. It does not expose a metrics/admin API or accept hosted staffing, source or policy gates.

## Observe and rehearse

```sh
pnpm local:host observe dev <authorized-staff-uuid>
pnpm local:host observe stage <authorized-staff-uuid> 12
pnpm local:host prove-observability dev
pnpm local:host prove-observability stage
```

Use Node 24/pinned pnpm and Linux Docker from PowerShell, WSL or Linux. Existing host environments must be prepared and healthy; migrations and role credentials are managed through the separate database workflow. Build updated tooling through the existing database build workflow when source changes; an observation does not rebuild, bootstrap, reseed or start a stopped dependency. Providers remain private, and the fixture provider must already have its deliberately selected custody. [Retained setup](local-service-host.md#retained-devstage-workflow).

Normal observation requires a real existing active operations-read actor supplied explicitly; the disabled synthetic seed is refused. No actor is created by `observe`. Use the explicit synthetic drill on current seeded targets. It temporarily grants only its own test identity `operations_read`, then revokes/restores/removes that own grant during the proof. It never changes the seeded disabled staff record. The drill injects and later withdraws only its own artificial callbacks; it does not prove successful mail processing.

Interpret `healthy`, `fresh`, `queues`, `activeAlerts` and `events`. Counts are capped as indicated. A nonzero exit is expected for alarms/access loss; inspect masked output first. No queue detail is emitted for a denied/failed snapshot, and earlier alarms stay active. Subsequent unchanged samples suppress duplicate alert events. At most 12 polls run; no background daemon or external notification is installed. A fresh invocation re-emits outstanding alerts. Keep any redirected JSONL in an ignored protected local path with an explicit retention policy.

Only one supplied observer/drill may run per target. A regular observer consumes one of two existing operator connections; the drill consumes both. Stop extra operators during the drill. If `.local/observer-dev.lock` or its stage equivalent remains after interruption, first verify the corresponding command/container has ended, then remove only that target's stale lock. Do not delete credentials, host settings, journals, volumes or provider checkpoints.

## Respond without hiding uncertainty

| Signal | Inspect and respond | Evidence required to resolve |
| --- | --- | --- |
| `telemetry` unavailable/denied | Check selected environment, current actor/role, database connectivity and credentials privately. Do not copy raw errors or secrets into a ticket. Restore only an independently authorized role; do not enable the seeded identity | Fresh authorized SQL snapshot; unavailable telemetry alone never resolves queue alarms |
| `host_readiness` | Inspect masked host/Docker status and application/CMS availability. Preserve credentials and data. The isolated proof disables only its fixture CMS login, terminates that lane, then restores it; do not run that fault injection on another database | Actual readiness 200 and observer recovery after connectivity is restored |
| `storage_fixture` | Inspect its health and retained canary/checkpoint custody. Follow the [provider recovery runbook](local-service-host.md#provider-cold-restart-and-replay). A healthy process alone cannot establish key/version custody | Existing exact-canary verifier/startup and a fresh dependency observation; no regeneration to hide loss |
| `workflow_freshness` | Inspect local engine health, registration and completed maintenance history for the selected environment. New startup can alarm until the first cron; allow the normal one-minute cycle, then investigate if there is no completed run within the 180-second window | Fresh exact-environment completed cron plus current host readiness; replay only after inspecting side effects |
| Queue backlog/lag/capacity | Use authorized bounded aggregate inspection and the relevant service's existing runbook. Reduce or stop the affected producer while diagnosis continues. Distinguish capped counts, leased/in-progress work and expired rows | Fresh measurements below thresholds after an explicit approved response; never truncate real queues or enlarge capacity to hide an alarm |
| Privacy overdue, uncertain mail, unknown recovery | Preserve holds/journal/effect ledgers and escalate for the recorded policy/provider review. Reconcile an unknown external effect before retrying. Leave pending external lanes disabled | Applicable human/provider evidence and a fresh operational sample; synthetic cleanup is not an acknowledgement of a real external effect |

For each drill/incident record the environment, masked signal, detect time, chosen response, responder, recovery sample and outstanding uncertainty. Local automated drill timings measure technical execution only; they are not an actual staffed acknowledgement/escalation/response SLA. Actual on-call ownership, destinations, alert delivery/retention, hosted secret/provider custody and S3 acceptance remain pending.
