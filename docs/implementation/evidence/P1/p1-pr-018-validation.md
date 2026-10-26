# P1-PR-018 validation evidence

**October 25, 2026 · technical implementation for review; specialist/data gates pending.** Baseline: owner-approved PR #17 merge `89a4a098bd80796bff4b293497410118f36e8fcd`. See the [implementation contract](../../P1-PR-018-pricing-comparison.md). The owner explicitly retained specialist review and licensed adapters as pending while authorizing 018. Actual named specialist reviews remain zero; DD01/DD02/DD06/G1 are not satisfied by this packet.

## TDD and behavior evidence

The initial pricing tests failed because the arithmetic module did not exist. The final focused suite passes **110 new tests** across four unit/property files and the pricing application use-case file. Authored synthetic expectations include four $150 tires plus $100 services and $49 tax = $749; the fixture's explicitly modeled 50,000-mile life yields $14.98 per 1,000 miles. No actual retailer, applicable tax rate, approved manufacturer life or forecast is represented.

Quote cases cover per-tire/axle/package bases, partial replacement quantities, over/undercoverage, included/zero/missing services, fixed/percentage tax, explicit taxable fee dependencies, per-line/order rounding, cycles and unknown scope, exact range endpoints, price/source expiration and owner-authorized private quotes without fabricated licenses. Invalid booleans/origins/identities, money overflow/currency, malformed rates, mixed quantities and unknown calculation kinds fail conservatively.

Scenario cases cover five-year and bounded horizons, one/two sets, exact and just-over replacement boundaries, age-related purchases, wheel/swaps/storage/residual assumptions, zero mileage, zero/full winter share, missing evidence and warranty-versus-modeled-life separation. Exact international-mile conversion and rational seasonal allocation avoid premature rounding or double-counted distance. Cost-per-distance bounds enclose exact fractions; financial replacement assumptions never establish a safe-life date.

Seeded properties exercise 100 quote permutations/commercial-sidecar variations, 128 monotone source amounts, exact money beyond JS safe integers, 101 winter shares, frozen inputs and 100 outward-rounding fractions. Comparison tests separately assert fit, climate and price findings, signed interval deltas, incomparable scopes, stable ordering, interval-dominant highlights and the conservative point-only 017 budget bridge. Five application use cases prove one explicit clock, a trusted evidence port, raw-field refusal, denial propagation, scope integrity and redacted failures.

## Full verification

`pnpm verify:push` passed on implementation commit `ecf0a3cd6f09bd43b81d01c0fb426deadedeeb0e` at `2026-10-26T00:43:37.865Z`. The [redacted record](p1-pr-018-verification.json) captures that run. The final documentation/evidence commit is verified again before push; its exact head and independent CI status are recorded in [PR #18](https://github.com/xmyqyl4x/tiresandtreads/pull/18).

| Check | Observed result |
| --- | --- |
| Unit/use-case | 380 passed, including 110 new pricing tests |
| Database/provider | Existing 103 passed; restricted-role, ingestion, source freshness, publication, runtime and repository proofs retained |
| Foundation/schema/recovery | Six / 63 / 11 passed |
| Total | **563 passing tests** |
| Coverage | 95.8% lines, 92.12% statements, 98.14% functions, 88.68% branches; thresholds unchanged |
| Pricing coverage | 100% statements/lines/functions, 97.14% branches |
| Quality/build | Frozen Linux build/advisory audit, source hygiene, formatting, lint, TypeScript, inward/client boundaries, health contract and all migration checksums passed |
| Storage | 123 application tables, 39 views, 1,594 table/view columns; 250 fields/25 fact families; 28 CMS tables; 22 app/two CMS migrations; no schema changes |
| Runtime | Production image stop/restart and bundled worker/import/source CLI startup/refusal passed |
| Failure propagation | Seven deliberate verification failures rejected |
| Recovery | Separate synthetic backup/restore/deletion replay passed, including corrupt restore, stale/missing journal, incomplete deletion and inter-database crash retry |
| Documentation | 119 cards/137 original FR rows/dependency edges/source archives/historical approvals preserved; 51 checked tasks/306 unchecked |

The initial missing-module red test preceded implementation. A preliminary disposable database coverage run passed 477 tests before the final six malformed-input cases; the final run above includes all 110 new cases. The 98-case specialist packet from 017 is unchanged.

Disposable projects `tt-test-28ac20a3dd27e26e` and `tt-test-810100f9ad80f79b` and their fixture volumes were removed by exact identity. The preliminary `tt-test-0118c82e55c18ea9` project was also removed. Retained local dev/stage remain stopped at the accepted schema baseline with volumes retained; native PostgreSQL and unrelated Docker projects remain untouched. Local synthetic recovery does not prove hosted RPO/RTO or provider/object recovery.

## Acceptance limits

No provider selection, paid feed, production source mapping, actual licensed price coverage or specialist review is implied. The 98 draft golden scenarios from 017 remain unchanged with zero actual specialist reviews. Tax context, fee policy and modeled life must be reviewed from permitted actual evidence; source-backed explanations and real model calibration remain open. The 018 card stays **In progress** for that acceptance.

019 must compose repository-backed evidence, private-owner authorization, current source/recall/policy gates and immutable report snapshots. Estimate DTOs are technical results with `issuanceAuthorized: false`; raw client authorization flags cannot establish access. Range math is implemented, but the existing recommendation budget bridge accepts only exact current installed points. Product HTTP/UI, hosted provider proofs and live-phase acceptance remain later gates. No hosted resource or credential is introduced.
