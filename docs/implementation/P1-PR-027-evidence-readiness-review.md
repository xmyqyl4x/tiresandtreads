# Local evidence reconciliation and readiness reporting

This is the second local continuation authorized after PR66. It builds on PR67's held acceptance-input review and its image/non-file fixes. The exact accepted parent source and merge are recorded in the baseline and publication record after verification. This command reviews a checked-out repository; it does not rerun historical fixtures, inspect live infrastructure, accept actual decisions or close a design case/gate.

HS01–HS08 remain proposed; operators/coverage/rates unconfirmed; six actual S3 gates pending with empty records; specialist/licensed pending; APIs/frontends held. No hosted provisioning, purchases or actual recipient notifications. Four usable delivery phases, PostgreSQL consolidation, option C and database → repositories → services → APIs → frontends remain unchanged.

[Parent input review](P1-PR-027-acceptance-input-review.md), [gate disposition](P1-PR-027-s3-gate-review.md), [reviewed baseline](evidence/P1/p1-pr-027-evidence-review-baseline.json), [local receipt](evidence/P1/p1-pr-027-evidence-readiness-local.json), [validation](evidence/P1/p1-pr-027-evidence-readiness-validation.md).

## Command and interpretation

Run `node scripts/review/evidence-readiness.mjs`. Successful local reconciliation emits deterministic masked JSON and exits 0. `--require-inputs` emits that same consistent-but-pending report and exits 2. It never returns actual acceptance. Digest drift or unreadable registered evidence emits safe issue codes and repository paths, marks the report drifted and exits 1. Malformed manifests/configuration, exceeded global bounds or unsupported arguments produce a generic refusal, no partial success report and exit 1.

The command accepts no arbitrary root, expected catalog, target, provider URL, credentials, SQL, output destination, acceptance operation or callbacks. It locates its own checkout, performs local reads only and writes no files. It outputs no file contents, submitted identity, alert destination, provider recommendation, price or credential. It has no deployment, repair, approval, notification or runtime admission path.

Its scope is 180 historical/current source expectations, 160 frozen historical evidence files, four current input snapshots, 23 overlapping SP08 receipt digests and 264 registered local-evidence paths. Counts overlap; they are neither unique test coverage nor acceptance percentages. The current tool and baseline trust the reviewed Git checkout. They do not independently authenticate themselves, a live environment, an operator, a journal current head or a provider. Unpinned repository files are outside the digest claim; registered unpinned references receive a safe existence/readability check, not an invented historical digest.

## Reconciliation contract

Four fixed manifest anchors bind populated preservation, dependency maintenance, acceptance-input review and the SP08 handoff index. Their raw byte hashes must match the reviewed baseline before interpretation. The older source catalog includes the separately documented prior `.gitattributes` pin, so all four dependency-maintenance exceptions are accounted for. The next source stage consumes PR67's one explicit Docker build exception. A prior expectation cannot disappear or change merely because a newer record exists: exact old/new digests and a nonempty reason must consume an explicit exception. Missing, duplicate, conflicting, incorrect or unused exceptions refuse.

The two new exceptions apply only to the shared local review reader and its declaration. The reader exposes bounded raw bytes for exact SHA-256 comparison, supports the registered versioned `@` patch filename, and reuses its existing UTF-8 path/file-descriptor checks. Existing string/JSON behavior remains compatible. A UTF-8 BOM is included in byte digests even though normal text decoding removes it. Allocation follows the observed file size, with an additional byte to refuse observed growth. Pre-open regular-file refusal and the post-open descriptor check remain; previously approved database/fixture/production readers do not change.

Five prior exceptions and two local reader extensions are reported separately. The published dependency overrides/local patch, frozen install, audit settings and remaining upstream low warning stay unchanged. No source or historical evidence is silently rebased. The parent S3 register and staging decision JSON remain byte-for-byte unchanged, preserving their four pinned current-input snapshots. New documentation is discoverable through development/task notes; this developer report is not inserted as an actual gate record.

## Bounded file observations and uncertainty

Verification admits at most 512 distinct files, 16MiB aggregate successful verification bytes and 2MB per file; manifest/JSON reads use the shared 512KiB bound. Exact case, safe relative paths, symlink/junction and non-file refusals remain. Duplicate expected pins and conflicting groups refuse; overlapping references are read once in the verification pass. Oversized/unreadable files do not become matching prefixes. These are synchronous local repository observations, not a hostile mutable-filesystem authentication or an atomic multi-file snapshot guarantee.

After clean byte checks, the report includes PR67's 51 missing input groups and six pending gates. It explicitly preserves the two historical I/O admission receipts whose cleanup was unknown and fresh attempts blocked (`end-hang` and `inspection-loss`). Later physical project cleanup does not turn those original admission receipts clean. They remain historical observations, not freshly executed transport/database results. `fixtureExecutions` stays zero and acceptance/activation/authority flags remain false.

## Validation and completed scope

The test-first change covers reviewed hash transitions, dropped/duplicate/conflicting pins, missing or unused exceptions, real manifest shapes, source path substitution, raw BOM bytes, actual content drift, junction and missing-file refusal, individual/aggregate read limits, deterministic output, strict pending status, masked argument refusal and unchanged repository input bytes. A temporary hash-guard-removal mutant must fail the real content-drift test; exact source is restored before the passing run. Windows exercises its native junction/directory controls; Linux full regression also reruns the inherited actual FIFO control. Targeted and full counts overlap and negative failures are not passing coverage.

- [x] Implement exact reviewed source/exception reconciliation and fixed manifest anchoring.
- [x] Reuse bounded byte-level reads and report safe drift without altering evidence.
- [x] Combine current held inputs with historical uncertainty without accepting either.
- [x] Cover model, actual filesystem, process and no-write behavior with regression controls.

The local receipt records actual focused counts, source hashes, preservation checks and the observed report after completion. Publication requires the normal exact-commit full build/regression, all eight independent CI jobs, actual review and checkout-tree verification. Actual completed results belong in the PR; the documentation does not predeclare checks as passed. No production bootstrap/CLI/preflight, application/database code, dependency/runtime pin, permission or deployment policy changes occur in this continuation. All original design matrices, parent boxes and acceptance gates remain open as before.

Further product progress requires the still-held actual hosting/operator/provider/specialist/license/privacy inputs when the owner elects to address them. Consistent local evidence does not supply those inputs or release APIs/frontends.
