# P1-PR-027 local recovery and replay validation

**October 26, 2026 · Local technical evidence; full S3 OPEN.** [Contract](../../P1-PR-027-provider-recovery-replay.md), [measured local record](p1-pr-027-recovery-local.json). Specialist review and licensed adapters remain pending; product APIs remain held.

| Proof | Actual result |
| --- | --- |
| Provider TDD | Initial tests failed because the persistent server did not exist; six final behavioral tests pass against actual HTTP/process state |
| Exact fixture recovery | Two SIGKILL/restart cycles decrypt the same ciphertext/context and return identical version lists, bytes, metadata, SSE descriptors and delete markers |
| Persistence failure | A failed checkpoint returns 503, poisons health and restores the previous commit after restart; a lost acknowledgement after commit retains the unknown effect for reconciliation |
| Custody refusal | Corrupt/missing checkpoint, wrong scope/auth key/mode, unsupported codec and snapshot capacity refuse without replacing prior custody |
| Guarded upgrade | Dev/stage each passed five encrypted-column checks, zero encrypted values/old-key references, empty journal and exactly four legacy canary versions; legacy manifests/providers retained |
| Credential/host preservation | All four credential files unchanged; settings/key bytes unchanged; settings 0600 UID 1000, journal directories 0700 UID 1000 |
| Actual container loss | Each selected provider was killed and replaced with its retained volume; new active manifests and exact four canary versions stayed unchanged |
| Fresh execution after cold restart | Dev completed cron run `01M5XM7FXNFKKAA0VA3A9K798B`, 7,501 ms; stage `01M5XM7FXEBY2N1N7NYK5P74JV`, 3,565 ms; expired bucket removed, live bucket retained, policy disabled, API 404 |
| Workflow history | Fifty earlier completed run IDs in each target individually queried by ID after replacement; all preserved. A paginated recent-run window alone was insufficient and was not treated as loss |
| SQL/data preservation | Original subject/session, six synthetic notices and one synthetic template per target remain; 33 application migrations; no leftover proof policies, reseed or database schema change |
| Workflow TDD | Initial outcome test failed on missing validator; passing tests require failures/busy/malformed values to throw, and successful/disabled results to be masked |
| Real failure/replay | Actual SQL lock produced FAILED run `01M5XK91137CW9T5ZT2EV5B96P`; explicit engine replay `01M5XK91JFYPBQMMRC72139QPJ` completed; successful-run replay `01M5XK91TJZ0FTN480JEWP14AX` completed. SQL rows 2 → 1 → 1; product APIs absent |
| Data guard | Isolated real database refuses non-null encrypted data and JSON old-key references; empty declared fixture passes |

A first workflow experiment used an unretained lookup version and correctly failed host admission; the final scenario uses the configured retained version. The pinned Moto image's actual package is `5.1.23.dev` despite its `5.2.0` tag, so the codec checks the actual package and digest. No old KMS export or recording replay is claimed. The explicit new generation was permitted only after proving the legacy provider had disposable canaries and no encrypted database/journal dependencies.

The retained journal is empty. Private provider snapshots contain fixture key material and require protected storage/encrypted backups. Local filesystem fsync/process-loss tests are not independent disaster recovery, encrypted-at-rest custody, hosted workflow signing, hosted S3/KMS or selected ESP acceptance. Failure/replay evidence is SQL-only; external unknown effects require reconciliation.

The complete exact-commit Linux gate and final PR checks are recorded after implementation is committed. The unchanged task inventory and historical approvals are checked independently. No S3 acceptance flag or parent completion checkbox is changed by these proofs.
