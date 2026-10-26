# P1-PR-021 validation evidence

**October 25, 2026 · S3 implementation for review.** Baseline: approved PR #20 merge `2de57d88b69b7683b9a0ed1831548d2908e06555`. See the [service contract](../../P1-PR-021-content-seo.md). Specialist review and licensed adapters remain pending under the owner's instruction; this independent card does not close those gates.

## TDD and scope

The initial public-policy test failed because its implementation module did not exist. Green unit cases cover public-route exclusion, typed metadata, restrictive previews, redirect chains/loops/pattern intersections, bounded CSV, size decoding, fourteen-item checklists, scorecards and deterministic learning links. Mocked HTTP/SDK cases cover exact search scope, corrupt/oversized/missing responses, provider refusal, IndexNow acknowledgement distinctions, snapshot immutability, cache regression/invalidation/expiry and bounded same-origin crawl observations. These are contract tests, not real property/key verification.

Real app/CMS PostgreSQL fixtures exercise reviewed source capture, separate roles, duplicate/fenced work, role revocation, immutable origin/route binding, out-of-order publication, unpublish/rollback, application commit before lost CMS acknowledgement, public DTO redaction, SQL/S3 publication, aggregate corrections, missing/zero/stale metrics and sanitized crawl findings. The initial run exposed a narrow function-execute grant and a CMS enum-parameter cast, both corrected before acceptance. The pinned Payload migration adapter retains a native connection after destroy; the isolated fixture now runs its operator in a dedicated validated child process, which owns and closes that connection on exit. Production migration/operator behavior is unchanged. The first full schema gate also identified a missing reviewer foreign-key index; additive app migration 0026 corrects it without editing the already-applied 0025 checksum. The restore permission check was updated from the old blanket CMS read denial to verify the new narrow source-read grant while still denying editorial text changes, staff mutations and cross-database connections (existing read-only staff mappings remain available). Failed cases are not skipped or quarantined.

## Verification status

Full exact-commit Linux build/quality/coverage/runtime/recovery results and retained dev/stage migration results will be recorded before review. Independent documentation checks preserve original requirement rows, task IDs/dependencies, source archives and historical approvals.

## Acceptance limits

This is a headless service contract. Actual authenticated CMS/editor workflows, real reviewed articles/checklist/ratings data, product HTTP and rendered SEO/browser acceptance, production queue/CDN propagation under load, scheduled worker/notification activation, actual Search Console property/OAuth/key-file verification and hosted recovery remain at their planned gates. SQL/S3 workflow tests use an explicit in-memory object substitute and SDK transport fixtures; previous local Moto storage proofs remain separate evidence. No live indexing submission, real email, licensed source activation or production release occurs. Existing 98 draft specialist scenarios and zero actual specialist reviews are unchanged; DD01/DD02/DD06/G1 remain pending.
