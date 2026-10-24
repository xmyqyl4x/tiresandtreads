# Local development and verification

Accepted P1-PR-002 implements the headless workspace and test harness. P1-PR-003 adds [local integration proofs and external gates](implementation/P1-PR-003-local-foundation.md). There are no product screens, tire schemas, recommendation services or real provider integrations yet. `/` deliberately returns 404. Health endpoints report `scope: bootstrap`, not database/provider or product readiness.

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

Each cluster has separate `tt_app` and `tt_cms` logical databases. `local_harness` is a bootstrap test administrator, never a production/runtime role. Application/CMS ownership and migration roles start in P1-PR-004. No product migration or seed command is claimed by this PR.

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

`quality` checks source hygiene/case collisions, formatting, lint, strict TypeScript, cyclic/forbidden dependencies and generated contracts. The lightweight source scan catches private env artifacts and common credential patterns; it is not a comprehensive secret/security audit. The full Linux runner also queries the npm advisory service and fails at high severity. Advisory lookup alone has external network access; fixture application/tests run on an internal network. Future safety/security checks are added with their features.

Windows certificate trust may require a process-scoped `NODE_OPTIONS=--use-system-ca` for native registry requests. Never disable TLS verification or commit proxy credentials. Docker registry/package access was verified separately. Avoid sharing dependencies between a Windows checkout and a WSL-native checkout.

## Exact-commit verification before push

```text
node scripts/verify/local.mjs
git add <reviewed paths>
git commit -m "Describe the change"
pnpm verify:push
git push
```

The first command is also the cold-checkout path: it builds from the frozen lockfile and runs quality, unit/use-case coverage, deliberate failure checks, real PostgreSQL transaction/constraint tests, foundation integration proofs, HTTP smoke and app stop/restart checks. It measures idle container resources and rejects hosted fixture configuration in a separately owned, network-disabled container. Tests use both logical databases in a new cluster. Cleanup runs on failure as well as success, including timeout cleanup of the configuration probe. It does not need native `psql`, pnpm or host application dependencies.

`verify:push` requires a clean committed tree, repeats Linux verification and records source/tree/lock/image evidence in ignored `.local/verified-commit.json`. Any content change or new commit requires verification again. GitHub CI independently repeats the Linux suite with read-only repository permission and no provider credentials; it never trusts that local stamp.

Optionally install the repository-local hook with `git config --local core.hooksPath .githooks`. The hook checks the stamp and every pushed source SHA. It is a convenience, not the security boundary. CI and review remain required; `git push --no-verify` cannot create passing CI evidence. Protected main/release policies must be configured on GitHub before production delivery.

The [release scaffold](../infra/release/README.md) defines immutable artifact evidence and the remaining hosted environment controls. No merge deploys public traffic. Real source licenses, hosted environments, credentials, CMS/auth bridge, runtime DB roles, cloud workflows/storage/email and production recovery remain at their approved cards and [decision triggers](implementation/P1-PR-001-launch-baseline.md#deferred-decision-register).

The optimized image runs a bundle of the shared configuration validator before opening Next's server. Instrumentation/readiness checks alone do not guarantee process termination on invalid configuration; P1-PR-003 observed that failure and added the preflight. The same image is tested for valid local startup and invalid hosted-fixture refusal, and the runner always removes its specifically created refusal container.

## Pinned toolchain rationale

The lockfile pins Next.js 16.4.3, React 19.3.1, TypeScript 6.0.3, ESLint 10.13.0, Vitest 5.0.5 and Zod 4.6.7. TypeScript 7 was not selected because the current typescript-eslint peer range is below 6.1. The reviewed Next.js patch was published on the bootstrap date; release-age exceptions list only that exact version and its matching `@next` packages. Other dependencies retain the one-day policy. Node/PostgreSQL image digests are in [versions.json](../infra/local/versions.json).

Payload 3.92.0 requires Node 24.22.1+ on the Node 24 line and permits Next 16.4.3. P1-PR-003 installs the Next compatibility plugin, Payload and PostgreSQL adapter and tests real local Payload/Drizzle behavior. Core native unit/type checks can use 24.19; execute the Payload integration suite on the pinned Linux 24.22.1 runtime. Real Clerk/hosted proofs remain deferred; production schema/migration ownership remains P1-PR-004.

Payload 3.92's migration generator emits value imports for `MigrateUpArgs`/`MigrateDownArgs`; strict `verbatimModuleSyntax` requires `import type`. The proof normalizes the exact generated fixture header, then executes the actual migration runner. In P1-PR-004, review and commit generated migrations with explicit type imports before applying them. No production migration should be generated at runtime.

Scoped dependency overrides pin Vite's esbuild peer, the older Drizzle tooling's esbuild and Monaco's DOMPurify to tested compatible/patched versions. Their first unmodified resolution failed peer/audit checks; the resolved lockfile passes. Re-evaluate the overrides with the next Payload update. Test-only role/identity fixtures are blocked from application/package imports and are absent from exposed host routes. Keep versions pinned and update them through a tested PR.
