# P1-PR-014 validation evidence

**October 25, 2026 America/Los_Angeles · local verification in progress; owner and hosted provider acceptance pending.** Baseline: approved PR #13 merge `b3286d023dff392e23099377220a359b3d4337f2`. See the [implementation packet](../../P1-PR-014-jobs-assets-runtime.md).

## TDD and recovery cases

Regression tests cover atomic concurrent command replay/body conflicts, abandoned pending commands, job registration conflicts, successful completion/replay, rollback of SQL effects, expired/late worker fences, retry exhaustion/deadlines/legacy jobs, stable outbox event IDs after uncertain receipt and quarantined failures. Actual PostgreSQL roles enforce transaction ownership and grants.

Provider tests use a digest-pinned Moto 5.2.0 S3/KMS server and Inngest Dev Server 1.49.0 on an internal network with dummy credentials. They exercise real SDK uploads and encryption/version metadata, ambiguous PUT adoption, current-grant and mid-read revocation checks, complete version deletion, late-upload tombstone reconciliation, small/60,000-byte context-bound encrypted fields and tamper rejection, separate public configuration storage, actual workflow callback/replay, the bundled Linux worker's SIGTERM, queue refusal and successful/forced pool drain.

The first integration run exposed an admission-count defect and an insufficient ambiguous-PUT verification path; regression fixes count active plus waiting checkouts and verify existing version bytes. The internal callback body guard also needed to preserve the SDK's stream reader; it now counts emitted bytes without starting flowing mode. Failed test scaffolding for expired leases was corrected to create a valid expired SQL lease rather than violating its structural check. These failures were retained in ignored local logs; no secret or raw provider exception is committed as evidence.

## Final verification

Exact-commit Linux verification, retained dev/stage migration status and independent GitHub CI will be recorded after completion. No full hosted adapter acceptance or live product delivery is claimed.

## Scope limits

The [original DD03/DD05 register](../../P1-PR-003-local-foundation.md) remains open and blocking for full 014 adapter acceptance/cloud activation. Moto does not prove IAM, managed KMS security or cloud storage durability; a local Inngest callback does not prove real signing, cancellation, network/TLS or deployment compatibility. S3 bearer URLs are not issued; future signed-URL behavior needs explicit review. Product email/consent/privacy/source workflows and APIs/UI retain their assigned cards. Native PostgreSQL and unrelated Docker projects are untouched; disposable resources are removed only by their exact owned project.
