# P1-PR-020 validation evidence

**October 25, 2026 · S3 implementation for review.** Baseline: approved PR #19 merge `2bacfc78c60a86e6d49eed372ccd5c6b6fd7b714`. See the [service contract](../../P1-PR-020-contact-consent.md). Specialist review and licensed adapters remain pending under the owner's instruction; this independent contact/consent card does not close those gates.

## TDD and behavioral evidence

The initial address/browser-policy test failed because its implementation module did not exist. Green unit tests cover conservative normalization, restrictive defaults/GPC, purpose-separated cryptography and retained-key rotation. Real restricted-role PostgreSQL use cases cover report-only/offers-only/both flows, forged and wrong-audience proofs, independent notices/events, expiry, duplicate commands, changed-body conflicts, withdrawal/confirmation races, resubscription boundaries, tombstones, decryption rechecks, rollback, CMP revision races and denied catalog access. A complete report exists before requesting contact, proving that this layer does not gate assessment on email.

The initial database run rejected a duplicate existing trigger name. The additive migration was corrected before model generation and successful database tests. A separate real PostgreSQL FR-DEL-07 regression then failed because a raw address request reset confirmed preferences. The correction records a separate pending grant with an immutable HMAC of the existing permission event; only a valid inbox proof against that unchanged event can update the projection. The same test also proves that withdrawal invalidates the new proof. No failed privacy or authorization test is skipped. Workflow envelope tests use an explicit ciphertext substitute; the existing local Moto/KMS envelope proofs are retained, and hosted key custody remains unproved. No email network call or real message is authorized by these tests.

## Verification status

Full exact-commit verification and retained local-environment migration results will be recorded before review. Documentation inventory, original requirement rows, dependencies and historical approval records are checked independently.

## Acceptance limits

This is a headless S3 service boundary. Public HTTP schemas/CSRF/signed request signals and RFC 8058 transport, browser CMP integration, current notice review, provider webhook verification, rendering/final dispatch, frequency caps, physical retention/erasure jobs and hosted deployment acceptance remain at their planned cards. Internal worker methods are not public API operations. A production sender, paid providers and ad systems are not activated. The remaining specialist/source gates and all prior safety/consent expectations remain unchanged.
