# Interrupted executor/cold-restart proof — preparation validation receipt

Baseline: approved PR #46 merged at `b7e159075cc3159aea2dfb061a1add42e25ca101`. Local preparation only; final clean-commit and CI evidence belongs in the PR description. No hosted/runtime acceptance.

- Tests first: missing protocol collection failure. First implemented diagnostic 37 passed/three failed out of 40; all three failures waited for aggregate child close after actual IPC disconnect.
- Isolated plain/TypeScript-loader probe observed exit 72 plus both stream closures. Controller now requires those direct events and all DB/session/lock assertions; refinement 49/49 passed. No upstream root-cause claim or production change.
- UTF-8 boundary control: 25 unit passed/one failed; guard now measures bytes, not characters. No weakened bounds.
- Final command `node tests/fixtures/lifecycle-restart/run.mjs`, project `tt-test-4bb6ee091240f2c5`: **50/50** (30.42s), **26 unit / 24 SQL-process use cases**, zero failed/skipped. Fifteen SIGKILL checkpoints, three resume controls, three IPC-disconnect controls and three drift/repair workflows.
- Every successful fresh process rejects old exported evidence, observes zero import reads and completes two fresh reads of each DB for validation/handoff. All 17 quarantined runtime logins stay denied. No new activation authority.
- All owned processes, both streams, matching DB sessions/locks and exact generated Docker resources close; environment removed. No retained/native/cloud target.
- Six new test-support source pins; 43 unchanged pins (30 production/guard/dependency/CI plus 13 previous proof files). All prior evidence except two append-only reference registers and all 23 SP08 pins/index/baseline blobs remain intact. Core 119 cards/dependencies, 137 FR rows, 75 checked/282 unchecked tasks, three parent boxes, approval history and source archives unchanged.
- HS01–HS08 proposed; actual operator/coverage/rate/provider/budget/custody choices unconfirmed; six S3 gates pending with empty records and false acceptance/API/activation flags. Specialist/licensed work pending; APIs/frontends held. No provisioning, purchases or notifications.

The proof restarts a Node executor against unchanged disposable databases, not a host/database/provider or durable journal. Read-only/cooperative pair limits still apply. See [measured model](p1-pr-027-interrupted-executor-local.json), [official references](p1-pr-027-interrupted-executor-sources.json) and [proof/remaining scope](../../P1-PR-027-interrupted-executor-cold-restart-proof.md).
