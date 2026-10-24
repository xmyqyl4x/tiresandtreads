# P1-PR-002 workspace validation

**Prepared October 23, 2026 · owner review pending.** Based on main after approved PR #1, merge `b9e02f07be87422f30f7a5c3c18c57965bd59313`. This record covers bootstrap tooling, not a product release or local S0 acceptance. P1-PR-003 remains the next dependency gate.

## Implemented outcome

The [development guide](../../../development.md) provides portable commands for a pnpm/strict TypeScript workspace, a headless Next.js host, isolated Docker development/staging/test clusters and TDD/CI tooling. Package markers reserve the inward-facing domain, engine, application, database and integration layers without implementing product entities or services. Health responses have a strict generated contract and identify themselves as bootstrap checks; `/` returns 404.

The container runtime is Node 24.22.1 on Debian Linux, PostgreSQL 18.6, pnpm 11.25.0 and the committed frozen lockfile. Windows native quality checks used the available Node 24.19.0 runtime. The workstation's default Node 20 is suitable only for the small Docker orchestration commands. Docker 29.1.3 / Compose 2.40.3 ran the local verification. Images are pinned by digest in the Dockerfile/Compose and [version inventory](../../../../infra/local/versions.json).

## Observed results

| Check | Evidence and result |
| --- | --- |
| Red → green configuration behavior | Nine configuration cases failed against the initial unimplemented configuration reader, then passed after implementation. Explicit local modes, fixture-only execution and redacted error behavior are covered. |
| Unit and use-case suites | 21 passing tests: configuration, strict health contract, named/unexpected HTTP fixtures, independent local plans and target validation. Current coverage is 100% for the two small executable configuration/contract modules; empty future layers are excluded, not counted as implemented. |
| Real database integration | Two passing tests use a newly allocated PostgreSQL cluster, distinct `tt_app`/`tt_cms` databases, UTC, a real duplicate-key rejection and transaction rollback. No native workstation database is used. |
| Functional HTTP | Both health contracts return 200 with no-store/noindex; root returns 404; unsupported POST returns 405. The optimized Linux app passes before and after restart. |
| Failure propagation | The excluded intentional failing test must exit unsuccessfully. Injected domain-to-config, direct client-to-server and indirect client-to-server imports are rejected; only the runner's own temporary probes are removed. |
| Quality | Source hygiene, formatting, ESLint, strict TypeScript, cycle/layer/client boundaries and generated OpenAPI checks passed. |
| Dependency advisory check | `pnpm audit --audit-level high` passed with no known vulnerabilities reported at the time of the local run. This is a point-in-time advisory result, not a security certification. |
| Windows-accessible development and stage | Both `127.0.0.1:3100` and `127.0.0.1:3200` passed the HTTP checks. Both app containers reported Node 24.22.1. Distinct PostgreSQL system identifiers confirmed separate clusters. |
| Staging runtime | Inspected runtime user `node`, read-only root filesystem and zero source mounts. Dev uses its separate source mounts and hot-reload process. |
| Lifecycle and isolation | Disposable test resources were removed on failed and successful runs. Dev/stage were stopped after verification; their two named DB volumes were retained. Native PostgreSQL and unrelated running Docker resources were untouched. |

Container-only tests initially passed while host loopback access failed: Docker's internal network did not provide the required published dev/stage ports. The final configuration uses loopback-published bridge networks for dev/stage and a separate internal, unpublished test overlay. Host smoke tests then passed. Dev/stage bridge networks permit outbound traffic; they are not network sandboxes. No live provider adapter or credential is present.

## Reproduce and bind evidence to source

Run `node scripts/verify/local.mjs` from a checkout with Docker running. It builds from the frozen lockfile, checks advisories, runs quality, unit/use-case coverage, failure probes, real PostgreSQL and HTTP tests, restarts the app, repeats HTTP checks and cleans its disposable resources. Application/tests have an internal network; the separate advisory check uses registry access without database/provider credentials.

After committing, `pnpm verify:push` repeats the suite against a clean tree and writes ignored `.local/verified-commit.json` with the exact source SHA, Git tree, lockfile SHA-256 and built app image ID. The PR records the verified revision and GitHub check result. CI independently runs the same Linux verification from a fresh checkout; a local stamp does not substitute for CI. The repository-local pre-push hook checks that the pushed revision matches the stamp.

Documentation review also checks local links/anchors, all 119 stable PR IDs and dependency edges, the unchanged 137 original FR rows, preserved source archives and historical approval records. New completion checkboxes describe this bootstrap only.

## Remaining acceptance boundaries

Owner approval and merge are pending. This PR has no hosted deployment, product UI, product schema, runtime DB roles, repository behavior, Payload/Clerk integration or live provider adapter. The readiness endpoint does not claim database/provider readiness. Generic fixtures prove the harness, not future provider contracts. Protected hosted environments, registry promotion and live configuration follow DD03/DD04 and their affected cards; the [release scaffold](../../../../infra/release/README.md) records these requirements without a deployment command. Full G0 remains due by P1-PR-031 under the approved decision deferrals.
