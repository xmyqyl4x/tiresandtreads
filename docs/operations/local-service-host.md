# Local service-host runbook

The local host composes S3 services over one PostgreSQL server and separate application/CMS databases. [Contract and limits](../implementation/P1-PR-027-local-service-host.md). Product APIs remain on hold.

## Reproduce the isolated proof

The [retained setup contract](../implementation/P1-PR-027-persistent-local-workflows.md) and commands below cover the separate dev/stage workflow; they do not reset a retained database.

From the repository, run `pnpm verify:service-host`. It creates only a randomly named test project, starts pinned PostgreSQL and local provider containers, migrates isolated application/CMS fixtures, and runs the real-role host scenarios. It verifies pool ownership/capacity, CMS publication, signed-journal restart, missing-source refusal, configuration failures, readiness loss/recovery and shutdown. The healthy bundle runs from a temporary directory without workspace dependencies. Disposable resources are removed. Native PostgreSQL and retained dev/stage credentials/data are untouched.

`pnpm verify:push` additionally runs the full Linux suite, advisory audit, layer/schema/model checks, health contracts, runtime lifecycle and actual application/CMS dump/restore. Fixtures cannot close actual provider, specialist, policy, render or live-release gates.

## Configure an intentional local instance

1. Bootstrap/migrate the selected local application and CMS databases using the existing [database workflow](../development.md). Confirm the current 33 application/three CMS migrations and their checksums through that workflow; connectivity readiness does not replace migration validation. Preserve the generated role credentials. The host never bootstraps roles, migrates, seeds notices or fabricates reviews at startup.
2. Copy the [settings shape](local-service-host.settings.example.json) into an ignored private file outside tracked source. Every placeholder is intentionally invalid. Supply all 17 correct role DSNs and pool maxima, actual replica counts, every separately running process's pool maxima by database, and a cluster reserve. Both databases must use the same direct local PostgreSQL server. Include web, migration/operator/Payload/import/legacy-worker pools when those processes are actually enabled. Do not put whole-cluster capacity into both database allocations.
3. Supply independent persistent token/report/privacy/collection key rings, retained lookup versions and stable identity keys. Select explicitly synthetic local notice/template/policy records and the exact stored renderer hash. Keep `fixture: true` and a reserved HTTPS `.test` canonical origin. This origin is used to construct metadata/links; it is not a listening endpoint and the host does not resolve it. Existing public-origin policy remains intact.
4. Restrict the file to the service account (0600/0400 in Linux; a private ACL in Windows). Docker Desktop bind-mount permission mapping must be checked in the container. A private named secret volume with verified ownership/mode avoids relying on Windows POSIX mode emulation. Never bake the file into an image or print its contents.
5. Set `APP_ENV` to `dev-local`, `test-local` or `stage-local`, and `PROVIDER_MODE=fixtures`. Set `SERVICE_HOST_CONFIG_FILE` and `SERVICE_HOST_JOURNAL_DIRECTORY` to absolute paths visible to the process. Mount the journal separately from database backup/restore data, on durable encrypted storage, and retain it and the matching keys across restarts. The host refuses an unreadable/incompatible journal.
6. Supply the existing local provider variables: `STORAGE_ENDPOINT`, `WORKFLOW_ENDPOINT`, `PRIVATE_BUCKET`, `PUBLIC_BUCKET`, `KMS_KEY_ID`, `AWS_REGION` and explicit fixture AWS credentials. Buckets/KMS keys are prepared deliberately through local tooling; startup does not silently recreate them. Inside the Compose network use its `postgres`, `moto` and `inngest` service addresses. For a native process use the chosen databases' loopback ports and explicitly mapped loopback provider ports. Hosted endpoints and credentials are refused.
7. Run `pnpm service-host check` (or `node service-host.mjs check` in the built runner) to compose/check/drain once and print only masked metadata. To serve local health/workflow callbacks, set a local `WORKER_ORIGIN` matching `WORKER_PORT` and run `pnpm service-host run`. The default port is 8123. Keep the listener on a private local network; the in-app web host remains separate. Do not run another worker on that port or omit its pools from the budget.
8. Leave `maintenance.enabled` empty initially. After inspecting the fixture records, enable only the permitted lanes needed for the exercise and choose at most four for a cycle. Delivery/source/verification activation and retention apply flags are rejected. The three local workflow functions must be explicitly registered with the local workflow server; readiness alone does not prove a cron has executed. No transport retries are added to maintenance.
9. Check `/health/ready`; expect 200 only with usable application/CMS connectivity. Normal product URLs return 404. On stop send SIGTERM/SIGINT, allow the bounded service/pool drain, and confirm host connections disappear. Restart with the same file, journal, object versions and keys. Do not delete data or regenerate key rings to cure a configuration error.

Configuration/admission errors are intentionally generic. Inspect the selected target, file permissions, pinned IDs/hashes, key coverage and budget locally without copying secrets into logs or tickets. The headless health service returns masked alarms to a currently authorized operations actor; actual hosted monitoring and staffed response remain pending.

## Retained dev/stage workflow

Use Node 24 and the pinned pnpm version from Windows PowerShell, WSL or Linux with a Linux Docker engine. Select `dev` or `stage` explicitly:

```sh
pnpm local:host prepare dev
pnpm local:host up dev
pnpm local:host prove dev
pnpm local:host status dev
pnpm local:host stop dev
```

Repeat with `stage`. Preparation builds the tooling and separate host runner, starts the existing PostgreSQL container plus the local Moto fixture, checks both migration histories, and generates private host custody once. It requires the existing `.local/dev.env` and `.local/db-dev.env` (or stage equivalents), current migrations and correct credentials. It never runs bootstrap/migrate/general seed. Six synthetic notices and one synthetic template are explicitly prepared without updating existing records. Repeated preparation verifies custody and preserves private key bytes.

The host uses 0600 settings owned by Linux UID 1000 inside `tt-dev_host-state` / `tt-stage_host-state`, avoiding Windows bind-mount mode emulation. Journal directories are 0700 in separate `host-journal` volumes. Keep encrypted host backups and operating-system/Docker access controlled; the volume alone supplies no independent encryption or disaster recovery. `workflow-state` retains Inngest's dev database. Never print private JSON, environment files or Docker configuration containing credentials. No secret is baked into the image or committed.

Dev health is `http://127.0.0.1:8123/health/ready`; stage is port 8223. Only health and `/internal/inngest` are served. Providers and Inngest have no published ports. `up` verifies provider custody, starts the host, and registers its three functions. `prove` waits at most 85 seconds for the real cron callback to remove its expired SQL bucket while retaining an unexpired bucket and disabled policy. It confirms product APIs remain 404 and cleans only its own records. Failure is a failed proof, not an activation approval.

`stop` drains the host and stops Inngest, retaining all volumes and leaving PostgreSQL/Moto running. `local down` refuses marked prepared targets because removing Moto loses its in-memory KMS/S3 state. Keep Moto running during host/workflow restarts. Docker/OS restart, manually stopping/recreating Moto, or removing provider state requires deliberate fixture recovery; startup then refuses missing canary ciphertext/version custody. **This is not a complete cold-restart persistent provider environment.** Do not replay recordings, recreate keys/versions, delete manifests or rerun bootstrap to hide a mismatch. Provider cold-restart recovery remains a next local task; hosted custody remains gated.

Before enabling additional maintenance lanes, review the fixture data and declare every additional process's pool maximum. The retained plan enables only bounded SQL quota cleanup (17 owned pools + five external slots + reserve 20 = 42 of the actual 100 PostgreSQL slots). It does not enable quota admission policies, product reports, mail, analytics collection, ads or source pulls. The current web process opens no database pool. Retention remains dry-run. Original six S3 gates and the API hold are unchanged.
