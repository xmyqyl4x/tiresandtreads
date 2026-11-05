# P2-PR-005 — Local schema, upgrade and recovery validation

The owner's next-card continuation follows completed [PR #92](https://github.com/xmyqyl4x/tiresandtreads/pull/92). The [authorization record](evidence/P2/p2-pr-005-local-authorization.json) permits local card 005 implementation, validation and merge. It does not grant actual S1 approval, promote migrations or authorize later repositories. The original S1 approval task remains open in the [task card](../tasks/phase-2-prs.md#p2-pr-005).

**Trace:** storage evidence for DB12/DB23/DB24/DB25/DB26/DB28 and E04/E21/E36/E39/E40/E41. Existing requirements, six S3 records and original case/gate statuses remain unchanged.

## Combined validation

The three preceding local schema cards supply 43 forced-RLS tables, scoped views, real tenant/owner refusals, lease/choice races and bounded query plans. This card composes their exact checksummed sources with an [additive integrity migration](../../infra/database/phase-2-local/gate/README.md). Default P1 app/CMS manifests, generated models, bootstrap/CLI/preflight and dependencies remain unchanged.

| Proof | Scope and observed acceptance boundary |
| --- | --- |
| Empty install | Truly empty app database through all 43 migrations, including ten opt-in extensions; restricted migrator, replay no-op and failed migration atomicity/checksum refusal |
| Populated upgrade | Original 33-entry history and every original P1 row preserved across all 141 baseline tables; two expected asset-purpose codes are additive; retained partner membership and AI policy survive later extensions |
| Schema parity | Fresh and upgraded columns/defaults, constraints, indexes, relation ACLs, function definitions/security, policies and triggers compare; restored catalogs compare with the exact PostgreSQL CHECK formatting exceptions below |
| Archive drill | Real custom-format P1 and full archives; full restore and separate pre-erasure replay copy preserve all rows across 184 installed tables, including history |
| P1 compatibility | Unchanged report repository and transaction helpers read the retained report under the real existing private runtime role on upgraded, fully restored and P1 rollback databases |
| Grants and isolation | All 43 new tables force RLS; old app runtime has no direct P2 table privileges; all ten new roles remain restricted; real partner/photo/CSV readers preserve tenant, owner and independent review rules after restore |
| Indexes | Child-side leading-index audit for high-cardinality ownership, assets, AI requests/artifacts/attempts/budgets/jobs, reports, deletion requests, datasets and partner parents; existing 10,000-row partner/AI and 1,000-row photo plan proofs run together |
| Purge and replay | Wrong-order parent deletion is refused; unresolved AI holds cannot be purged; terminal reconciliation keeps spend; fixed synthetic photo graph deletes children first while P1 report, CSV approval and partner records survive; retained markers invalidate the pre-erasure archive before its photo reader is admitted |

Thirty new integration cases and 202 preceding native cases run together (232 total), with bounded setup/teardown for five disposable databases. The [source-bound proof record](evidence/P2/p2-pr-005-local-proof.json) records actual counts and intended red failures. Run `node tests/fixtures/phase2/schema-gate-run.mjs`; exact-commit full Linux build/regression, all PR/main checks and exact-head review are required for merge completion.

PostgreSQL reparses some existing CHECK expressions during dump/restore, flattening nested associative AND groups. The fixture records exact before/after strings in a bounded comparison map; it does not strip arbitrary SQL or ignore checks. All other definitions and validation/deferred flags must match. NOT NULL identity compares column attributes and normalized column-key names rather than PostgreSQL-generated constraint names.

## Upgrade and backfill strategy

1. Actual promotion requires owner-reviewed S1, phase entry, role/host/operator/provider/privacy/source decisions and the six open S3 gates. No command in this card changes current production admission. Existing production preflight continues to reject an extended local history.
2. For a future admitted target, inventory the exact current checksums/history, owners, grants, storage capacity and old/new application compatibility. Acquire a verified recovery point and retain required erasure markers separately before migration. Never edit an applied migration or reuse these fixture credentials/commands as a production runbook.
3. Provision restricted roles only through a separately approved production lifecycle. Apply additive schema before activating consumers. New tables default empty and policies pending/draft; only two reference codes are inserted. No speculative historic AI choice, consent, photo, source rights, reseller agreement or approval is backfilled from old P1 rows.
4. Keep P1 serving through the unchanged repository contract; deploy P2 consumers disabled until their own service/API/privacy acceptance. Future necessary backfills need versioned scripts with keyset batches, checkpoints, idempotency, row/byte/time budgets, cancellation, source rights and before/after validation. Do not run a large data backfill in the migration transaction.
5. Local migrations are transactional and use bounded statement/lock limits. The new index is built on a new local table. This is not an online production index proof: size/lock/maintenance measurements must decide whether a separately reviewed concurrent-index lifecycle is needed before promotion. No low-downtime or production SLA is accepted here.

## Purge ordering and retained evidence

| Graph | Required order and remaining service responsibility |
| --- | --- |
| Photo/AI | Cancel/fence jobs and withdraw processing authority; retain owner-free asset barriers; reconcile uncertain cost before deletion; remove selections/attachments/reuse references where present, confirmations/candidates/extractions, provenance/artifacts, terminal reservations/attempts/requests, mutual photo claims/uploads in one deferred transaction, guards/scopes, then eligible policy/window/job/assets. Keep historical spend and required erasure markers. The fixed native proof exercises its populated subset; later workers must handle the full report/delivery/source graph. |
| CSV | Revoke current publication eligibility first; remove review children before intake/template/evidence and source assets. P1 dataset/run/publication heads remain the source of truth. Do not purge published catalog versions still referenced by reports or provenance; rights, legal retention and evidence policy need actual review. |
| Partner | Revoke membership/serving before erasure; resolve/cancel coupon, frequency and cap reservations and correction/dispute history; remove dependent selections/events/metrics before pools/versions/offers, then organization children and parent. Deferred version pointers require one transaction. Retained ledger totals and suppression/cohort rules need later services and accepted privacy policy; raw cascade deletion is not an approved strategy. |

The fixture deliberately does not delete the P1 subject or report. Its synthetic reservation settles to 40 minor units with no provider call; settled history deletion leaves spend at 40. Production cost retention/billing reconciliation and the complete privacy executor are later work. Local table-row removal does not prove removal of encrypted bytes, object versions, backups or logs.

## Recovery and rollback

The fixture owns five fixed databases inside a random disposable Docker project: upgraded source, empty-install target, full restore, P1 rollback and pre-erasure replay. Runtime CONNECT starts revoked on restore targets. The disposable maintenance identity alone executes fixed `pg_dump`/`pg_restore`; restored objects keep restricted owners, and runtime grants are opened only for specific local tests. Existing runtime identities cannot dispatch server programs. Every owned database/role/container/volume is removed afterward.

Rollback is a restore of the verified P1 archive into an empty isolated target, not reverse DDL on the upgraded database. The retained P1 report is read through its original runtime repository. A real post-cutover rollback must additionally capture/reconcile writes after the recovery point, replay erasure/suppression and journal evidence, validate provider effects, prove custody and get operator approval before traffic moves. This fixture has no concurrent live traffic or external effects and makes no zero-data-loss/PITR claim.

For deletion replay, two parent-held synthetic barrier IDs from the purged copy are applied to the old full archive while its photo runtime remains closed. Current AI artifact/candidate/confirmation reads then fail closed. This is a same-instance refusal proof with simulated retained marker custody; it does not prove independently durable/authenticated/fenced journals, off-host backups, hosted recovery or accepted restore operations.

## S1 decision

The [S1 readiness record](evidence/P2/p2-s1-local-readiness.json) is a pending approval record, not a sign-off. Local implementation/proof evidence can be complete while actual approval remains held. Actual phase entry/feasibility, specialist/source/provider/privacy/restore/pilot/deployment acceptance, operator coverage/rates, production role lifecycle and promotion evidence still require their respective decisions. No later card is accepted by this record.

All six S3 gates remain open; HS01–HS08 remain proposed; operators/coverage/rates and provider/model/budgets are unconfirmed; specialist/licensed work remains pending. No provisioning, purchases, actual recipient notifications, model/provider calls, case closure or gate closure occurs.
