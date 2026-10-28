# P1-PR-027 — SP08 local evidence handoff and readiness review

**October 28, 2026 (Pacific) · Local reconciliation in review; full S3 OPEN; APIs HELD.** The owner approved [PR #39](https://github.com/xmyqyl4x/tiresandtreads/pull/39), merged into main at `9d314d00255b18b6e7d6f873e6f70c9080dfd2e5`, and authorized this finite local review. SP01–SP07 local technical proofs are approved and merged. No actual hosted acceptance is claimed. HS01–HS08 remain proposed; provider, region, database operating model, budget and actual operators remain unapproved. No provisioning, purchases or notifications are authorized.

This completes the requested local handoff scope once reviewed; it does not close parent P1-PR-027 or implement frontend task card P1-PR-040. Specialist review and licensed adapters remain pending. All six actual gates retain pending status, empty accepted-record lists and false activation flags in the [service register](evidence/P1/s3-service-register.json). The four usable phases, option C (app and database outside Vercel), PostgreSQL consolidation and database → repositories → services → APIs → UI sequence remain unchanged.

## Evidence provenance

The [handoff index](evidence/P1/p1-pr-027-staging-handoff-index.json) records full final-head/merge SHAs, GitHub observation time, successful independent CI associated with each final PR head and checked Git ancestry into the review baseline. A pull-request CI checkout may be a synthetic merge revision; association with a PR head is not a claim that its checkout SHA equals that head. Counts below were parsed from those successful job logs. UTC machine times can differ from Pacific document dates.

| Local work | Approved PR | Final head | Main merge | CI test snapshot |
| --- | --- | --- | --- | --- |
| Staging decision proposal | [#33](https://github.com/xmyqyl4x/tiresandtreads/pull/33) | `9deed80e` | `7d0849b7` | [1,083 passed](https://github.com/xmyqyl4x/tiresandtreads/actions/runs/40562720074) |
| SP01–SP02 TLS/database ownership | [#34](https://github.com/xmyqyl4x/tiresandtreads/pull/34) | `f2f5de8e` | `1f1db236` | [1,098 passed](https://github.com/xmyqyl4x/tiresandtreads/actions/runs/40580316623) |
| SP03 provider boundaries | [#35](https://github.com/xmyqyl4x/tiresandtreads/pull/35) | `cfcd9901` | `9529a3f8` | [1,139 passed](https://github.com/xmyqyl4x/tiresandtreads/actions/runs/40615337071) |
| SP04 custody/recovery | [#36](https://github.com/xmyqyl4x/tiresandtreads/pull/36) | `f2e38589` | `0e521439` | [1,160 passed](https://github.com/xmyqyl4x/tiresandtreads/actions/runs/40620162113) |
| SP05 deployment/access/rollback | [#37](https://github.com/xmyqyl4x/tiresandtreads/pull/37) | `41d47d77` | `3e86d3e5` | [1,190 passed](https://github.com/xmyqyl4x/tiresandtreads/actions/runs/40640623707) |
| SP06 capacity/lifecycle | [#38](https://github.com/xmyqyl4x/tiresandtreads/pull/38) | `8a117da0` | `fa25c6b7` | [1,214 passed](https://github.com/xmyqyl4x/tiresandtreads/actions/runs/40716829572) |
| SP07 observation/response | [#39](https://github.com/xmyqyl4x/tiresandtreads/pull/39) | `8f4a8081` | `9d314d00` | [1,247 passed](https://github.com/xmyqyl4x/tiresandtreads/actions/runs/40753556460) |

These are successive snapshots, never additive. The unchanged [PR #32 readiness index](evidence/P1/p1-pr-027-readiness-index.json) separately covers PRs #27–#31 and their older measurement commits. The new index pins **23 files**: that index, its 15 original immutable receipts, all six immutable SP01–SP07 validation receipts and one newly captured historical PR #39 exact-local receipt. Mutable implementation narratives are navigation, not immutable measured receipts. Historical receipts retain their original dates and review wording.

The [historical baseline receipt](evidence/P1/p1-pr-027-staging-baseline-verification.json) was captured from the matching PR #39 clean-commit log and ignored verification stamp **before** any fresh SP08 run. It binds `8f4a8081…`, its tree, lockfile digest, local image ID, timestamp, 1,247 tests and coverage (97.27% lines / 94.11% statements / 97.91% functions / 90.54% branches). It is not a new run of SP08 or the merge commit. Its recovery inventory is the populated disposable fixture (141 application / 28 CMS tables, 33 / three migrations), not an empty production schema. Image IDs describe local Docker content; registry signing/provenance remains unproved. Final SP08 clean-commit verification and CI are recorded separately in its PR/checks to avoid a self-referential receipt.

The index also pins the **baseline Git blobs** for the decision packet and acceptance register. Their current progress/local-evidence references can advance without changing those historical hashes. Checked-in digests establish byte consistency and ancestry; they are not a signed independent attestation, actual reviewer approval or proof of a selected provider's behavior. No private settings, journals, credentials, keys, raw logs or recipient data are included.

## Local-to-hosted evidence matrix

| Work and executable reproduction | Accepted local scope | What still needs actual evidence |
| --- | --- | --- |
| [SP01–SP02](P1-PR-027-local-hosted-preflight.md), `pnpm verify:db-preflight` | Disposable TLS hostname/CA refusal and PostgreSQL version, role, ownership/bootstrap/restore compatibility | Selected service/account/region, real server identity/trust chain, administrative restrictions, scoped roles and restore privileges; no hosted runtime URL is enabled |
| [SP03](P1-PR-027-local-provider-preflight.md), `pnpm verify:provider-preflight` | Local provider composition, policy/authority validation and adverse refusal fixtures | Actual S3/KMS/workflow/ESP contract, endpoint/account/region/key/signature authority, private reachability and reconciliation of unknown effects; local composition remains fixture-only |
| [SP04](P1-PR-027-local-custody-preflight.md), `pnpm verify:custody-preflight` | Encrypted synthetic nonempty journal/DB/CMS/object recovery, signed restrictions, key-version continuity and deletion replay in isolated processes | Independently controlled off-host custody, actual key lifecycle/provider erasure, policy retention and measured hosted RPO/RTO/PITR. Shared local control and synthetic restores cannot establish these |
| [SP05](P1-PR-027-local-deployment-preflight.md), `pnpm verify:deployment-preflight` | Approved-source current/previous image fixture, TLS restricted access, serialized expansion, actual disposable PostgreSQL stop/start, readiness loss/recovery and image rollback | Reviewed account/resource inventory, registry provenance, real ingress/network/MFA/secrets, deployed identity and rollback with actual provider dependencies; no remote release is installed |
| [SP06](P1-PR-027-local-capacity-preflight.md), `pnpm verify:capacity-preflight` | Full pool maxima, usable-capacity admission, mixed synthetic work, bounded queue refusal, lane reconnect, drain and helper process lifecycle | Actual replicas/processes/provider reservations, disk/object/journal limits, sustained representative load and production runtime envelope. Helper runs inside 1,536 MiB tooling; it does not prove a standalone 768 MiB service workload |
| [SP07](P1-PR-027-local-observation-preflight.md), `pnpm verify:observation-preflight` | Genuine local maintenance cron, masked fresh observations, role revocation/recovery, real CMS-lane failure, private bounded response journal and loopback-only delivery/retry | Selected hosted collector/destination, actual operator access/coverage, delivery acknowledgment/escalation, failure-to-notify visibility, approved clock/freshness/retention policies and timed human response. No actual recipient adapter or notification is accepted |

SP06's disposable budget is **68 required / 70 usable** (75 raw minus five reserved); SP07 adds observer/pressure allocations and uses **69 / 70**. The earlier retained 42-slot and isolated 65-slot declared budgets belong to their recorded topologies; the retained server's historical raw maximum was 100, with PostgreSQL reservations handled separately in later usable-capacity proofs. The proposed hosted single-host 45 and overlap 62 requirements remain unapproved and must be re-enumerated on selection. Never replace declared maxima with idle socket snapshots or combine budgets from different fixtures.

SP06 client forced-close and server quiescence are separate timings. Its NOLOGIN/termination reconnect test is a runtime-lane drill, not a postmaster restart; SP05 separately tests actual PostgreSQL stop/start. SP07's restricted-role `numbackends` total is a conservative database-backend observation, not an exact client count. `quota_capacity` remains rate-limit rows. Snapshot usage, deliberately low fixture alarm thresholds and helper measurements are not peak/SLO or production sizing evidence.

SP07 controller close/reopen, an injected pending-third-intent file after three real lost-ack sends and an in-memory receiver dedupe set do not prove OS/power-loss recovery or durable external deduplication. Receiver acknowledgment, synthetic operator acknowledgment and incident resolution are distinct. Its storage-proxy fault leaves Moto running; the CMS failure is a lane outage. Fifteen-second simulated escalation and five-minute local history are fixture policies, not staffed SLA or approved retention. Earlier retained dev/stage observations and empty journals remain historical; this review does not retest, reseed or fault those environments.

## Actual acceptance backlog and handoff ownership

The service inventory remains **14 component cards / 26 application modules**, with **98 draft specialist scenarios / zero actual specialist reviews**. Responsibilities below are roles to assign, not appointed people. Keep every gate below pending until actual scoped review records meet the existing [gate contract](P1-PR-027-s3-gate-review.md).

| Gate | Missing acceptance record and decision trigger | Accountable role still to confirm |
| --- | --- | --- |
| `G1-specialist` | At least 50 actual case reviews with named specialist, canonical date, outcomes, disputed rules/calibration and accepted explanations; DD06 | Owner and tire specialist; pending by owner direction |
| `G1-fitment-catalog` | Permitted contract/sample with storage/display/derived/channel rights, mapping/coverage and real adapter adverse evidence; DD01 | Owner and data/tire reviewer; licensed work pending |
| `G1-prices` | Permitted price feed with units/bases/tax/freshness/retention, actual installed-cost reconciliation and stale/unavailable behavior; DD02 | Owner and data reviewer; licensed work pending |
| `G2-provider-effects` | Selected S3/KMS custody/version/delete, hosted signed workflow/concurrency and ESP no-send/idempotency/unknown-effects/erasure proofs; DD05 | Platform and privacy reviewers; actual contracts/authority pending |
| `G2-privacy-policy` | Applicable notices/deadlines/holds/extensions/appeals, independent journal recovery and reviewed marker/key/receipt retention; DD06 | Owner and actual privacy reviewer; no policy acceptance inferred |
| `S3-service-host` | Selected topology/account/US region, complete physical budget, network/TLS/secrets/journal custody, deployed schedules/alerts and actual response drill; DD03/DD04/DD05 | Owner, backend/platform/DB primary and backup operators; unassigned |

The [HS packet](P1-PR-027-private-hosted-staging-decision.md) remains a proposal. HS01 host/region, HS02 database operating model, HS03 private access/domain, HS04 spending ceiling, HS05 real operators, HS06 provider scope, HS07 custody/retention and HS08 execution/approval sequence all retain null approved values/approvers. Historical vendor quotes are planning evidence; revalidate eligibility, price, taxes/labor, temporary overlap and resource inventory before any spending proposal. No price lookup or purchase is part of SP08.

A future **actual** acceptance bundle must record source commit/tree and immutable registry digest/provenance, config digest without secrets, migration versions, deployed provider/account/region/version, complete process/replica/pool/reservation inventory, canonical timestamps and measured workload/limits, failure/recovery/rollback evidence, retention/custody references and named reviewer/operator disposition. Cross-reference the actual provider/privacy gates and list everything still pending. Missing fields remain explicitly missing; local values cannot be copied in as hosted measurements. Private evidence stays in approved custody with safe references; never commit credentials or journals.

## Reproduction and review disposition

From the repository root, reproduce the existing bounded proofs using the commands above or the complete clean-commit `pnpm verify:push` gate. They accept no hosted target/credential override and create only generated disposable projects. The existing cleanup checks remain mandatory. Native PostgreSQL and retained dev/stage settings, keys, credentials, manifests, journals and data are not targets.

For a read-only consistency review, save and run this Node snippet from the root (it needs full Git history and no provider credentials). It checks the pinned bytes and baseline ancestry. A successful message grants no acceptance authority:

```js
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const index = JSON.parse(
  readFileSync('docs/implementation/evidence/P1/p1-pr-027-staging-handoff-index.json', 'utf8'),
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const receipt of index.receiptDigests) {
  if (digest(readFileSync(receipt.path)) !== receipt.sha256) throw new Error(receipt.path);
}
for (const blob of index.baselineState) {
  const bytes = execFileSync('git', ['show', `${blob.sourceCommit}:${blob.path}`]);
  if (digest(bytes) !== blob.sha256) throw new Error(blob.path);
}
for (const row of index.lineage) {
  if (row.ci.headSha !== row.head || row.ci.conclusion !== 'success') throw new Error(row.url);
  execFileSync('git', ['merge-base', '--is-ancestor', row.head, row.merge]);
  execFileSync('git', ['merge-base', '--is-ancestor', row.merge, index.baselineMerge]);
}
execFileSync('git', ['merge-base', '--is-ancestor', index.baselineMerge, 'HEAD']);
console.log('Local evidence consistency checked; actual S3 acceptance remains ungranted.');
```

`pnpm s3:check` must pass; `pnpm s3:acceptance` must still exit **2**. The [SP08 validation receipt](evidence/P1/p1-pr-027-handoff-validation.md) records preservation and negative review checks. This is documentation/evidence reconciliation with no executable product behavior, new fixture, dependency, schema, migration, runtime, retained environment or CI-policy change; new behavior-driven TDD is not applicable. Existing full regression verification remains required on the committed revision.

The local packet is ready for owner review when lineage/pins, scope limits, all eight proposed decisions, the six-gate backlog, unchanged task graph and separately recorded final SP08 verification/CI are reviewable. Approval/merge accepts this **local reconciliation only**. All three parent completion boxes remain open; P1-PR-028–030 remain blocked. Preserve 119 cards/dependencies, 137 FR rows, 75 checked/282 unchecked tasks, historical approvals and source archives.

There is no automatic next local runtime feature justified by this handoff. After review/merge, the next bounded step can be owner consideration of HS01–HS08 and assignment of actual operators/reviewers, or leaving those decisions pending. A selection does not authorize provisioning: any later execution needs a concrete separately reviewed account/region/cost/resource, access, rollback and cleanup plan plus explicit authorization. Actual notifications also require explicit authorization. Ordinary S4 entry requires actual acceptance of all six gates **and** explicit release of the owner's API hold. Neither is requested or granted here.
