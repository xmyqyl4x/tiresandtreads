# P1-PR-021 validation evidence

**October 25, 2026 · S3 implementation for review.** Baseline: approved PR #20 merge `2de57d88b69b7683b9a0ed1831548d2908e06555`. See the [service contract](../../P1-PR-021-content-seo.md). Specialist review and licensed adapters remain pending under the owner's instruction; this independent card does not close those gates.

## TDD and scope

The initial public-policy test failed because its implementation module did not exist. Green unit cases cover public-route exclusion, typed metadata, restrictive previews, redirect chains/loops/pattern intersections, bounded CSV, size decoding, fourteen-item checklists, scorecards and deterministic learning links. Mocked HTTP/SDK cases cover exact search scope, corrupt/oversized/missing responses, provider refusal, IndexNow acknowledgement distinctions, snapshot immutability, cache regression/invalidation/expiry and bounded same-origin crawl observations. These are contract tests, not real property/key verification.

Real app/CMS PostgreSQL fixtures exercise reviewed source capture, separate roles, duplicate/fenced work, role revocation, immutable origin/route binding, out-of-order publication, unpublish/rollback, application commit before lost CMS acknowledgement, public DTO redaction, SQL/S3 publication, aggregate corrections, missing/zero/stale metrics and sanitized crawl findings. The initial run exposed a narrow function-execute grant and a CMS enum-parameter cast, both corrected before acceptance. The pinned Payload migration adapter retains a native connection after destroy; the isolated fixture now runs its operator in a dedicated validated child process, which owns and closes that connection on exit. Production migration/operator behavior is unchanged. The first full schema gate also identified a missing reviewer foreign-key index; additive app migration 0026 corrects it without editing the already-applied 0025 checksum. The restore permission check was updated from the old blanket CMS read denial to verify the new narrow source-read grant while still denying editorial text changes, staff mutations and cross-database connections (existing read-only staff mappings remain available). Failed cases are not skipped or quarantined.

## Full verification

`pnpm verify:push` passed on implementation commit `0b6931f9686582be2c0abfea21ce7490f2636293` at `2026-10-26T03:59:01.037Z`. The [redacted machine record](p1-pr-021-verification.json) captures that exact run. The final evidence commit is verified again before push, with its head and independent CI status recorded in [PR #21](https://github.com/xmyqyl4x/tiresandtreads/pull/21).

| Check | Observed result |
| --- | --- |
| Unit/use-case | 530 passed, including 65 new policy, tool, provider and snapshot cases |
| Database/provider | 157 passed, including 17 new migrated app/CMS service cases |
| Foundation/schema/recovery | Six / 63 / 11 passed |
| Total | **767 passing tests**, including 82 new content/SEO/tool tests |
| Coverage | 97.03% lines, 93.85% statements, 98.22% functions, 89.99% branches; thresholds unchanged |
| Quality/build | Frozen Linux production build/advisory audit, source hygiene, formatting, lint, TypeScript, 160-module boundaries, health contract and reviewed migration checksums passed |
| Storage | 127 app tables, 42 views, 1,638 table/view columns, 250 codec fields/25 fact families, 28 CMS tables; 26 app/three CMS migrations; generated Drizzle parity passed |
| Failure propagation | Seven deliberate verification failures rejected |
| Runtime | Production stop/restart, worker/import/source CLI loading and invalid hosted-configuration refusal passed |
| Recovery | Separate synthetic backup/restore/deletion replay passed at 26 app/three CMS, including corrupt restore, stale/missing journal, incomplete deletion and inter-database crash retry |
| Documentation | 119 cards/137 original FR rows/dependency edges/source archives/historical approvals preserved; 60 checked tasks/297 unchecked |

Both retained Docker dev/stage targets passed migrate/status with **26 app/three CMS applied, zero pending**, then were stopped with their volumes retained. No credential or native PostgreSQL changes were made. Local synthetic recovery does not prove hosted RPO/RTO, PITR or external provider/object recovery. Disposable projects `tt-test-207571f6e0d22dc5` and `tt-test-d5e7f2ba07b436df` and their volumes were removed by exact identity; preliminary fixture projects were also removed.

## Acceptance limits

This is a headless service contract. Actual authenticated CMS/editor workflows, real reviewed articles/checklist/ratings data, product HTTP and rendered SEO/browser acceptance, production queue/CDN propagation under load, scheduled worker/notification activation, actual Search Console property/OAuth/key-file verification and hosted recovery remain at their planned gates. SQL/S3 workflow tests use an explicit in-memory object substitute and SDK transport fixtures; previous local Moto storage proofs remain separate evidence. No live indexing submission, real email, licensed source activation or production release occurs. Existing 98 draft specialist scenarios and zero actual specialist reviews are unchanged; DD01/DD02/DD06/G1 remain pending.
