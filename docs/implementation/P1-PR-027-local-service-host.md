# P1-PR-027 continuation — local service host and connection budget

**October 26, 2026 · Local technical implementation approved and merged as [PR #28](https://github.com/xmyqyl4x/tiresandtreads/pull/28), `7c86af95`; full S3 acceptance stays open.** The owner approved [PR #27](https://github.com/xmyqyl4x/tiresandtreads/pull/27), merged at `026a14c707c567ccbeffaabca8ff74f5aaf59b59`, and authorized this continuation while keeping APIs on hold. Specialist review and licensed adapters remain pending. This work adds no migration, database role, dependency or product endpoint.

## One composition root, explicit ownership

`createLocalServiceHost` loads an explicit private settings file, validates local fixture configuration, checks a complete connection plan, and constructs the existing report/contact/delivery/privacy/callback/action, analytics/limiter/operations, CMS/content, ingestion/source, staff/commercial and maintenance factories. Report services retain their deterministic engine/comparison mathematics and actual catalog-backed evidence resolver. Missing accepted source coverage still refuses report creation. No fake catalog resolver or pricing provider replaces that gate.

The root owns 17 bounded pools. Factories receive their existing scoped transaction adapters; the durable runtime and import factories reuse those scopes rather than silently allocating another private, asset, ingest or publication pool. Legacy CLI constructors retain their own ownership and checks. When run alongside the new host, their maxima must appear as explicit external allocations; they are not counted twice as owned pools.

| Lanes | Role | Database |
| --- | --- | --- |
| report; worker | `tt_private_runtime`, separate pools | Application |
| asset; catalog; report_source | `tt_asset_runtime`; `tt_catalog_runtime`; `tt_report_source_runtime` | Application |
| ingest; publish | `tt_ingest_runtime`; `tt_publish_runtime` | Application |
| content; public | `tt_content_runtime`; `tt_public_runtime` | Application |
| privacy | `tt_privacy_runtime` | Application |
| collector; aggregate | `tt_analytics_runtime`, separate pools | Application |
| limiter; operations | `tt_limiter_runtime`; `tt_operations_runtime` | Application |
| staff; commercial | `tt_staff_service_runtime`; `tt_commercial_runtime` | Application |
| cms | `tt_cms_runtime` | Separate CMS database |

The local root deliberately supports one direct PostgreSQL server with distinct application/CMS databases. All application DSNs must identify the same database; every DSN must have its exact role and local endpoint, without URL query overrides. The CMS database must differ. Default port and explicit 5432 normalize consistently. Separate server topologies and pooler capacity are later deployment decisions rather than inferred aliases.

## Cluster budget and lifecycle

PostgreSQL `max_connections` is shared across databases in the same server. The plan computes each database's replica-scaled owned maxima plus named external pool allocations, then adds one cluster reserve. It compares the combined total with actual server capacity. Missing/extra lanes, duplicate external names, invalid bounds and overbooking refuse startup. One report connection discovers capacity before the remaining lanes connect. Every lane then checks its actual role, database and capacity. Errors close all partially initialized pools and redact configuration details.

The fixture declares every harness maximum, including CMS administration, rather than counting only currently active sockets: 16 application pools plus one CMS pool, 28 external slots and a reserve of 20 require **65 of 97 usable** cluster connections (100 raw minus three superuser-reserved). SP06 strengthens admission to subtract both server reservation settings; raw metadata remains available alongside usable capacity. A separate pure two-replica example requires 58. These are local engineering fixtures, not a production capacity recommendation or a measurement of launch traffic. Declared replica/external maxima must match actual deployment processes; the root cannot discover the maximum size of an undeclared process's idle pool.

Service calls are admitted through a lifetime guard. Shutdown refuses new service and workflow work, waits up to five seconds for admitted calls, quiesces the durable runner, drains every owned application/CMS pool with existing bounded deadlines, and destroys owned SDK clients. Repeated shutdown is idempotent. SQL transaction/statement/lock/admission bounds remain. Long external effects and hosted cancellation/recovery still require actual provider proofs.

Readiness checks both application operations and CMS connectivity through their existing pools; concurrent probes share one in-flight check. Losing the CMS lane changes readiness to 503 and restoring it recovers without restarting. The listener exposes only health and the existing internal local workflow callback. Product routes remain 404.

## Scheduling, secrets and inactive providers

The existing optional one-minute maintenance function calls the actual composed maintenance services. Actions default disabled; a cycle contains at most four allowed actions. Local configuration may enable callbacks, publication, privacy, analytics maintenance, quota cleanup, retention or assets. Source fetching, delivery and verification sends cannot be enabled by this settings schema. Retention/object cleanup remains dry-run. SQL-only durable jobs still require explicitly registered SQL handlers; this root does not invent arbitrary product jobs or put network effects inside a SQL transaction.

S3/KMS clients use the existing local emulator endpoints and explicit fixture credentials. Public snapshots and private encrypted objects remain separate. Mail send/retrieval, privacy-provider erasure, crawl/search and source pulls return unavailable/unsupported or remain disabled; they never fabricate a successful provider acknowledgment. Analytics collection and external advertising are fixed off. There is no provider purchase, hosted activation, production report issuance or specialist acceptance.

Key rings and stable identity keys come from a bounded, absolute, regular private JSON file, never from a committed sample. Linux rejects group/world-readable files; Windows relies on the operator's filesystem ACL. Unknown settings, malformed keys, unsupported activation and invalid references refuse startup. There is no automatic generation/rotation on restart. Existing suppression/privacy/quota coverage checks remain, and journal verification rejects incompatible key bytes even when a version label is reused.

The signed file journal lives at an explicit absolute directory on independent durable encrypted storage; it is verified before readiness. The existing file-journal snapshot supports at most 1,000 records and a bounded signed manifest; paged storage is required before those limits are reached. Local filesystem proofs do not establish encrypted-volume custody, an independent disaster-recovery system or a production retention policy. See the [runbook](../operations/local-service-host.md), [settings shape](../operations/local-service-host.settings.example.json) and [validation](evidence/P1/p1-pr-027-host-validation.md).

## Acceptance boundary

The service register records this local evidence separately from accepted evidence. The `S3-service-host` row stays pending for selected-provider/hosted wiring, actual secret custody, physical topology/budget and schedule/monitor/response proofs. All six existing S3 evidence gates remain open. Original P1-PR-027 completion boxes remain unchecked; P1-PR-028–030 and product APIs stay on hold. No S4/S5/S6 approval or usable live phase is claimed.

The subsequent [retained dev/stage and real workflow continuation](P1-PR-027-persistent-local-workflows.md) supplies a repeatable operator without changing these acceptance boundaries.
