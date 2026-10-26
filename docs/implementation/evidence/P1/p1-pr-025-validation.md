# P1-PR-025 validation evidence

**October 26, 2026 · S3 implementation candidate.** Baseline: approved PR #24 merge `4ba7b446ee343eac9baabd3d98bb8ba228d11890`. See the [privacy service and recovery contract](../../P1-PR-025-privacy-retention-recovery.md).

## TDD and scope

The initial policy/cryptography suites failed with the new modules absent. Real PostgreSQL tests then exposed missing role grants, date conversion and operator-lock privileges; those were corrected without disabling constraints or weakening authorization. A later review added deterministic delivery reservations and serialized asset erasure barriers to fence late renderers. Near-deadline escalation continues deletion instead of trapping it in an unattended manual state.

Unit tests cover jurisdiction-rule validation, calendar clock calculations, proof audience/tamper/rotation, resource HMAC separation, independent file journal persistence, duplicate/conflicting writes and corrupted signature refusal. Database/application tests exercise browser/share authority, known/absent email responses, notification and proof expiry, immediate revocation, complete report/quote/comparison/email/callback erasure, retained independent owners/PDFs, unavailable journal/provider/object behavior, legal holds, current operator review, competing/expired leases, deadline escalation, dry-run/apply retention, late asset registration and authenticated restored-resource replay/readiness.

Provider/encryption/object ports use explicit synthetic fixtures. Advancing `barrier_until` in these fixtures represents the absence of an outstanding real I/O call; no identity/immutability trigger or FK is disabled. Actual provider erasure and power-loss behavior are not inferred from a successful fixture acknowledgment. The existing full-schema recovery gate remains a separate real dump/restore test with synthetic data.

## Measured verification

Final exact-commit totals, coverage, migration/model inventory and verification time are recorded in [the machine-readable evidence](p1-pr-025-verification.json) after the complete Linux gate passes. No production activation or full FR/UC/live acceptance is claimed by those measurements.

## Remaining gates

- DD01/DD02 licensed adapters and DD06/G1 specialist review remain pending; 98 draft scenarios still have zero actual specialist reviews.
- G2 approves actual jurisdiction notices/clocks, exceptions, minimal evidence/tombstone lifetime and external provider handling. No production rights policy is seeded.
- #27 binds worker cadence, notification dispatch, retention, priority/lag alarms and recovery commands; #29/S5 provide the API and user/staff controls.
- The first file-journal adapter has explicit 1,000-record/2 MiB snapshot bounds. The production volume, independent high-water evidence, paging/compaction and key retirement need hosted review.
- Production collection, report issuance and real email remain disabled. PostgreSQL remains the consolidated store; no Redis, ClickHouse or optional computation cache is added.

The first complete Linux gate passed 902 unit/use-case/database tests, foundation and schema checks, then rejected the partial `request_work_recovery_fk` index during actual restore health validation. Follow-up migration 0031 supplies the complete index; the original applied migration and the recovery check are preserved. Verification was rerun on the corrected committed source.
