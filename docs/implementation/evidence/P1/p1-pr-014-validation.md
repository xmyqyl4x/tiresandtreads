# P1-PR-014 validation evidence

**October 25, 2026 America/Los_Angeles · local verification accepted by the owner; PR #14 merged at `969235fe712ea4989602c8908bc63ad9ca9bcf7a`. Hosted DD03/DD05 provider acceptance remains pending.** Baseline: approved PR #13 merge `b3286d023dff392e23099377220a359b3d4337f2`. See the [implementation packet](../../P1-PR-014-jobs-assets-runtime.md).

## TDD and recovery cases

Inbox cases also cover receipt/job/outbox atomicity, duplicate/conflicting receipt hashes, rollback of processing state, orphan scheduling, legacy quarantine, terminal receipt no-op, incompatible/missing resources, a composite job/receipt FK and indexed recovery against 5,000 scheduled receipts. Runtime callbacks exercise the same inbox consumer.

Regression tests cover mandatory current authorization on command replay, atomic concurrent command replay/body conflicts, abandoned pending commands, job registration conflicts, successful completion/replay, rollback of SQL effects, expired/late worker fences, retry exhaustion/deadlines/legacy jobs, stable outbox event IDs after uncertain receipt and quarantined failures. Actual PostgreSQL roles enforce transaction ownership and grants.

Provider tests use a digest-pinned Moto 5.2.0 S3/KMS server and Inngest Dev Server 1.49.0 on an internal network with dummy credentials. They exercise real SDK uploads and encryption/version metadata, ambiguous PUT adoption, current-grant and mid-read revocation checks, complete version deletion, late-upload tombstone reconciliation, small/60,000-byte context-bound encrypted fields and tamper rejection, separate public configuration storage, actual workflow callback/replay, the bundled Linux worker's SIGTERM, queue refusal and successful/forced pool drain.

The first integration run exposed an admission-count defect and an insufficient ambiguous-PUT verification path; regression fixes count active plus waiting checkouts and verify existing version bytes. The internal callback body guard also needed to preserve the SDK's stream reader; it now counts emitted bytes without starting flowing mode. Failed test scaffolding for expired leases was corrected to create a valid expired SQL lease rather than violating its structural check. These failures were retained in ignored local logs; no secret or raw provider exception is committed as evidence.

## Final verification

`pnpm verify:push` passed on implementation commit `4ed37e20ce7658f8b128f15d56341065a0fd0aba`, including the required authorization-on-replay and inbox recovery additions. Main project `tt-test-cf9445ecccc46061` and separate recovery project `tt-test-2e167a18ee49c3dd` were removed, including provider fixtures and disposable volumes. The [redacted verification record](p1-pr-014-verification.json) retains source/image hashes, counts, indexed inbox evidence, lifecycle and recovery timings.

| Check | Observed result |
| --- | --- |
| Unit/use-case | 122 passed |
| Database/provider | 83 passed, including 11 durability and seven runtime/provider cases |
| Foundation/schema/recovery | Six / 63 / 11 passed |
| Total | **285 passing tests** |
| Coverage | 96.66% lines, 92.08% statements, 97.89% functions, 87.16% branches; existing thresholds unchanged |
| SQL/model parity | 16 app/two CMS migration checksums; 123 app tables, 39 app views, 1,577 app columns and 28 CMS tables |
| Inbox recovery | A 5,000-scheduled-receipt backlog excludes queued work through the recovery index; at most eight candidate rows and four returned; compound receipt/job binding and immutable assignment enforced |
| Provider contracts | Actual Inngest callback, inbox processing and reconciliation plus Moto S3/KMS SDK requests pass; no external cloud activation |
| Worker packaging/lifecycle | Bundled worker imports in the actual runner without workspace dependencies and rejects hosted fixture configuration; valid bundled Linux worker exits zero on SIGTERM; bounded checkout overflow, successful query drain and forced cleanup pass |
| Full gates | Frozen install/advisory audit, quality, seven deliberate failure gates, health-only web HTTP/restart and separate backup/restore/deletion replay pass |
| Dev/stage | Additive 0015/0016 applied without rewriting history; replay no-op, 16 app/two CMS with zero pending; credentials unchanged and volumes retained after stop |
| Documentation | 119 cards, 137 original FR rows, dependency edges, source archives and historical approval sections preserved |

A final SDK wire-format regression additionally preserves frozen resource version/revision separately from the event schema version, including a revision beyond JavaScript safe integer range. This adds one unit case (286 total); the JSON/table above identify the complete 285-case source snapshot, while the final PR records the verified wire-fix commit and its 286-case result.

The evidence commit repeats full exact-commit verification before push. [PR #14](https://github.com/xmyqyl4x/tiresandtreads/pull/14) records its final tested SHA and independent GitHub CI. Local technical verification and owner review are accepted in merged PR #14; the original DD03/DD05 hosted adapter acceptance remains pending. Synthetic timings do not establish production capacity, physical erasure timing or hosted RTO/RPO.

## Scope limits

The [original DD03/DD05 register](../../P1-PR-003-local-foundation.md) remains open and blocking for full 014 adapter acceptance/cloud activation. Moto does not prove IAM, managed KMS security or cloud storage durability; a local Inngest callback does not prove real signing, cancellation, network/TLS or deployment compatibility. S3 bearer URLs are not issued; future signed-URL behavior needs explicit review. Product email/consent/privacy/source workflows and APIs/UI retain their assigned cards. Native PostgreSQL and unrelated Docker projects are untouched; disposable resources are removed only by their exact owned project.
