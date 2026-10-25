# P1-PR-015 — Script-first ingestion and publication services

**October 25, 2026 · implementation in progress.** Baseline: owner-approved [PR #14](https://github.com/xmyqyl4x/tiresandtreads/pull/14), merged at `969235fe712ea4989602c8908bc63ad9ca9bcf7a`. Implements the [015 card](../tasks/phase-1-prs.md#p1-pr-015), S3/E05/E36 and service portions of CAP-04/UC13/AT22/DB22. The four live phases, PostgreSQL consolidation, option-C deployment and S4-before-frontend gate remain unchanged.

## Service and adapter boundaries

`createImportService` owns registration, streaming staging, normalization, validation, status, diff, publication and safe rollback. The CLI calls these same application use cases; P2 admin adapters will reuse them. The composition root uses separate `tt_ingest_runtime` and `tt_publish_runtime` pools, one connection each, bounded admission and graceful draining. Startup verifies the actual roles, same database and `2 + IMPORT_DB_OTHER_CONNECTIONS + IMPORT_DB_RESERVE <= max_connections`; defaults are 20 other connections and 10 reserved. Count concurrent operator processes in the deployment's other-connection allowance. Neither runtime can create approval evidence or alter licenses.

No parsing or filesystem I/O occurs inside a SQL transaction. Streaming uses 16 KiB chunks, a 16 KiB encoded row limit, SQL batches capped at 25 rows/180,000 serialized bytes and adjacent-kind bulk materialization. Parent rows precede dependent rows in the input. The current manual snapshot ceiling is 20 MiB/100,000 rows. Larger scheduled source contracts belong to 016. JSONL is a normalized internal interchange format; it is not an unrestricted upstream mapper, CSV parser or archive extractor. No arbitrary URL is fetched or source text executed.

## Snapshot contract and critical rejection policy

A UTF-8 JSON manifest contains exactly `id` (dataset UUID), `providerId`, `licenseId`, `kind`, `externalVersion`, SHA-256 `checksum`, `effectiveAt`, `fetchedAt`, `upstreamRunKey`, `schemaVersion: "1"`, `mappingVersion: "1"`, `semantics: "complete_snapshot"`, `expectedRows` and `expectedBytes`. Times use UTC ISO milliseconds. The operator supplies an independently established upstream total and complete-snapshot declaration; a self-created manifest does not establish a real provider's completeness. Provider-specific authenticated pagination, rights and field contracts must be accepted in 016 before live connector use. Incremental feeds are rejected by this first adapter rather than treating missing rows as deletions.

Each JSONL line has `{ "kind": "tireModels", "record": { ... } }`, using one of the 25 typed fact families and every required/nullable field in `catalog-records.ts`. An optional `identities` array of one to four `{id, kind, stableKey}` values establishes company/brand/plant/vehicle-make/model identities through the restricted repository in the same batch. Stable keys are bounded identifiers; conflicting reuse fails. Typed relationship endpoints are rechecked before publication. Bigints and exact decimals use strings; unknown values stay explicit nulls. UUIDs are supplied in the reviewed normalized snapshot, enabling stable retries and parent references. All records end in LF; CRLF is accepted and included in the checksum. BOMs, malformed UTF-8/JSON, extra fields, oversized records, unsupported versions, unexpected counts, byte changes and checksum mismatches prevent the verified end marker and block validation. The normalizer rejects unsafe source URLs.

All rejects are critical in v1: **zero rejected or duplicate source keys** are required. Invalid normalized records retain a redacted `invalid_record` marker, never the rejected payload. Staging rows and materialization receipts commit together. Accepted staging expires after one day or the license expiry, whichever is earlier, within the existing 30-day ceiling; production source-specific shorter retention and cleanup policies must be reviewed with connector rights. Staging is never a public read source. A malformed stream can leave checkpointed private rows, but cannot validate or change a head. A retry replays the same checksum/version identity from byte zero, checks every committed batch and only appends new materialization. An active lease cannot be stolen; fencing rejects late workers. Leases renew per batch and release on completion/failure; abrupt process death waits for the five-minute lease before resume.

Diffs compare source keys and normalized facts against an immutable published bundle, reporting additions, changes and removals for all 25 families. Removed rows are meaningful only under the accepted complete-snapshot contract. Operators review suspicious deltas before requesting approval; this PR activates no automatic publisher or permissive reject threshold.

## Commands and authorization

Set `INGEST_DATABASE_URL` and `PUBLISH_DATABASE_URL` from private environment configuration using their named roles. Credentials never go into command arguments, manifests, plans or Git. The commands work on Windows and Linux; the build also emits the standalone `.local/import.mjs` CLI.

```text
pnpm data:dry-run --manifest <private-manifest.json> --file <private-snapshot.jsonl>
pnpm data:resume --manifest <same-manifest.json> --file <same-snapshot.jsonl>
pnpm data:status --run <run-uuid>
pnpm data:diff --run <run-uuid> --against <published-bundle-uuid-or-none>
pnpm data:publish --plan <private-approved-plan.json>
pnpm data:rollback --plan <private-approved-rollback.json>
```

Dry-run means private registration/staging/validation plus separately requested diff, with no head, publication receipt or outbox change. Resume uses the same service. Results are machine-readable JSON; bigints serialize as decimal strings. Failure exits nonzero and emits safe codes without source bytes, credentials or filesystem paths.

A publication plan contains exactly `runId`, `bundleId`, `market`, `actorId`, `approvalId`, `expectedHead` and `members`. Members are `{key, kind, datasetId}`; expected head is null for first publication or `{bundleId, revision: "<positive integer>"}`. The actor must be currently active. A separate reviewed approval workflow supplies an immutable `admin.audit_events` row with action `import.publish`, kind `dataset_bundle`, result `approved` and the canonical manifest digest. This runtime has no approval-writing privilege; synthetic tests seed approvals solely as the fixture migrator. Staff authentication/MFA, approval creation and HTTP endpoints remain later API/admin work.

The publication transaction rechecks source rights, full validation, required component kinds and all pinned cross-source references; it compares expected head, writes the new head and publication receipt, and inserts a stable `dataset_bundle.published` outbox event atomically. A head race rolls back the losing bundle/dataset updates. Retries acknowledge the original receipt without moving a later head. These events feed the durable relay; downstream safety-overlay/AI-cache consumers remain their later service work.

Rollback plans omit `runId`/`members`, require a non-null expected head, and reference a previously published target in the same market. Approval action is `import.rollback`; digest is SHA-256 over canonical `['rollback', market, targetBundleId, expectedBundleId, expectedRevisionString, actorId]`. The target's current rights and actor authorization are checked again. Rollback locks and compares the current head, writes a monotonic revision and `dataset_bundle.rolled_back` outbox receipt in one transaction. Approval ID is the immutable event identity. Retries return that receipt without repeating the head change, including after a later publication.

Rollback requires **identical recall-bearing dataset IDs** in current and target manifests. This includes declared recall kinds, empty recall snapshots and mixed datasets containing campaigns, unresolved targets or resolved mappings. If that conservative comparison fails, rollback is refused and the current warning remains available. This PR does not build an independent safety overlay or claim universal recall clearance. Historical facts/reports are untouched.

## Database and acceptance boundary

Additive migration `0017_import_services` grants the publisher only the outbox receipt columns needed for replay and adds an accepted-staging diff index. No table, column, view, role or CMS migration changes: 123 application tables, 39 views, 1,577 columns; 28 CMS tables; 17 application/two CMS migrations. Earlier migration bytes and generated model declarations remain unchanged.

Verification is recorded after the real PostgreSQL, process CLI, quality, coverage, recovery and exact-commit checks pass. Real source/provider selection remains deferred to its necessary 016 decision trigger. DD03/DD05 hosted workflow/storage proofs remain pending independently of local PR #14 approval. No paid provider, live source ingestion, frontend, HTTP product API or production deployment is activated here.
