# P1-PR-027 — target-plan admission and ordering model proof

**October 30, 2026 (Pacific) · Local synthetic model evidence only; no original case or gate closure.** Approved [PR #55](https://github.com/xmyqyl4x/tiresandtreads/pull/55) merged at `b9f23153c8175621dcebe35ee1cc47cdfb46da80` after complete local and independent CI validation. The owner deferred acceptance blockers and requested the next set of PRs. This is the first bounded continuation of the [PJ13 multi-target ordering contract](P1-PR-027-multitarget-coordination-ordering-review.md), under existing P1-PR-027/S3-service-host. The subsequent fixture TLS/admission work is proposed for a separate review.

[Local observations and unchanged inventories](evidence/P1/p1-pr-027-target-plan-model-local.json), [exact source anchors/hashes](evidence/P1/p1-pr-027-target-plan-model-sources.json), [validation record](evidence/P1/p1-pr-027-target-plan-model-validation.md). HS01–HS08 proposed; operators/coverage/rates unconfirmed; all six S3 gates open; specialist/licensed work pending; APIs/frontends held. Production bootstrap/CLI/preflight/policy unchanged. No provisioning, purchases or actual recipient notifications.

## Result and limits

**119 focused tests pass: 79 unit and 40 use-case cases.** Six new files provide bounded raw JSON admission, fixed synthetic bindings, a synchronous ordering/event model, two test suites and a dedicated isolated runner. There are **zero PostgreSQL connections, database/provider fixture service executions, lifecycle/provider dispatches or actual recipient notifications in this focused proof**. Existing production code, migrations, bootstrap/CLI/preflight, policies, Compose/TLS, dependencies, full verification, hooks and CI remain byte-identical. The model imports no production executor, SQL driver, network/filesystem client, resolver, provider or journal backend.

The model accepts caller-supplied outcomes and clock/context records. It does not acquire a lock, run a query, await a driver, inspect a session, resolve an actual container/volume or authenticate a target. A deliberate negative control shows **two independent models both accepting supplied `held` outcomes**, and a changed well-formed supplied binding can start another fresh model. This demonstrates the absence of shared exclusion/attestation; it is not evidence of lock contention or fencing. No production authority, key namespace, resource provenance, current journal/index, trust root, durable store, recovery continuity or hosted provider is selected.

## Raw input and binding contract

The exact plan fields remain `version`, `scope`, `project`, `fixtureGeneration`, `domains`; 4,096 UTF-8 bytes maximum. Version 1/scope `disposable-readonly-multitarget-plan`, `tt-test-` plus 16 lowercase hex project, 32 lowercase hex generation, exactly two unique fixed slots: 0/source and 1/target. Only the existing names `postgres`/`recovery-postgres`, `tt_app_recovery`/`tt_cms_recovery` and their app/CMS migrators appear in descriptors. The excluded bad-restore DB is never admitted.

The separate **synthetic binding** record has exact version/scope/project/generation/domains fields, scope `synthetic-multitarget-bindings`, and an 8,192-byte test-support bound. Each domain contains only slot, fixed service, `synthetic-container:` reference, `synthetic-volume:` reference, credential generation and TLS generation. References must have fixed hex shapes and differ between slots. These are modeled values, not actual Docker IDs, credentials, certificates, live harness lookup or distinct physical cluster evidence. The existing production/PR54 parser is not broadened. An eventual real fixture supervisor must construct/resolve its own current owned binding through separately reviewed code; this model does not implement that resolver.

Raw input is string or bounded fatal-decoded UTF-8 bytes; BOM, malformed Unicode, duplicate decoded keys (including escaped aliases), extra/missing fields, malformed/unsafe numbers, trailing data and limits refuse. JSON is additionally bounded to 128 value nodes, depth 6 and 512 decoded string code units; objects have no prototype. Events have a separate 1,024-byte cap. Environment fields are own data properties with exact test-local/fixtures/project values; an accessor is not invoked. No URI/CA/password/SQL/callback/timeout/key override, retained target, archive, journal, receipt or arbitrary action is accepted. Fixed-schema reconstruction detaches values and freezes output; it is **not general cryptographic JSON canonicalization or authentication**. Both allowed enumerations yield identical output and allocation order.

## Modeled sequence, failures and cleanup

The only allocation sequence is **common:0 → common:1 → inner:0:app → inner:0:cms → inner:1:app → inner:1:cms**. Four modeled read-start/read-complete pairs follow 0/app, 0/cms, 1/app, 1/cms only after all six supplied acquisitions succeed. Supplied busy/unavailable at each position refuses without another acquisition or read, retaining only the acquired prefix for reverse modeled close. Early work, reordered/reentrant/extra allocation, mismatched/duplicate acknowledgement, foreign or out-of-order close and completed-model reuse refuse. No SQL key or command is dispatched.

Every event re-admits the supplied environment/binding and compares its canonical value with the initial snapshot. Drift before acknowledgement or read completion invalidates candidate observations. The caller-supplied nonnegative safe-integer clock must be monotonic and stays within one 4,000ms modeled attempt, including all domains; no step resets it. This is a reducer invariant, **not measured real timeout, wall-clock bound or cancellation**. Modeled cleanup and an already in-flight completion remain admissible after refusal/deadline/context drift to describe disposition. An unavailable read leaves work unknown; a supplied observed completion after failure is counted late and discarded.

Loss of either common descriptor invalidates all candidate observations and stops new work. `simulatedHeld` describes the owned handle prefix awaiting modeled close, including after a loss; it is not a claim that a real lock remains live. Exact reverse close records supplied closed/unknown outcomes; unknown cleanup prevents a clean evidence disposition. Trace storage is capped at 64 fixed-value entries; diagnostics never reflect arbitrary rejected strings. Frozen receipts are snapshots and carry `simulated: true` with zero actual SQL/fixture/dispatch counts and false durability/authentication/fencing/runtime/hosted/product flags. A new model has no knowledge of another model's cleanup or outstanding work. No result supplies permission to resume an executor.

## Mapping to the proposed review controls

These are partial synthetic observations against the inherited MT01–MT16 review references, **not new core task cards or accepted scenarios**. All 18 original journal scenarios and 22 lifecycle cases remain frozen/proposed. PJ13 and BLC-T13 remain open.

| Control | This model's observation and boundary | Full control |
| --- | --- | --- |
| MT01 | Modeled raw-envelope admission: byte/depth/node/string limits, duplicate decoded keys and exact schema. No live endpoint resolved. | Open; not accepted |
| MT02 | Modeled fixed slots, names and distinct synthetic references. Supplied references are not physical identity or attestation. | Open; not accepted |
| MT03 | Both input permutations produce identical canonical fields and common 0/1 then inner 0/app,0/cms,1/app,1/cms descriptors. | Open; not accepted |
| MT04 | Modeled early/out-of-order/reentrant allocation and terminal reuse refuse; no real handles exist. | Open; not accepted |
| MT05 | Supplied first-common busy/unavailable refuses with no further modeled allocation/read. | Open; not accepted |
| MT06 | Supplied second-common busy/unavailable refuses and permits exact owned-prefix modeled cleanup. | Open; not accepted |
| MT07 | Supplied binding/credential/TLS generation drift refuses; actual connection, TLS/SAN/version/role checks not executed. | Open; not accepted |
| MT08 | Supplied busy/unavailable at each inner descriptor refuses and retains exact owned cleanup prefix; no SQL contention. | Open; not accepted |
| MT09 | Modeled four-read journey keeps all six descriptors until reads finish and closes in reverse order; no actual lock window. | Open; not accepted |
| MT10 | Supplied loss of either common descriptor discards all candidate observations and stops new modeled work. | Open; not accepted |
| MT11 | Supplied in-flight observed completion after loss/deadline is counted late and discarded; unavailable leaves work unknown. No driver cancellation or real work quiescence. | Open; not accepted |
| MT12 | Re-admit supplied context on every event including read acknowledgement; invalid environment/binding stops new work. No awaited command or live lookup occurs. | Open; not accepted |
| MT13 | Not executed: no source/target data/catalog/ACL/GUC/history/role/membership snapshots or quarantine observation in this model. | Open; not accepted |
| MT14 | Exact reverse modeled close and unknown cleanup tested; no session death, lock absence or foreign backend inspected. | Open; not accepted |
| MT15 | Terminal model cannot be reused; independent fresh models deliberately both accept supplied held outcomes. No global exclusion, old-work disposition or safe re-entry authority. | Open; not accepted |
| MT16 | Model accepts only bounded fixed event/envelope fields and has no dispatch interface. No archive/journal/recovery/production composition or case acceptance. | Open; not accepted |

No focused source/target snapshots, catalog/ACL/GUC/history/role/membership comparison, target-quarantine observation, TLS handshake/SAN/version/role query, session death, lock absence, real contention or source/target read-only transaction was performed. Those actual observations remain prerequisites for a later separately authorized SQL proof. Existing recovery/TLS/strict-reader gaps from PR #55 remain unchanged, as do all 17 app + 2 CMS restrictive roles and zero scoped memberships.

## TDD, runner and full verification

The new suites first failed collection because the model module did not exist (two expected collection failures; no assertions ran). After implementation, 103/104 cases passed; the remaining negative-control fixture supplied old context to a model initialized with changed context, correctly causing refusal. Correcting that fixture and adding parser/acknowledgement/diagnostic-bound controls produced **119/119**, no failures/skips, **506ms** Vitest duration in the dedicated Linux run (6.07s orchestration). Prettier for all six files, pinned Linux lint and root TypeScript checks pass. Supplying `stage` or a synthetic PostgreSQL URI to the no-argument runner refuses with exit 1 before initialization.

Run focused proof from the repository with `node tests/fixtures/multitarget-plan/run.mjs`. It generates a unique disposable test project, builds the pinned tooling image, then runs only these two suites in a **network-none, read-only-root** container with bounded tmpfs, 1,536MiB memory, two CPUs, all capabilities dropped and no new privileges. It starts no PostgreSQL/TLS/application/provider service; finally it checks exact-project cleanup and removes its generated ignored environment file. Docker build/host orchestration can use image/package caches and host files: the network/filesystem isolation statement applies to the test execution container, not the build host. No persistent dev/stage resource is used.

Before publication, the final clean commit must pass the unchanged `node scripts/verify/push.mjs` pipeline, normal pre-push hook and independent GitHub CI. That full regression **does run existing disposable database, schema, HTTP, restore/custody and provider-simulation fixtures**. Its SQL/setup effects are regression evidence, distinct from the new synthetic proof's zero-SQL boundary. Measured final commit/tree, suite totals, coverage, recovery and cleanup results are recorded in the PR description after execution. No `[skip ci]`, hook bypass, altered threshold/resource/TLS guard or reused verification stamp applies to this implementation.

## Evidence preservation

Preserve **83 unchanged source pins**, **125 frozen historical evidence files**, **23 SP08 receipt pins/index/baseline blobs**, source archives and historical approvals. Six new test files have separate hashes; they do not replace older evidence. Two registers append local model references only, retaining null actual selections, eight proposed HS decisions, six pending empty-record S3 gates and false acceptance/endpoint/public flags. Preserve 119 cards/dependencies, 137 FR rows, 75 checked/282 unchecked tasks and P1-PR-027's three open completion boxes. No design case or gate closes.

- [bounded-json](../../tests/fixtures/multitarget-plan/json.ts#L18)
- [flags](../../tests/fixtures/multitarget-plan/model.ts#L46)
- [admission](../../tests/fixtures/multitarget-plan/model.ts#L64)
- [events](../../tests/fixtures/multitarget-plan/model.ts#L181)
- [reducer](../../tests/fixtures/multitarget-plan/model.ts#L212)
- [fixed-bindings](../../tests/fixtures/multitarget-plan/samples.ts#L17)
- [noarg-runner](../../tests/fixtures/multitarget-plan/run.mjs#L8)
- [unit](../../tests/unit/multitarget-plan.test.ts#L1)
- [negative-control](../../tests/usecases/multitarget-plan.test.ts#L248)

HS01–HS08 proposed; operators/coverage/rates unconfirmed; all six S3 gates open; specialist/licensed work pending; APIs/frontends held. Production bootstrap/CLI/preflight/policy unchanged. No provisioning, purchases or actual recipient notifications. Four usable live phases, option C app + DB outside Vercel, PostgreSQL consolidation and platform-agnostic database → repositories → services → APIs → frontends remain unchanged. Acceptance blockers are deferred; no hold is released by this local proof.

## Proposed next-step prompt

> Approve the target-plan admission and ordering model proof PR and merge it into main. Start the local-only fixture TLS and target-admission preparation contract review for PJ13 against existing separate-source/target recovery fixtures. Review only; no new implementation, fixture execution or case/gate closure. Define fixed test identities, verified TLS/hostname requirements, separately owned setup/teardown effects and refusal observations before a later SQL proof. Keep production bootstrap/CLI/preflight and policy unchanged, HS01–HS08 proposed, operators/coverage/rates unconfirmed, all six S3 gates open, specialist/licensed work pending and APIs/frontends held. No lifecycle mutation/provider effect dispatch, production authority selection or independent durability/authentication/fencing claim. No provisioning, purchases or actual recipient notifications. Generate the next step prompt when done.
