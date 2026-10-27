# P1-PR-027 continuation — retained local hosts and workflow execution

**October 26, 2026 · Local technical continuation; full S3 remains open.** The owner approved [PR #28](https://github.com/xmyqyl4x/tiresandtreads/pull/28), merged at `7c86af95e8f78bc4b4c6d29ac8ebefe771b57bd5`, and authorized retained dev/stage setup and local workflow proofs. Specialist review and licensed adapters remain pending. Product APIs remain on hold. This adds no dependency, schema migration, database role, frontend or product endpoint.

## Retained setup

The portable `pnpm local:host` operator selects only the existing `tt-dev` or `tt-stage` Compose project and reuses existing environment and per-role credential files. It does not bootstrap, migrate, rotate role credentials, rerun the general synthetic seed, or reset a target. Preparation requires current migration identities/checksums. Fresh targets require the separate database workflow first.

The [Compose overlay](../../infra/local/compose.service-host.yaml) adds a distinct production runner image for the private host, a tooling-only preparation/proof service, and project-scoped `host-state`, `host-journal` and `workflow-state` volumes. The dev frontend keeps its existing tooling image and port. Host health/callback ports bind loopback only: dev 8123, stage 8223. Provider/workflow ports stay inside the Compose network. The service account runs without root, on a read-only image with bounded resources and a stop grace period.

Preparation generates independent random host key rings, lookup/identity keys, notice UUIDs and a template UUID once. Settings and provider manifest are committed together by directory rename, with file/directory fsync and private Linux modes/ownership. Concurrent preparation refuses an existing lock. An interrupted staging directory or orphaned bucket requires inspection; no automatic repair replaces custody. Repeated preparation compares the full role/connection plan and preserves key bytes, identifiers, ciphertext and object versions. Narrow inserts add six clearly synthetic notices and one synthetic template; conflicts roll back rather than update existing records. These fixtures are never human or production policy acceptance.

The local plan declares 17 owned one-connection pools, five external slots (operators, CMS operator, workflow proof and setup), and a 20-connection reserve: **42 of 100** connections on each actual local PostgreSQL server. The frontend currently opens no database pool. Extra concurrent legacy workers/imports/Payload processes require declared maxima before enabling them. Dev and stage use separate physical containers and budgets.

## Actual local workflow proof

The retained Inngest dev server uses its pinned `--persist` mode with its working directory on `workflow-state`. Startup explicitly registers the three existing functions. The cron proof uses the existing `service-maintenance-v1` one-minute schedule and its real HTTP callback, composed maintenance service, admission service, limiter repository and restricted PostgreSQL lane. It does not directly call maintenance or invent a SQL handler to simulate dispatch.

Only quota cleanup is enabled. A unique disabled synthetic quota policy gets one expired and one unexpired bucket. The proof waits for cron to remove the expired bucket, verifies the unexpired bucket and disabled policy are preserved, and confirms `/api/reports` returns 404. It removes only its own remaining probe records. Registration/dispatch/SQL failure or timeout fails the proof. Report issuance, source pulls, mail send/verification, analytics collection, advertising and destructive retention stay disabled. Existing tests continue to cover signed privacy-journal restart, bounded admission, readiness loss and shutdown.

## Persistence boundary and remaining work

PostgreSQL data, private settings, journal files and Inngest state use retained volumes. `local:host stop` stops the host and workflow process while keeping PostgreSQL and Moto running. Generic `local down` refuses a target marked as prepared. Repeat startup and preparation preserve settings and verify fixture custody before host admission.

**Moto 5.2.0 remains memory-only.** Recording/replay does not guarantee identical KMS material, ciphertext or immutable version identities; it is not used as persistence. Each target records a KMS-encrypted canary plus two exact S3 versions in each bucket. Preparation and every persistent host start decrypt/check all four versions. Missing keys, changed bytes, disabled versioning or lost versions refuse startup without regeneration. Docker/OS restart or manual Moto removal/restart requires a deliberate fixture recovery decision. Keep real customer data out of this setup. Cold-restart provider recovery and hosted S3/KMS custody remain open; volume names cannot close them.

The journal volume is separate from PostgreSQL on the same local Docker host. This proves local separation, not independent disaster recovery, encrypted-volume custody or hosted RPO/RTO. Inngest dev mode is unsigned local testing, not hosted workflow authentication/durability acceptance. The [six S3 gates](P1-PR-027-s3-gate-review.md) and original P1-PR-027 completion boxes remain open. P1-PR-028–030 stay blocked.

See the [operator commands](../operations/local-service-host.md#retained-devstage-workflow), [validation record](evidence/P1/p1-pr-027-persistent-validation.md), [cron proof](../../scripts/runtime/local-workflow-proof.ts), and [host regression](../../tests/database/service-host.test.ts).
