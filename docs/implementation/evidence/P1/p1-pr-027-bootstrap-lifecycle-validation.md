# P1-PR-027 — bootstrap lifecycle contract validation

**October 29, 2026 (Pacific) · Design review only.** Baseline: owner-approved [PR #43](https://github.com/xmyqyl4x/tiresandtreads/pull/43), merged at `f878e8fd16c6f03796d80f330cde918eaf175d85`. [Review](../../P1-PR-027-bootstrap-lifecycle-contract.md), [planning contract](p1-pr-027-bootstrap-lifecycle-contract.json), [official sources](p1-pr-027-bootstrap-lifecycle-sources.json).

## Review method and scope

Inspect current cluster initialization, bootstrap, exact role definitions, CLI, owner migration runners, local read-only preflight, inventory and recovery/custody code. Distinguish implemented behavior, the accepted 13-case investigation and proposed lifecycle behavior. The current CLI `status` can initialize migration metadata; the migrated preflight is local-only and is not a foundation/recovery inspector. Existing-role bootstrap does not rotate its password. These findings must remain explicit rather than being presented as completed refactors.

Review current official PostgreSQL 18 pages and the two directly relevant public DigitalOcean role/limit pages. Record observations and design inferences separately. No account/API authentication, supplier contact, provider test, quote request, purchase, resource provisioning or actual recipient action. The provider cleanup/rotation/ownership mechanism is unestablished, not asserted available or universally impossible. No price, provider selection, patch or name/privilege policy change is made.

The contract specifies separate authorities, three read-only profiles, serialized lifecycle state/handoffs, cross-DB partial failure, credential custody/rotation, recovery quarantine and future test-first acceptance. All **22 BLC-T01–BLC-T22** scenarios are prospective specifications, not newly executed tests. No tests mirroring documentation are added. Existing code and the existing 1,260-test total remain unchanged; final verification must measure that total, not infer a new pass from PR #43.

## Preservation checks

The staging packet gains only one lifecycle-design reference entry; all eight HS decision objects, prior investigations/reviews, authority, costs, connection budgets, selection/approval fields and other data remain byte-equivalent after parsing. All decisions remain proposed and all actual values/approvers null. S3-service-host gains only four planning-evidence references. All six actual S3 gates remain pending, records empty and acceptance/public-activation/API flags false.

The new contract's assignments, coverage, rates, provider/edition/region, custody locations and actual budget stay null; provider/acceptance records empty and recipient count zero. Only design review authority is true. Source pins bind unchanged code/guards/dependencies/CI to the approved merge; no runtime, migration, role, fixture, package script, dependency, lockfile or verification implementation changes. Existing public research receipts are historical and are not refreshed in place.

Check every new invariant/profile/state/test/source reference, table shape and all new local links/anchors/path case. Preserve 119 original cards/dependency edges, 137 FR rows, 75 checked/282 unchecked tasks and three unchecked P1-PR-027 completion boxes; historical approval sections and source archives remain unchanged. Preserve all 23 SP08 receipt pins, index/baseline blobs and prior evidence files except the two append-only reference registers. Check UTF-8 without BOM/LF and Git whitespace.

## Committed verification

After preparation checks, commit the complete revision, require a clean worktree and run the unchanged exact-commit `pnpm verify:push` Linux gate. Record measured SHA/tree/lockfile-bound outcomes, counts/coverage and independent final-head CI in the PR/checks; avoid a self-referential receipt. Keep the complete audit, quality/layers/contracts/models/S3, coverage, negative gates, build/HTTP/lifecycle, recovery/custody/deployment/capacity/observation/provider suites and mandatory disposable cleanup.

`s3:check` must pass; strict `s3:acceptance` must still refuse with exit 2 and all six gates pending. Verification targets only generated disposable projects, never native PostgreSQL or retained dev/stage settings, credentials, data, keys, journals or provider manifests. No new lifecycle implementation is credited to the existing full suite. All HS01–HS08 proposed; operators/coverage/rates unconfirmed; specialist/licensed work pending and APIs/frontends held. No provisioning, purchases or notifications.
