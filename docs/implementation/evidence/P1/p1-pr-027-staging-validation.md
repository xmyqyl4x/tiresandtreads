# Private hosted staging packet — validation and evidence boundaries

**October 27, 2026 · Planning evidence only; full S3 OPEN; APIs HELD.** [Packet](../../P1-PR-027-private-hosted-staging-decision.md), [decisions/cost model](p1-pr-027-staging-decision.json), [source index](p1-pr-027-staging-sources.json). Baseline is merged PR #32, `7f2476e62864a671d437f932d8879f57d2de129d`.

This continuation changes documentation/evidence only. It adds no cloud resource, infrastructure executable, schema, role, dependency, runtime adapter, API or frontend. No cloud account was inspected or authenticated. Existing credentials, local retained state and native PostgreSQL are unchanged. Public vendor documentation is the source of catalog facts; proposed sizes, ancillary cost allowances and operational choices are explicitly unapproved.

## Packet checks

- Resolve local links and anchors with exact path case; require UTF-8 without BOM and LF.
- Preserve all 119 cards (43/27/25/24), dependency edges, 137 original FR rows, 75 checked/282 unchecked tasks, historical approval sections, source archives and all 15 receipts indexed by the accepted local readiness packet.
- Require all eight HS decisions to be proposed with null approval values/reviewers; actual provider/region/DB/budget/operator selections remain null. Provisioning, purchases, account creation/authentication, DNS, deployment, notifications and product API authority remain false.
- Recalculate all three scenarios from their line items with 20% contingency: $131.88 / $161.88 / $250.68; first two fit the proposed $175 ceiling, high does not. Unquoted labor/tax/licenses and temporary resources remain explicit unknowns.
- Recalculate full physical budget: 16+1 owned, five+three external, reserve 20 = 45 usable slots; two hosts require 62. Provider-reserved capacity is separate. The historical local 42/100 and harness 65/100 are unchanged.
- Check all 13 source references are official DigitalOcean/AWS URLs; no account-specific checkout or supplier quote is claimed. Exact catalog patch, stock and managed-role compatibility remain untested. Public source access date is October 27, 2026.
- Verify SP01–SP03 findings against actual source: local-only URL/origin/runtime guards, no explicit hosted CA input in the pool factory, fixture service composition and strict bootstrap ownership/membership rules. No guard is loosened here.
- Compare the S3 register with the baseline: only planning paths under `S3-service-host.localEvidence` may be added. All six statuses stay pending, accepted-record lists empty and activation/acceptance flags false.

`node scripts/verify/s3.mjs` must pass inventory validation and report acceptance false. `node scripts/verify/s3.mjs --require-accepted` must exit **2** with the same six pending gates, 98 draft golden cases and zero actual specialist reviews. The original P1-PR-027 completion boxes and P1-PR-028–030 blocks remain intact.

This documentation-only change requires no new behavior tests. The repository's mandatory exact-commit `node scripts/verify/push.mjs` still runs the full Linux build/audit/quality/test/lifecycle/database-restore/provider-recovery gate before push. Its stamp identifies the exact clean commit; the review PR and independent GitHub checks identify the pushed head and actual results. Those checks validate the repository; they do not run or accept hosted infrastructure. Historical measured receipts retain their original SHAs and are not relabeled as this planning revision.

Review/merge of the packet accepts its planning scope only. Provider selection, budget and operator/policy decisions need explicit recorded values. Any later provisioning/purchase requires separate authorization of a concrete scoped change; no free tier or provider signup is implicitly allowed. Specialist/licensed deferrals and the API hold persist.

Preparation audit passed: all eight decisions and eight future proof items remain proposed/unstarted, 13 official-source references resolve to the researched vendor domains, all three cost scenarios and both connection budgets recalculate, and all 15 historical receipt digests match. The documentation audit preserves the original cards/edges/FR rows/task counts/approvals/source archives and verifies local paths/anchors and UTF-8/LF. `s3:check` passes; strict acceptance correctly exits 2. The final committed head's full Linux verification and independent CI are recorded with the review PR rather than inventing a hosted verification receipt.
