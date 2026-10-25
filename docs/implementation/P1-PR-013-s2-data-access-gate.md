# P1-PR-013 — Full S2 entities and data-access validation gate

**October 25, 2026 · accepted after owner approval and merge at `b3286d023dff392e23099377220a359b3d4337f2`.** Review: [PR #13](https://github.com/xmyqyl4x/tiresandtreads/pull/13). Implementer: Codex. Acceptance owner: repository owner. Baseline: owner-approved [PR #12](https://github.com/xmyqyl4x/tiresandtreads/pull/12), merged at `4a37b95807b0209b29e6f4b03caf46bf5cb0a1ce`. This implements the [013 card](../tasks/phase-1-prs.md#p1-pr-013), E04/ENG-03/ENG-04/ENG-05, following accepted 008–012. The owner accepted S2 and authorized dependent P1-PR-014.

## Gate scope and result

S2 establishes pure entity/value contracts, complete application storage column models, explicit mappers, narrow repository ports, real PostgreSQL implementations and one-client transaction behavior. The [contract audit](P1-PR-013-s2-contract-audit.md) inventories every non-generated package source file and every application/CMS relation. The [validation record](evidence/P1/p1-pr-013-validation.md) ties the conclusions to executable checks. The [forecast](P1-PR-013-s2-forecast.md) revises the remaining P1 effort and dependency path.

| Gate | Review conclusion | Evidence |
| --- | --- | --- |
| Complete storage representation | Drizzle column models cover 123 application tables, 39 views and all 1,574 columns; separate 28-table Payload ownership preserved | Exact regeneration plus every model SQL type, null/default/generated property checked against migrated PostgreSQL |
| Entity/value and DTO separation | UUID kinds, bigint revisions/money, units, timestamps, explicit unknown evidence and readonly entity contracts remain independent of storage/client types | Strict type fixtures, domain/mapping suites and dependency checks |
| Catalog and source contracts | All 25 fact families/247 codec fields match base columns, SQL types/nullability and allowlisted public views; source rights/version/coverage stay explicit | Live metadata checks and complete round trips in catalog suite |
| Private/reliability contracts | Ownership, immutable versions/drafts/compare/quote, permissions, capabilities, delivery and reliability ports remain scoped and transaction-bound | Real-role private, transaction and schema suites |
| Public/operations contracts | Ordered publication/configuration, safe projections, generation-fenced analytics and all-window quotas retain fail-closed boundaries | Operations concurrency/privacy/reporting suite and bounded configuration failure tests |
| Pool/transaction behavior | Admission, statement, execution and cleanup limits are explicit; no caught failure, floating work or uncertain commit can be silently retried | Unit fault injection, actual two-connection pool saturation/recovery, multi-client rollback/revision tests |
| Bounded query evidence | Indexed keyset results are bounded at 101 fetched rows for a 100-item page | Existing 20,000-SKU and 10,000-page workloads plus new 20,000-report/2,000-owner-report workload |
| Whole-foundation validation | Full quality, actual schemas, restore/deletion replay, failure propagation and health/lifecycle checks remain required | Exact-commit verification and independent GitHub CI recorded after completion |
| Delivery readiness | First-use service extensions and external blockers have owning cards; all existing dependency edges remain | Audit boundary register and 30-card forecast |

Passing these checks supplies the technical evidence for owner S2 acceptance. It does not accept a product use case, current-phase API gate, live release or production workload. G0 provider/hosting decisions retain their existing triggers. Four usable live phases, PostgreSQL consolidation, option-C deployment and frontend sequencing remain the approved direction.

## Corrections made during review

The approved plan required Drizzle storage models, while 009–012 had supplied only narrow storage records/metadata, explicit raw-`pg` mappers and repositories. This gate closes that gap with [generated column declarations](../../packages/db/src/models/application.generated.ts). `pnpm db:models` migrates a new disposable PostgreSQL database, reads schema metadata and regenerates the file deterministically. It never exports business rows or connects to native/dev/stage PostgreSQL. Normal CI fails when regenerated output differs from committed source.

The declarations provide inferred select/insert types, bigint-safe integers, exact decimal strings, UTC timestamp `Date` values, string dates, nullable values, JSON, byte buffers and generated-field exclusions. Every generated column is also inspected through Drizzle runtime metadata and compared with PostgreSQL. A real Drizzle query proves bigint/Date decoding; a raw `pg` query proves its different bigint-string representation. Type fixtures reject lossy bigint conversion, unvalidated UUID branding, generated event-day insertion and private reviewer exposure.

These are column models for existing SQL objects. Reviewed SQL continues to own constraints, keys, indexes, functions, triggers, grants and migration history. The models must never be used as a schema-push or migration-generation input. Existing parameterized SQL repositories retain their explicit transaction/locking protocols. The domain/application layer never imports Drizzle, storage models or migration operators. Payload continues to own its separate generated models and migration runner.

The audit also found permissive import-state decoding. Malformed stored counters could raise a raw `BigInt` parsing exception, and checkpoint strings could exceed signed-64-bit range or contain noncanonical leading zeros. The new regression first reproduced that failure. The mapper now validates all counters/fences/checkpoints as canonical nonnegative int64 strings, validates the import-state vocabulary and returns safe integrity failures. `RunState.status` now uses the domain's import-state type. Zero before leasing, exact large counts and normal existing runs remain valid.

Neither correction changes stored schema, migration bytes, runtime grants, credentials, dependency versions or the lockfile. Existing dev/stage databases remain at 14 app/two CMS migrations. Generated declarations have their own complete live-schema validation and are excluded from behavioral coverage; executable-code thresholds are unchanged.

## Boundaries for S3

The audit explicitly distinguishes current repository methods from schema foundations awaiting their owning use case. S2 does not create generic CRUD access for every table. Provider health/artifact/rejection lifecycle, durable command/job coordination, challenge/cookie flows, full erasure, email event/link/feedback handling, staff/commercial mutation and CMS/object propagation require narrow persistence extensions at their assigned service cards. Each extension must precede its orchestration and have real-role tests; services must not issue SQL or borrow migration credentials. [The audit register](P1-PR-013-s2-contract-audit.md#first-use-extension-register) identifies those assignments.

After owner approval, 014 composes runtime credentials, repositories, clocks, jobs and private storage. Independent 020 consent-policy service work is also dependency-ready under the existing DAG; this PR does not start either card. 015–026 implement and validate business behavior; 027 accepts S3; 028–030 expose APIs; 031 accepts the complete P1 API and outstanding G0 evidence before 032 begins frontend work. Later changes discovered through real use follow reviewed schema/contract changes and affected-test reruns.
