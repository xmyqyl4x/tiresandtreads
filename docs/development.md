# Local development and verification

Accepted P1-PR-002 implements the headless workspace and test harness. P1-PR-003 adds [local integration proofs and external gates](implementation/P1-PR-003-local-foundation.md). [P1-PR-004](implementation/P1-PR-004-database-foundations.md) adds database ownership, registry, identity and asset migrations. P1-PR-005 adds catalog/reference/import schemas and P1-PR-006 adds report/privacy/delivery/reliability schemas. P1-PR-007 adds CMS, SEO/ad operations, analytics and quotas. Product screens, recommendation/delivery services and real provider integrations remain at later cards. `/` deliberately returns 404. Health endpoints report `scope: bootstrap`, not database/provider or product readiness.

## Start with Docker

Use Git and Docker Desktop in Linux-container mode (Compose 2.24.4+ / BuildKit). A host Node installation runs the small portable orchestration scripts; Node 20.19+ can run those scripts without installing application dependencies. The actual dev app, optimized staging app and authoritative test suites run on **Node 24.22.1** in the pinned Linux image. Native dependency/test commands require Node 24.19+; `.nvmrc` selects the preferred 24.22.1 patch. Do not use the workstation's default Node 20 for native Vitest or Next.js commands.

From the repository root, on PowerShell, WSL or Linux:

```text
node scripts/dev/local.mjs doctor
node scripts/dev/local.mjs up dev --dry-run
node scripts/dev/local.mjs up dev
```

The first `up` generates independent random local values in ignored `.local/dev.env`, builds the image and waits for health checks. It never reads the native PostgreSQL password or connects to port 5432 on the host. The first build needs access to public package/container registries. No paid service or cloud account is needed.

| Target | Compose project | App URL | Host PostgreSQL | State |
| --- | --- | --- | --- | --- |
| Dev | `tt-dev` | `http://127.0.0.1:3100/health/ready` | `127.0.0.1:55432` | Hot-reload source mounts; dedicated named DB volume |
| Local stage | `tt-stage` | `http://127.0.0.1:3200/health/ready` | `127.0.0.1:55433` | Optimized nonroot, read-only app image; no source mount; separate DB volume |
| Disposable tests | `tt-test-<random>` | Internal Compose network only | Internal Compose network only | New network/DB volume per run; removed by its own runner |

Each cluster has separate `tt_app` and `tt_cms` logical databases. `local_harness` is a bootstrap test administrator, never a production/runtime role. P1-PR-004's separate operator commands assign application/CMS ownership, apply committed migrations and optionally load synthetic local seeds.

```text
node scripts/dev/local.mjs up stage
node scripts/dev/local.mjs status dev
node scripts/dev/local.mjs logs stage
node scripts/dev/local.mjs down dev
node scripts/dev/local.mjs down stage
```

`down` preserves dev/stage database volumes. Keep the corresponding ignored env files with those volumes; regenerating a password does not change the password in an existing database. There is no general reset/prune command. Test cleanup only removes the randomly allocated test project it created. Build images/cache are retained for reuse; no global Docker cleanup runs. Dev and stage publish only on loopback, use independent bridge networks, contain no live provider credentials and reject connected/live configuration. Disposable tests use an internal network with no published ports; unexpected test HTTP is also rejected. Bridge networks permit outbound connectivity, so dev/stage are not described as network sandboxes. Real adapters still require their own fixture/no-send enforcement.

The doctor reports versions, Docker resources, disk space, target names and port availability without credentials. Resolve port conflicts before starting. The committed plan owns ports 3100/3200/55432/55433; environment validation rejects redirection to another target/native port. It also overrides conflicting inherited shell variables with the validated project values. Before working in multiple checkouts, use distinct resource names through a reviewed plan change; do not point two checkouts at the same `tt-dev`/`tt-stage` resources.

Source mounts cover the health routes, instrumentation and current package source folders. Dependency/configuration changes require rebuilding dev. Host and container `node_modules` are separate. Later auth work must add distinct verified hostnames/cookies and provider namespaces; ports alone do not isolate browser cookies. No auth or cookie flows exist in this host yet.

## Native fast loop and TDD

With Node 24.19+ (24.22.1 preferred) and **pnpm 11.25.0**:

```text
pnpm install --frozen-lockfile
pnpm quality
pnpm test:unit
pnpm test:usecases
pnpm test
pnpm test:gates
```

`pnpm test` runs the fast unit/use-case projects. `pnpm verify:data-access --coverage` runs unit/use-case and real database projects together with coverage in an isolated Linux/PostgreSQL environment; the full pre-push pipeline does the same. `pnpm test:coverage` is the underlying container command and requires its disposable database target. `pnpm test:db` requires the disposable runner's explicit database target; it refuses generic/production targets. `pnpm test:foundation` uses that runner with Node 24.22.1 to create disposable proof roles, generate/apply Payload migrations and exercise access/pool denials. Use the Docker verification command for this suite; never point it at dev/stage or native PostgreSQL. `pnpm test:http` exercises a running local host and accepts only loopback/the Compose app hostname. `pnpm contracts:generate` regenerates the health-only OpenAPI artifact; `contracts:check` rejects drift.

Write a failing behavior/denial/boundary case, implement, then refactor. The bootstrap configuration tests began with nine intended failures. The deliberately failing test project is excluded from normal test runs; `test:gates` invokes it and requires failure, then injects/removes forbidden imports to prove layer and direct/transitive client/server enforcement. Test fixtures reject unexpected HTTP; an actual local listener proves rejected requests do not reach it.

Coverage includes unimported package source. Current testable packages require 85% lines/statements/functions and 80% branches; future domain/engine/application code requires 95% lines/statements and 90% branches. Empty layer markers are explicitly excluded and do not imply implemented entities or services. The combined unit/database suite includes the S2 SQL adapters; see each implementation packet for measured coverage. Interface-only modules have no executable behavior. Thresholds are unchanged.

`quality` checks source hygiene/case collisions, formatting, lint, strict TypeScript, cyclic/forbidden dependencies, generated contracts and committed migration-source checksums. The lightweight source scan catches private env artifacts and common credential patterns; it is not a comprehensive secret/security audit. The full Linux runner also queries the npm advisory service and fails at high severity. Advisory lookup alone has external network access; fixture application/tests run on an internal network. Future safety/security checks are added with their features.

Windows certificate trust may require a process-scoped `NODE_OPTIONS=--use-system-ca` for native registry requests. Never disable TLS verification or commit proxy credentials. Docker registry/package access was verified separately. Avoid sharing dependencies between a Windows checkout and a WSL-native checkout.

## Exact-commit verification before push

```text
node scripts/verify/local.mjs
git add <reviewed paths>
git commit -m "Describe the change"
pnpm verify:push
git push
```

The first command is also the cold-checkout path: it builds from the frozen lockfile and runs quality, unit/use-case coverage, deliberate failure checks, real PostgreSQL transaction/constraint tests, foundation and schema integration proofs, HTTP smoke and app stop/restart checks. It measures idle container resources and rejects hosted fixture configuration in a separately owned, network-disabled container. Tests use both logical databases in a new cluster. Cleanup runs on failure as well as success, including timeout cleanup of the configuration probe. It does not need native `psql`, pnpm or host application dependencies.

`verify:push` requires a clean committed tree, repeats Linux verification and records source/tree/lock/image evidence in ignored `.local/verified-commit.json`. Any content change or new commit requires verification again. GitHub CI independently repeats the Linux suite with read-only repository permission and no provider credentials; it never trusts that local stamp.

Optionally install the repository-local hook with `git config --local core.hooksPath .githooks`. The hook checks the stamp and every pushed source SHA. It is a convenience, not the security boundary. CI and review remain required; `git push --no-verify` cannot create passing CI evidence. Protected main/release policies must be configured on GitHub before production delivery.

The [release scaffold](../infra/release/README.md) defines immutable artifact evidence and the remaining hosted environment controls. No merge deploys public traffic. Real source licenses, hosted environments, credentials, CMS/auth bridge, hosted runtime credential provisioning, cloud workflows/storage/email and production recovery remain at their approved cards and [decision triggers](implementation/P1-PR-001-launch-baseline.md#deferred-decision-register).

The optimized image runs a bundle of the shared configuration validator before opening Next's server. Instrumentation/readiness checks alone do not guarantee process termination on invalid configuration; P1-PR-003 observed that failure and added the preflight. The same image is tested for valid local startup and invalid hosted-fixture refusal, and the runner always removes its specifically created refusal container.

## Database ownership and migrations

P1-PR-004 adds database-first schema sources and operator commands. With Docker running, execute from the repository root:

```text
pnpm database bootstrap dev
pnpm database migrate dev
pnpm database status dev
pnpm database seed dev
pnpm database bootstrap stage
pnpm database migrate stage
pnpm database status stage
```

`seed` is optional and accepts local dev/stage only. The command creates disabled/empty-permission synthetic identities and a pending private asset; no source provider, external authentication or storage object is activated. Repeat `migrate`/`seed` to verify no-op/idempotent behavior. Stop a project's services with `pnpm local down dev` or `stage`; this preserves its volume. Do not delete volumes or credential files to resolve a migration mismatch.

The Windows/WSL/Linux equivalent without host pnpm is `node scripts/database/local.mjs <action> <dev|stage>`; all SQL/Payload tooling runs with pinned Node inside Linux containers. `bootstrap` creates restricted owners/runtimes using only the project Docker admin credential. Per-cluster role passwords/CMS secret remain in ignored `.local/db-dev.env` and `.local/db-stage.env`; the separate temporary admin file is removed after bootstrap. Protect these files with the workstation account permissions; do not copy them into Git, screenshots or tickets. Never share dev/stage credentials or supply an owner credential to the web host.

`migrate` verifies the source manifest and applied history, takes one database lock and applies pending migrations with the proper owner. `status` validates history and reports only counts; on the first invocation it may initialize empty migration bookkeeping. A failure gives a redacted command/SQLSTATE result; inspect the selected cluster and review sources, never print credential-bearing environments. Bootstrap refuses unexpected owners/tables/role capabilities and preserves existing passwords. If credentials are lost, recover/rotate them explicitly with the operator; this command does not reset data or credentials automatically.

Run `node scripts/verify/database.mjs` for focused disposable schema tests, or `node scripts/verify/local.mjs` for the full Linux pipeline. The schema suite creates separate `tt_app_schema`/`tt_cms_schema` databases only inside its random test cluster; dev/stage/native databases cannot be selected by that fixture. `pnpm db:check` verifies committed checksums without contacting a database. See the [implementation packet](implementation/P1-PR-004-database-foundations.md) for ownership, grants and [validation evidence](implementation/evidence/P1/p1-pr-004-validation.md) for observed results.

P1-PR-005 adds three application migrations (source/identity, catalog/reference and imports), making five application migrations and one CMS migration. Upgrade existing dev/stage with `pnpm database migrate dev` and `pnpm database migrate stage`; status should report zero pending and replay should apply zero versions. The 42 new tables start empty and retain no runtime grants. Synthetic catalog facts exist only in disposable schema fixtures; optional local seeds retain the 004 identity/asset scope. See the [catalog/import packet](implementation/P1-PR-005-domain-catalog-import-schemas.md) and [validation evidence](implementation/evidence/P1/p1-pr-005-validation.md).

Application SQL lives in `infra/database/app`; generated Payload TypeScript and snapshots live in `infra/database/cms`. Add a sorted version and SHA-256 entry to its manifest after review, using LF source bytes. Do not change a deployed migration/hash to get past a mismatch. Future Payload generation should use the retained snapshot and current desired config in a disposable development copy, then review its generated SQL/type imports/grants before committing. `migrate` never generates code. There is no automatic destructive rollback; use compatible application rollback or an additive database correction. P1-PR-008 adds the isolated logical backup/restore/deletion-replay drill below; chosen-host recovery remains a separate release gate.

P1-PR-006 adds four migrations, bringing application history to nine and CMS history to one. Use the same dev/stage migrate/status commands; replay applies zero. Its 42 new tables retain default-deny runtime access, and the audit FK replaces the prior NULL-only placeholder. See the [report/delivery packet](implementation/P1-PR-006-report-consent-delivery-schemas.md) and [validation evidence](implementation/evidence/P1/p1-pr-006-validation.md).

P1-PR-007 adds two application migrations and one Payload-generated CMS migration, bringing history to **11 app / 2 CMS**. Run `pnpm database migrate dev` and `pnpm database migrate stage`, then `pnpm database status dev` / `stage`; expected pending count is zero and replay applies zero. Do not reset existing volumes or edit applied checksums. The isolated generator `pnpm exec tsx tests/fixtures/schema/generate-cms.ts 0001_staff` reproduces the 007 baseline delta inside the schema-fixture container; omit the baseline for a later forward delta. Generation is an operator step, never runtime schema push. See the [CMS/operations packet](implementation/P1-PR-007-cms-seo-ads-analytics-schemas.md) and [validation evidence](implementation/evidence/P1/p1-pr-007-validation.md).

P1-PR-008 changes no migration or retained environment state. Run `pnpm verify:recovery` to create source/recovery PostgreSQL clusters with random project names and no exposed ports. It checks real app/CMS dumps, the full inventory and fingerprints, corrupt-archive rollback, current deletion replay, independent CMS publication and restricted reopening. The runner removes only its own test resources; redacted evidence remains in ignored `.local/recovery-evidence`. Never point these bounded synthetic fixtures at dev/stage/production data. The full `pnpm verify:push` and GitHub CI now include this drill. See the [S1 recovery procedure and limitations](implementation/P1-PR-008-database-validation-recovery.md) and [validation record](implementation/evidence/P1/p1-pr-008-validation.md).

P1-PR-009 adds pure domain/value types, application ports and a one-client transaction helper. Run `pnpm verify:data-access` for the existing database harness plus real restricted-role transaction tests; it uses only its random disposable environment. `pnpm test` covers values, mappers and fault injection; strict type checks reject ID/unit/wire/context misuse. `pnpm verify:push` includes both the data-access and recovery tests. No dev/stage migration or credential change is required. See the [contract and transaction protocol](implementation/P1-PR-009-entities-transactions.md) and [evidence](implementation/evidence/P1/p1-pr-009-validation.md).

## Pinned toolchain rationale

The lockfile pins Next.js 16.4.3, React 19.3.1, TypeScript 6.0.3, ESLint 10.13.0, Vitest 5.0.5 and Zod 4.6.7. TypeScript 7 was not selected because the current typescript-eslint peer range is below 6.1. The reviewed Next.js patch was published on the bootstrap date; release-age exceptions list only that exact version and its matching `@next` packages. Other dependencies retain the one-day policy. Node/PostgreSQL image digests are in [versions.json](../infra/local/versions.json).

Payload 3.92.0 requires Node 24.22.1+ on the Node 24 line and permits Next 16.4.3. P1-PR-003 installs the Next compatibility plugin, Payload and PostgreSQL adapter and tests real local Payload/Drizzle behavior. Core native unit/type checks can use 24.19; execute the Payload integration suite on the pinned Linux 24.22.1 runtime. Real Clerk/hosted proofs remain deferred; committed schema/migration ownership is implemented in P1-PR-004; remote deployment remains gated.

Payload 3.92's migration generator emits value imports for `MigrateUpArgs`/`MigrateDownArgs`; strict `verbatimModuleSyntax` requires `import type`. The proof normalizes the exact generated fixture header, then executes the actual migration runner. P1-PR-004 commits the reviewed initial migration with explicit type imports, its generated snapshot and narrow grants. No production migration should be generated at runtime.

Scoped dependency overrides pin Vite's esbuild peer, the older Drizzle tooling's esbuild, Monaco's DOMPurify and Payload GraphQL's graphql-scalars (2.0.1 for GHSA-x8rm-f576-gq67) to tested compatible/patched versions. Their first unmodified resolution failed peer/audit checks; the resolved lockfile passes. Re-evaluate the overrides with the next Payload update. Test-only role/identity fixtures are blocked from application/package imports and are absent from exposed host routes. Keep versions pinned and update them through a tested PR.

## P1-PR-010 catalog repository upgrade

Migration `0012_catalog_access` adds three separate roles and published views plus a materialization ledger. On an existing local target, first rerun bootstrap to append only the missing role passwords. Existing role passwords, CMS secret and retained data are preserved:

```text
pnpm database bootstrap dev
pnpm database migrate dev
pnpm database status dev
pnpm database bootstrap stage
pnpm database migrate stage
pnpm database status stage
pnpm verify:data-access --coverage
```

Expected history: **12 app / two CMS**, zero pending; migration replay applies zero. Old credentials are validated and never silently regenerated. A missing legacy credential is an error requiring local investigation. The catalog, ingester and publisher credentials stay in the ignored target env file; the general app and CMS receive no new grants. Runtime connection composition remains S3/014. Stop targets with `pnpm local down dev` / `stage` to retain volumes. See the [repository protocol](implementation/P1-PR-010-catalog-ingestion.md) and [evidence](implementation/evidence/P1/p1-pr-010-validation.md).

## P1-PR-011 private repository upgrade

Bootstrap dev and stage before migrating to append `DB_PASSWORD_TT_PRIVATE_RUNTIME` to each ignored credential file. Existing passwords and CMS secrets are preserved. Run `pnpm database bootstrap dev`, `pnpm database migrate dev`, `pnpm database status dev`, then the equivalent stage commands. Expected current history is **13 app / two CMS**, zero pending; replay applies zero. This supersedes the 010 historical count above. Stop with `pnpm local down dev` / `stage` to retain data.

`tt_private_runtime` belongs only to the trusted private workflow process. It composes owner/report/privacy/delivery/reliability repositories on one `TransactionContext`; public catalog, CMS and browser callers never receive its credentials. Crypto, permission policy, signed downloads and provider calls remain S3. The [protocol](implementation/P1-PR-011-owner-report-delivery.md) defines identity/subject/send lock order, key overlap and caller responsibilities. `pnpm verify:data-access --coverage` runs synthetic real-role concurrency and rollback tests; full `pnpm verify:push` also runs schema/recovery/HTTP/lifecycle proofs.

## P1-PR-012 operations adapter upgrade

Bootstrap each retained dev/stage target before migrating. This appends only the five new content/public/operations/analytics/limiter role secrets, preserving existing passwords and CMS secrets. Run `pnpm database bootstrap dev`, `pnpm database migrate dev`, `pnpm database status dev`, then the same commands for stage. Expected current history is **14 app / two CMS**, zero pending; replay applies zero. Stop with `pnpm local down dev` / `stage` to retain data. This supersedes the historical count above; never reset retained volumes or change an applied checksum.

See the [012 implementation protocol](implementation/P1-PR-012-content-operations-analytics.md) for role composition, publication ordering, analytics locks and quota rotation. Use `pnpm verify:data-access --coverage` for repository proofs and `pnpm verify:push` on a clean commit for the complete pipeline. No product routes, collection, ad tags or external services are enabled.

## P1-PR-013 full S2 validation

`pnpm db:models` creates its own randomly named disposable Docker PostgreSQL environment, applies reviewed migrations and regenerates `packages/db/src/models/application.generated.ts`. It reads schema metadata only; no native/dev/stage target or row data is used. Commit generated output with any intentional schema change. `pnpm verify:data-access --coverage` verifies exact source regeneration and every Drizzle column type/null/default/generated property against migrated PostgreSQL, along with all repository tests. The existing clean-commit `pnpm verify:push` also runs failure gates, schema/restore and HTTP/lifecycle checks.

Column declarations are storage models, never migration/schema-push input: SQL owns FKs, checks, indexes, triggers, roles and history. Payload owns its separate database and has no application Drizzle model. Generated declarations are excluded from behavioral coverage because the full live parity test validates them; thresholds for executable code are unchanged. Drizzle returns bigint/Date values, while raw `pg` queries return bigint strings; use the corresponding explicit mapper and never cast a raw row to an inferred Drizzle type.

No new migration, role, credential or dependency is needed. Retained dev/stage stay at 14 app/two CMS migrations. The [audit](implementation/P1-PR-013-s2-contract-audit.md) assigns later lifecycle/command persistence extensions to their owning S3 cards; no generic ORM row or privileged client crosses the application ports. Owner S2 approval precedes 014; all P1 business services/APIs must pass 031 before product frontend work.

## P1-PR-014 runtime, durable jobs and private assets

After accepted S2, `pnpm verify:data-access --coverage` now starts its own digest-pinned Moto S3/KMS and Inngest Dev Server alongside real PostgreSQL, on an internal Docker network without published ports. Full `pnpm verify:push` runs the same providers and removes the complete verify profile at teardown. There is no cloud credential, mail, billable provider or native PostgreSQL dependency in this proof. Moto does not establish cloud IAM/encryption durability. The Inngest Dev Server is development infrastructure only.

`pnpm build` bundles `.local/worker.mjs`; the Linux runner image includes it beside the web server. `node worker.mjs` inside that image starts the private worker transport; the web command stays `node start.mjs`. Worker composition validates a separate fixture configuration and refuses production/live settings. No reviewed product job handler is installed by default; owning service cards register narrow SQL handlers through `createRuntime`'s port factory. Do not send arbitrary external side effects from a SQL handler.

Use an ignored environment file rather than CLI arguments for `PRIVATE_DATABASE_URL` (`tt_private_runtime`) and `ASSET_DATABASE_URL` (`tt_asset_runtime`), `STORAGE_ENDPOINT`, `WORKFLOW_ENDPOINT`, distinct `PRIVATE_BUCKET`/`PUBLIC_BUCKET`, full `KMS_KEY_ID`, `AWS_REGION`, fixture-only AWS credentials, `WORKER_PORT` and `WORKER_ORIGIN`. Local tests provision fresh versioned buckets and a synthetic KMS key. Existing database operator env files contain migrator/admin credentials: never mount those files into a worker. Production mode, TLS, workload IAM and real signing keys require the DD03/DD05 hosted proofs and a reviewed production composition path.

`DB_POOL_MAX` defaults to two per private/asset pool; `APP_REPLICAS` defaults one; `OTHER_DB_CONNECTIONS` reserves three per replica for CMS/other pools; `DB_CONNECTION_RESERVE` defaults 20. Composition verifies `replicas × (2 × poolMax + otherConnections) + reserve` against usable capacity: actual `max_connections` minus `superuser_reserved_connections` and `reserved_connections`. Operational reserve is already included in the required total and is separate from server reservations. Recalculate other connections when new service role pools are composed; this is an admission check, not proof of production capacity. Each pool allows eight waiting checkouts, a 500ms connection timeout and existing transaction-local SQL limits. Worker SIGTERM stops HTTP admission, drains requests and then closes pools with finite deadlines. New enqueue/relay/command work is refused after drain begins.

Retained dev/stage upgrade through `pnpm database migrate dev` and `pnpm database migrate stage`: 16 application/two CMS migrations, existing credentials unchanged. `0015`/`0016` add no new role or table. Generated storage columns are already regenerated and checked against PostgreSQL. The [implementation packet](implementation/P1-PR-014-jobs-assets-runtime.md) records limits, failure queues and hosted acceptance blockers.

## Script-first import services (P1-PR-015)

[Command and input contract](implementation/P1-PR-015-ingestion-publication-services.md) documents the six `pnpm data:*` commands, private role URLs, complete normalized JSONL snapshots, expected-head plans and separate approval evidence. `pnpm build` emits `.local/import.mjs` for Linux/container operator use as well as the worker. Local dev/stage retain their existing credential files and upgrade to 17 application/two CMS migrations. Dry runs stage/validate privately; publication is a separate approved command. Run `pnpm verify:data-access --coverage` for the real PostgreSQL/process CLI tests. Source-specific adapters remain 016; no paid source or automated publisher is activated.

## Source-adapter draft (P1-PR-016)

[016](implementation/P1-PR-016-domain-source-adapters.md) documents NHTSA scopes, private source registration, bounded refresh/tick commands and the read-only `pnpm data:source-probe --spec <scope.json>` command. No database or approval is needed for that explicit public compatibility probe; it reports metadata only and does not establish rights or coverage. Database commands use the same private ingestion/publication role URLs as 015. Source/rights approvals are separate audited records; no production source is seeded. The cron file in `infra/jobs` is a deployment template with a reviewed image/secret placeholder, overlap lock and ephemeral scratch volume; nothing is installed automatically. The application remains headless. Dev/stage upgrade through 0018–0022 to 22 app/two CMS migrations without changing credentials. See the implementation packet for pending licensed sources, public-source rights review, native temporary-file cleanup after abrupt termination and the later issuance-service call to the recall freshness guard.

## Report/refine/compare/access services (P1-PR-019)

[019](implementation/P1-PR-019-report-services.md) provides headless callable services and repository-backed evidence composition. For an existing retained target, run `pnpm database bootstrap dev` then `pnpm database migrate dev` (and the corresponding `stage` commands). Bootstrap adds only the missing `tt_report_source_runtime` credential/role and preserves existing credentials. Migration 0023 adds explicit policy heads, comparison-bound shares and scalar command receipts. Both retained targets have been upgraded locally to **23 app/two CMS migrations** and stopped with volumes retained. Native PostgreSQL remains untouched.

Application composition supplies separate bounded private/catalog/source-metadata scopes, a server-held capability key ring, a separate stable command-identity key, the existing context-bound envelope adapter and one explicit clock. Include all pools in the deployment connection budget and drain them through their owning process. No report HTTP endpoint, hosted provider or public UI is activated here. Actual source rights, reviewed policy/head publication and clearance coverage are required; the real resolver fails closed while those decisions remain pending. Run `pnpm verify:data-access --coverage` and the clean-commit `pnpm verify:push` before publishing changes.

P1-PR-020 adds the [headless contact/consent contract](implementation/P1-PR-020-contact-consent.md), conservative ASCII email policy, independent lookup/bearer key rings and migration `0024_contact_services`. Use `createContactRuntime` only with `tt_private_runtime`; supply current reviewed notices, clock and the established context-bound encryption adapter. The internal verification-message and suppression ports must not be registered as public routes. Tests never send email. Run `pnpm quality`, `pnpm verify:data-access --coverage` and the clean committed `pnpm verify:push` gate; apply migration 0024 to retained dev/stage with `pnpm database migrate <target>` before serving them.

P1-PR-021 adds the [headless content/SEO contract](implementation/P1-PR-021-content-seo.md). Compose separate `tt_content_runtime`, `tt_public_runtime` and `tt_cms_runtime` scopes through `createContentRuntime`; verified staff mappings require current `content.publish`/`seo.publish` capabilities. Tests use an exact disposable CMS database and an isolated Payload migration child process; no real content/provider activation occurs. Apply app through 0026/CMS 0003 with `pnpm database migrate <target>` before serving a retained target. The full `pnpm verify:push` gate verifies the clean committed Linux tree, including independent app/CMS recovery.

P1-PR-022 adds the [delivery orchestration contract](implementation/P1-PR-022-delivery-orchestration.md). `createDeliveryRuntime` validates `tt_private_runtime` and `tt_asset_runtime`, reuses current contact-policy/key coverage, and composes private PDF/payload storage with render/provider ports. Apply app through 0027/CMS 0003 using the existing database operator. `request/status/cancel` are future owner transports; `dispatch/reconcile` are internal worker methods. Never expose the contact request effect callback as transport input. Fixtures are labeled and the real Resend adapter refuses them; actual report issuance remains disabled. Native PostgreSQL is untouched.

[P1-PR-023 email actions/recovery](implementation/P1-PR-023-mail-events-actions.md) provides the trusted operator command `pnpm exec tsx scripts/mail/recover.ts pending`, `status <send-id>`, `replay <inbox-id>` and `reconcile <send-id>`. Configure the private role URL and lookup versions in the environment; explicit provider reads require their own flag/key. The production image exposes the same bundled command as `node mail-recover.mjs`. No resend/force-accept command exists. See [validation](implementation/evidence/P1/p1-pr-023-validation.md) for measured proof and deferred acceptance.

[P1-PR-024 analytics/limits/operations](implementation/P1-PR-024-analytics-limits-operations.md) provides `createWorkloadPools` and `createAnalyticsRuntime` for trusted server composition. Configure explicit per-lane credentials/maxima, every replica, other connections and a reserve. Collection and seeded policies remain disabled pending transport/activation review. Run bounded `rebuildOne`, `maintenance`, limiter cleanup and authorized dashboard queries through the headless services; P1-PR-027 owns schedule/host binding. See [validation](implementation/evidence/P1/p1-pr-024-validation.md) for proof and acceptance limits.

**P1-PR-025 privacy services:** provision `tt_privacy_runtime` through the local bootstrap before migrations 0030/0031, retain private MAC/contact/encryption key versions while proofs/markers need them, and supply a separate encrypted journal plus real provider acknowledgment adapters before activation. Use the headless `requestOwner`/`requestEmail`, notification dispatch, `workOne`, `queue`, reviewed manual decisions, dry-run/apply `sweep`, asset retention and authenticated replay factories. P1-PR-027 binds schedules; API/UI remain later gates. See the [implementation contract](implementation/P1-PR-025-privacy-retention-recovery.md).

[P1-PR-026 staff/commercial services](implementation/P1-PR-026-staff-commerce-revenue.md) use exact `tt_staff_service_runtime`, `tt_commercial_runtime` and `tt_public_runtime` scopes. Run database bootstrap before migrate to add only the new credentials to retained dev/stage. Migration 0032 is additive; the real-role tests remain synthetic and do not enable public ads/email/issuance. See [validation](implementation/evidence/P1/p1-pr-026-validation.md).

[P1-PR-027 S3 review](implementation/P1-PR-027-s3-validation-gate.md) adds `pnpm s3:check` to quality (inventory integrity) and `pnpm s3:acceptance` (strict acceptance). The latter intentionally exits 2 while the [register](implementation/evidence/P1/s3-service-register.json) has pending evidence. CI green is not S3 acceptance. Apply additive 0033 to Docker dev/stage; no new credentials or providers are needed. Product endpoint implementation remains held.

**October 26 local service-host continuation:** Use `pnpm verify:service-host` for the isolated composed-service proof and [the local host runbook](operations/local-service-host.md) for intentional dev/stage configuration. `pnpm service-host check` composes/checks/drains; `run` exposes health/internal workflows only. The host never bootstraps, migrates, seeds policy approvals or rotates keys automatically. Product APIs remain held.

Retained dev/stage service hosts use `pnpm local:host prepare|up|prove|status|stop <dev|stage>`. See the [local workflow runbook](operations/local-service-host.md#retained-devstage-workflow) for separate keys/journal/workflow volumes, guarded fixture-provider cold restart and actual cron/SQL failure/replay proofs. Product APIs and the six S3 acceptance gates remain held.

The [local observability/response continuation](implementation/P1-PR-027-local-observability.md) adds `local:host observe` and `prove-observability`. See the [masked operational response runbook](operations/local-observability.md). All six S3 gates and the API hold remain unchanged.

The [final local S3 readiness review](implementation/P1-PR-027-final-local-readiness.md) is the current evidence entry point. Retained idle socket counts differ from declared maxima; local fixture recovery differs from independent hosted custody. Keep the six acceptance gates and API hold intact. No additional setup, migration or credential change is required for this documentation reconciliation.

The [private hosted staging decision packet](implementation/P1-PR-027-private-hosted-staging-decision.md) identifies future hosted endpoint/TLS and ownership preflight work. Packet preparation changes no local setup or credentials and authorizes no cloud login, provisioning or purchases. Product APIs remain held; all proposed HS choices need explicit recorded decisions.

For the owner-authorized [SP01–SP02 local TLS/ownership preflight](implementation/P1-PR-027-local-hosted-preflight.md), run `pnpm verify:db-preflight` from the repository root. It uses a fresh internal Docker test project and removes its own volumes. It accepts no target argument, retained credential file or cloud/native endpoint. Existing dev/stage setup and runtime guards are unchanged. Planning PR #33 is merged; HS01–HS08 remain proposed, actual hosted proofs pending and APIs held.

After approved merged PR #34, use `pnpm verify:provider-preflight` for [SP03 local provider preflight](implementation/P1-PR-027-local-provider-preflight.md). It accepts no target/credential arguments, uses only its own internal Moto/Inngest project and synthetic resources, starts no DB/app, and cleans up its own project/volumes. Offline SDK signature probes create no listener/functions. This does not configure retained environments or enable hosted endpoints. All HS choices remain proposed and all acceptance/API holds persist.

**October 27 SP04 local custody/recovery preflight:** PR #35 is approved and merged at `9529a3f8`. [SP04 local-only proof](implementation/P1-PR-027-local-custody-preflight.md) (`pnpm verify:custody-preflight`) adds authenticated encrypted fixture backups, separate key/current signed-journal volumes, admission refusals, isolated app/CMS restore and real privacy-service deletion/tombstone replay. This does not prove independent off-host custody, hosted RPO/RTO/PITR or policy acceptance. No retained data/secrets are exported. HS01–HS08 remain proposed, all six gates pending with empty records, specialist/licensed work pending, APIs held; no provisioning/purchases.

**October 27 SP05 local deployment/access/rollback preflight:** PR #36 is approved and merged at `0e521439`. [SP05 local-only proof](implementation/P1-PR-027-local-deployment-preflight.md) (`pnpm verify:deployment-preflight`) adds approved-source/candidate immutable image builds, local TLS/operator-certificate access, signed SDK probes, denied product routes, serialized additive fixture expansion, outage refusal and explicit image rollback. Local source labels/IDs do not prove registry provenance or hosted rollout/identity/business compatibility. HS01–HS08 remain proposed; all six actual gates pending with empty records; specialist/licensed work pending; APIs held. No provisioning/purchases or retained environment changes.

**October 28 SP06 local capacity/lifecycle preflight:** PR #37 is approved and merged at `3e86d3e5`. [SP06 local-only proof](implementation/P1-PR-027-local-capacity-preflight.md) (`pnpm verify:capacity-preflight`) accounts for every fixture pool/process/reservation, strengthens admission to subtract server-reserved PostgreSQL slots, and proves bounded mixed work, overload refusal, runtime-lane reconnect, signed journal/versioned-object I/O, drain and separate bundled-process SIGTERM. The revised fixture requires 68 of 70 usable slots (75 raw); the proposed 45-slot profile is refused. This does not select/accept hosted capacity. HS01–HS08 proposed, all six actual gates pending with empty records, specialist/licensed work pending, APIs held; no provisioning/purchases or retained environment changes.

**October 28 SP07 local observation/response preflight:** PR #38 is approved and merged at `fa25c6b7`. [SP07 local-only proof](implementation/P1-PR-027-local-observation-preflight.md) (`pnpm verify:observation-preflight`) adds fresh masked observations, separate usable-connection capacity, real local cron/readiness faults, a bounded private incident/delivery journal and a loopback-only receiver. Simulated acknowledgments/escalations and controlled retries do not establish actual staffing or notification acceptance. The existing quota-capacity signal counts rate-limit rows; connection observations use conservative database-backend totals without broader privileges. All HS choices remain proposed, six actual gates pending with empty records, specialist/licensed work pending and APIs held. No provisioning, purchases, actual recipient notifications or retained environment changes.

**October 28 SP08 local evidence handoff:** Owner-approved PR #39 is merged at `9d314d00`. The [finite SP01–SP07 evidence reconciliation](implementation/P1-PR-027-local-evidence-handoff.md) accepted in merged PR #40 (`8965bd72`), with full PR/CI ancestry, 23 immutable receipt pins, explicit local/hosted limits and the six-gate acceptance backlog. The historical PR #39 exact-local receipt is not relabeled as a fresh SP08 run. No runtime or dependency change. All HS01–HS08 decisions remain proposed; six actual gates open, specialist/licensed work pending, APIs held. No provisioning, purchases or notifications. After local review there is no automatic next runtime feature; actual decisions and acceptance require their existing scoped review/authorization.

**October 28 HS05/HS04 proposal:** SP08 local handoff is accepted in merged PR #40 (`8965bd72`). [Operator responsibilities and the expanded staging budget](implementation/P1-PR-027-staging-operations-budget.md) are in review: seven unassigned role slots, candidate coverage and labor estimates, full recurring/temporary/setup/cash-versus-effort categories, and public-price versus unquoted-cost distinctions. Proposed infrastructure envelope USD 350/month plus separate USD 100/event and month temporary resources; actual labor/tax/support/local/setup amounts remain unresolved. The historical USD 175 model is preserved and insufficient for this expanded scope. All HS01–HS08 remain proposed, six actual S3 gates pending, specialist/licensed work pending and APIs held. No provisioning, purchases or notifications.
