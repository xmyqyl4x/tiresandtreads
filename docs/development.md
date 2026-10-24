# Local development and verification

Accepted P1-PR-002 implements the headless workspace and test harness. P1-PR-003 adds [local integration proofs and external gates](implementation/P1-PR-003-local-foundation.md). [P1-PR-004](implementation/P1-PR-004-database-foundations.md) adds database ownership, registry, identity and asset migrations. There are no product screens, tire schemas, recommendation services or real provider integrations yet. `/` deliberately returns 404. Health endpoints report `scope: bootstrap`, not database/provider or product readiness.

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

`pnpm test` includes coverage and only unit/use-case projects. `pnpm test:db` requires the disposable runner's explicit database target; it refuses generic/production targets. `pnpm test:foundation` uses that runner with Node 24.22.1 to create disposable proof roles, generate/apply Payload migrations and exercise access/pool denials. Use the Docker verification command for this suite; never point it at dev/stage or native PostgreSQL. `pnpm test:http` exercises a running local host and accepts only loopback/the Compose app hostname. `pnpm contracts:generate` regenerates the health-only OpenAPI artifact; `contracts:check` rejects drift.

Write a failing behavior/denial/boundary case, implement, then refactor. The bootstrap configuration tests began with nine intended failures. The deliberately failing test project is excluded from normal test runs; `test:gates` invokes it and requires failure, then injects/removes forbidden imports to prove layer and direct/transitive client/server enforcement. Test fixtures reject unexpected HTTP; an actual local listener proves rejected requests do not reach it.

Coverage includes unimported package source. Current testable packages require 85% lines/statements/functions and 80% branches; future domain/engine/application code requires 95% lines/statements and 90% branches. Empty layer markers are explicitly excluded and do not imply implemented entities or services. Current 100% coverage applies only to the two small configuration/contract modules.

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

Application SQL lives in `infra/database/app`; generated Payload TypeScript and snapshots live in `infra/database/cms`. Add a sorted version and SHA-256 entry to its manifest after review, using LF source bytes. Do not change a deployed migration/hash to get past a mismatch. Future Payload generation should use the retained snapshot and current desired config in a disposable development copy, then review its generated SQL/type imports/grants before committing. `migrate` never generates code. There is no automatic destructive rollback; use compatible application rollback or an additive database correction. Full backup/restore/deletion-replay drills remain P1-PR-008 and chosen-host gates.

## Pinned toolchain rationale

The lockfile pins Next.js 16.4.3, React 19.3.1, TypeScript 6.0.3, ESLint 10.13.0, Vitest 5.0.5 and Zod 4.6.7. TypeScript 7 was not selected because the current typescript-eslint peer range is below 6.1. The reviewed Next.js patch was published on the bootstrap date; release-age exceptions list only that exact version and its matching `@next` packages. Other dependencies retain the one-day policy. Node/PostgreSQL image digests are in [versions.json](../infra/local/versions.json).

Payload 3.92.0 requires Node 24.22.1+ on the Node 24 line and permits Next 16.4.3. P1-PR-003 installs the Next compatibility plugin, Payload and PostgreSQL adapter and tests real local Payload/Drizzle behavior. Core native unit/type checks can use 24.19; execute the Payload integration suite on the pinned Linux 24.22.1 runtime. Real Clerk/hosted proofs remain deferred; committed schema/migration ownership is implemented in P1-PR-004; remote deployment remains gated.

Payload 3.92's migration generator emits value imports for `MigrateUpArgs`/`MigrateDownArgs`; strict `verbatimModuleSyntax` requires `import type`. The proof normalizes the exact generated fixture header, then executes the actual migration runner. P1-PR-004 commits the reviewed initial migration with explicit type imports, its generated snapshot and narrow grants. No production migration should be generated at runtime.

Scoped dependency overrides pin Vite's esbuild peer, the older Drizzle tooling's esbuild and Monaco's DOMPurify to tested compatible/patched versions. Their first unmodified resolution failed peer/audit checks; the resolved lockfile passes. Re-evaluate the overrides with the next Payload update. Test-only role/identity fixtures are blocked from application/package imports and are absent from exposed host routes. Keep versions pinned and update them through a tested PR.
