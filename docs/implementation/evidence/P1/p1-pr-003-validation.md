# P1-PR-003 validation evidence

**October 23, 2026 America/Los_Angeles (October 24 UTC) · local S0 owner-approved and merged in PR #3 at `ebcf9361a495547f9d9445d89f64131cf0ebef68`.** Baseline: accepted PR #2 merge `dd1817fa826b38e1bc6037be7eba782a869148ab`. Scope and outstanding decisions are in the [local foundation packet](../../P1-PR-003-local-foundation.md).

## Executed evidence

`node scripts/verify/local.mjs` passed on Docker Desktop Linux / Compose 2.40.3 with pinned Node 24.22.1 and PostgreSQL 18.6. The completed integrated run used disposable project `tt-test-3de5563264a2d349`; its local app image ID was `7063701d02778be93c82c6f7f4e9f23ab2ce5bf0328081e7f3d9fc187dc29613`. This is a local content-addressed image ID, not a published registry release digest.

| Check | Observed result |
| --- | --- |
| Unit/use-case suite | 30 tests passed. The new disposable-target guard first failed its valid-target case against an unimplemented function; all nine positive/denial cases then passed. |
| Existing real PostgreSQL harness | Two tests passed for distinct logical databases, UTC, actual constraint errors and rollback. |
| Foundation integration | Six tests passed for cross-database/DDL/escalation denials, direct Drizzle migration rollback, bounded pool/SQL/lock timeouts and recovery, in-flight pool drain, Payload migrations/ownership and actual Local API access behavior. |
| CMS migration | One real generated Payload migration applied through the CMS owner; repeated migrate did no new work. All CMS tables had the CMS migration owner. Runtime could write authorized content but could neither alter schema nor mutate the migration ledger. |
| Access boundary | Anonymous/viewer content access denied; injected test editor allowed with `overrideAccess: false`; password login returned 403; unverified header identity remained unauthenticated; test email adapter refused delivery. |
| Application isolation | `/`, `/admin`, `/api/proof-content` and `/api/proof-staff/login` returned 404. No test-only identity route is mounted. Intentional import of a test fixture from app code fails the new dependency rule. |
| Build/quality | Optimized Next build with Payload plugin, shared-schema preflight bundle, formatting, lint, strict TypeScript, layer/cycle/client boundaries and OpenAPI drift checks passed. Build received no database credentials and ran no migrations. |
| Failure gates | Intentional failed test, forbidden domain import, direct and transitive client imports and app-to-test-fixture import all failed as required. |
| Dependencies | Peer check passes. Advisory gate reports no known vulnerabilities for the resolved lockfile at observation time. Future updates require another check. |
| Container lifecycle | Valid local app became healthy; SIGTERM exit 143, no OOM kill, stop within 10 s. Invalid production+fixture startup exited before serving. HTTP contracts/headers/method denials passed after restart. |
| Windows dev/stage smoke | Rebuilt and started `tt-dev` and optimized `tt-stage` with the updated Payload plugin/startup. HTTP checks passed from Windows on ports 3100/3200, including absent fixture/admin routes. Stopped both projects afterward and preserved their separate data volumes. |
| Cleanup | Disposable DB/app/network/volume and configuration-refusal container were removed. Dev/stage data and native PostgreSQL were not used for the destructive proof fixtures. |

Current 100% measured package coverage is still only the two small configuration/contract modules; the six integration tests do not claim coverage of unimplemented product layers. No UI/browser accessibility or real provider test is claimed by this headless proof.

## Measured local sample

From that integrated run:

| Measurement | Observed | Local proof budget / scope |
| --- | --- | --- |
| Pool checkout exhaustion | 251 ms | Configured 250 ms deadline; timer scheduling adds small overhead |
| Simple read workload | 100 reads, four callers, peak two connections; p95 1.31 ms | Parameterized lookup of one synthetic row; p95 budget <500 ms |
| Next container stop | 682 ms, exit 143 | Idle headless host, <10 s; business-request drain is a later integration obligation |
| App memory / sampled CPU | 50.19 MiB of 768 MiB / 10.70% | One Docker stats sample after tests; not steady-state or peak capacity |
| PostgreSQL memory / sampled CPU | 46.23 MiB of 512 MiB / 3.42% | Disposable synthetic fixture workload; not production sizing |

Pool draining was tested with a checked-out client doing real SQL: shutdown remained pending until the query completed and the client was released, then further checkout failed. Combined HTTP/business transaction drain, network partitions, mixed report/import/analytics load and hosted capacity remain P1-PR-014/031/042 proofs. The public report p95 target remains unchanged.

## Failures found and resolved

1. **Dependency resolution:** Payload's toolchain selected an incompatible Vite esbuild peer. A scoped override selects esbuild 0.28.2. The initial audit also caught vulnerable DOMPurify through Monaco and an old esbuild dev-server advisory through Drizzle tooling. Scoped overrides select DOMPurify 3.4.17 and esbuild 0.25.12, with passing migration/build/peer/audit checks. Re-evaluate these pins on the next Payload update. References: [DOMPurify advisory](https://github.com/advisories/GHSA-cg2g-xh64-v4q7), [esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
2. **Migration generation:** The proof initially lacked its output directory. After creating it, strict TypeScript exposed generated migration types imported as runtime values. The exact fixture import header is normalized to `import type`; real generation, migration and idempotent replay now pass. P1-PR-004 must review/commit that correction in migration source rather than relaxing compiler settings.
3. **Startup rejection:** Next's instrumentation hook logged invalid configuration but left a server process alive with readiness HTTP 500. The optimized image now runs an esbuild bundle of the existing shared configuration validator before dynamically importing Next's server. Invalid startup exits; valid startup, SIGTERM and restart pass. The probe now owns an explicit container ID and removes it in `finally`, including timeout failures.

## Review and acceptance

[PR #3](https://github.com/xmyqyl4x/tiresandtreads/pull/3) records its exact locally verified commit and independent GitHub CI result. `pnpm verify:push` writes ignored source/tree/lock/image evidence and is required again for any final revision. The GitHub checkout repeats the full Linux suite and does not trust the local stamp.

Owner approval and merge accepted **local S0 only**. This permits synthetic S1/S2 implementation under the existing ordering. G0, source rights/coverage, real Clerk/MFA/session behavior, provider credentials, paid hosting/budget, TLS/proxy, off-host recovery, specialist review and live launch remain open at the packet's explicit triggers. Product migrations/roles begin in P1-PR-004; these fixture roles are not production infrastructure.
