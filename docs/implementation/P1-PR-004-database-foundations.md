# P1-PR-004 — Database ownership, identity and asset foundations

**October 23, 2026 · in progress; owner acceptance pending.** Implementer: Codex. Acceptance owner: repository owner. Prerequisite [PR #3](https://github.com/xmyqyl4x/tiresandtreads/pull/3) was owner-approved and merged at `ebcf9361a495547f9d9445d89f64131cf0ebef68`, accepting local S0. Full G0 and the recorded commercial/host/provider decisions remain open.

## Scope and construction order

This is P1/S1/E04, tracing ENG-03 and the foundation portions of DB12/DB15. It creates SQL persistence foundations; it does not implement authentication, report-owner authorization, signed download grants, tenant RLS, storage delivery or a public product. DB12's compound report/tenant boundaries and DB15's current-authority checks remain obligations of their later schemas/services/APIs. UC05/UC11/UC12 are not accepted by this card.

Application migrations are reviewed PostgreSQL SQL under [infra/database/app](../../infra/database/app/0001_registries.sql). SQL is the schema authority for the database-first sequence; Drizzle storage records, pure entities, repository ports and mappings follow in S2 (009–013). [Drizzle supports this database-first approach](https://orm.drizzle.team/docs/migrations). Operational scripts live outside application packages, and executable import-boundary checks prevent application code from importing them. Product packages and health contracts retain their current boundaries.

## Committed schema

| Migration | Objects and constraints |
| --- | --- |
| App `0001_registries` | `app`, `admin`, `privacy`, `email`, `analytics` schemas; code sets/values, countries, currencies, locales, markets, market locales and units. Named keys/checks, registered foreign keys and leading FK indexes. Static US/USD/en-US and unit/purpose vocabulary; the market remains disabled until its later activation. No tire/provider facts are seeded. |
| App `0002_identity_assets` | `app.subjects`, `app.owner_sessions`, `app.object_assets`; `admin.staff_identities`, `admin.roles`, `admin.staff_role_assignments`. Named uniqueness/check/FK constraints, digest key versions, positive revisions, UTC timestamps, ordered lifetimes, restricted deletion and FK/retention indexes. |
| CMS `0001_staff` | Payload-generated staff-link and internal KV/lock/preference/migration tables in the separate CMS database. UUID IDs, unique logical application-staff link, no cross-database FK, explicit runtime grants and no password login. All CMS collection access remains denied until a verified identity adapter is implemented. |

`owner_sessions.token_hash` holds a 32-byte digest plus its key version, never a raw browser secret. The initial digest storage contract supports SHA-256/HMAC-SHA-256-sized results; actual minting, rotation, revocation and ownership checks belong to later services. Permission/revision counters have database positivity checks; use cases must increment them with their authorized changes. The database does not invent authentication from a subject or staff row.

Asset metadata accepts registered purposes and opaque `assets/<UUID>` object keys; no URL or filesystem path grants access. A `ready` record requires checksum and nonnegative byte size. `deleted` requires its timestamp. These checks reject malformed states; future asset services must validate bytes/MIME, enforce current authority, manage permitted state transitions and delete actual object versions. Bucket names/metadata do not prove that S3/KMS has been provisioned. Optional storage/key versions remain explicit.

Code registries are reviewed operational vocabulary, separate from the versioned source-backed `reference_code_values` due in 005. FK existence does not mean an enabled code/market or a permitted purpose; services must enforce current policy. US is a market, not a universal timezone. Future scheduling records carry their own reviewed IANA timezone.

## Ownership and runtime grants

| Role | Current authority |
| --- | --- |
| `tt_app_migrator` | Owns only the application database, its schemas/migrations and controlled seed operations; never supplied to the web runtime |
| `tt_cms_migrator` | Owns only the CMS database and Payload migrations |
| `tt_app_runtime` | Reads registry vocabulary; SELECT/INSERT/UPDATE subjects and owner sessions |
| `tt_asset_runtime` | Reads registry vocabulary; SELECT/INSERT/UPDATE asset metadata; cannot read owner sessions |
| `tt_staff_runtime` | Reads registry vocabulary and staff identities/roles/assignments; cannot provision identities or grant roles |
| `tt_cms_runtime` | Reads CMS staff links; scoped DML on Payload internal KV/lock/preferences and their sequences; no access to either migration ledger |

All six are non-superuser login roles without role/database creation, replication, inherited membership or RLS bypass. PUBLIC database connect/temp and schema creation are revoked; cross-app/CMS connects fail. Future tables receive no automatic runtime grants, and newly created functions have PUBLIC execution revoked. This follows PostgreSQL's [ownership rules](https://www.postgresql.org/docs/18/ddl-priv.html) and [default privilege model](https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html). Future migrations must review grants explicitly, especially privacy, email and analytics; broad `GRANT ALL` is not an acceptable shortcut.

Payload emits unqualified DDL, so the migrator's search path begins with its exclusively owned `public` schema. Runtime search paths begin with `pg_catalog`; runtimes cannot create in either schema. Direct database ownership is verified before a migration can run. Scoped service authorization and narrow worker grants follow with their services; these SQL roles do not replace object-level checks.

## Migration execution and recovery

The runner checks committed source SHA-256 values, unique sorted migration IDs, contiguous ledger positions and an exact applied-history prefix before running any pending migration. Unknown or changed applied history fails closed. One dedicated connection holds a per-database advisory lock; a concurrent executor fails immediately. Connection, statement, lock and idle-transaction timeouts are bounded. Application DDL and its history entry commit in one transaction per migration. A failed migration rolls back its DDL/history, while earlier successful versions remain applied.

Payload uses its native migration runner and transaction client. The wrapper writes its checksum row through that same transaction as the generated DDL and native ledger. Both histories must agree before replay. Schema push and automatic runtime migrations are disabled. Runtime initialization uses restricted credentials. Generated type imports are corrected to `import type`; the generated snapshot is retained, with reviewed UUID-link/grant additions in the TypeScript migration. [Payload migration documentation](https://payloadcms.com/docs/database/migrations) describes the native runner.

Deployment commands apply committed sources only; no migration generation occurs at application startup. Keep SQL migrations free of transaction-control statements and operations such as concurrent index creation that cannot run in a transaction. Such future changes require a reviewed separate execution/recovery design. Migration history is append-only under normal operation; never edit a deployed source or regenerate its checksum to bypass a mismatch. Correct an unapplied migration before release, or ship an additive correction after application. The checksum gate catches accidentally reformatted migration source too.

The current role-level ceilings are 15 s statement time, 3 s lock wait and 10 s idle transaction; operator connection establishment is bounded at 3 s. These protect provisioning/migration tools. Later application pools must apply their narrower request budgets and the accepted connection-count plan; this card does not raise the report API latency target or replace P1-PR-003's measured pool limits.

Rollback means a compatible application rollback or reviewed forward database correction. Do not run generated destructive `down` operations against retained data; this CMS migration's down function explicitly refuses. Before future breaking changes: expand schema, deploy compatible readers/writers, perform resumable backfill, verify, then contract in a later release. Empty/populated-prior-schema upgrade and failed-transaction recovery are covered here. Backup/restore, deletion replay and full S1 acceptance remain 008; chosen-host recovery remains 042. No reversible data-loss claim is made.

## Local operation and credential lifecycle

See [database commands](../development.md#database-ownership-and-migrations). The local operator wrapper accepts only named dev/stage Compose targets; it generates six role passwords and a CMS secret into ignored `.local/db-<target>.env`. A separate short-lived ignored admin env file is supplied only for bootstrap and removed in `finally`. Existing local cluster credentials are reused; native PostgreSQL is untouched. Each dev/stage cluster has its own password set and volume. Preserve these files with their cluster; lost files require explicit operator credential recovery/rotation, not automatic database deletion or password resets.

Bootstrap is repeatable and refuses unexpected owners, foreign tables, elevated roles or memberships. It assigns existing empty project databases to the correct owner, and does not create/drop an arbitrary host database. The generic migration functions use standard `pg` connection URLs; actual remote bootstrap, TLS, credentials and operations must be adapted and verified after the deferred host decision. No cloud account, provider or paid resource is required here.

Synthetic seeds are a separate local-only action, never a migration or startup side effect. They create one synthetic guest/session, disabled staff mapping, empty-permission revoked role assignment and pending private asset. They create no usable login or S3 object. Repeating seeds preserves existing records instead of updating them. The normal headless host still receives no database owner credentials and exposes health routes only.

## Validation and next work

[Validation evidence](evidence/P1/p1-pr-004-validation.md) records observed results and remaining limits. Tests include migration-source/history denials, concurrency lock, populated upgrades, transaction rollback, cross-database/role/DDL denials, token uniqueness and expiry, asset metadata invariants, staff FKs/permissions, leading FK indexes, real Payload migration and restricted initialization. The full Linux pipeline includes this suite and independently repeats it in GitHub CI.

After owner review and merge, 005 adds domain/catalog/reference/import schemas, 006 adds reports/consent/delivery/reliability and 007 adds CMS/SEO/ads/analytics. 008 closes S1 with the full schema/recovery evidence; entities/repositories remain 009 onward. This card does not close S1, full G0 or any live phase release.
