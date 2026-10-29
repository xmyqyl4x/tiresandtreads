# P1-PR-027 — restricted-admin local investigation validation

**October 28, 2026 (Pacific) · Local evidence only.** Baseline: owner-approved PR #42, merged at `ad9c55a007b945aee7bdca94b7da3ddc23502e62`. [Investigation](../../P1-PR-027-restricted-admin-investigation.md), [result summary](p1-pr-027-restricted-admin-local.json), [official PostgreSQL references](p1-pr-027-restricted-admin-sources.json).

## Test-first and experimental observations

The 13 database scenarios were written before their fixture helper. The initial disposable run failed collection because the helper was absent; no SQL outcome is credited to that run. Once implemented, the first actual SQL diagnostic passed 12/13 and refuted the assumption that granting SET permission alone permits changing default privileges as the non-inheriting creator. The test now explicitly checks that transfer is enabled, direct default-ACL change is still denied, and actual role assumption is needed. No production policy was changed to make the hypothesis pass.

The next diagnostic passed that case but failed snapshot equality because repeated grants reordered the database ACL array. Canonical `aclexplode` records compare actual privileges, grantee/grantor and grantability rather than array order. Empty default-ACL rows are retained; an actual CONNECT grant must produce a snapshot difference. A subsequent focused working-tree project **`tt-test-034ab73cf41ce993`** passed **13/13**, zero failed/skipped, in **14.58 seconds** reported by Vitest. This is a preparation diagnostic, not final-commit evidence. The final focused working-tree project **`tt-test-cb2cb5ff66ad9909`** then passed **13/13** with role-settings/all-role capability assertions and empty-default-ACL handling, zero failed/skipped, in **6.51 seconds** reported by Vitest. Cleanup and exact-project removal checks passed. Final committed checks remain separate.

The exact-owner replay scenario deliberately changes the owner's statement timeout to 27 seconds before replay. Bootstrap attempts its ordinary earlier role-setting updates before failing to administer another role; the complete role-settings/ownership/membership/ACL snapshot must retain the pre-attempt state. This proves rollback of observable settings rather than comparing already-identical values. The positive control explicitly grants administrative CONNECT for its refusal test so a connection denial is not mistaken for a role-administration denial.

The final runtime control verifies restrictive flags for **all 19 scoped roles**, zero scoped memberships, denied default function EXECUTE/type USAGE, RLS row filtering, denied schema creation/owner assumption and denied app/CMS cross-connections. The privileged fixture control is not a managed service, hosted bootstrap adapter, accepted S1 choice or runtime privilege expansion. No real provider behavior, RPO/RTO, rights/policy, specialist or custody acceptance is inferred.

## Target and cleanup boundaries

`pnpm verify:restricted-admin` accepts no arguments, creates a random `tt-test-*` environment, runs only pinned Docker PostgreSQL/tooling on the internal test network and exposes no database host port. Its fixture first applies the existing disposable-target guard, rejects pre-existing proof roles/databases and generates its own random passwords. Only newly created synthetic databases/roles are removed. Root/client secrets, raw connection URLs and PostgreSQL password hashes are not serialized into the evidence. Ordinary proof roles are synthetic actors, not appointed operators.

The runner closes clients, tears down only its generated Compose project and volumes, verifies exact-project cleanup by label and removes the generated environment file even after test failure. `stage`/target/URI arguments refuse before environment creation. No native PostgreSQL, retained dev/stage settings/credentials/data/keys/journals/provider manifests, cloud account, provider endpoint or recipient is a test input. No provisioning, purchases, notifications or global cache/resource cleanup.

## Preservation and scope

Production bootstrap, role definitions, migration/TLS/version guards, runtime composition, schema/migrations, dependencies/lockfile and CI remain unchanged. Only a local diagnostic entry/runner and real database test fixture/scenarios are added. The existing database project automatically includes the 13 new cases; no coverage/audit/negative gate is weakened. Unit/business code is not changed, so these new SQL contract/use-case tests complement the existing unit suite rather than duplicate implementation with stubs.

The staging decision packet only gains one local investigation reference. Every HS object, actual selection, authority, historical cost model, connection budget and prior review entry remains unchanged. S3-service-host gains seven local evidence paths; all six actual gates retain pending status, empty records and false acceptance/activation/API flags. Operator assignments, coverage and rates remain unconfirmed; specialist/licensed work pending and APIs/frontends held. The next lifecycle contract is a design proposal only, not an implemented refactor or newly approved exception.

Preserve 119 original cards/dependency edges, 137 FR rows, 75 checked/282 unchecked tasks, three parent completion boxes, historical approvals/source archives, all 23 SP08 receipt pins/index/baseline blobs and prior evidence files including the merged operations/budget and HS01/HS02 models/sources/validation. Check references, local links/anchors/path case, UTF-8 without BOM/LF and Git whitespace. Source SHA-256 pins for unchanged production/guard/dependency files accompany the result summary.

## Committed verification

Commit the complete revision and run the unchanged exact-commit `pnpm verify:push` Linux gate on a clean tree. Expected total: **1,260 tests**, the prior 1,247 plus 13 real DB scenarios. Measure final counts, coverage, source/tree/lockfile-bound evidence and independent final-head CI in the PR/checks; never relabel the focused working-tree run or an earlier CI checkout as fresh committed evidence.

The complete audit, quality/types/layers/contracts/migrations/models/S3, coverage, negative gates, build/HTTP/lifecycle, recovery/custody/deployment/capacity/observation/provider and mandatory generated-project cleanup remain required. `s3:check` must pass; strict `s3:acceptance` must still refuse with exit 2. Local test success does not close an S3 acceptance gate, approve HS01–HS08 or release any operator/rate/specialist/licensed/API hold.
