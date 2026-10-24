# P1-PR-003 — Local foundation and integration proofs

**October 23, 2026 · local S0 accepted by owner approval and merge `ebcf9361a495547f9d9445d89f64131cf0ebef68`.** Review: [PR #3](https://github.com/xmyqyl4x/tiresandtreads/pull/3). Implementation owner: Codex. Acceptance/decision owner: repository owner. Prerequisites: accepted PR #1 and [PR #2](https://github.com/xmyqyl4x/tiresandtreads/pull/2), merged at `dd1817fa826b38e1bc6037be7eba782a869148ab`. This packet binds E01/E02, ENG-06, CORE-10 and CAP-03's outstanding advertising-provider gate. It does not deliver tire data, advertising, authentication or a live product.

## Acceptance boundary

Local S0 establishes whether the pinned Linux/Next.js/PostgreSQL/Payload foundation is suitable for synthetic S1 schemas and S2 repositories. Owner approval and merge accept only the measured local scope below. **Full G0 remains open** under [DD01–DD08](P1-PR-001-launch-baseline.md#deferred-decision-register). P1-PR-004 cannot claim production ownership/migrations merely by copying proof fixtures; it must implement the reviewed schema and repeat role, migration and recovery tests.

The proof is intentionally outside product packages: `tests/fixtures/foundation` and `tests/foundation` contain disposable roles, synthetic tables, CMS collections and injected actors. The normal host exposes no CMS/admin/fixture routes. There is no header-based fixture login in application code. Domain, entities, repositories and product UI remain at their ordered cards.

## Reproducible local proofs

Run `node scripts/verify/local.mjs` with Docker running, from the repository root. The runner builds with the frozen lockfile, then executes quality, unit/use-case, database, foundation and HTTP checks on an internal disposable network. It removes only its randomly named test project. `pnpm verify:push` repeats this on the exact clean commit and records the image/source evidence; GitHub CI independently repeats the command. See [development](../development.md).

| Boundary | Proof and acceptance criterion |
| --- | --- |
| Build and dependency compatibility | Node 24.22.1/Linux, PostgreSQL 18.6, Next 16.4.3, Payload/Next adapter/PostgreSQL adapter 3.92.0 and application Drizzle 0.45.2. Next builds with `withPayload`; builds receive no DB credentials and do not run migrations. |
| Privileged proof target | Test-only environment/project, exact internal hostname/port/database/user, no query-string redirect. Nine guard cases include red → green evidence; native/dev/stage/remote targets are rejected before role creation. |
| Ownership | Real distinct app/CMS migration and runtime login roles. Revoke public connect/schema creation; cross-database connects, runtime DDL, owner-role escalation and CMS migration-ledger mutation must fail with PostgreSQL permission errors. |
| Direct migration | App fixture DDL uses a direct migrator client through Drizzle; a failed transaction leaves no partial table. Payload generates/applies its own fixture migration through its CMS owner, with a no-op repeat. Runtime initialization uses `push: false`, no database creation and no automatic migrations. |
| Bounded pool | Two application connections, 250 ms checkout deadline, 500 ms statement timeout, 150 ms lock timeout and 1 s idle-transaction timeout. Exhaustion and blocked SQL fail; released clients serve a subsequent query. |
| Local workload | 100 parameterized single-row reads at four concurrent callers, maximum two application connections, p95 under 500 ms. This is a bootstrap regression budget, not a report/production capacity claim. |
| Drain and restart | An in-flight database operation completes before pool shutdown; new checkout after shutdown fails. The idle optimized Next container handles SIGTERM with exit 143 within 10 s, then passes HTTP checks after restart. Full HTTP/business-transaction drain remains P1-PR-014/chosen-host evidence. |
| Payload access | Anonymous and viewer operations deny; an explicitly injected test editor can persist/read synthetic CMS content with `overrideAccess: false`. Password login is disabled; asserted identity headers do not authenticate; email adapter refuses delivery. No claim of Clerk/MFA/session verification. |
| Network/configuration | Runtime/migration clients reach only the disposable internal PostgreSQL service. App/container probes reject production+fixture configuration and require absent fixture/admin routes. Updated dev/stage images also pass HTTP checks from Windows on loopback ports 3100/3200. Cross-host TLS/private networking remains external work. |

The [Payload Local API](https://payloadcms.com/docs/local-api/access-control) bypasses permissions by default; future authorized adapters must explicitly enforce access and supply the verified actor. [Payload PostgreSQL options](https://payloadcms.com/docs/database/postgres) distinguish development schema push from [controlled migrations](https://payloadcms.com/docs/database/migrations). The isolated proof exercises these settings rather than treating configuration declarations as evidence.

The compatibility spike found that Payload 3.92 generates migration type names as runtime imports, conflicting with this workspace's strict `verbatimModuleSyntax`. The proof converts only the known generated import header to `import type` and runs the real migration. P1-PR-004 must apply this correction during migration authoring/review, retain the generated SQL and commit its final sources. Do not weaken TypeScript settings or generate production migrations at runtime.

## Connection, workload and resource plan

The initial one-process design budgets **2 application + 3 CMS connections** per process; Payload currently uses its own bundled pg 8.20.0 while application probes use pg 8.23.1. The proof separately measures a real `pg.Pool.end()` drain. Before P1-PR-014 adds workers or replicas, calculate `instances × (app + CMS pools) + worker pools + migration/admin reserve` against the actual server limit. Admission must fail within a deadline; adding PgBouncer requires a measured need and direct migration access, not an automatic dependency.

Current container ceilings remain app 768 MiB / 2 CPUs, PostgreSQL 512 MiB / 1 CPU, proof runner 1536 MiB / 2 CPUs. Record observed memory and shutdown duration in validation evidence. These are local test allocations, not a production hosting quote or availability guarantee.

For P1-PR-024/031 mixed-load design, a **synthetic planning scenario** of 10,000 public views/day × 5 consented events/view means 50,000 events/day; at an assumed 512 bytes/row, raw payload alone is about 25.6 MB/day before indexes, tuples, WAL and backups. This is not observed demand. Vary bursts, retention, report traffic, CMS publication, imports, SQL rate buckets and analytics together. Actual event schemas, query/index plans, CPU/IO/lock budgets and deletion races must pass before workload-consolidation acceptance. The report API target remains p95 <2 s with cached provider inputs; the tiny lookup probe does not meet that requirement on behalf of reports.

## External proof register — full G0 stays open

| Proof | Current evidence/limit | Blocking card or trigger | Accountable owner |
| --- | --- | --- | --- |
| Fitment/catalog/recall sources and pricing | No licensed production rows or fitment coverage. Synthetic fixtures only. Source contracts must specify identity, axle/package constraints, provenance/version, rights, freshness, schema evolution and unknown/refusal behavior. | DD01/DD02 before protected imports and P1-PR-016 adapters; reviewed coverage by 027 | Repository owner + data/tire reviewer, reviewer unassigned |
| Host, registry, region, TLS and reverse proxy | Local Linux build/start/stop only; no remote resources. Need authenticated ingress, body/time limits, certificate checks, private DB access, rotation, image promotion and rollback. | DD03/DD04 before paid/remote provisioning; completed hosted smoke by 031 | Owner + operations reviewer, reviewer unassigned |
| Clerk/Payload identity | Local Payload access and password-bypass denial only. Real issuer/signature/audience, MFA, role removal, session expiry and staff provisioning remain unproven. | DD05 before staff adapter acceptance in 026 and callback/auth APIs in 029/030; complete by 031 | Owner + backend/security reviewer |
| Inngest | No real scheduler/callback/retry proof. Need signing keys, environment separation, concurrency, replay and cancellation behavior. | DD05 before 014/022/030 acceptance | Owner + backend/operations reviewer |
| S3/KMS | No cloud encryption, IAM, signed-URL or deletion evidence. Need actual least-privilege storage/network/region and recovery tests. | DD03/DD05 before 014 assets; privacy/recovery in 025/042 | Owner + operations/privacy reviewer |
| Email | Proof adapter refuses send; no domain reputation/delivery acceptance. Need permitted use, verified sender/domain, allowlist, webhook signatures and uncertain-send reconciliation. | DD05 before 022/030; production acceptance at 043 | Owner + backend/privacy reviewer |
| CMP, AdSense/other ads and affiliate networks | CAP-03 remains open. Need approved providers/terms, signed consent/GPC/withdrawal states, no-fill/denial paths, placement/CLS checks and reporting permissions. | DD05/DD06 at 026/030, UI/placements 039/040, live acceptance 043; headless/provider prerequisites by 031 | Owner + privacy/commercial reviewer |
| Monitoring, recovery and operating ownership | Local resource samples only; no off-host backups/PITR, alerts or on-call ownership. | DD03–DD06 before hosted acceptance; local restore in 008, real recovery/capacity in 042 | Owner + operations reviewer |

Roles identify responsibility; they do not imply specialists have been appointed. Provider mocks/metadata do not close these rows. Revisit decisions when the corresponding card becomes ready, rather than asking for commercial choices prematurely. Full G0 and chosen-host evidence close no later than P1-PR-031, before frontends.

## Next database-first batch and provisional sizing

| Card | Next concrete tasks | Initial engineering effort assumption |
| --- | --- | --- |
| 004 | Implement durable app/CMS migration ownership and restricted runtime roles; identity/assets/code registries; controlled migration runner and real denials | 2–4 engineering days |
| 005 | Domain/source/license/bundle/import schemas; catalog identities and recall uncertainty; synthetic seeds and invariants | 3–5 engineering days |
| 006 | Reports/consent/delivery/reliability schemas; uniqueness/idempotency and state invariants | 3–5 engineering days |
| 007 | CMS/SEO/ads/analytics/quota schemas with explicit ownership and retention | 2–4 engineering days |
| 008 | Empty/upgrade migration, restore/invariant and role evidence; accept S1 before repositories | 2–3 engineering days |

These are provisional technical-effort ranges for one implementer, not promised elapsed dates, staffed capacity or a full P1 forecast. Re-estimate after 004 reveals integration/schema complexity and split large cards under the existing suffix convention when needed. No provider procurement time is included. Product business logic remains 014–027, exposed APIs 028–031, then product frontends 032 onward.

## Decision and evidence status

The [validation record](evidence/P1/p1-pr-003-validation.md) documents passing local integration, lifecycle, workload and quality evidence and the failures resolved during the spike. Local S0 is **accepted following owner approval and merge of PR #3**. Preserve full G0 as open even after local S0 is accepted. The [master ledger](../15-project-task-list.md) is authoritative for merge/acceptance status; checkboxes report completed proof preparation, not an owner sign-off or live product release. The PR binds final source verification and independent CI to its exact revision.
