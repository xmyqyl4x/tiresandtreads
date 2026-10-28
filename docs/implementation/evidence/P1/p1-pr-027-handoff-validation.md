# P1-PR-027 — SP08 local handoff validation

**October 28, 2026 (Pacific) · Local review evidence only.** Baseline: owner-approved merged PR #39, `9d314d00255b18b6e7d6f873e6f70c9080dfd2e5`. [Handoff contract](../../P1-PR-027-local-evidence-handoff.md). All six actual S3 gates remain open; HS01–HS08 proposed, specialist/licensed work pending and APIs held. No provisioning, purchases or notifications.

## Provenance and finite review scope

Authenticated read-only GitHub observations confirm PRs #33–#39 merged to main, successful independent CI associated with each final head, and full Git head → merge → baseline ancestry. The [index](p1-pr-027-staging-handoff-index.json) records canonical UTC observation/completion times and full SHAs. CI snapshots progress through 1,083 / 1,098 / 1,139 / 1,160 / 1,190 / 1,214 / 1,247 tests, including six provider-process tests each; these totals are not additive. CI checkout may be a synthetic merge revision.

The new historical [PR #39 local receipt](p1-pr-027-staging-baseline-verification.json) is explicitly captured from its matching pre-existing clean-commit stamp/log, not relabeled as a fresh SP08 run or merged-main test. SHA/tree/lockfile, local image ID, final-local 1,247 tests and coverage remain tied to `8f4a8081…`. Safe fields only are exported. Raw logs, credentials, keys, journal bodies, environment files and recipient data are excluded. Local image identity does not establish registry provenance.

The 23 immutable file pins cover the prior readiness index and its 15 receipts, six preceding preflight validation receipts and the newly captured historical receipt. The baseline decision/register blobs are separately hashed at their source commit; current progress references do not rewrite that history. Existing measured receipts, dates and review wording remain byte-identical. Older retained dev/stage measurements remain historical; no new retained-target claim is made.

## Preservation and negative review checks

The handoff's read-only consistency recipe verifies all 23 digests, both historical baseline blobs, final-head CI association and all seven ancestry chains. Review also substitutes an incorrect receipt digest and an unrelated later commit as a claimed historical head: both must refuse. These are isolated in-memory/ignored review inputs, never edits to the checked-in evidence or Git history. Hash/ancestry consistency is not independent signed authenticity, actual acceptance or approval of a provider.

Decision/register comparison permits only SP07's approved local merge status, SP08's local-review status and appended local-evidence references. All eight proposed decisions, null approved values/approvers, provider/region/budget/operator selections, cost proposals and authority fields remain unchanged. All six gates retain pending status and empty records; acceptanceRequested/publicActivation/endpointImplementationAllowed remain false. `s3:check` passes and strict `s3:acceptance` refuses with exit 2.

Documentation checks cover local links/anchors and case, UTF-8/LF, unchanged 119 original cards and dependency edges, 137 original FR rows, 75 checked/282 unchecked tasks, historical approval sections/source archives and three open parent completion boxes. No application/package/SQL/runtime/config/fixture/workflow/dependency/lockfile or executable verification-policy change is included. No new product behavior exists to drive new unit/use-case tests; existing regression gates are retained.

## Final committed verification

Commit the full packet, require a clean worktree and run `pnpm verify:push`. Record its exact SHA/tree/lockfile-bound result and independent final-head CI in the PR body/checks. A working-tree review or the historical PR #39 receipt cannot substitute for this fresh gate. The complete pinned Linux gate retains advisory/source/format/lint/type/layer/contract/migration/model/S3 checks, combined coverage, negative gates, foundation/schema/HTTP/build/lifecycle, recovery/custody/deployment/capacity/observation/provider proofs and mandatory generated-project cleanup. It must preserve all activation holds.

Only generated disposable projects are used by full verification. Native PostgreSQL and retained dev/stage data, settings, credentials, keys, journals and provider manifests are not targets. No cloud authentication, account/resource creation, spending, DNS/remote deployment or recipient notification occurs. The finite handoff remains in review; its merge can accept local reconciliation only, leaving all actual acceptance work pending.
