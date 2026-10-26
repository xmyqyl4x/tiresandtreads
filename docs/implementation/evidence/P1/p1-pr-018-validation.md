# P1-PR-018 validation evidence

**October 25, 2026 · technical implementation for review; specialist/data gates pending.** Baseline: owner-approved PR #17 merge `89a4a098bd80796bff4b293497410118f36e8fcd`. See the [implementation contract](../../P1-PR-018-pricing-comparison.md). The owner explicitly retained specialist review and licensed adapters as pending while authorizing 018. Actual named specialist reviews remain zero; DD01/DD02/DD06/G1 are not satisfied by this packet.

## TDD and behavior evidence

The initial pricing tests failed because the arithmetic module did not exist. The final focused suite passes **110 new tests** across four unit/property files and the pricing application use-case file. Authored synthetic expectations include four $150 tires plus $100 services and $49 tax = $749; the fixture's explicitly modeled 50,000-mile life yields $14.98 per 1,000 miles. No actual retailer, applicable tax rate, approved manufacturer life or forecast is represented.

Quote cases cover per-tire/axle/package bases, partial replacement quantities, over/undercoverage, included/zero/missing services, fixed/percentage tax, explicit taxable fee dependencies, per-line/order rounding, cycles and unknown scope, exact range endpoints, price/source expiration and owner-authorized private quotes without fabricated licenses. Invalid booleans/origins/identities, money overflow/currency, malformed rates, mixed quantities and unknown calculation kinds fail conservatively.

Scenario cases cover five-year and bounded horizons, one/two sets, exact and just-over replacement boundaries, age-related purchases, wheel/swaps/storage/residual assumptions, zero mileage, zero/full winter share, missing evidence and warranty-versus-modeled-life separation. Exact international-mile conversion and rational seasonal allocation avoid premature rounding or double-counted distance. Cost-per-distance bounds enclose exact fractions; financial replacement assumptions never establish a safe-life date.

Seeded properties exercise 100 quote permutations/commercial-sidecar variations, 128 monotone source amounts, exact money beyond JS safe integers, 101 winter shares, frozen inputs and 100 outward-rounding fractions. Comparison tests separately assert fit, climate and price findings, signed interval deltas, incomparable scopes, stable ordering, interval-dominant highlights and the conservative point-only 017 budget bridge. Five application use cases prove one explicit clock, a trusted evidence port, raw-field refusal, denial propagation, scope integrity and redacted failures.

## Verification status

The first disposable Linux database/provider coverage run passed **477 tests** (374 unit/use-case plus 103 database/provider) before the final six malformed-input cases were added. It reported 100% pricing statements/lines/functions and 97.13% pricing branches. That observation is preliminary, not an exact-final-commit claim. The final 110-test focused run passed afterward. The clean committed implementation will undergo the complete exact-commit Linux build, coverage, runtime, failure-gate and recovery suite before push; the resulting redacted record and final head will be recorded here and in PR #18.

No schema, migration, storage codec, grants, dependency or runtime-provider configuration changed. Baseline remains 123 app tables, 39 views, 1,594 table/view columns, 250 codec fields/25 fact families, 28 CMS tables and 22 app/two CMS migrations. Documentation preserves all 119 cards, original 137 FR rows, dependency edges, source archives and historical approvals; 51 technical tasks are checked and 306 remain unchecked. The full 016/017/018 cards stay in progress for their recorded external acceptance gates.

The disposable first-run project `tt-test-0118c82e55c18ea9` and its fixture volume were removed. Retained local dev/stage remain stopped at the accepted schema baseline with volumes retained; native PostgreSQL and unrelated Docker projects remain untouched.

## Acceptance limits

No provider selection, paid feed, production source mapping, actual licensed price coverage or specialist review is implied. The 98 draft golden scenarios from 017 remain unchanged with zero actual specialist reviews. Tax context, fee policy and modeled life must be reviewed from permitted actual evidence; source-backed explanations and real model calibration remain open. The 018 card stays **In progress** for that acceptance.

019 must compose repository-backed evidence, private-owner authorization, current source/recall/policy gates and immutable report snapshots. Estimate DTOs are technical results with `issuanceAuthorized: false`; raw client authorization flags cannot establish access. Range math is implemented, but the existing recommendation budget bridge accepts only exact current installed points. Product HTTP/UI, hosted provider proofs and live-phase acceptance remain later gates. No hosted resource or credential is introduced.
