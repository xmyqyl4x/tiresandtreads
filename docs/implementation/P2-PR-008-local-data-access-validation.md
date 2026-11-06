# P2-PR-008 — Local data-access validation and pending S2 review

The owner continued the next local card after completed [PR #95](https://github.com/xmyqyl4x/tiresandtreads/pull/95). The [authorization](evidence/P2/p2-pr-008-local-authorization.json) permits local validation and merge while actual S1/S2 acceptance remains held. This explicit exception to the task card's accepted dependencies covers the three local tasks only. No acceptance gate closes, despite the original card title. P2-PR-009 services are not started.

## Entity, row and wire boundaries

[The read-only source audit](../../scripts/review/p2-data-access.mjs) verifies all 50 source pins from the two preceding repository proofs, traverses the pure domain/port import graph with the TypeScript parser (including type imports, re-exports, import types and dynamic edges), rejects external/DB/provider/ORM dependencies and requires fixed inward paths. It checks explicit readonly field sets for five safe owner/partner projections and existing transaction parameters in all five repository ports. Standard workspace typechecking and dependency-cruiser boundaries remain required. This bounded audit is an inventory check, not authentication or semantic validation.

| Concern | Boundary and shared P1 capability |
| --- | --- |
| Domain | Branded IDs, revisions, bigint money/counts, immutable discriminated entities; no driver/ORM/provider SDK |
| Row decoding | PostgreSQL adapters explicitly decode stored values; mapper/input tests refuse invalid int64, malformed JSON and shape drift |
| Transactions | All five new port families use P1 opaque `TransactionContext`; one unit of work owns one connection; caught failures still poison and roll back |
| Tenant/offer/allocation | Server-only actor scope, versioned offers and internal coupon allocation entities; safe partner metrics have five named fields |
| AI output/reuse | Captured scope/policy revisions, exact SQL digest/fence, named report projection; provider identifiers and manifests remain internal |
| Photo | P1 `AssetRepository`/`AssetLocation`, `JobLease`, pagination and transaction types; safe status/candidate/confirmation fields are enumerated |
| CSV review | P1 import/job/source/artifact pipeline and `AssetLocation`; no second parser/publication pipeline |
| Rights | P1 `PrivacyLease`, object locations and receipt stage; SQL adapters perform no storage/provider I/O |
| Future wire contracts | No P2 HTTP serializer is approved here. Internal entities such as coupon assignments, scopes and CSV reviews must never be returned directly. Later API cards must explicitly allowlist DTO fields, serialize bigint/revisions as strings, bound output and recheck service authorization |

The five audited safe projections are internal application results, not approved HTTP payloads. Free-form output/candidate text still requires task-specific semantic validation and safe UI rendering in later cards. Source hashes bind the inspected snapshot; changing it requires a new reviewed proof.

## Database and regression evidence

Run `node tests/fixtures/phase2/data-access-gate-run.mjs`. It creates one bounded disposable PostgreSQL project, typechecks the workspace, runs the source audit and reruns both complete repository suites plus the new gate tests, then verifies owned resources were removed. [The source-bound proof](evidence/P2/p2-pr-008-local-proof.json) records actual counts and log hashes.

The new native cases preserve a P1 owner report across P2 writes; commit two repository operations on one checked-out restricted connection; prove caught-error rollback of both request and reuse claim; measure an indexed worker point-read among 10,000 synthetic requests; race twelve owners over two shared budget windows (three reservations succeed); retain uncertain charges through privacy refusal and preserve historical spent totals on owner purge; and close a real pooled connection before a lease expires, then prove replacement generation and stale-publication refusal after SQL expiry.

The rerun suites add all 103 prior native cases and 140 mapper/input cases: tenant/context isolation, 10,000-row organization-location lookup, allocation contention, exact-key leases, photo/job/artifact atomicity, CSV evidence/review expiry, missing-receipt refusal, legal holds, bounded deletion and unrelated/shared-data preservation. Existing full Linux regression also exercises the P1 private object adapter and version/marker erasure against the local emulator. These tests do not compose or accept the full P2 physical-erasure executor.

Default manifests remain 33 application / 3 CMS migrations. The opt-in local track remains 45 application migrations / 185 tables; this card adds no schema, dependencies, production adapter or runtime wiring. Prior sources, models, bootstrap, CLI, preflight and policy remain unchanged. Local query/lease/window results are not a production SLA, independent durability, authentication or provider fencing claim.

## Readiness, risks and revised estimate

[The S2 record](evidence/P2/p2-s2-local-readiness.json) remains **pending**, with empty approval records and both actual S1/S2 approval flags false. Principal gaps are latest-track archive/restore and rights replay, production privacy composition/physical erasure, real source/model evaluation, owner/staff authentication and service authorization, bounded batch/operator handling, provider/operator/budget decisions and actual phase/deployment acceptance. Earlier S1 archive evidence through migration 0043 does not establish restored parity for 0044/0045.

Nineteen Phase 2 cards remain, P2-PR-009–027. The draft remaining effort is **68–118 engineering person-days**, including implementation, tests and review. This is a planning range for one focused experienced engineer equivalent, not calendar time, staffing, cost or delivery approval.

| Remaining scope | Cards | Person-days |
| --- | --- | --- |
| Reseller services | 009–011 | 10–18 |
| AI, photo, privacy and CSV services | 012–016 | 22–38 |
| Service/model and API validation | 017–020 | 12–21 |
| Frontends | 021–025 | 16–27 |
| Security and release | 026–027 | 8–14 |

External decisions/reviews, licensed sample availability, real provider evaluation and acceptance/deployment waits are excluded from the range and may extend calendar time. The next service card requires its own authorized local scope while actual S2 acceptance is pending; this record does not authorize it.

All six S3 gates remain open with unchanged empty records. HS01–HS08 remain proposed; operators/coverage/rates and provider/model/budgets remain unconfirmed; specialist/licensed work remains pending. Actual phase entry, feasibility, S1/S2, privacy/source/restore/provider/pilot/deployment acceptance stays held. No provisioning, purchases, actual recipient notifications, model/provider calls or design-case/gate closure occurs.
