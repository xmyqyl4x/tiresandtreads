# P1-PR-027 — HS01/HS02 host and database review validation

**October 28, 2026 (Pacific) · Review analysis, no actual acceptance.** Baseline is owner-approved PR #41, merged at `e37617ca0a0211e719b01d6a5e5d02f6563663b8`. [Review](../../P1-PR-027-host-database-review.md), [machine-readable comparison](p1-pr-027-host-database-review.json), [official sources](p1-pr-027-host-database-sources.json).

## Evidence and method

Public official pages were reviewed without cloud login, provider API queries, account creation, supplier contact/quote requests, purchases, provisioning or recipient notifications. Sixteen source observations record what was read and distinguish public catalog statements from account eligibility, inference, unknowns and actual measurements. No source page, credential, retained dump or provider account information is committed.

Local code inspection covers the 19 app/CMS role names and bootstrap ownership/flags/membership/default-ACL checks, local-only CLI/runtime/recovery guards and pinned PostgreSQL 18.6 image/tools. PostgreSQL's documented automatic role-creator membership conflicts with the unchanged zero-membership replay check for an ordinary non-superuser path. This is a static contract finding, not a failed DigitalOcean/RDS test or proof that every provider-specific alternative is impossible. Advanced-edition name/attribute restrictions and patch/edition lifecycle need confirmation before selection. No role mapping, privilege exemption, alternate runtime factory or new compatibility runner is implemented.

Recompute the unchanged merged budget's managed/self-operated service allocations and reserve-inclusive envelopes. Service difference: 28,410 − 25,440 = **2,970 cents/month**; funding-envelope difference: 34,092 − 30,528 = **3,564 cents/month**. Six additional routine self-operated hours imply illustrative crossover rates of 495 service cents/hour and 594 reserve-inclusive cents/hour; rates and coverage remain unconfirmed. Additional setup effort is eight hours. The $350 recurring/$100 separate temporary proposals and all null approval fields are unchanged. No all-in budget is approved.

Capacity comparisons preserve original proposed hosted 45/62 usable slots, SP06 fixture 68 and SP07 fixture 69 required; SP07's 75 raw − five reserved = 70 usable is local. Catalog 97 available backends for 4 GiB is not a measured hosted capacity/throughput result. Native/retained PostgreSQL is not queried. No capacity claim closes S3-service-host.

## Preservation checks

Only HS01/HS02 proposal text/detail links and one supporting review entry may advance in the staging packet. Preserve its recommendation, historical cost object, original connection budget, authority and actual selection fields; preserve the other six decision objects. Every HS status remains proposed, approved values/approvers null. The new comparison likewise has null selections, names, rates, coverage and actual budget, empty provider/acceptance results and false execution authority.

Append four planning-evidence references to S3-service-host only. All six gates remain pending, records empty, and acceptance/activation/API flags false. Original 119 cards, dependencies, 137 FR rows, 75 checked/282 unchecked tasks, three parent completion boxes, historical approvals/source archives and future S4/S5/S6 boundaries remain intact. All 23 SP08 receipt pins, index/baseline blobs, prior readiness receipts, six preflight receipts and the complete merged operations/budget model/source/validation artifacts remain unchanged. Current narrative/approval records distinguish PR #41 definition approval from actual HS approvals.

Check source-reference resolution, local links/anchors/path case, UTF-8 without BOM/LF, table shape and Git whitespace. This review changes documentation/data only: application, SQL, packages, dependencies/lockfile, local fixtures, workflow definitions, CI, guard and verification implementations are unchanged. Behavior-driven unit tests are not added for prose. Any later compatibility implementation requires meaningful failing and passing unit/functional/use-case/adverse tests before acceptance.

## Committed verification and limits

After preparation checks, commit the full revision, require a clean worktree and run the repository's existing exact-commit `pnpm verify:push` Linux gate. Record the resulting SHA/tree/lockfile-bound local measurements and independent final-head CI in the PR/checks rather than making a self-referential receipt or relabeling PR #41 tests as a fresh run. Preserve high-audit, quality/layer/model/contract/schema/build, coverage, negative API/S3 gates and all recovery/custody/deployment/capacity/observation/provider suites with mandatory disposable cleanup.

`s3:check` must pass; strict `s3:acceptance` must still refuse with exit 2. Verification targets only generated disposable projects, never native PostgreSQL or retained dev/stage data/settings/credentials/keys/journals/provider manifests. All HS01–HS08 remain proposed, six actual S3 gates open, specialist/licensed work pending and APIs/frontends held. No provisioning, purchases or notifications; operator assignments, coverage and rates remain unconfirmed. This review requests no runtime implementation or hosted execution authority.
