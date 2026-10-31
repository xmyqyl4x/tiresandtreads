# P1-PR-027 — LR04 populated source/target preservation

The owner authorized completing the current PR and fully implementing, validating and merging the next local slice. PR64 is merged at `86f6d98f1a398a87418ec123281536c0dda11a63`; its six post-merge checks passed. This PR completes LR04's distinct populated fixture, read-only preservation observations and quarantine review. It does not perform a restore or combine a current-index/provisioning journal with a restore executor. Those require a separate designed scope. No original design case or gate closes.

HS01–HS08 remain proposed; operators/coverage/rates unconfirmed; all six S3 gates open; specialist/licensed work pending; APIs/frontends held. Production bootstrap/CLI/preflight/policy, previously approved readers/fixtures, dependencies and runtime pins remain unchanged. No hosted provisioning, purchases or actual recipient notifications.

[Local results](evidence/P1/p1-pr-027-populated-preservation-local.json), [source/preservation pins](evidence/P1/p1-pr-027-populated-preservation-sources.json), [validation](evidence/P1/p1-pr-027-populated-preservation-validation.md), [LR04 scope](P1-PR-027-coordination-evidence-reconciliation.md#lr04--populated-sourcetarget-preservation-design), [original lifecycle contract](P1-PR-027-bootstrap-lifecycle-contract.md), [original journal contract](P1-PR-027-provisioning-journal-serialization-contract.md).

## Scope and responsibilities

Run `node tests/fixtures/populated-preservation/run.mjs` from the repository root with local Docker. The runner accepts no arguments, caller SQL, URL, target, phase override, callbacks, retained resources or credentials. It refuses a remote Docker context and occupied generated namespaces. Nine fresh generated projects use two separate pinned PostgreSQL instances, four app/CMS owner endpoints, separate data/TLS volumes, an internal network and no published ports.

Only the short-lived setup actor has the generated bootstrap password and writable owner/baseline volumes. It reuses the unchanged foundation initializer, migrates both app and CMS on each instance through existing migration helpers, inserts fixed synthetic rows, records the baseline, applies at most one fixed synthetic fault and records a separate pre-observation snapshot. All setup sessions and CMS child processes exit before observation. Setup mutation is explicitly fixture preparation, not lifecycle/provider effect dispatch. There is no restore, role import, runtime promotion or production executor.

The observer mounts only owner credentials, public trust and the two populated metadata files, all read-only. It has no administrator password, Docker socket, server key, added capability, writable database/baseline mount or provider credential. Private metadata is created inside owned Linux volumes with mode `0600`; no host-owned private binding is mounted. The trusted parent separately checks the same owned instance IDs, start times, mounts, networks and aliases before setup and after observation. This establishes local harness continuity at those boundaries, not authenticated live attestation or an independent authority.

## Populated phase and baseline

The new phase is exactly `populated-quarantined`. A separate envelope binds version, generated project, generation, current migration-source digest and four ordered endpoint observations. It admits no arbitrary phase or expected catalog supplied by an observer caller. Baseline shape, digest syntax, positive populated/history/quarantine predicates, endpoint uniqueness/order, 16KiB metadata limit and table budget are checked before observation. The envelope is trusted local setup input; it is not a signature, durable journal or authorization receipt.

Each app database contains one fixed restricted guest subject. Each CMS database contains one fixed draft article and one explicit synthetic prior-version row linked to it. IDs, content and seed timestamps are fixed. This uses actual committed app checksum history, CMS checksum history and native Payload migration rows. The explicit article version exercises preservation of populated version rows; it does not claim that a Payload editing workflow ran. Migration timestamps and generated migration-row IDs remain endpoint-specific, so each endpoint has its own exact row baseline. Cross-instance byte equality is not assumed and neither instance is represented as restored from the other.

The fixed reader captures semantic catalog/ownership/ACL/defaults/policies/types, every regular/partitioned table in the existing inventory namespaces, row fingerprints, sequence state, scoped roles/memberships/settings/database ACL and both migration ledgers. Table names come only from the fixed catalog inventory and must match a strict identifier grammar. It refuses more than 200 tables/sequences, more than 1,000 rows per table, more than 1MB per table, 2MB aggregate rows/catalog or 100 ledger rows. Oversized observations refuse rather than silently truncate. The fixture is for small synthetic data, not a live-data export/inspection facility. Row values and secrets are never emitted in receipts.

Every owner observation uses native verified CA/hostname TLS, exact owner/session/database/server-version checks, a repeatable-read READ ONLY transaction, native 1500ms connect/query limits, 1000ms statement/idle limits, 250ms lock limit, 5000ms transaction limit and a 6000ms endpoint elapsed check. Catalog rendering uses the same `pg_catalog` search path in setup and observation. Each client must emit native `end` within a separate 750ms observation window. Failure does not yield a compatible result; a timed-out await is not cancellation. The parent bounds setup/observer processes and verifies exact generated-project teardown, retaining synthetic custody if teardown fails.

## Implemented controls and acceptance limits

| Local control | Required observed behavior |
| --- | --- |
| Positive populated pair | All four endpoints match; repeated observation is inert; four permanent-table write attempts refuse with PostgreSQL `25006`; the unchanged foundation-only snapshot refuses all four populated endpoints. |
| Target app row drift | A fixed subject status change produces target row/populated findings. |
| Target CMS draft drift | Existing immutable-version enforcement first refuses an attempted version edit with `23514`; a changed editable draft title then produces target CMS row/populated findings. The immutable version remains unchanged. |
| Missing target row | Deleting the sole synthetic subject produces missing populated/row findings. |
| Target app checksum drift | A changed real migration checksum produces history incompatibility. |
| Target native CMS history drift | A negative native Payload batch produces history incompatibility. |
| Target inventory drift | An extra synthetic table produces catalog incompatibility. |
| Target quarantine drift | A fixed runtime CONNECT grant produces security/quarantine findings. No runtime connection is opened. |
| Source row drift | A changed source subject produces source findings, demonstrating that source continuity is checked too. |

Every control takes a fresh four-endpoint post-observation audit and compares it with the distinct snapshot taken **after the deliberate setup fault**. Thus positive data, adverse data and adverse privileges survive observation exactly as presented: the observer neither repairs nor erases the fault. Negative setup changes are not mislabeled preserved pristine state. The other instance is also audited. Same-instance/volume continuity and checked teardown are separate parent receipts, not extra test executions.

Twenty unit controls cover baseline substitution, ordered endpoints, component drift, false phase predicates, missing/duplicate endpoints, metadata/digest/table limits and defensive copying. A controlled row-guard-removal mutation must fail the actual row-drift test, with exact source bytes restored before the final passing run. The nine native cases and twenty unit controls overlap the normal unit regression and must not be added as unique coverage.

This supplies representative local evidence for PJ13/MT13 source preservation and BLC-T05 read-only preservation, plus populated ledger/quarantine observations relevant to BLC-T14/T18/T19. It does **not** establish migration replay acceptance, restore/archive validation, source/target lock composition, signed current-head/journal provenance, runtime admission, independent durability/authentication/fencing, external-administrator exclusion, every-await coverage, hosted acceptance or an atomic snapshot spanning four databases. The original 18 journal, 22 lifecycle, 16 target-order, 20 TLS/admission and 20 coordination matrices remain unchanged and open.

## Delivery checklist and next boundary

- [x] Define distinct populated phase, fixed seed/history baselines and actor custody.
- [x] Implement native read-only four-endpoint observations and fixed adverse setup controls.
- [x] Prove repeated reads, native write refusal, unchanged foundation-reader refusal and preservation as presented.
- [x] Add independent Linux CI and bounded owned-resource continuity/teardown.
- [x] Preserve historical source/evidence pins, task/requirement counts, decisions and all acceptance holds.

Exact-commit full build/regression and all seven independent PR CI jobs are publication requirements; final head/tree, actual results and links are recorded in the PR after completion. A local fixture result never fills an actual S3 acceptance record.

The next boundary is LR05's actual decisions and acceptance inputs, which remain held. Restore/current-index/journal composition also remains separate and unimplemented. The next useful review can identify the exact inputs needed for those decisions without selecting providers/operators, provisioning resources, implementing APIs/frontends or closing gates.
