# P1-PR-027 local observability validation

**October 26, 2026 · Local technical evidence; S3 OPEN.** [Contract](../../P1-PR-027-local-observability.md), [measured results](p1-pr-027-observability-local.json). Specialist review and licensed adapters remain pending; APIs remain held.

| Proof | Actual result |
| --- | --- |
| TDD red/green | First observer tests failed on the missing module; five new behavioral unit tests pass |
| Masking and alarm lifecycle | Fixed queue codes/counts/ages only; unknown fields/error strings excluded; stable repeats suppressed; fresh recovery events emitted |
| Unknown/denied telemetry | Existing queue alarm retained through permission revocation and synthetic-row withdrawal; clears only after a fresh authorized snapshot |
| Focused real integration | 14 tests passed: 12 existing host scenarios (including extended CMS outage observation) and two new observer/database/HTTP scenarios |
| Real SQL fault | Existing CMS `NOLOGIN` and connection termination cause HTTP 503 and a readiness alert; restoring the lane causes HTTP 200 and recovery |
| HTTP adverse paths | Actual local 503/recovery and three-second stalled response; redirects/hosted target/query-bearing URL refused |
| Retained dev drill | 101 owned old synthetic callbacks cause backlog/lag; repeat emits zero events; own access revocation preserves alarm; own fixture withdrawal + fresh authorization recovers; 299 ms |
| Retained stage drill | Same proof, 195 ms; API 404 in both targets; no automatic repair or external mail send |
| Permission boundary | Normal CLI given the disabled seeded staff identity exits nonzero, reports masked access denial and withholds queue counts |
| Cleanup/preservation | Zero temporary actors/callbacks remain; four credential files and host settings/key bytes and both provider manifests unchanged; original subject/session, six notices and one template preserved |
| Resource and contract bounds | One observer connection, one fixture operator connection for drill, within existing declared operator slots; no host pool-maxima, role, schema, package or public contract change |

The retained journal remains empty, and provider health is not an encryption/deletion authority proof. The local workflow freshness window is technical evidence, not hosted authentication, complete failure-rate monitoring or staffed response acceptance. Synthetic callback withdrawal is deliberately not represented as successful external processing. All six S3 acceptance gates remain pending.

The base implementation `de2317adb1a7b28953fa04d7484d077aac2ae263` passed the complete exact-commit Linux gate. [Pinned machine evidence](p1-pr-027-observability-verification.json) records lifecycle, app/CMS restore and provider recovery. The combined coverage set has 997 tests; foundation six, schema 63, database recovery 11 and provider recovery six: **1,083 total**, seven new. Coverage is 97.26% lines, 94.07% statements, 98.28% functions and 90.46% branches; thresholds are unchanged. Frozen Linux build, advisory audit, quality/type/layer/model/permission checks, deliberate failure gates, HTTP/lifecycle and actual application/CMS dump/restore all passed. Storage remains 141 application/28 CMS tables with 33/three migrations.

Final review separated the normal observer from the general setup container. Actual authorized CLI observations in dev and stage return all ten queue codes healthy; environment-name inspection confirms only `DB_PASSWORD_TT_OPERATIONS_RUNTIME`, with no host-state or journal mounts. The read-only image initially rejected pnpm’s attempted dependency write; direct `node --import tsx` succeeds without installation or writable source. Temporary actors used for this check are removed. Normal observation does not provision an identity. Fixture-actor cleanup additionally matches its exact provider subject.

[PR #31](https://github.com/xmyqyl4x/tiresandtreads/pull/31) carries the continuation. The final isolation/evidence revision is independently verified as its own exact commit before push; GitHub CI must identify that final head. The document audit preserves all 119 cards/dependencies, 137 FR rows, 75 checked/282 unchecked tasks, source archives and historical approvals, with valid UTF-8/LF and relative links. Original parent completion boxes remain open.
