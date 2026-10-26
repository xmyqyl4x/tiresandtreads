# P1-PR-020 validation evidence

**October 25, 2026 · S3 technical implementation approved and merged as PR #20 at `2de57d88`.** Baseline: approved PR #19 merge `2bacfc78c60a86e6d49eed372ccd5c6b6fd7b714`. See the [service contract](../../P1-PR-020-contact-consent.md). Specialist review and licensed adapters remain pending under the owner's instruction; this independent contact/consent card does not close those gates.

## TDD and behavioral evidence

The initial address/browser-policy test failed because its implementation module did not exist. Green unit tests cover conservative normalization, restrictive defaults/GPC, purpose-separated cryptography and retained-key rotation. Real restricted-role PostgreSQL use cases cover report-only/offers-only/both flows, forged and wrong-audience proofs, independent notices/events, expiry, duplicate commands, changed-body conflicts, withdrawal/confirmation races, resubscription boundaries, tombstones, decryption rechecks, rollback, CMP revision races and denied catalog access. A complete report exists before requesting contact, proving that this layer does not gate assessment on email.

The initial database run rejected a duplicate existing trigger name. The additive migration was corrected before model generation and successful database tests. A separate real PostgreSQL FR-DEL-07 regression then failed because a raw address request reset confirmed preferences. The correction records a separate pending grant with an immutable HMAC of the existing permission event; only a valid inbox proof against that unchanged event can update the projection. The same test also proves that withdrawal invalidates the new proof. No failed privacy or authorization test is skipped. Workflow envelope tests use an explicit ciphertext substitute; the existing local Moto/KMS envelope proofs are retained, and hosted key custody remains unproved. No email network call or real message is authorized by these tests.

## Full verification

`pnpm verify:push` passed on implementation commit `eccefcb18db7242e0da3e4e6fcdfd6d473601457` at `2026-10-26T02:51:33.848Z`. The [redacted machine record](p1-pr-020-verification.json) captures that exact run. The final evidence commit is verified again before push, with its head and independent CI status recorded in [PR #20](https://github.com/xmyqyl4x/tiresandtreads/pull/20).

| Check | Observed result |
| --- | --- |
| Unit/use-case | 465 passed, including 18 new contact policy/crypto tests |
| Database/provider | 140 passed, including 23 new contact/consent/transaction/authorization tests |
| Foundation/schema/recovery | Six / 63 / 11 passed |
| Total | **685 passing tests**, including 41 new contact tests |
| Coverage | 96.7% lines, 93.51% statements, 98.12% functions, 89.69% branches; thresholds unchanged |
| Quality/build | Frozen Linux production build/advisory audit, source hygiene, formatting, lint, TypeScript, 149-module boundaries, health contract and reviewed migration checksums passed |
| Storage | 125 app tables, 40 views, 1,613 table/view columns, 250 codec fields/25 fact families, 28 CMS tables; 24 app/two CMS migrations; generated Drizzle parity passed |
| Failure propagation | Seven deliberate verification failures rejected |
| Runtime | Production stop/restart, worker/import/source CLI loading and invalid hosted-configuration refusal passed |
| Recovery | Separate synthetic backup/restore/deletion replay passed at 24 app/two CMS, including corrupt restore, stale/missing journal, incomplete deletion and inter-database crash retry |
| Documentation | 119 cards/137 original FR rows/dependency edges/source archives/historical approvals preserved; 57 checked tasks/300 unchecked |

Both retained Docker dev/stage targets passed migrate/status with **24 app/two CMS applied, zero pending**, then were stopped with their volumes retained. No credential or native PostgreSQL changes were made. Local synthetic recovery does not prove hosted RPO/RTO, PITR or external provider/object recovery. Disposable projects `tt-test-af2546a6106613f1` and `tt-test-3a2a18091b361a3a` and their volumes were removed by exact identity; preliminary fixture projects were also removed.

## Acceptance limits

This is a headless S3 service boundary. Public HTTP schemas/CSRF/signed request signals and RFC 8058 transport, browser CMP integration, current notice review, provider webhook verification, rendering/final dispatch, frequency caps, physical retention/erasure jobs and hosted deployment acceptance remain at their planned cards. Internal worker methods are not public API operations. A production sender, paid providers and ad systems are not activated. The remaining specialist/source gates and all prior safety/consent expectations remain unchanged.
