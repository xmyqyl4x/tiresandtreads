# PostgreSQL consolidation and build order

**Architecture amendment 1.0 · October 22, 2026.** The user requested a database-first implementation sequence and removal of unnecessary ClickHouse/Redis dependencies. This approved amendment changes the implementation target; it does not claim implementation, load-test results or procurement. It supersedes the affected parts of AS02/AS07 and the former overlapping frontend schedule. The original approvals remain recorded against their original commits in the [signoff record](07-stack-and-layer-signoff.md#7-signoff-decisions).

## Decision

Use **Neon PostgreSQL for operational data, first-party analytics, application rate limits, and any measured need for a shared computation cache**. Remove ClickHouse Cloud, Upstash Redis, and Upstash QStash from the planned stack, provisioning, secrets, callbacks, costs, and test-environment requirements. There is no application code or infrastructure to migrate today. The supplied source archive remains historical evidence.

Retain the separate Payload logical PostgreSQL database and its migration ownership, Inngest for durable execution/schedules, S3/KMS for files/encryption, Global Config for public configuration distribution, and the existing hosting, identity, email and monitoring services. PostgreSQL persists work and state; Inngest runs the work. This change does not require creating a general-purpose queue product or storing PDFs in SQL.

| Existing dependency | Planned use | Replacement and assessment |
| --- | --- | --- |
| ClickHouse | Consented events, funnels, cohort and operational dashboards | `analytics` schema in the application PostgreSQL database; indexed raw events and recomputed aggregate tables. No demonstrated launch volume or query pattern requires a separate analytical database. |
| Redis | Short-lived lookup/calculation caches and abuse limits | Indexed catalog reads and existing public CDN caching first; atomic SQL rate-limit buckets; optional bounded `app.computation_cache` only after profiling. Existing owner sessions, permissions, idempotency and reservations already belong in PostgreSQL. |
| QStash | Durable transport into analytics storage | Collector commits accepted events and aggregate invalidation in PostgreSQL. Scheduled Inngest workers consume pending work; event receipt does not depend on dispatching a second vendor message. |

ClickHouse is designed for column-oriented analytical workloads, while Redis provides an in-memory data store. Those are useful capabilities, but neither is an established requirement for this application. Removing them is a project design judgment based on the documented workload, not a claim that PostgreSQL has identical performance at every scale. See the vendors' [ClickHouse overview](https://clickhouse.com/docs/get-started/about/intro) and [Redis data-store guide](https://redis.io/docs/latest/develop/get-started/data-store/).

## Analytics on PostgreSQL

1. The collector validates the registered event schema, signed subject/consent context, current permission revision, body limits and admission limits. Lock the subject guard for the final consent check and receipt transaction so withdrawal/deletion has a defined ordering. Denied collection creates no behavioral event.
2. Persist each permitted event once by event ID and canonical payload digest, with its erasable subject linkage, and mark affected UTC aggregate days dirty in the same transaction. Return `202` only after commit. A retry with the same ID/body does not increase counts; a conflicting body returns a generic conflict. Operational report/send facts remain authoritative for their own totals.
3. A scheduled Inngest worker scans dirty days through a restricted adapter, leases bounded work, and recomputes the allowed daily aggregates. Replace a complete aggregate generation atomically instead of adding counts on each retry. A generation/fencing check prevents older workers overwriting newer output. A separate privacy revision rejects output made invalid by deletion, while ordinary intake during calculation leaves the day pending for another pass rather than starving refresh. No permanent process, database timer, or `LISTEN/NOTIFY` delivery assumption is required; [Inngest schedules](https://www.inngest.com/docs/durable-execution/guides-and-advanced/events-and-triggers/schedules-and-delayed-starts) supply execution.
4. Dashboards query bounded aggregate projections and show the last completed generation, freshness and consent coverage. Exact unique-session metrics are recomputed for the requested period from permitted source rows, or reported only for their defined daily grain; daily unique counts cannot be summed and labeled monthly unique visitors.
5. Withdrawal blocks new collection immediately. Deletion restricts the subject and invalidates every affected day before batched erasure; aggregate queries exclude restricted subjects while purge completes. Privacy-invalidated generations are hidden until rebuilt. Retention, replay markers and restore barriers apply to analytics as well as operational rows. Retaining a table in the same database does not authorize broader use of it.

The [database catalogue](09-database-design.md#8a-analytics-rate-limits-and-optional-cache) defines tables, privileges, cleanup and races. Begin with unpartitioned indexed tables; introduce partitions only from measured volume/retention needs, preserving global event deduplication. PostgreSQL provides [atomic conflict handling](https://www.postgresql.org/docs/current/sql-insert.html), [row locks](https://www.postgresql.org/docs/current/explicit-locking.html), [partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html), and [materialized views](https://www.postgresql.org/docs/current/rules-materializedviews.html). We choose explicit aggregate tables for controlled rebuilding and privacy invalidation; materialized views are an optional read optimization, not an automatic incremental counter.

## Limits and caching

Use short SQL transactions and capped `INSERT ... ON CONFLICT DO UPDATE ... WHERE` counters for fixed UTC rate windows. An hourly bucket allows a boundary burst across adjacent hours; document this in endpoint policy and combine it with a short burst window and the existing challenge/edge controls. These security limits are distinct from the strictly rolling marketing-frequency caps. Check all applicable subject/address/IP windows atomically in deterministic key order, returning `429` with `Retry-After` when exhausted. Return `503` when required abuse control is unavailable; never grant an unbounded fallback. Do not apply interactive challenges to verified provider webhooks or one-click unsubscribe.

Security keys use purpose-specific HMACs and a key version, never raw addresses or IPs. Bound key cardinality, expiry, rows per cleanup batch and concurrent limiter requests; verify platform-level traffic protection before traffic reaches SQL. A database rate limiter is not DDoS protection. Rate counters do not extend consent or marketing authority.

Default cache strategy: public CDN/framework caches for published public content, indexed SQL for versioned catalog reads, and no shared computation cache until profiling shows repeated expensive calculations. If introduced, the SQL cache stores only bounded, non-identifying, deterministic results keyed by all relevant input/data/engine/policy versions. Check expiry on every read; cleanup is storage maintenance, not the validity check. A cache miss/failure uses a bounded source calculation or an explicit overload response. Permissions, recalls' live freshness, tenant checks and private report DTOs are never supplied by a permissive cached decision.

## Capacity, failure and reconsideration

Sharing PostgreSQL reduces service count and cross-store reconciliation, but analytics writes, WAL, indexes, vacuum, cache churn and limiter locks consume the same database resources as reports. Schemas and separate credentials provide ownership boundaries, **not compute isolation**. Separate connection budgets and short query/lock timeouts limit contention; they do not create a second CPU or storage system. Use pooled runtime connections and transaction-local context, consistent with [Neon pooling](https://neon.com/docs/connect/connection-pooling).

At S0 record the expected events/session, peak requests/second, retention volume, row/index sizes, limiter-key growth, pool/compute envelope and cost. Model 10k/100k/1m monthly sessions without asserting that any of them is supported. At S4 and S6 test normal traffic plus 10× measured/forecast peak ingestion, concurrent dashboard queries, limiter contention, purge and worker backlog. Initial project targets are report p95 <2s, dashboard p95 <2s for allowed queries, analytics freshness ≤5 minutes in steady state, and no duplicate effects or permission bypass. These are budgets to prove, not benchmarks already achieved. Record per-query and pool budgets at E02.

On analytics overload, cap/disable optional collection and show missing/stale metrics; do not delay report submission or pretend dropped events were accepted. The collector returns `429`/`503` without durable receipt when capacity or SQL is unavailable. Client retry queues have a bounded lifetime and size and recheck consent; accepted-event loss is an incident. Aggregate-worker failure leaves durable rows for retry. A shared database outage still stops new persistent reports: this architecture isolates optional work logically and with budgets, not from total database failure.

Reconsider a separate analytical store or cache only after indexes, bounded queries, aggregation, retention, concurrency controls and appropriate PostgreSQL sizing are tested. Evidence must show sustained failure of the agreed report/freshness/dashboard budgets or unacceptable cost/lock pressure, with a named workload and alternative benchmark. A read replica or separate PostgreSQL compute is an option to evaluate before another database technology; neither is provisioned by this plan. Any new dependency needs a fresh decision, cost/operations owner and privacy/recovery tests. Redis or ClickHouse is not an automatic R2/R3 requirement.

## Build order and architecture integrity

The [implementation plan](04-implementation-plan.md#build-stages-and-exit-gates) now requires **S0 prerequisites → S1 database → S2 data access/models → S3 domain/business services → S4 exposed APIs → S5 frontends/renderers → S6 integrated release evidence**. All launch backend capabilities pass S4 before product frontend implementation starts. Content research and UX specification can proceed earlier; product UI code, design-system components, staff/partner screens and email/PDF visual templates wait for their stage.

Database-first construction does not mean database-shaped business code. S1 establishes relational integrity; S2 defines pure entity/value interfaces, typed storage records, mappers and narrow repository ports; S3 adds invariant-preserving domain behavior and application orchestration. Domain/application code never imports the ORM. S4 exposes deliberate action/query DTOs through thin authenticated handlers. S5 consumes these tested contracts. Schema or contract changes discovered later follow reviewed migrations, compatibility checks and regression tests; stage gates do not freeze flawed assumptions.

## Change record

| ID | Outcome and affected baseline |
| --- | --- |
| D28 / ENG-07 | User-directed database → data access → business/service → API → frontend sequence; replaces overlapping UI work in the former schedule. |
| D29 / ENG-08 | PostgreSQL replaces Redis and ClickHouse duties; removes QStash transport; updates AS02/AS07 implementation selections while preserving their original approval history. |
| ENG-09 | Require capacity, failure, consent/deletion, limit and cache tests before accepting consolidation; no performance or savings claim without measurements. |

Reviewed prior baseline: [`e4aa24c`](https://github.com/xmyqyl4x/tiresandtreads/commit/e4aa24c38d203182b2c684ad74245e18c54e27f4). Direction supplied by the requesting user on October 22, 2026; detailed design outcome prepared in this amendment. Existing AS01/AS03–AS06, TDD obligations, source requirements and product release gates continue to apply. The approval record below identifies the amendment commit reviewed and authorized for merge.

## Approval record

On **October 22, 2026 (America/Los_Angeles)**, the requesting user approved this amendment and all associated plan, architecture, database, TDD, coding-standard, traceability and contribution updates at reviewed commit [`fc34cb5`](https://github.com/xmyqyl4x/tiresandtreads/commit/fc34cb54ae8ed9c3e3ef63aed9ab822f22ec00bf).

The user's instruction was: “Approve these updates and merge the database-first implementation plan and PostgreSQL consolidation branch into main.” This approves D28/D29, ENG-07–ENG-09, the AS02/AS07 amendments and the documentation merge. Original approvals remain preserved. Application work is unstarted; stage acceptance, capacity tests, specialist/provider evidence and production release gates remain required.
