# Restore/journal evidence readiness integration

November 2, 2026 (Pacific). The owner selected readiness integration followed by a remaining-gap review after [PR70](https://github.com/xmyqyl4x/tiresandtreads/pull/70), main `df2be77ab24662ce3c7f0ae30696652c0686b8e2`. This first continuation adds a separate read-only developer report. All original design cases and six S3 gates remain open; HS01–HS08 proposed; operators/coverage/rates unconfirmed; specialist/licensed work pending; APIs/frontends held. No hosted provisioning, purchases or actual recipient notifications.

[Local receipt](evidence/P1/p1-pr-027-restore-readiness-local.json), [reviewed manifest baseline](evidence/P1/p1-pr-027-restore-readiness-baseline.json), [validation](evidence/P1/p1-pr-027-restore-readiness-validation.md). The existing acceptance/evidence reports, source readers and every prior receipt remain byte-for-byte unchanged.

## Run and interpret

Run `node scripts/review/restore-readiness.mjs` from the repository root. A consistent local repository returns exit 0 and `consistent-restore-evidence`. `--require-inputs` returns exit 2 after consistent checks because actual acceptance inputs are still missing. Drift or refused input returns exit 1. No root, output, fixture-run, acceptance, URL or effect arguments are accepted; diagnostics mask supplied values. The command performs no database/provider calls, fixture execution, Git subprocess, CI rerun or repository writes.

The report extends PR68's existing source/history/exception reconciliation with the accepted PR69 contract and PR70 proof. Nine fixed manifest anchors are byte checked before JSON interpretation; two additional proof documents are pinned. It requires exact prior source/history continuity, all seventeen proof source paths, four frozen contract artifacts, unchanged input/SP08 sets and no new exceptions. It validates the recorded sixteen-profile order and outcomes, sixteen cleanup records, phase/replay/end/TLS/refusal facts, parent-derived assertions and false authority/activation/closure flags. Native source, publication source/tree and accepted merge identifiers remain distinct historical metadata. The command does not attest current Git ancestry, independently authenticate records or replay the scenarios.

## Current observed report

The verification pass checks **464 distinct files**, matches **378 expected pins**, reads **4922048 bytes** and reports no drift. The catalog has 206 source pins, including seventeen unchanged restore-proof support files, 163 historical pins, four input snapshots, 23 SP08 digests and 264 existing registered local references. Overlapping pins/references are read once within this verification pass. Historical five dependency/build exceptions and two local-reader exceptions remain explicit; no new exception is introduced.

Historical execution is reported as sixteen native profiles, three pre-restore refusals, thirteen actual synthetic restore/privacy-replay paths and 26 repeated executions of two existing custody tests; none are newly run or newly unique coverage in this command. RH17 remains modeled only. The four rejected write probes are separate from the normal observer's zero mutation dispatches. Parent assertion counts are derived from the fixed successful parent and are not represented as independently exported child receipts. The quarantine CONNECT fault, owned observer loss after a completed read/end and current-view permission loss retain their original limited meanings.

The report preserves 51 missing input groups and both historical unknown I/O admission receipts (`end-hang`, `inspection-loss`). Later physical cleanup never upgrades those receipts. Recorded handoff facts and the input report are withheld on byte drift. All accepted/runtime/hosted/public/independent-authority flags remain false; current fixture/provider/notification/closure counts remain zero.

## Bounds and trust

The initial manifest phase uses the existing 512KiB per-file reader for the new baseline and nine fixed manifests. The subsequent verification pass admits at most 512 distinct files, 2MB per file and 16MiB aggregate successful verification bytes. Later fixed input/history parsing retains the same 512KiB individual bound. These are separate bounded phases, not one cumulative byte budget or an atomic multi-file snapshot. Existing exact-case, path, symlink/junction and non-file refusals are reused unchanged. Review roots supplied to the library are trusted local roots; the CLI always resolves its repository root from its own module location.

The new baseline is reviewed repository data, not an independent trust authority. Byte consistency cannot supply operator/provider approvals, specialist/license/privacy decisions, hosted recovery targets or fencing. Original 18/22/16/20/20 matrices, 119 cards/dependencies, 137 FR rows, core parent boxes and approved historical/source archives remain unchanged. Production bootstrap/CLI/preflight/policy, databases, application layers, dependencies and runtime pins are unchanged. Four usable phases, PostgreSQL consolidation, option C and database-first layering remain.

## Completed local scope

- [x] Add a separate fixed read-only integration without modifying frozen readers/reports.
- [x] Check raw manifest anchors before interpretation and preserve source/history continuity.
- [x] Validate historical restore facts, modeled RH17, overlap and uncertainty without acceptance.
- [x] Cover model, actual file, process and no-write behavior with 43 focused controls.
- [x] Remove the real raw-manifest guard, observe the actual file test fail, restore exact bytes and pass all focused controls.

Initial tests failed on missing modules/CLI. Scoped lint findings were fixed before final checks. The negative run has one expected failure and 42 passing controls; it is not additional passing coverage. Final focused controls are 37 model, three actual filesystem and three CLI use cases. Existing package coverage does not measure these developer scripts. Focused/full counts overlap. Publication requires normal exact-commit full build/regression, all nine independent CI jobs, actual current-source review and matching checkout trees; completed results belong in the PR.

The next authorized PR will reconcile remaining gaps using the accepted evidence. It is a review of what local proofs establish and what still needs actual decisions or separately scoped implementation. It supplies no new native execution, production authority or case/gate closure.
