# P2-PR-006 — Local tenant, offer and pilot repositories

The owner continued the next local card after completed [PR #93](https://github.com/xmyqyl4x/tiresandtreads/pull/93). The [authorization record](evidence/P2/p2-pr-006-local-authorization.json) permits implementation, testing and merge of this card while actual S1 approval remains pending. This is a local exception to the ordinary accepted dependency in the [task list](../tasks/phase-2-prs.md#p2-pr-006), not acceptance of S1, S2 or a later card.

**Trace:** local persistence evidence for UC11, DB09/DB10/DB12 and E21–E25. Original requirement rows and all case/gate statuses remain unchanged.

## Layer boundaries

Pure typed tenant/offer/discount/coupon/metric entities depend only on domain values. Application ports take the existing opaque transaction capability. PostgreSQL adapters own row decoding, parameterized queries, locks and atomic persistence. DTOs enumerate safe fields; int64 revisions, money and counters remain bigint, never JavaScript floating point. Stored invalid shapes fail closed; JSON terms are copied/frozen before use. SQL/framework/provider code stays outside the domain and application layers.

| Port | Implemented local behavior |
| --- | --- |
| Tenant reads | Current-member organization, exact role/revision and organization/actor-bound keyset location pages; fresh transaction-local context on each call |
| Identity writes | Atomic pending organization/owner registration; organization and membership changes use expected revisions; active organizations require verified status |
| Offer persistence | Append-only numbered drafts and bounded targets, distinct-reviewer persistence, immutable reviewed terms, compare-and-set publication pointer and tenant-scoped version history |
| Allocation | Atomic current-version/pool admission, exclusive/shared code selection, full rolling/calendar frequency checks, all active caps, immutable decision and request receipt |
| Outcomes/reconciliation | Persist issued/uncertain/quarantined outcomes; refuse release of uncertain holds without definitive non-use reason/evidence; release counters once; issued frequency usage stays counted |
| Redemption history | Idempotent reported events and linked correction/reversal ledger; no verified-sale claim and no individual attribution for shared codes |
| Pilot reporting | Masked organization counts and disputes; reviewed current-generation cohort aggregates only, including clicks and reported redemptions; no consumer/contact/send/code identifiers in partner projections |

This is data access, not completed partner onboarding, matching, consent, code import/encryption, rendering, aggregate construction, services, API or UI. Verification/agreement/location/domain/asset decisions are represented by the preceding schema and must be authorized and composed in later use cases. Existing P1 analytics remains the source for visitor capture; this card reads reviewed aggregate projections and creates no new visitor tracker.

## Transactions and locking

One existing unit of work owns every connection and transaction. A repository error poisons that scope even if a caller catches it; earlier writes cannot commit. Forged, expired and foreign transaction capabilities are refused by the existing transaction layer.

New allocation locks the subject, send, canonical request key, sorted frequency guards, organization/offer/version/pool, sorted cap windows and selected code in that order. Offer writes use organization then a per-offer transaction advisory lock and offer/version rows, including first creation before an offer row exists. Outcome/release uses subject/send, frequency guards, sorted existing cap windows and assignment locks. No code/counter state escapes a rollback. `SKIP LOCKED` makes a contended exclusive code unavailable for that attempt; callers must use bounded service-level retry rather than assume a definitive inventory shortage.

The adapter snapshots and hashes bounded canonical command inputs before awaiting persistence. A receipt binds organization/request key to the exact command and original assignment. Identical retries return the original assignment, including a released one; a changed command conflicts. Receipt keys must be unique per intended command and have a future accepted retention policy. Receipt and selected-decision history are immutable; release never creates a fresh hold on retry.

Frequency policy identity is pinned by subject/scope guards. Both required scopes are checked: overall notifications use a database-computed calendar month in the supplied policy time zone; per-offer usage uses the entire preceding 30 days. SQL captures the evaluation clock and bounds, so callers cannot omit recent history by choosing a narrower interval. Issued/uncertain history from every policy contributes to counts; a guard policy change conflicts rather than resetting usage. Overall usage is shared by all partner offers on one send and releases only when its last live assignment releases. Actual limits, time zone and policy version require service/owner decisions; synthetic test values are not approved commercial policy.

All current cap identities must match the evaluated command, with one each of the supplied total/day/budget kinds, explicit integer units and sufficient capacity. Capacity is checked under row locks. Time-sensitive cap and offer admission is rechecked after waiting for locks. This is reservation-time admission only: future dispatch must recheck current consent, suppression, source/partner/asset/domain/offer/pool validity and frozen payload through the authorized delivery service. It does not authorize sending or promise that a reservation remains eligible indefinitely.

Repository credentials are internal capabilities. A correct organization argument alone does not authorize a staff or allocation command. Staff authentication/MFA, membership administration policy, last-owner rules, verification evidence, privacy purpose, selection eligibility and release-evidence semantics belong to later services. Evidence IDs here provide integrity references, not proof of a real provider reconciliation.

## Privacy and bounded reads

Partner RLS requires current organization and active actor membership. Context is transaction-local and reset on pool reuse. Internal writer/allocation roles are separate from the partner reader; none gets raw contact/send SELECT access. The pilot reader cannot select coupon secrets, assignments, frequency rows or raw daily metrics.

All list limits are bounded. Location/dispute cursors bind organization and actor; metric cursors additionally bind date/metric filters and a ready generation. Header/cells share one SQL statement snapshot. A dirty/replaced generation refuses continuation so pages cannot silently mix refreshes. Cursor digests are context bindings, not authentication or independent tamper protection; RLS and server authorization remain authoritative. No private recipient identity is projected, including in dispute details.

An actual restricted-role plan over 10,000 synthetic locations verifies bounded keyset access using the organization index. Prior partner/AI/photo query proofs remain in the full regression. Local timings are observations, not an accepted production SLA.

## Validation and remaining acceptance

The [source-bound focused proof](evidence/P2/p2-pr-006-local-proof.json) records mapper/input tests, native PostgreSQL cases, intended red failures, actual index observation and owned cleanup. Tests exercise current membership/RLS, pooled-context reset, cross-tenant cursors, exact int64 decoding, identity CAS, offer review/publication, last-code/cap/frequency contention, post-wait expiry, rollback, idempotency, uncertainty/release, immutable corrections, masked cohorts and generation refresh. Run `node tests/fixtures/phase2/partner-repositories-run.mjs`; exact-commit full Linux build/regression and actual PR/main CI are additionally required for merge completion.

The additive [local migration](../../infra/database/phase-2-local/repositories/README.md) extends the existing checksummed track; prior schemas/manifests/models/bootstrap/CLI/preflight/policy/dependencies remain unchanged. This fixture does not promote the track, provision hosting, install providers or wire production composition. Restore/purge compatibility for new receipts, retention/erasure policy, domain services and the complete S2 review require later work and actual acceptance.

All six S3 gates remain open; HS01–HS08 remain proposed; operators/coverage/rates and provider/model/budgets are unconfirmed; specialist/licensed work remains pending. Actual phase entry, feasibility, S1/S2, privacy/source/restore/provider/pilot/deployment acceptance stays held. No provisioning, purchases, actual recipient notifications, model/provider calls or case/gate closure occurs.
