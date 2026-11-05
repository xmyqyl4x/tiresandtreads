# P1-PR-042 — Local security, capacity and recovery evidence

The permitted local slice adds one bounded mixed workload across report/analytics/import/limit/advertising services, hostile permission and leak controls, a concurrent real SQL quota check and a two-process public-cache propagation proof. It changes disposable test support and documentation only; production runtime, bootstrap/CLI/preflight, admission policy, schema, dependencies and all original case/gate states remain unchanged.

## Added executable proofs

`tests/database/product-mixed-load.test.ts` composes the existing synthetic report resolver with actual report business services/HTTP/PostgreSQL, consented local analytics collection, registered import files, SQL quota and held advertising reads. Eighteen operations execute in waves of four. Every result is checked; report/event rows are counted and import status read back. Measured p95/p99, elapsed time and RSS are emitted with their fixture scope; no approved production SLA is invented. Cross-owner reads, forged CSRF, staff impersonation and arbitrary import paths fail without disclosing private values. Eight competing quota attempts admit only two and refuse six while independent reads remain usable. A separate immutable fixture policy supplies the two-slot bound; no existing policy is edited or disabled.

`tests/database/public-cache-process.test.ts` launches two separate fixed read-only child processes against the existing synthetic public reader and versioned local object fixture. SQL publishes redirect revision 1, both caches warm, then SQL publishes removal revision 2. Both peers retain the old version during the allowed interval and refresh after the existing 30-second real-time TTL. There is no shared-memory invalidation or fake clock. Both children are stopped/joined before owned fixture cleanup. This proves local bounded-age cross-process convergence, not instantaneous invalidation, an external CDN or additional full-host capacity. The two one-connection peers fit the two existing reserved fixture web slots.

The [focused local record](evidence/P1/p1-pr-042-local-proof.json) captures four passing native tests and the hashes of their code. The measured eighteen-operation run took about 245 ms with request p95 about 89 ms; process RSS was a single 141 MB decimal sample. The two peers refreshed after approximately 30.14 seconds including the intentional wait. These are local fixture observations, not production targets. The first focused runs caught missing required analytics fields, a forbidden edit to an immutable quota policy and a redirect expectation missing its normalized mode. The tests now use valid payloads, an independent immutable fixture policy and the full normalized value; no production guard was weakened.

## Full regression and handover mapping

| Requirement | Required regression evidence |
| --- | --- |
| NFR01 performance and SQL budgets | Mixed product workload; existing seven-case SP06 physical lane, overload, mixed consumer, filesystem, drain and bundle proofs; complete visitor JS budget |
| NFR03 reliability | Existing service-host workflow replay, local provider cold restart, deployment readiness/drain/rollback and alert-response suites |
| NFR04 privacy/security | New hostile-request/leak controls; existing RLS/grant matrix, capability/CSRF/staff/callback/upload/link tests, privacy and consent suites |
| NFR05/DB28 integrity/recovery | Full migrations/schema/backup/restore/custody, actual restore-to-read-only handoff profiles, signed deletion replay and immutable payload tests |
| NFR06 freshness/operations | Existing SP07 masked observations, queue alarms, acknowledgment distinctions and failure preservation; cross-process routing TTL proof |
| Operator/support/budget handover | [Local response and pending production handover](../operations/phase-1-local-handover.md); actual assignments, rates, targets and sign-off remain pending |

All required checks are rerun on the exact committed tree and CI merge checkout, followed by post-merge main checks. Historical receipts/pins remain unchanged; new observations supplement them rather than rewriting their original scope. The existing resource/alert/recovery suites are reused rather than creating fake alternative deployment or privacy executors.

## Acceptance boundary

This completes the authorized local technical slice only. Production G2/G4/G5 targets/decisions, six S3 gates, HS01–HS08 proposals, operators/coverage/rates, specialist/licensed/provider/privacy, actual editorial/Search Console, real inbox and PDF/screen-reader, real CMP and live LCP/CLS acceptance remain pending. No hosted provision/purchase, actual notification, production activation or original design-case/gate closure occurs. P1-PR-043 is the next card and remains a held live-release decision.
