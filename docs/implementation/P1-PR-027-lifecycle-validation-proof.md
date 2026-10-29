# P1-PR-027 — disposable phase-aware read-only validation proof

**October 29, 2026 (Pacific) · Local technical proof only.** Owner-approved [PR #44](https://github.com/xmyqyl4x/tiresandtreads/pull/44) merged at `d407a86c2f3763ef68a9c9295889d5b5a84b4b2a`, accepting the [lifecycle contract design analysis](P1-PR-027-bootstrap-lifecycle-contract.md). The owner then authorized this phase-aware proof in disposable test support. Production bootstrap, CLI, preflight and policy remain unchanged. HS01–HS08 remain proposed; operators/coverage/rates unconfirmed; all six actual S3 gates pending with empty records; specialist/licensed work pending and APIs/frontends held. No provisioning, purchases, notifications, provider login, accounts, DNS or remote deployment.

This continues P1-PR-027 under `S3-service-host`. It is not a new core task, hosted compatibility result or accepted provider/operating model. [Measured preparation evidence and source pins](evidence/P1/p1-pr-027-lifecycle-proof-local.json), [official sources](evidence/P1/p1-pr-027-lifecycle-proof-sources.json), [validation receipt](evidence/P1/p1-pr-027-lifecycle-proof-validation.md).

## Implemented test-support boundary

[Reader](../../tests/fixtures/lifecycle-validation/reader.ts), [fixture](../../tests/fixtures/lifecycle-validation/database.ts), [CMS setup child](../../tests/fixtures/lifecycle-validation/migrate.ts), [no-argument runner](../../tests/fixtures/lifecycle-validation/run.mjs), [unit tests](../../tests/unit/lifecycle-validation.test.ts), [real DB tests](../../tests/database/lifecycle-validation.test.ts). These six new files live under `tests/`; no production module imports them. No package script, dependency, lockfile, migration, CI stage, existing fixture/runner or runtime composition changes.

The request accepts only mode, phase, app/CMS target, exact owner URL and fixture CA. It requires test-local/fixture mode, a random 16-hex `tt-test-*` project, the fixed synthetic lifecycle DB names, exact respective owner, generated credential format, port 5432 and the existing test TLS host aliases. Native/retained/cloud targets, alternate roles, query/fragment options, arbitrary SQL, expected-history/catalog overrides and repair switches refuse. The connection boundary re-admits settings against the current disposable environment and builds canonical driver options; a typed settings object is not authority.

Each inspection uses an owner-authenticated dedicated TLS connection, verified CA/hostname, `search_path=pg_catalog`, default read-only mode and explicit repeatable-read/read-only transaction. Statement timeout is one second, lock timeout 250 ms, idle-in-transaction timeout one second and transaction timeout five seconds. Success and failure roll back the inspection transaction and close the session. The inspector executes only fixed catalog queries; it never invokes the mutation-capable CLI `status`, bootstrap, migration, seeding, restore or repair paths. The separate exported test wrapper is used to demonstrate PostgreSQL rejection of hardcoded writes and stalled queries; it accepts no caller SQL in the inspection request.

PostgreSQL [read-only transaction controls](https://www.postgresql.org/docs/18/sql-set-transaction.html) are one boundary, not a general SQL sandbox or a reduction of the owner's underlying privileges. Catalog allowlisting, local target admission, TLS and closure remain necessary. The before/after comparisons concern durable project catalog/history/role state; connection statistics and normal server logging are not claimed immutable.

## Three real catalog profiles

| Profile | Fixture preparation | Inspector expectation | Observed local result |
| --- | --- | --- | --- |
| Foundation | Existing privileged local bootstrap establishes both fresh app/CMS DBs and all 19 exact restricted roles | Correct DB/schema owners, exact role flags/settings and no incoming/outgoing scoped memberships; baseline grants/defaults; future migration metadata and application objects absent | Both owners pass without creating metadata. Migrated/quarantine requests refuse this state |
| Migrated | Exact app owner applies all 33 reviewed SQL migrations; a bounded child runs all three CMS migrations as its exact owner, with fresh synthetic CMS secret | Full controlled-fixture catalog/ACL/policy/type baseline, exact ordered ID/checksum/position history and matching CMS native ledger; scoped runtime admission and peer denial | Both owners pass; foundation/quarantine requests refuse. Changed/missing/gapped/extra histories and CMS push-state drift refuse |
| Quarantined recovery | Same known migrated schema, then revoke CONNECT from all 16 app runtimes and the one CMS runtime | Migrated catalog/history intact, owner inspection retained, all 17 runtime connections denied and no release/promotion authority | Both owners pass; every actual runtime login attempt fails. Foundation/migrated requests refuse |

The recovery profile is a **synthetically prepared quarantined catalog shape**. This task does not perform a new archive restore, journal replay, provider effect, custody acceptance or promotion. Existing recovery suites remain required and their historical receipts unchanged. The foundation/migrated/quarantine profile is evaluated per DB; a pair of results is not an atomic cross-DB snapshot or a release coordinator.

## Baselines, findings and adverse controls

Expected foundation/catalog digests are captured by controlled test setup before faults; the migrated digest follows checksum-validated repository migrations. Immutable digest records bind the disposable project and current app/CMS source manifests. Inspection never learns a replacement baseline from a defective target or accepts one in its request. These are trusted fixture expectations, not independently signed/provider-reviewed production baselines or bearer release receipts.

The reader checks all 19 role flags and both [membership directions/options](https://www.postgresql.org/docs/18/catalog-pg-auth-members.html), both DBs' effective admission/peer privileges and exact [per-role/per-DB settings](https://www.postgresql.org/docs/18/catalog-pg-db-role-setting.html). Catalog comparison includes user schemas, reviewed relations/sequences/columns/views, constraints/indexes/triggers, routines/definer definitions, type owners and RLS policy definitions. ACL comparison expands [privileges](https://www.postgresql.org/docs/18/functions-info.html) into grantee, grantor, privilege and grantability, preserving empty default-ACL rows. Raw ACL-array order is excluded from semantic equality.

| Adverse control | Observed outcome |
| --- | --- |
| Wrong phase, environment, target, role, URI options, caller SQL/repair fields or stale project/source binding | Configuration or incompatible result; no authority inferred and no target repair |
| Missing role, peer-role BYPASSRLS, ADMIN-only incoming or outgoing membership and 27-second role timeout drift | Defect reported with complete before/after catalog/role/settings snapshots equal |
| PUBLIC DB/schema grants, future public function access, wrong runtime CONNECT or peer CONNECT | Defect remains present while inspection reports it; owner/default grants are not reset |
| Actual ACL-array reorder from revoking/regranting an untouched runtime's CONNECT | Raw ACL text changes; semantic snapshot remains equal and validation passes. Actual added grants elsewhere still fail |
| Table owner, object grant, RLS flag or unvalidated-constraint drift | Frozen pre-fault catalog comparison reports incompatible state without adopting it |
| Missing/changed/gapped/extra app history and negative CMS native batch | History mismatch reported without ledger writes; test teardown restores original values/timestamps |
| Metadata table reassigned so the inspecting owner cannot read its ledger | Real SQL permission failure is masked as unavailable; target remains unchanged and session closes |
| Wrong CA/hostname; redirected or foreign-project settings at connect | Refused/unavailable; no raw credential, URL, SQL or driver error is returned |
| Hardcoded permanent-table DDL, ALTER ROLE and UPDATE through the read-only wrapper | PostgreSQL returns 25006; catalog/settings and synthetic sentinel value remain unchanged |
| Five-second sleep through the wrapper | Server statement timeout returns 57014; session closes and durable state is unchanged |
| Another fixture encounters pre-existing scoped resources | Refuses without adoption, deletion or modification of the existing proof resources |

Reports contain only fixed status/finding enums, phase/target and bounded counts/booleans. No catalog body, password/hash, connection URI, CMS secret, report/user row or journal content is serialized. All reports retain `hostedAccepted=false` and `productActivation=false`. This report is not a deployment or acceptance authorization.

## Test-first results and design coverage

The unit/DB tests were written before their reader and fixture; the initial run failed collection for missing modules. The first implementation passed **56/56** SQL/guard cases. Strict optional-property typing was then corrected without a type-policy waiver. Boundary re-admission, missing-role, SQL-error and ACL-order controls were added. The ACL diagnostic passed 60/61: its chosen role had already been moved to the end by an earlier grant test, so removing/regranting it did not change raw order. The control now uses an untouched role and still requires an actual raw-order difference. The final focused diagnostic passed **62/62**, zero failed/skipped: **22 unit cases and 40 real PostgreSQL cases**. No production policy was changed to make a test pass.

| Original design case | Local evidence now | Still outside this proof |
| --- | --- | --- |
| BLC-T01, T03, T04 | Strict local requests, masked reports, phase distinction and no metadata creation | Hosted configuration, custody/retention and general production inspector |
| BLC-T02, T16 | Project/source baseline binding and connection re-admission | Operation/release/credential-generation receipts, stale evidence and serialized fresh handoff |
| BLC-T05, T06 | Real read-only writes denied; bounded timeout/SQL failure; TLS CA/hostname failures and session closure | Exhaustive transport failure modes and another engine/patch; no version guard waiver |
| BLC-T07, T08, T09 | All scoped flags/memberships/settings; canonical ACL control; sampled owner/grant/RLS/constraint drift | Every object-kind/grantor/grantability corruption and provider-specific roles/catalog visibility |
| BLC-T10, T19 | Effective peer/admission checks and all 17 quarantined runtime login denials | New row-filter/owner-assumption probes, actual restore/current journal/effect reconciliation and promotion |
| BLC-T11, T14 | Prior restricted-admin proof retained; real setup manifests and adverse app/CMS history inspection | New provider administration or owner-release executor acceptance |
| BLC-T20, T21, T22 | False activation/hosted flags, retained-target refusal, pre-existing-resource refusal, masked errors and exact disposable cleanup | Human acceptance, real notification/delivery, interrupted host custody and unknown provider effects |
| BLC-T12, T13, T15, T17, T18 | No new implementation credited | Provisioning journal/serialization, paired partial-release handling, rotation and independent reconstruction/restore |

This supplies local subsets of the 22 prospective design cases, not 22 new completed acceptance gates. The original design/model/validation remain historical and unchanged. No original task completion box or actual S3 record is advanced.

## Reproduce and next bounded proposal

Run `node tests/fixtures/lifecycle-validation/run.mjs` from the repository root. It accepts no arguments, creates a fresh random disposable Docker project using pinned PostgreSQL 18.6 and existing TLS tooling on the internal test network, exposes no DB host port and runs the two new test files. It closes clients, removes only its generated project/volumes, verifies cleanup by exact project label and removes its generated environment file. Supplying `stage`, a URI or another target refuses before environment creation. Native PostgreSQL, retained dev/stage credentials/data/settings/keys/journals/provider manifests and cloud endpoints are not inputs. The unchanged database/unit projects automatically discover these tests in local and CI verification.

Recommend a **local-only paired-database validation and receipt/handoff proof** next: bind both independent inspections to exact fixture/source/phase identities, handle partial/incompatible/unavailable pairs, invalidate stale evidence after drift and require a fresh handoff without issuing activation authority. Keep that prototype in disposable test support, preserving production code/policy and all holds. It is a proposal only, not implemented or automatically authorized here. Provisioning/rotation mechanisms, actual provider compatibility, patch lifecycle, funding/custody/staffing and all six actual S3 gates remain unresolved.

Four usable live phases, option C outside Vercel, PostgreSQL consolidation without Redis/ClickHouse and database → repositories → services → APIs → frontends remain unchanged. No provisioning, purchases or notifications.
