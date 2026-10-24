# P1-PR-009 — Typed entities and transaction helpers

**October 24, 2026 · accepted after owner approval and merge at `7ac3ed2051a22703c0b9d72fea55e0dfa292a36f`.** Review: [PR #9](https://github.com/xmyqyl4x/tiresandtreads/pull/9). Implementer: Codex. Acceptance owner: repository owner. The owner approved [PR #8](https://github.com/xmyqyl4x/tiresandtreads/pull/8), merged at `beccd8efe28e6df1eef6fe99fd088787521b8d9a`, accepting the local P1 S1 database gate. This starts S2/E04 under the [009 task card](../tasks/phase-1-prs.md#p1-pr-009).

## Scope and traceability

009 implements the shared type/value, mapping and transaction foundations for repositories in 010–012. It supplies the S2 portions of ENG-04/ENG-05 and representation support for CORE-01/CORE-04/CORE-10/CORE-12: explicit units/costs, provenance and unknown evidence. Transaction proofs support DB01/DB02/DB07/DB08/DB12/DB28 infrastructure; their business protocols and UC01/UC03/UC06/UC08/UC13 remain later repository/service acceptance. No original FR, complete S2 gate or live phase is accepted by these helpers.

No table, applied migration, runtime grant, dependency version or lockfile changes. No product API, provider call or UI is added. Existing option-C hosting, PostgreSQL-only infrastructure, deferred provider/budget decisions and S4-before-UI sequencing remain in force.

## Package and representation contracts

| Boundary | Implemented contract |
| --- | --- |
| `@tt/domain/values` | Pure validated IDs, revisions, instants, money, quantities, tire dimensions and known/unknown evidence |
| `@tt/domain/entities/{catalog,report,consent,import}` | Readonly business records; independent identities, source provenance, state variants and version references |
| `@tt/application/ports/{repositories,transactions,pagination}` | Narrow catalog/report/permission/import/source-fetch contracts, explicit opaque transaction context and bounded page request |
| `@tt/db/mappers` | Selected storage-row decoding for money, tire dimensions and report heads; explicit storage money encoding and snapshot-version guard |
| `@tt/db/transactions` | One-client PostgreSQL unit of work and transaction-scoped query capability for SQL adapters |
| `@tt/contracts/primitives` | Independent version-1 money/evidence/error wire shapes; transport decoding/authorization and endpoint mappings remain S3/S4 |

Root marker modules remain empty: consumers import the relevant subpath rather than a domain-wide barrel. Type-only imports obey layer rules. The engine may import domain value modules, never report/consent/import entities; a deliberate type-import violation now proves that restriction in CI. SQL/ORM types never appear in application ports. The driver-facing adapter uses a small structural interface verified against actual `pg.Pool`/`PoolClient`; connection creation and sizing belong to a server composition root, not an entity constructor.

Domain interfaces are trusted internal contracts, not runtime validators for arbitrary external objects. Constructors validate their declared primitive inputs; API/source/snapshot decoders must validate whole external records before creating these interfaces. Entity behavior and additional row mappers grow with their owning repository/service card. Snapshot payloads and private contacts are deliberately absent from general catalog/report reference types.

## Value and mapping rules

- UUID IDs are canonical lowercase with distinct compile-time kinds; nil/malformed IDs are refused. Revision values use positive signed-64-bit-range `bigint`, decoded from canonical decimal strings. Report version columns remain PostgreSQL positive `integer` values, separate from bigint edit revisions.
- Money uses nonnegative bigint minor units plus a supplied enabled currency registry. External numeric amounts, leading zeros, exponents, fractions, negatives and overflow are rejected. Wire and SQL write representations use decimal strings; no conversion through JavaScript `number`. Signed refunds/ledger amounts require their own later value contract.
- Quantities carry an explicit unit and an exact bigint count of millionths. Version 1 accepts at most six decimal places and nine whole digits, refusing excess precision rather than rounding silently. Mile-to-kilometre conversion is exact or fails with a precision error. Broader source precision must be handled by a reviewed import normalization contract; no source silently loses precision here.
- Known zero and known false differ from unknown with a reason. SQL `NULL` dimensions become `unknown/not_supplied`; missing columns, malformed numeric strings or impossible dimensions are integrity failures. Tire-size validation checks shape/bounds only; it does not establish fitment verification or interpret an arbitrary code.
- Domain instants are validated UTC ISO strings with millisecond precision and real calendar/leap-year checks, without an implicit clock. Storage `Date` values convert explicitly to that form; invalid timestamps fail. PostgreSQL retains higher timestamp precision and owns exact deadline/ordering comparisons. Service time comes from an injected clock, not domain globals.
- Storage mappers read explicit columns and construct allowlisted values. Extra selected fields are discarded; absent/wrong types or unsupported state/schema versions fail without exposing raw row values. Report heads preserve null version only where the accepted database state permits it. Published snapshot version 1 is the only supported decoder version; accepting future versions needs reviewed compatibility behavior.
- Money/evidence wire interfaces fix representation without adding an endpoint. Transport adapters must construct those DTOs explicitly after authorization; neither an ORM row nor a full domain object is a wire response. Error envelopes add safe field errors/request IDs at the transport boundary, never database messages or parameters.

Provenance identifies provider, license, immutable dataset, source record, fetch time and explicit validity evidence. Consent retains purpose **and scope**, event provenance and revision; an absent decision is unknown, never an implicit grant. Report/import/consent state vocabularies follow accepted migrations. Presence of an entity or a claimed source does not authorize disclosure or verify source rights.

## Transaction protocol

`createTransactions(pool)` returns an application `unitOfWork` and an adapter-only `query(tx, sql, parameters)`. Services receive only the unit-of-work and repository ports. SQL adapters receive the query capability; all cooperating writers use the same explicit context. There is no ambient/global client, automatic transaction joining, savepoint API or automatic retry. Nested use cases must reuse their supplied context; starting another unit of work would be a separate transaction and cannot provide aggregate atomicity.

The helper borrows one connection, starts `READ COMMITTED`, applies local SQL limits, runs the awaited callback and commits only a successful typed result. Typed business failure, thrown failure, caught SQL error or concurrent/floating statement prevents a successful commit. Queries with stale/foreign contexts are rejected before reaching SQL. Even if a caller catches a query exception, the scope remains failed. Contexts expire before cleanup and cannot submit later work. Two query methods share a connection only through the same scoped adapter; independent pool queries do not join it.

| Limit | Default | Maximum override |
| --- | --- | --- |
| Pool admission | 1,000 ms | 5,000 ms |
| Transaction execution | 5,000 ms | 30,000 ms |
| Each SQL statement | 2,000 ms | 15,000 ms |
| SQL lock wait | 500 ms | 3,000 ms |
| Idle SQL transaction | 3,000 ms | 10,000 ms |

Limits are positive safe integers. Admission, execution and rollback cleanup are separately bounded, so total request budgeting must include all three. The composition root must also configure a bounded pool, network/query timeouts, TLS, credentials and an idle-pool error handler. The integration fixture uses a two-connection pool with a 500 ms admission setting and a 3,000 ms driver query timeout; these are local proof settings, not launch capacity measurements.

Execution timeout invalidates the context and destroys the connection; PostgreSQL rolls back uncommitted work when the connection closes. Late pool arrivals are destroyed, and callbacks completing after timeout cannot commit. Cleanup releases a clean connection or destroys an uncertain/failed one. JavaScript deadlines bound asynchronous waits, not an infinite CPU loop. Provider/CMS/object operations are forbidden inside the callback by the application contract; runtime SQL adapters are trusted code, not a sandbox for arbitrary SQL. They must never submit their own transaction control, role changes or pool queries.

Definitive server integrity/transaction-rollback errors at `COMMIT` are classified as rejected work. Connection loss, timeout or an unexpected acknowledgement during commit returns **`commit_unknown`**, with `retryable: false`; reconcile the durable operation identity before any retry. Serialization/deadlock and statement/lock timeouts may signal that a new attempt is possible, but the helper performs **zero retries**. The use case must reauthorize and decide whether replay is safe and bounded. Duplicate keys are conflicts without an automatic retry suggestion. Unknown callback exceptions become a safe internal failure; driver failures become safe infrastructure failures. No SQL text, values, credentials or raw driver error is returned.

This follows the one-client transaction requirement in [node-postgres](https://node-postgres.com/features/transactions) and uses PostgreSQL's stable [SQLSTATE codes](https://www.postgresql.org/docs/18/errcodes-appendix.html), rather than localized messages. Actual repositories, durable outbox writes, complete business locking/idempotency and safe retry policy remain 010–027 work.

## Verification and next work

The [validation record](evidence/P1/p1-pr-009-validation.md) records red/green tests, strict type fixtures and real PostgreSQL results. Run `pnpm test` for values/mappers/fault injection, `pnpm verify:data-access` for isolated real transaction tests and `pnpm verify:push` on the clean commit for the complete pipeline. The existing CI command includes the new database cases. Dev/stage need no migration or reset.

Following owner acceptance, 010 implements catalog/ingestion repositories, 011 reports/delivery/privacy repositories and 012 content/operations adapters. Their additional data mappers, grants, representative plans, query counts and authorization/race tests must pass before 013 accepts S2. Product service/API/frontend and chosen-host release gates remain unchanged.
