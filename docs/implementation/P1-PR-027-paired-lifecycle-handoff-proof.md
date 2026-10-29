# P1-PR-027 — disposable paired-database validation and receipt/handoff proof

**October 29, 2026 (Pacific) · Local technical proof only.** Approved [PR #45](https://github.com/xmyqyl4x/tiresandtreads/pull/45) merged at `25b063798ed9ec1c1b188d3121915953af76578a`, accepting the [phase-aware local reader proof](P1-PR-027-lifecycle-validation-proof.md). The owner then authorized this paired proof in disposable test support. Production bootstrap/CLI/preflight/policy remain unchanged. HS01–HS08 remain proposed, operators/coverage/rates unconfirmed, six actual S3 gates open with empty records, specialist/licensed work pending and APIs/frontends held. No provisioning, purchases or notifications.

This continues P1-PR-027 under `S3-service-host`; it does not complete that task or choose a provider/operating model. [Measured preparation evidence and source pins](evidence/P1/p1-pr-027-paired-lifecycle-local.json), [official sources](evidence/P1/p1-pr-027-paired-lifecycle-sources.json), [validation receipt](evidence/P1/p1-pr-027-paired-lifecycle-validation.md).

## Implemented test support

[Receipt state](../../tests/fixtures/lifecycle-pair/contract.ts), [SQL pair coordinator](../../tests/fixtures/lifecycle-pair/pair.ts), [synthetic unit inputs](../../tests/fixtures/lifecycle-pair/samples.ts), [no-argument disposable runner](../../tests/fixtures/lifecycle-pair/run.mjs), [unit cases](../../tests/unit/lifecycle-pair.test.ts), [state use case](../../tests/usecases/lifecycle-pair.test.ts), [real SQL workflows](../../tests/database/lifecycle-pair.test.ts). All seven new code files are under `tests/`. Existing production code, prior reader/fixture/tests, dependencies/lockfile, package scripts, migrations and CI stages remain unchanged. Existing unit/use-case/database discovery includes the new files automatically.

The coordinator admits exactly one app and one CMS request through the unchanged reader's local-only guards. Both must name their exact owner/DB, verified fixture TLS endpoint and the same phase/project. Controlled baseline and request inputs are copied before asynchronous work; a later caller mutation cannot redirect them. Environment and manifest identity are checked before and after each observation batch. No arbitrary SQL, alternate expected catalog, repair option or retained/native/hosted target is accepted. All binding labels must be primitive strings; objects with custom string conversion refuse. Three additional identity fields are synthetic fixture operation, release digest and credential-generation labels; they do not attest an actual deployment, image, config, secret vault or provider identity.

## Pair, receipt and handoff behavior

| Operation | Required observation | Local result |
| --- | --- | --- |
| Validate | Exactly app then CMS pass the same foundation, migrated or synthetic quarantined-recovery profile | One immutable evidence object; no partial receipt |
| Refuse | Either side unavailable/incompatible/configuration-invalid, mixed phases, stale source/project, contention or invalidation | No receipt, repair, grants, migration or activation |
| Handoff | Original live object from this coordinator, unused and younger than 15 seconds from monotonic observation start; then fresh reads of both DBs | `observed` only if both fresh reads pass; all hosted/product/runtime authority flags stay false |
| Repair or declared change | Prior handoff consumed or generation invalidated | Old evidence remains refused after repair; a new full validation is required |
| Export or replay | JSON copy, another operation/fixture/release/generation, expired or consumed receipt | Refused; a matching summary/hash is not authority |

Receipt fields bind the random disposable project, coordinator fixture ID, synthetic operation/release/generation, common phase, app/CMS source manifests, controlled baseline and exact endpoint/owner/database/CA digests. They include bounded check summaries, a wall-clock display time and a SHA-256 digest. Expiry uses process-monotonic time and rejects a value before issuance. Secret values and password hashes, URIs, CA bodies, catalog bodies, row data, SQL and driver errors are excluded. Nested receipt data is frozen. Only one current object is retained in memory; no receipt file, signature/import protocol, signer, custodian or retention policy is introduced. The digest detects content differences; it is not a signature or provider attestation.

Each validation or handoff holds a dedicated app-owner TLS/read-only transaction with nonblocking `pg_try_advisory_xact_lock(7724046,1)`, and runs the two existing owner inspections sequentially. At most two proof owner connections overlap: lock holder plus one inspector. A final query verifies that the lock session survived the reads. Rollback/closure releases it on success or failure; no lock/journal table is created. PostgreSQL documents [transaction-level advisory lock behavior](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS) and its [cooperative scope](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS). This is a disposable diagnostic allocation, not a change to approved/proposed hosted capacity budgets.

The lock coordinates participating coordinators during **each observation batch**. It is not continuously held between initial validation and a later handoff. Unrelated administrators/provider control planes can bypass it. The DB snapshots remain separate; there is no atomic cross-DB snapshot, release transaction or guarantee against transient/later drift. Read-only [transaction properties](https://www.postgresql.org/docs/18/sql-set-transaction.html) bound fixed catalog queries, not the owner's underlying privileges or every possible disk write. A fresh observation does not execute a release or activate any runtime.

## Real SQL workflows and adverse evidence

| Control | Measured outcome |
| --- | --- |
| Foundation, migrated and synthetic quarantine | Both DBs validate, then are read afresh at handoff; durable snapshots unchanged. Foundation creates no future metadata; all 17 quarantined runtime connections remain denied |
| App-only migration commit | All 33 real app migrations commit under the app owner; CMS remains foundation. Pair refuses, preserves committed app history and leaves CMS unchanged |
| CMS-only migration commit | All three real CMS migrations commit under its exact owner; app remains foundation. Pair refuses without a false cross-DB rollback or repair |
| Partial app/CMS ledger | Either side refuses; the peer's committed history and full before/after snapshot remain equal. Fixture teardown restores original microsecond timestamps |
| ACL drift in either DB after initial evidence | Fresh handoff reports incompatibility and preserves the defect. Repair does not revive consumed evidence; a new validation is needed |
| Real app/CMS owner password change | Old captured credentials fail; receipt/handoff refuses, leaks neither password nor password hash and never rotates credentials itself |
| CMS metadata reassigned to the other owner | Actual history-read permission error becomes masked unavailable; no raw SQL/driver message and no state change |
| Competing lock, busy reentry or terminated lock backend | Refusal; no stale apparent protection. A fresh attempt succeeds after cleanup; no inspection session remains |
| In-flight invalidation/closure or changed environment | No receipt is issued; no redirection, target repair or leaked session |
| Copied/foreign/stale/expired/replayed records | State tests and real coordinator tests refuse; output flags remain false |

Only fixture setup/fault/teardown code uses the already approved disposable mutation helpers. The coordinator never invokes bootstrap, the mutation-capable CLI status, migration, restore, seed, password rotation or runtime admission. Quarantine is the existing synthetic catalog/CONNECT shape, not a new archive restore, signed-journal replay, provider effect reconciliation or promotion.

## Test-first evidence and remaining scope

State tests preceded the prototype; initial collection failed for the missing modules. The first implemented SQL/state run passed 49/49. Two additional state controls and four SQL controls were then added. A new monotonic-boundary test failed (22 passed/one failed in that unit run): consumption admitted a supplied time between observation start and issuance. The implementation now requires consumption at or after issuance, preserving expiry from observation start. The 55-case refinement passed. Final review added a primitive-identity control, which failed with 23 unit cases passing/one failing because coercible objects could pass format checks. Binding fields now require primitive strings before formatting. The initial full verification was deliberately stopped at its exact owned test container and normal project cleanup completed before this guard was added; it is not counted as a successful full run. Final focused preparation project `tt-test-8b259b123c0b6521` passed **56/56** in **26.52s**: **24 unit, one state use case and 31 real PostgreSQL cases**, zero failed/skipped; exact disposable cleanup passed. No policy or test threshold was weakened.

This adds local subsets for original BLC-T02/T03/T12/T15/T16/T19/T20. All 22 original design-case records remain proposed/historical; the whole lifecycle is not implemented or accepted. No original task box or actual S3 record is advanced. Actual provider administration, compatible image/config selection, durable provisioning journal/replay, rotation executor, independent receipt custody and real restore/current-journal continuity remain unresolved. Prior SP08 receipts and earlier proof artifacts remain frozen apart from append-only navigation/reference records.

Reproduce with `node tests/fixtures/lifecycle-pair/run.mjs`. It accepts no arguments, generates a random isolated local Docker project with pinned PostgreSQL 18.6 and existing TLS tooling, exposes no DB host port, runs the three new test files, removes only its generated resources, asserts exact-label cleanup and deletes its environment file. `stage` or URI arguments refuse before environment creation. Native PostgreSQL and retained dev/stage data/settings/credentials/keys/journals/provider manifests are not inputs. Final committed full-suite and independent CI evidence belongs in the PR description after the clean-commit gates run; this document records the measured preparation diagnostic.

Recommend a **local-only interrupted-executor and cold-restart handoff proof** next: terminate a participating validation process, verify lock/client cleanup, refuse imported old records and require fresh both-DB evidence after restart. Keep it in disposable test support; no durable provisioning journal, release/rotation executor, production change or activation. This is a proposal only, not implemented or automatically authorized here.

Four usable live phases, option C outside Vercel, PostgreSQL consolidation without Redis/ClickHouse and database → repositories → services → APIs → frontends remain unchanged. HS01–HS08 proposed; operators/coverage/rates unconfirmed; six S3 gates open; specialist/licensed work pending; APIs/frontends held. No provisioning, purchases or notifications.

## PR #46 local paired-proof approval record

On October 29, 2026 (Pacific), the owner approved PR #46 and it merged at `b7e159075cc3159aea2dfb061a1add42e25ca101`, accepting this disposable paired proof only. The owner then authorized the [interrupted-executor and cold-restart proof](P1-PR-027-interrupted-executor-cold-restart-proof.md) in disposable test support. Original measured artifacts remain historical. Production bootstrap/CLI/preflight/policy unchanged; HS01–HS08 proposed; operators/coverage/rates unconfirmed; all six S3 gates open; specialist/licensed work pending; APIs/frontends held. No provisioning, purchases or notifications.
