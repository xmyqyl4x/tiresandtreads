# P1-PR-016 validation evidence

**October 25, 2026 · NHTSA/shared implementation verified for review; full card in progress.** Baseline: owner-approved PR #15 merge `5504a4a5b543d474bb031d714513de82170f651f`. The owner explicitly directed: **keep licensed adapters pending; proceed with NHTSA and shared infrastructure**. See the [implementation packet](../../P1-PR-016-domain-source-adapters.md), [redacted verification record](p1-pr-016-verification.json) and [read-only source observations](p1-pr-016-source-probes.json).

## TDD and functional proof

The initial source-refresh test failed before the service existed. Subsequent real PostgreSQL tests exposed an overly broad audit SELECT grant; additive migration 0020 narrows it to the verification columns. A live, read-only recall probe exposed missing historical narratives and the distinction between report receipt and announcement dates; additive migrations 0019/0021 retain those unknowns explicitly. Migration 0022 prevents identity changes through the column capability needed for row locks. The first full run also caught an intermittent health constraint failure: separate clock reads could put success after attempt. Successful completion now records one stable statement timestamp, with a database assertion covering that invariant. All earlier migration bytes remain unchanged.

Seventeen new unit/use-case cases exercise exact source scopes without invented fitment, strict dates/counts/advisories, duplicate/conflicting tire records, unknown product types, ZIP entry/path/symlink/ratio/size/CRC/framing checks, HTTP byte/time/redirect/conditional/retry boundaries, manufacturer pagination reconciliation, dictionary drift, both recall archives, mixed 304 responses, unchanged full checks, cleanup and safe unexpected failures. The read-only compatibility driver is also tested.

Nine new database/functional cases run real restricted roles and process commands. They prove separate source approval and current rights, inability to mutate protected registry/audit/identity fields, complete validation and explicit publication, no-change receipts without fact rewrites, failed/stale checks preserving previous warnings, a weekly full-check deadline, concurrent and expired leases, late-worker fencing, revoked rights before HTTP with durable backoff, crash/retry between validation and health completion, bounded due selection and exact published recall readiness. Synthetic HTTP/ZIP fixtures isolate the full suite from public endpoints. Existing 25-family/250-field and 20,000-SKU repository evidence remains in the suite.

## Full verification

`pnpm verify:push` passed on implementation commit `b41ee3e8a00d52527f42c15322c2e9add1d60b74`. The final evidence/documentation commit is checked again before push; its exact head and independent CI status are recorded in [PR #16](https://github.com/xmyqyl4x/tiresandtreads/pull/16).

| Check | Observed result |
| --- | --- |
| Unit/use-case | 153 passed |
| Database/provider | 103 passed, including nine new source/CLI cases |
| Foundation/schema/recovery | Six / 63 / 11 passed |
| Total | **336 passing tests** |
| Coverage | 94.85% lines, 90.31% statements, 97.6% functions, 85.2% branches; thresholds unchanged |
| Quality | Frozen Linux build, advisory audit, formatting, lint, TypeScript, inward/client boundaries, health contract and 22 app/two CMS migration checksums passed |
| Database inventory | 123 application tables, 39 views, 1,594 table/view columns; 28 separately owned CMS tables; generated models match |
| Lifecycle | Health-only web stop/restart and independent production worker/import/source bundle startup passed; source CLI safely refused missing configuration |
| Failure propagation | Seven deliberate verification failures were rejected |
| Recovery | Separate synthetic backup/restore/deletion-replay drill passed at 22 app/two CMS migrations, including corrupt restore, stale/missing journal, incomplete deletion and inter-database crash retry |
| Retained dev/stage | Both upgraded to 22 app/two CMS, zero pending, replay no-op, credential files unchanged; containers stopped and volumes retained |
| Documentation | 119 cards, 137 original FR rows, dependency edges, source archives and historical approvals preserved; 46 checked tasks/311 unchecked |

Disposable main project `tt-test-b4f54bbead8ce157` and recovery project `tt-test-86df3c6f38ab7fc2` were removed by exact project identity, including their fixture volumes. Native PostgreSQL and unrelated Docker projects were untouched.

## Read-only source compatibility

Official vPIC model/manufacturer-page/equipment-plant responses, the dictionary and both PRE/POST recall archives were inspected with bounded GET requests. The implemented no-database probe parsed the complete two-archive tire scope: **788 campaigns and 22,307 unresolved source targets**, producing 23,095 facts / 17,934,902 normalized bytes with a maximum row of 3,044 bytes. Missing narratives affected 131 campaigns. Hashes, exact scopes, observation times and bounds are in the source evidence. The manufacturer page observation does not establish whole-source pagination or coverage. No source/provider/license/approval was registered, no real data was imported/published and no rights or production completeness acceptance follows from these observations. Windows trust-store support was enabled for the process; TLS verification stayed enabled.

## Acceptance limits

Licensed catalog/fitment/pricing/climate adapters remain pending under DD01/DD02 by owner direction. Per-source rights/retention/channel review, actual licensed field/unit contracts, production coverage fixtures and reviewed cross-source links remain open. P1-PR-016 therefore stays **In progress**, with this PR presenting its authorized NHTSA/shared implementation for review.

The recall-readiness service is a freshness input for the later report issuance service; that service must call it and perform its own pinned-bundle/safety checks. The cron file is a single-host template, not a hosted activation. Operational notification delivery and original DD03/DD05 hosted workflow/storage proofs remain pending. No paid provider, product UI/API or live phase was activated. Four live phases, database-first construction and app plus PostgreSQL outside Vercel are unchanged.
