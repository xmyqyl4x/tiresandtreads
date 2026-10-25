# P1-PR-014 validation evidence

**October 25, 2026 America/Los_Angeles · local verification passed; owner and hosted provider acceptance pending.** Baseline: approved PR #13 merge `b3286d023dff392e23099377220a359b3d4337f2`. See the [implementation packet](../../P1-PR-014-jobs-assets-runtime.md).

## TDD and recovery cases

Regression tests cover mandatory current authorization on command replay, atomic concurrent command replay/body conflicts, abandoned pending commands, job registration conflicts, successful completion/replay, rollback of SQL effects, expired/late worker fences, retry exhaustion/deadlines/legacy jobs, stable outbox event IDs after uncertain receipt and quarantined failures. Actual PostgreSQL roles enforce transaction ownership and grants.

Provider tests use a digest-pinned Moto 5.2.0 S3/KMS server and Inngest Dev Server 1.49.0 on an internal network with dummy credentials. They exercise real SDK uploads and encryption/version metadata, ambiguous PUT adoption, current-grant and mid-read revocation checks, complete version deletion, late-upload tombstone reconciliation, small/60,000-byte context-bound encrypted fields and tamper rejection, separate public configuration storage, actual workflow callback/replay, the bundled Linux worker's SIGTERM, queue refusal and successful/forced pool drain.

The first integration run exposed an admission-count defect and an insufficient ambiguous-PUT verification path; regression fixes count active plus waiting checkouts and verify existing version bytes. The internal callback body guard also needed to preserve the SDK's stream reader; it now counts emitted bytes without starting flowing mode. Failed test scaffolding for expired leases was corrected to create a valid expired SQL lease rather than violating its structural check. These failures were retained in ignored local logs; no secret or raw provider exception is committed as evidence.

## Final verification

`pnpm verify:push` passed on implementation commit `0f46e022a2af0fd0bf834a6101612d4c65d5e1bd` with pinned Linux containers. Main project `tt-test-941daab4b7397d3b` and separate recovery project `tt-test-0b98cf1dbe039e3f` were removed, including provider fixtures and disposable volumes. [Redacted verification record](p1-pr-014-verification.json) retains hashes, counts, lifecycle and recovery timings.

| Check | Observed result |
| --- | --- |
| Unit/use-case | 121 passed |
| Database/provider | 79 passed, including seven new durability and seven runtime/provider cases |
| Foundation/schema/recovery | Six / 63 / 11 passed |
| Total | **280 passing tests** |
| Coverage | 96.56% lines, 92.05% statements, 97.83% functions, 87.19% branches; existing thresholds unchanged |
| SQL/model parity | 15 app/two CMS migration checksums; 123 app tables, 39 app views, 1,576 app columns and 28 CMS tables |
| Provider contracts | Real Inngest callback/reconciliation and Moto S3/KMS SDK requests pass; no external cloud activation |
| Worker packaging/lifecycle | Bundled worker imports in the actual runner without workspace dependencies and rejects hosted fixture configuration; a valid bundled Linux worker exits zero on SIGTERM; bounded checkout overflow, successful query drain and forced cleanup pass |
| Full gates | Frozen install, advisory audit, quality, seven deliberate failure gates, health-only web HTTP/restart and separate backup/restore/deletion replay pass |
| Dev/stage | Additive 0015 applied, replay no-op, 15 app/two CMS with zero pending, credential files unchanged; stopped with retained volumes |
| Documentation | All 119 cards, 137 original FR rows, dependency edges, source archives and historical approval sections preserved |

The review/evidence commit repeated full exact-commit verification. A subsequent review adds a mandatory transaction-bound authorization callback before command receipt/replay and preserves 201/202 response semantics. One added regression brings the final suite to 281 cases; the final exact-commit run and CI are recorded on the PR before completion. [PR #14](https://github.com/xmyqyl4x/tiresandtreads/pull/14) records the final tested SHA and independent GitHub CI. Local technical verification is complete; owner review and the original DD03/DD05 hosted adapter acceptance remain pending. These synthetic measurements do not establish production capacity, physical erasure timing or hosted RTO/RPO.

## Scope limits

The [original DD03/DD05 register](../../P1-PR-003-local-foundation.md) remains open and blocking for full 014 adapter acceptance/cloud activation. Moto does not prove IAM, managed KMS security or cloud storage durability; a local Inngest callback does not prove real signing, cancellation, network/TLS or deployment compatibility. S3 bearer URLs are not issued; future signed-URL behavior needs explicit review. Product email/consent/privacy/source workflows and APIs/UI retain their assigned cards. Native PostgreSQL and unrelated Docker projects are untouched; disposable resources are removed only by their exact owned project.
