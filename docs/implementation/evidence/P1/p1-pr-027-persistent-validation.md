# P1-PR-027 retained local workflow validation

**October 26, 2026 · Local technical evidence; full S3 OPEN.** Specialist review and licensed adapters remain pending. Product APIs remain held. [Contract](../../P1-PR-027-persistent-local-workflows.md), [measured local results](p1-pr-027-persistent-local.json).

| Proof | Actual result |
| --- | --- |
| Existing databases | Dev and stage each report 33 application / three CMS migrations, zero pending; no bootstrap, migration or general reseed run |
| Existing credentials/data | All four environment/role credential files unchanged by SHA-256 comparison; original subject and owner-session fixtures preserved in both targets |
| Explicit host fixtures | Six synthetic notices and one synthetic template per target; repeated preparation creates no duplicates or updates |
| Private host custody | Distinct dev/stage settings; byte-for-byte settings/provider manifests preserved across repeated preparation and host/workflow restart; settings 0600 UID 1000 |
| Journal volume | Separate project volume, 0700 UID 1000, preserved; zero retained privacy records in these local environments, so no claim of a nonempty retained-journal recovery proof |
| Real cron → SQL | Dev first proof 5,575 ms; stage 53,289 ms; each expired probe removed, unexpired probe preserved, admission policy disabled, product API 404, no probe policies left |
| Fresh execution after restart | Dev 41,336 ms, completed run `01M5XB2GXNQMW76VVBK478W7RV`; stage 41,282 ms, completed run `01M5XB2GXJK56NYYV9Q2SEQWVH`; local workflow engine receipts identify the maintenance function and one-minute cron |
| Persisted workflow history | All three earlier completed dev maintenance run IDs and one earlier stage run ID still present after Inngest stop/start; additional completed runs afterward |
| Local provider custody | Same KMS encrypted canary and four exact S3 versions verify before/after host restart; Moto container kept running; no claim of provider cold-restart persistence |
| Stop guard | Generic `local down` refuses both prepared targets; host/workflow stop preserves all named volumes, PostgreSQL and Moto |
| Policy and dependency preservation | All six S3 gates open, 98 draft specialist cases/zero actual reviews, API hold intact; 119 cards/dependency edges, 137 original FR rows, 75 checked/282 unchecked tasks, source archives and historical approval sections unchanged |

The isolated regression adds a real cron/HTTP/SQL host scenario and adverse provider-custody checks. A first negative experiment exposed Moto's unsupported `DisableKey` operation (HTML error, no valid AWS response); the test uses an actually unavailable key, altered canary hash and deleted exact object version instead. No unsupported provider behavior is fabricated as acceptance. The actual provider verifier also requires an enabled matching KMS key descriptor.

The retained journal is empty; existing real-role host tests separately prove an actual signed privacy restriction record survives host restart and rejects incompatible key bytes. The local setup is not independent encrypted disaster recovery. Moto cold-restart recovery, hosted workflow signing/reachability, selected ESP/S3/KMS custody, human policy/source reviews and staffed operation remain open.

Implementation commit `a37ed2085a2a3710bf59ebfe8d3bdfada2512362` passed the complete exact-commit Linux gate. [Pinned machine evidence](p1-pr-027-persistent-verification.json) includes the real recovery/lifecycle measurements and verification timestamp. The combined unit/use-case/database set has 984 tests; foundation has six, schema 63, and recovery 11: **1,064 total**, five new. Coverage is 97.27% lines, 94.05% statements, 98.20% functions and 90.31% branches; thresholds are unchanged. Frozen Linux build, advisory audit, source/format/type/layer/schema/model/permission checks, deliberate failure gates, health contracts, container lifecycle and actual application/CMS dump/restore all passed. Storage remains 141 application/28 CMS tables with 33/three migrations.

[PR #29](https://github.com/xmyqyl4x/tiresandtreads/pull/29) is the review continuation. Final documentation is independently reverified as its own exact commit before push; the PR check records identify the final remote head. These results cannot accept S3 or enable APIs.
