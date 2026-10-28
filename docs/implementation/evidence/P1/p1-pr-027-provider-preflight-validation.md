# P1-PR-027 — SP03 local provider preflight validation

**October 27, 2026 (Pacific) · Local technical evidence only.** Baseline: owner-approved merged PR #34, `1f1db23641a1f5297e8812e8a43eaedee0989d7e`. [Implementation contract](../../P1-PR-027-local-provider-preflight.md). HS01–HS08 remain proposed; all six actual S3 gates pending, specialist/licensed work pending and APIs/frontends held. No provisioning, purchases, cloud authentication or actual provider effects are authorized.

## TDD and focused results

The initial unit run failed because the provider configuration module did not exist. After implementation, the signed SDK tests failed on the Web API adapter's missing Host header; the fixed in-process origin is now supplied explicitly. The first integration run failed strict KMS metadata checks and fixture enable/disable controls. Inspecting the pinned emulator offline showed that setup needed explicit encryption usage/specification and bare UUIDs for those fixture-only controls. Setup was corrected; no inspector state/type/ARN check was removed or relaxed.

`pnpm verify:provider-preflight` then passed **41 tests in three files**: 26 configuration/mail/signature cases, seven transport/metadata/deadline/cleanup cases and eight actual local fixture integration cases. The `tt-test-a8d72380965023aa` project used the existing pinned Linux Node 24.22.1 / pnpm 11.25.0 / Moto 5.2.0 / Inngest SDK 4.26.0 and dev-server image. Tests started at 01:17:24 UTC October 28 (October 27 Pacific), completed in 4.96 seconds excluding image/startup time, and the project/volumes were removed. Host TypeScript validation also passed.

The final revision additionally makes raw post-inspection drift assertions explicit and asserts zero global fetches during offline signature verification. A further test first demonstrated that the SDK accepted an unrelated inherited fallback signing key; explicitly setting both primary and fallback to the same synthetic key closes that local authority gap. The final full gate must cover these assertions; the earlier focused result is not relabeled as final-commit evidence.

| Boundary | Evidence and scope |
| --- | --- |
| Configuration | Exact disposable environment, fixed internal endpoints/account/region, per-project resources and no-send; foreign/hosted/implicit/insecure/unknown inputs refuse before I/O |
| Inspector | Real Moto metadata, versioning/encryption/access drift, disabled key, correct/wrong context/plaintext and exact-version bytes; only fixed read commands/owner parameters, no repair, unchanged versions |
| Simulated adverse transport | Wrong returned account/region/key/object metadata; uncertain/denied request; five-second deadline even when cancellation is ignored; abort, close, plaintext clearing and masked results |
| Workflow | Real dev-server health check, unavailable transport refusal and redirect-error request option; actual pinned SDK verifies synthetic signatures offline, including dev-environment override refusal; no function, listener, sync or event send |
| Mail and activation | No-send fixture port always rejects; unsupported modes refused; fixed false hosted/external-effects flags; actual mail/ESP acceptance absent |

No real secret, raw provider error, ciphertext, object payload or retained file is published by probe reports. Synthetic fixture setup/fault injection performs local writes separately from the read-only preflight. Wrong returned metadata tests are simulations, not actual AWS IAM denials. Actual selected-provider authority, callback network/signing, external-effect reconciliation and independent custody remain unproved.

## Final committed gate and preservation

Commit the complete revision, require a clean worktree, and run `node scripts/verify/push.mjs` before push. Its private stamp binds the exact SHA/tree/lockfile to the complete Linux gate. Record measured totals/coverage and independent final-head CI in the PR body/checks; do not reuse an older stamp or edit immutable historical receipts to imply newer evidence.

The gate includes advisory audit, source/format/lint/type/layer/contract/migration/model/S3 checks; combined unit/use-case/database coverage (including all new cases); negative gates; foundation/schema/HTTP/build/lifecycle; isolated database dump/restore and provider crash/restart/deletion proofs. The focused diagnostic is not a substitute for the gate or actual S3 acceptance.

Documentation/authority audit preserves 119 original cards (43/27/25/24), every dependency, 137 FR rows, 75 checked / 282 unchecked tasks, historical approvals/source archives and all 15 readiness receipt digests. The preceding SP01–SP02 receipt remains byte-identical. Only SP progress/local evidence may change; all eight HS rows/authority/selection/cost values and six actual gate records remain unchanged. Bootstrap, migrations/models, retained configuration, existing runtime providers/guards and product contracts are unchanged. All original parent completion boxes remain unchecked.

This receipt does not predeclare successful future CI, actual hosted compatibility, full effective IAM/ACL proof, custody/RPO/RTO/PITR or acceptance/staffing. Final-head results belong to the corresponding PR/checks.
