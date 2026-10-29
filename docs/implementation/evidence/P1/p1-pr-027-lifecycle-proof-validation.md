# P1-PR-027 — disposable lifecycle proof validation

**October 29, 2026 (Pacific) · Local technical evidence only.** Baseline: approved PR #44, merged at `d407a86c2f3763ef68a9c9295889d5b5a84b4b2a`. [Proof](../../P1-PR-027-lifecycle-validation-proof.md), [local measurements/source pins](p1-pr-027-lifecycle-proof-local.json), [official observations](p1-pr-027-lifecycle-proof-sources.json).

## Test-first preparation

Tests preceded the fixture/reader and initially failed collection for missing modules. The first implemented diagnostic passed 56/56. Exact optional-property typing was fixed without changing TypeScript policy. Added guard/error/ACL controls yielded 60/61: the initial ACL-order control chose a role already moved by another test. Retain its raw-order-difference assertion and choose an untouched role. The final focused diagnostic passed 62/62, zero failed/skipped: 22 unit and 40 real PostgreSQL cases. Project/timing and source hashes are in the local JSON receipt. Preparation diagnostics are not final-commit or hosted evidence.

Meaningful real SQL covers positive/negative profiles, both membership directions, peer role and GUC drift, PUBLIC/default/admission drift, ledger defects, object/RLS/constraint changes, ACL semantic equality despite actual raw reordering, permission-error masking, runtime quarantine, refused writes/timeouts and connection closure. Requests reject arbitrary SQL, repair/expected-state fields and non-disposable targets; connection settings are re-admitted. The fixture refuses existing scoped resources and creates only synthetic DBs/roles/credentials inside the generated project.

The strict runner takes no target/URI arguments. Verify argument refusal before project creation. Every normal/failing run must close connections, remove exactly its generated Compose project/volumes, assert exact-label cleanup and remove its generated env file. Do not enumerate or delete retained projects, global caches/resources, native PostgreSQL or dev/stage state. The trusted expected catalogs come from controlled setup and immutable source manifests, not adaptive target repair or a signed provider baseline.

## Preservation audit

Only six new test-support files plus documentation/reference updates are allowed. Production bootstrap/CLI/preflight, roles, migrations, runtime, dependencies/package scripts/lockfile, CI and existing fixtures/guards/verifiers remain byte-identical to the approved merge. Source SHA-256 pins cover those boundaries; proof-source pins bind the new files to the measured focused result. Test support must remain unreachable from application imports through the unchanged boundary/negative gates.

The staging packet gains one local-validation-proof reference; every prior HS object, authority, cost/connection budget, actual value, earlier review/investigation/design entry remains unchanged. S3-service-host gains ten local evidence paths only. All eight HS decisions proposed, values/approvers null; six actual S3 gates pending with empty records and false acceptance/activation/API flags. Actual people/coverage/rates/provider/region/edition/budget/custody remain unconfirmed. The 22 original design-case records are not relabeled complete; only scoped local coverage is recorded separately.

Preserve 119 original task cards/dependencies, 137 FR rows, 75 checked/282 unchecked tasks, three parent completion boxes, historical approvals/source archives, all 23 immutable SP08 receipt pins/index/baseline blobs and previous evidence files except the two append-only reference registers. Validate link targets/anchors/path case, sources, UTF-8 without BOM/LF, tables and Git whitespace. Four usable live phases, outside-Vercel option C, PostgreSQL consolidation and build order remain unchanged.

## Committed verification and limits

Commit the complete revision, require a clean tree and run the unchanged exact-commit `node scripts/verify/push.mjs` Linux gate. Expected total: **1,322 tests**, the previous 1,260 plus 62 new cases. Measure final totals, coverage and SHA/tree/lockfile binding in the PR/checks, along with independent CI associated with the final PR head. Never relabel a preparation run or previous PR checkout as fresh exact-commit evidence.

Keep audit, quality/types/layers/contracts/migrations/models/S3, coverage, negative API/import gates, build/HTTP/lifecycle, all recovery/custody/deployment/capacity/observation/provider suites and mandatory cleanup. `s3:check` must pass; strict `s3:acceptance` must still refuse with exit 2. No coverage, permission, TLS, version or target-policy relaxation. Production preflight remains unchanged and does not gain these phase profiles.

The quarantined profile is synthetic catalog/admission state, not a new restore, signed-journal replay or promotion. Per-DB snapshots are not an atomic cross-DB handoff. Trusted fixture baselines are not independent provider attestations. All HS/operator/coverage/rate/S3/specialist/licensed/API/frontend holds remain; no provisioning, purchases, notifications or actual provider actions. The paired-database receipt/handoff proof is a proposal only.
