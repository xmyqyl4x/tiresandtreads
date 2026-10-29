# P1-PR-027 — local restricted-admin bootstrap/replay investigation

**October 28, 2026 (Pacific) · Local investigation only.** Owner-approved [PR #42](https://github.com/xmyqyl4x/tiresandtreads/pull/42) merged at `ad9c55a007b945aee7bdca94b7da3ddc23502e62`, accepting the [HS01/HS02 review analysis](P1-PR-027-host-database-review.md). The owner then authorized this local-only restricted-admin investigation. All HS01–HS08 remain proposed, operators/coverage/rates unconfirmed, six actual S3 gates pending with empty records, specialist/licensed work pending and APIs/frontends held. No provisioning, purchases, notifications, provider login, accounts, DNS or remote deployment.

## Result and decision implication

The **ordinary PostgreSQL 18.6 restricted-creator path fails the unchanged bootstrap/replay contract** in the tested profile. This confirms the earlier local-contract concern with real SQL. A non-superuser with `CREATEDB`/`CREATEROLE`, `NOINHERIT`, no replication and no RLS bypass cannot be treated as the local fixture superuser. Making project roles more powerful or ignoring their memberships is not a remedy.

A privileged **local control** can remove creator memberships, establish the exact 19 scoped roles and replay the existing bootstrap while keeping runtime privileges restricted. This is not a managed-provider implementation, proof of provider support or approval of self-operated S1. No actual DigitalOcean/RDS account or API was used. Managed S2 remains a conditional research candidate; its concrete provisioning/administration contract, engine lifecycle, custody, operations and funding remain unresolved.

[Tests](../../tests/database/restricted-admin.test.ts), [fixture](../../tests/fixtures/restricted-admin/database.ts), [focused runner](../../scripts/verify/restricted-admin.mjs), [local result](evidence/P1/p1-pr-027-restricted-admin-local.json), [source observations](evidence/P1/p1-pr-027-restricted-admin-sources.json), [validation](evidence/P1/p1-pr-027-restricted-admin-validation.md). This remains existing P1-PR-027, not launch task P1-PR-043.

## Observed cases

| Scenario | Cases | Observed result |
| --- | --- | --- |
| Real restricted creator identity and escalation denials | 1 | Server version 180006; superuser/replication/BYPASSRLS absent. Assuming `local_harness` or creating elevated roles fails with SQLSTATE 42501 |
| Automatic creator membership and revoke | 1 | Creator receives an admin membership granted by `local_harness`, without SET or INHERIT. Plain creator revoke leaves the grant in place; immediate `SET ROLE` is denied |
| Provider-style admin-owned app/CMS databases | 2 | Existing bootstrap refuses unexpected database ownership before scoped-role or ACL changes |
| Fresh restricted bootstrap on fixture-superuser-owned app/CMS databases | 2 | SQL permission refusal 42501; transaction rollback leaves no scoped roles and preserves database/schema/ACL state |
| Roles precreated by the restricted creator | 2 | All 19 scoped roles have automatic creator memberships. App and CMS bootstrap reject those memberships without changing state |
| Configuration, ownership transfer and default ACL actor | 1 | Creator can configure its child role. Transfer initially fails; explicit SET permission enables transfer. Changing default privileges still fails until the session actually assumes the owning child role. Membership remains |
| Privileged cleanup and replay control | 1 | Only the fixture superuser clears the 19 automatic grants in this experiment. Privileged bootstrap/replay succeeds with zero project-role memberships. Explicit admin CONNECT separates admission from administration; subsequent restricted replay still fails |
| Exact restricted migrator acting as replay administrator | 2 | Both app and CMS owners fail replay of other roles with 42501; snapshots remain unchanged |
| Restricted runtime behavior after privileged replay | 1 | Function EXECUTE and type USAGE defaults remain denied; RLS returns no rows to the restricted reader; schema creation, assuming the owner and cross-database connections remain denied |
| **Total** | **13** | Local technical scenarios, not provider acceptance |

The fixture snapshots role flags, incoming/outgoing memberships and grant options, role-specific settings, database/public-schema ownership, and database/schema/default ACLs. ACLs use sorted `aclexplode` privilege records, including grantor, grantee and grantability; ACL array order is not a permission change. An actual added CONNECT grant must change the snapshot. This comparison is test support, not a new production validator. [PostgreSQL ACL functions](https://www.postgresql.org/docs/18/functions-info.html).

## Why a broad admin role does not solve replay

[PostgreSQL role rules](https://www.postgresql.org/docs/18/role-attributes.html) distinguish role-creation administration from permission to assume or inherit a role. The probe observes those dimensions directly. The current [bootstrap](../../scripts/database/bootstrap.ts) rejects any membership attached to a scoped role, regardless of whether it seems convenient for administration. A temporary SET grant still creates state that conflicts with that rule until a separately authorized privileged mechanism removes it.

The [ownership-transfer rules](https://www.postgresql.org/docs/18/sql-alterdatabase.html) and [default-privilege rules](https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html) also apply to different operations. With a non-inheriting creator, merely holding SET permission is not equivalent to running as the owner for default ACL changes. The unchanged bootstrap does not add this role-switching path, and no such path is introduced here. Creating correct low-privilege roles is distinct from being able to administer them again.

The positive control is deliberately privileged and uses only the generated local fixture authority. It does not show that a managed service exposes the necessary grantor cleanup, ownership or replay operations. The tested profile is ordinary PostgreSQL with explicit flags; provider-specific built-in roles, user APIs, grantors, membership policies and defaults can differ. Provider documentation or a future separately authorized proof must establish those exact capabilities. There is no hosted compatibility verdict and no automatic switch to self-operation.

## Reproduce locally

Run `pnpm verify:restricted-admin` or `node scripts/verify/restricted-admin.mjs` from the repository root. The command accepts **no arguments**. It generates a random disposable `tt-test-*` Docker project, uses pinned PostgreSQL 18.6 on an internal test network with no host DB port, builds the existing tooling image and runs the 13 database scenarios. Only synthetic roles/rows and generated fixture passwords are used. Native PostgreSQL, retained dev/stage databases/settings/credentials/journals/keys/provider manifests and cloud targets are not inputs.

The fixture calls the existing disposable-target guard before connecting. It refuses pre-existing proof roles/databases, closes its clients and removes only objects created after those checks. The runner removes its exact generated Compose project/volumes, verifies cleanup by project label and removes its generated environment file. A failure still triggers cleanup. Supplying `stage` or any target/URI argument fails before environment creation. No provider credentials, effects, live dataset, actual recipient or task scheduler is configured.

The tests are part of the existing database project, so the unchanged full local/CI gate discovers them automatically. No CI stage, runtime composition, migration, dependency version, role policy or hosted adapter is added. The new package script is a focused diagnostic entry, not a deployment command.

## Test-first investigation and evidence limits

Tests were written before the fixture; the initial collection failed for the missing helper. The first SQL diagnostic passed 12/13 and refuted the assumption that SET permission alone permits default-ACL changes. The next passed that case but exposed ACL array ordering in the replay snapshot. Canonical privilege comparison resolves that test-fixture issue while retaining a real CONNECT-change control. The final focused working-tree run passed 13/13; its generated project and timing are recorded in the validation receipt. These are investigation refinements, not changes to the production bootstrap or a claim that earlier failed attempts passed.

The [final exact-commit procedure](evidence/P1/p1-pr-027-restricted-admin-validation.md#committed-verification) still requires all existing quality, coverage, negative-gate, build and recovery suites, plus independent CI. The full total is expected to increase from 1,247 to 1,260 through these 13 real DB cases. Measured final SHA/tree/lockfile and outcomes belong in the PR/checks rather than a self-referential receipt. Technical success does not accept S3.

## Recommended next bounded decision

Review a **bootstrap/provisioning lifecycle contract** next: which authority creates roles/DBs and removes grants, which read-only invariants are checked afterwards, and which ordinary owner-scoped migration/replay operations are needed for a release or restore. Distinguish a provider-supported privileged setup mechanism from ordinary restricted SQL. Specify negative tests, credential custody, handoff, recovery and audit evidence before proposing implementation. Preserve all 19 role names, zero project-role memberships and restrictive capabilities unless a separate explicit policy decision changes them; this investigation requests no exception.

That next contract/design review is a proposal, not implemented or automatically authorized here. Host/region/edition, patch compatibility, operator assignments/rates, complete funding, HS03–HS08 and all actual provider/source/specialist/privacy/custody acceptance remain open. No API or frontend work follows automatically. Four usable live phases, option C outside Vercel, PostgreSQL consolidation and database → repositories → services → APIs → frontends remain unchanged.

## PR #43 local investigation approval record

On October 29, 2026 (Pacific), the owner approved PR #43 and it merged at `f878e8fd16c6f03796d80f330cde918eaf175d85`. Approval accepts the local investigation only, with no managed-provider compatibility, policy exception or hosted acceptance. The owner then authorized the [local-only bootstrap/provisioning lifecycle contract design review](P1-PR-027-bootstrap-lifecycle-contract.md). All HS01–HS08 remain proposed; operators/coverage/rates unconfirmed, six actual S3 gates pending, specialist/licensed work pending and APIs/frontends held. No provisioning, purchases or notifications. The original experiment, sources, results and validation receipt remain historical and unchanged.
