# P1-PR-015 validation evidence

**October 25, 2026 · local verification owner-approved; PR #15 merged at `5504a4a5b543d474bb031d714513de82170f651f`.** Baseline: PR #14 merge `969235fe712ea4989602c8908bc63ad9ca9bcf7a`. See the [implementation packet](../../P1-PR-015-ingestion-publication-services.md) and [redacted verification record](p1-pr-015-verification.json).

## TDD and functional proof

Initial ingestion tests failed before the service existed. The first real PostgreSQL diff test then exposed a JSON operator-precedence error; correcting it made the immutable-fact diff and dependent publication scenario pass. Subsequent tests cover interrupted 25-row checkpoints, verified resume, duplicate/malformed records, parser truncation, complete empty snapshots, exact counts/checksums/UTF-8/byte limits, critical rejects, lost SQL batches, source identity conflicts, semantic company/brand joins, source rights expiry and current actor authorization. Wide-row use cases exercise byte-bounded batches; materialization groups adjacent kinds while preserving dependency order and exact bigint values.

Eleven new database/functional cases run the actual restricted ingestion/publication roles and shared services. They include the process CLI, dry-run/status/diff/publish paths, atomic expected-head races, publication replay, approved rollback replay, recall-bearing mixed-dataset protection, revoked authorization/rights and license-bounded staging expiry. SQL constraints and the existing 25-family/247-field and 20,000-SKU repository evidence remain in the suite. No live upstream endpoint is contacted.

## Full verification

`pnpm verify:push` passed on implementation commit `942e60023d01ba7f41c64e91688ab77e7882c64f`. The final evidence/documentation commit is checked again before push; its exact head and independent CI status are recorded in [PR #15](https://github.com/xmyqyl4x/tiresandtreads/pull/15).

| Check | Observed result |
| --- | --- |
| Unit/use-case | 136 passed |
| Database/provider | 94 passed, including 11 new ingestion/CLI cases |
| Foundation/schema/recovery | Six / 63 / 11 passed |
| Total | **310 passing tests** |
| Coverage | 96.29% lines, 92.14% statements, 98.13% functions, 88.03% branches; thresholds unchanged |
| Quality | Frozen Linux build, advisory audit, formatting, lint, TypeScript, inward/client boundaries, health contract and 17 app/two CMS migration checksums passed |
| Database inventory | 123 application tables, 39 views, 1,577 columns; 28 separately owned CMS tables; generated models match |
| Lifecycle | Health-only web stop/restart passed; bundled import CLI and worker load in the production runner without workspace dependencies and reject missing/unsafe configuration with redacted errors |
| Failure propagation | Seven deliberate verification failures were rejected |
| Recovery | Separate synthetic backup/restore/deletion-replay drill passed at 17 app/two CMS migrations, including corrupt restore, stale/missing journal, incomplete deletion and inter-database crash retry |
| Retained dev/stage | Both upgraded to 17 app/two CMS, zero pending, replay no-op, credential files unchanged; containers stopped and volumes retained |
| Documentation | 119 cards, 137 original FR rows, dependency edges, source archives and historical approvals preserved; 45 checked tasks/312 unchecked |

Disposable main project `tt-test-90119b8b3e1d8c54` and recovery project `tt-test-5530b29f225cf6a2` were removed by exact project identity, including their fixture volumes. Native PostgreSQL and unrelated Docker projects were untouched.

## Acceptance limits

The owner deferred real provider selection until necessary. This PR accepts normalized synthetic snapshot mechanics for review; it does not establish NHTSA/licensed-provider access, upstream completeness, production coverage or throughput. Those contracts and source-specific fetch/refresh schedules remain 016. Separate audited approval creation/authentication and HTTP/admin adapters remain later cards. Rollback conservatively refuses any changed recall component; independent safety overlays and downstream AI reuse invalidation consumers remain later services. Original DD03/DD05 hosted workflow/storage proofs remain open. No paid resource, product frontend/API or live phase is activated.
