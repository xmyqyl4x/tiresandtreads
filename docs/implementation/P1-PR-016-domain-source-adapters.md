# P1-PR-016 — NHTSA and licensed domain source adapters

**October 25, 2026 · NHTSA/shared implementation for review; full card in progress.** Baseline: owner-approved [PR #15](https://github.com/xmyqyl4x/tiresandtreads/pull/15), merged at `5504a4a5b543d474bb031d714513de82170f651f`. Implements the available NHTSA/shared-infrastructure portion of the [016 card](../tasks/phase-1-prs.md#p1-pr-016), S3/E01/E05/E35. Source/provider selection was previously deferred; [DD01/DD02](P1-PR-001-launch-baseline.md#deferred-decision-register) now block licensed-adapter acceptance. The owner explicitly directed: keep licensed adapters pending and proceed with NHTSA/shared infrastructure. No provider was selected, contacted or purchased. Public-source rights review and final tire/data review also remain open.

## Delivered technical scope

| Profile | Exact scope and mapping | Completeness boundary |
| --- | --- | --- |
| `vpic-models` | A make ID, year and passenger-car/truck type; stable make/model identities, identifiers, relationship and form options | One complete JSON response with matching count and requested identity/type. No vehicle trim, axle, tire-size, load/speed, verified fitment or recommendation facts are created |
| `vpic-manufacturers` | Company identity, source identifier and optional common-name alias | Pages of 100, a terminal short/empty page, duplicate-ID checks and a second identical whole traversal. At most 512 pages/50,000 rows/64 MiB per traversal; changed pagination fails. A manufacturer/common name does not establish brand ownership or tire manufacturing |
| `vpic-plants` | Equipment type 1 or 16, query year 2016+, `reportType=all`; current and old DOT codes remain distinct | Matching response count, typed fields/status/code validation. Plant identity fingerprints source identity/location claims; ambiguous/reassigned codes are not merged. Query year is not asserted as a manufacturing/validity interval |
| `nhtsa-tire-recalls` | Tire records from both official PRE/POST 2010 archives; campaign plus every unresolved source target | Both archives and the reviewed 29-field dictionary are required. One expected ZIP entry per archive, exact inflated size/CRC, 100:1 ratio ceiling, UTF-8 framing and full traversal. A vehicle-only recall API or a recent-years archive cannot establish this scope |

Primary contracts: [vPIC API](https://vpic.nhtsa.dot.gov/api/), [NHTSA datasets](https://www.nhtsa.gov/nhtsa-datasets-and-apis), [recall dictionary](https://static.nhtsa.gov/odi/ffdd/rcl/RCL.txt). The dictionary SHA-256 is pinned to `3438cc7e4131efa401dfe6437dbe035607e092c129155dfb411d459d58802203`; changes require review. Endpoint/field observations are technical evidence, not a grant of display/storage/derived/AI/app/MCP rights.

## Normalization and safety semantics

The adapters build bounded private normalized snapshots and invoke the existing 015 application service. They never publish automatically. Fact IDs depend on source scope/content and use a fixed custom SHA-256 UUID layout; stable domain entities have separate identity keys. The database reuses original registration times after an interrupted check, so a replay cannot conflict merely because the clock advanced.

Source dates/counts/codes retain explicit meaning. Tire targets keep make/model text, manufacturing dates, component identifiers and unresolved status. No DOT pattern, tire size or SKU/model match is inferred from free text. Source campaign counts are exact integers, not summed once per repeated target. Conflicting campaign claims, duplicate target IDs, malformed schema/dates/counts and unknown advisory values fail the check. Optional missing narratives remain NULL, preserving the warning. Report-received dates populate `report_received_on`; unavailable announcement dates stay NULL. “Reported” does not assert outstanding repair status or recall clearance. `do_not_drive` and `park_outside` preserve Yes/No/unknown and are explicitly available in the licensed public projection; private raw target details remain excluded.

The licensed catalog/fitment/price/climate implementations are **not delivered or accepted**. Their unit/precision/freshness contracts and reviewed cross-source mappings depend on the selected sources. Existing typed quantity/money/fact boundaries remain available; no supplier format, unit conversion or fitment authority is invented. Unknown profile types are refused, including an unselected licensed connector.

## Refresh, reconciliation and operations

The application service claims a source in a short SQL transaction, performs network/filesystem/normalization outside transactions, validates through shared import services and then records a fenced health receipt. Registration requires current source rights plus separate immutable `source.register` audit evidence and an active staff actor. The digest binds connector/provider/license/scope/origin/path. The runtime cannot create approvals or change licenses. It rechecks the approval, policy and rights when completing a check or satisfying recall readiness.

Source row locks and 15-minute token/fence leases reject concurrent and late workers. SQL is authoritative for due times and the weekly full-reconciliation deadline. Each scheduler tick processes at most four sources. Recall/model checks are daily; manufacturer/plant checks are weekly. Each request is allowlisted, sequentially paced, bounded to 15 seconds, rejects redirects and limits 429/503 retries to three attempts while honoring a bounded Retry-After. The total fetch/normalization deadline is ten minutes. Failed checks retain the previous success, clear their lease, back off to at most one hour and enqueue a redacted failure notification. Current rights failures are recorded before HTTP, with backoff so they cannot monopolize the due set.

Conditional recall checks require a prior validated receipt. All required resources must return verified no-change responses; a mixed changed/304 result refetches the missing archive unconditionally. Full-body identical checks also advance success without rewriting immutable facts. A seven-day reconciliation omits conditional headers. Failed/truncated/empty or schema-drifted checks never advance success.

`requireRecall(datasetId)` refuses readiness unless a reviewed active tire-recall source has current rights, no failed/in-progress check, a complete successful check within 48 hours and the exact current published dataset/run in the US head. A newly validated but unpublished warning version therefore blocks readiness for the old version. This is a mandatory **freshness input** for the later issuance service, which is not yet built; it is not a universal recall-clearance or safe-to-drive decision. Existing warnings remain readable during a failed refresh. Failure/success outbox events carry connector IDs and revisions only; operator notification delivery/dashboard integration remains its later card.

The [single-host cron template](../../infra/jobs/source-refresh.cron) runs an explicit container tick with overlap locking and ephemeral bounded scratch storage. It is not installed or activated. Configure a reviewed image digest, role-only secrets, one scheduler host, aggregate connection budget and operational alert consumer before hosted use. The runtime uses the existing two bounded import pools. Each process needs its own allowance; no source URL or credential is accepted from a CSV or command argument.

## Operator commands and compatibility review

```text
pnpm data:source-probe --spec <public-scope.json>
pnpm data:source register --plan <private-reviewed-source-plan.json>
pnpm data:source refresh --connector <connector-uuid>
pnpm data:source tick
pnpm data:source recall-ready --dataset <published-dataset-uuid>
```

The probe takes a strict source specification, needs no database connection and returns scalar counts/hashes only. It fetches/normalizes privately and removes its temporary files. It cannot register/import/publish a source or establish rights. Windows environments using an organizational trust root may set process-scoped `NODE_USE_SYSTEM_CA=1`; TLS verification stays enabled. CI uses synthetic HTTP/ZIP fixtures and never calls live sources.

Registration plans contain exactly `id`, `providerId`, `licenseId`, `spec`, `actorId`, `approvalId`. Scope examples are `{"type":"vpic-models","makeId":474,"year":2024,"vehicleType":"passenger car"}`, `{"type":"vpic-manufacturers"}`, `{"type":"vpic-plants","year":2024,"equipmentType":1}` and `{"type":"nhtsa-tire-recalls"}`. Origin/path are derived from the allowlist. Approval digest is canonical SHA-256 over `[id, providerId, licenseId, spec, origin, path]`, action `source.register`, resource `source_connector`, result `approved`. Production source/rights rows are not seeded by this PR. Use private `INGEST_DATABASE_URL`/`PUBLISH_DATABASE_URL` role URLs for database commands. The build emits `source.mjs`; the production image includes it alongside the import CLI and worker.

Temporary source files normally disappear in `finally` cleanup. Abrupt native-process termination can leave an owned temporary directory; inspect/remove only that identified directory. Hosted jobs use an ephemeral tmpfs/container and must not mount a persistent raw-data cache without a reviewed retention policy. No raw archive or proprietary sample is checked in.

## Schema and remaining acceptance

Additive 0018–0022 preserve earlier migration bytes. They add reviewed connector fields and refresh receipts/due times, explicit advisories, nullable missing narratives, a separate receipt date, narrow audit verification grants and an immutable connector-ID guard for the row-lock capability. The regenerated model audit covers **123 application tables, 39 views, 1,594 table/view columns and 250 codec fields across 25 fact families; 28 CMS tables; 22 application/two CMS migrations**. No new role, CMS migration, Redis or ClickHouse dependency is introduced.

[Validation evidence](evidence/P1/p1-pr-016-validation.md) and the [redacted verification record](evidence/P1/p1-pr-016-verification.json) record 336 passing tests, coverage, real PostgreSQL/process CLI, production image, recovery and retained dev/stage proofs. [PR #16](https://github.com/xmyqyl4x/tiresandtreads/pull/16) presents the authorized NHTSA/shared implementation for owner review. The 016 card stays in progress. Required before accepting its remaining scope: selected licensed providers and permitted samples/contracts under DD01/DD02, per-source rights/retention/channel review, actual field/unit/coverage fixtures and live checks, reviewed cross-source links and later issuance-service integration. A merge accepts the authorized NHTSA/shared implementation only; it does not close those gates or the entire 016 card. Four live phases, database-first construction and option-C deployment remain unchanged.
