# P1-PR-027 — LR01 trust-root and material adverse proof

LR01 adds disposable local tests for expired, future and non-CA roots, and missing, extra, mixed-issuer and mismatched key/leaf material. The approved TLS/admission and coordination fixtures, readers and production bootstrap/CLI/preflight/policy remain unchanged. This records local evidence only: **no original case or gate closes**. HS01–HS08 remain proposed; operators/coverage/rates unconfirmed; six S3 gates open; specialist/licensed work pending; APIs/frontends held. No hosted provisioning, purchases or actual recipient notifications.

[Local receipts](evidence/P1/p1-pr-027-trust-material-local.json), [source and preservation pins](evidence/P1/p1-pr-027-trust-material-sources.json), [validation](evidence/P1/p1-pr-027-trust-material-validation.md), [prior reconciliation](P1-PR-027-coordination-evidence-reconciliation.md).

## Execution and refusal boundaries

Run `node tests/fixtures/trust-material/run.mjs` from the repository root with local Docker. The no-argument runner creates nine fresh generated projects, two distinct PostgreSQL services per project, internal networks without published ports and exact owned volumes. It refuses pre-existing project resources and tooling tags before entering cleanup scope. It uses the approved pinned PostgreSQL, Moto/cryptography and Node tooling images; it does not invoke another complete proof runner as an initializer.

The new certificate writer keeps root signing keys in memory and emits the same bounded file layout used by the frozen admission fixture. Source/target private keys remain distinct, UID 999 and mode 0600. The three root negatives contain actual expired, future or non-CA X.509 root bytes. Their owner context hashes match those bytes, and the actual material/resource seal is created before observation and compared afterward. These controls therefore do not depend on an intentionally stale seal or mismatched CA digest. The unchanged reader rejects each root before constructing/connecting an owner client. They are **pre-driver root refusals**, not failed TLS handshakes. Positive controls perform actual verified TLS/read-only catalog observations against all four endpoints.

Each of the five material profiles first admits its own untouched four-endpoint foundation. A separate network-none parent-controlled actor then changes exactly one fixed synthetic file. The observer cannot invoke that actor or write the mounted files. Missing trust material fails before a driver connection; the other material faults invalidate the frozen custodian's exact inventory or comparison digest. No changed generation is resealed, repaired or adopted for observation.

| Profile | Actual control | Required observation |
| --- | --- | --- |
| positive | Valid root and distinct source/target keys | Four verified owner endpoints, four connect/end calls, matching foundation snapshots |
| root-expired | Root validity ended two days before generation | Matching CA hash; root date assertion; refusal before any owner driver/SQL |
| root-future | Root validity starts two days after generation | Matching CA hash; root date assertion; refusal before any owner driver/SQL |
| root-nonca | Self-signed root has BasicConstraints CA false, otherwise current dates | Matching CA hash; actual CA false; refusal before any owner driver/SQL |
| missing-root | Remove the fixed trust root after positive baseline | Actual file absence; refusal before any owner driver/SQL |
| missing-leaf | Remove the source valid leaf after positive baseline | Actual file absence; custodian inventory refusal before any owner driver/SQL |
| extra-file | Add one fixed extra trust entry after positive baseline | Actual unexpected directory entry; inventory refusal before any owner driver/SQL |
| mixed-leaf | Replace source leaf with one signed by another in-memory issuer, preserving hostname, current dates and original key | Actual signature/issuer mismatch with correct key pair; custody refusal before any owner driver/SQL |
| wrong-key-pair | Replace source private key while preserving leaf and UID/mode | Actual public-key mismatch, correct UID/0600; custody refusal before any owner driver/SQL |

The material controls occur after PostgreSQL has loaded its original valid certificate/key. They prove changed-file custody refusal. They do **not** demonstrate malformed initial key-pair admission, PostgreSQL startup refusal, certificate reload behavior or a failed handshake against the changed files. Those gaps stay explicit. No production TLS policy is added or changed.

The test spies count real `pg.Client` connect/query/end calls without replacing their implementations or responses. Every negative requires zero calls to all three and an empty observation receipt. There are **14 live test executions**: six positive controls and eight negatives across nine owned projects. Positive controls account for 24 owner connects/ends. These counts do not include setup sessions, do not claim independent backend absence and are not added to the separate full regression as unique tests. No new pure test is included in the default full suite.

## Isolation, timing and cleanup

The observer has read-only owner/trust/control mounts, a read-only root filesystem, bounded tooling tmpfs and no capabilities. It receives no setup root password, Docker socket, server keys, fault mounts or provider credentials. Trusted setup retains the earlier private-network plaintext initialization behavior and exits before observation. The unchanged read-only Docker supervisor/seal helper remain trusted same-run custodians; their daemon socket and key-read capability do not constitute independent authentication or a hostile-host sandbox. The fault actor has no network or owner credential mount; its fixed file changes belong only to newly generated synthetic volumes.

The original whole-attempt 4000ms budget, at-most-1500ms connect/query budget, 1000ms statement/idle limits, 250ms lock limit, 5000ms transaction cap, 750ms IPC/end waits and 90-second outer readiness remain unchanged. There is no root fallback, permissive TLS switch or timeout increase. The Vitest/outer Docker watchdogs are distinct from admission budgets.

Every profile removes its exact owned project and independently inspects its labeled containers, volumes and networks for absence. The environment/binding files are removed only after that inspection succeeds. Failed/unavailable teardown remains unknown and retains synthetic custody for recovery; a later cleanup cannot retroactively turn an unknown admission/backend observation into a clean one. Successful zero-connection negatives need no driver end; they do not assert independent backend absence. No independent post-fault database preservation audit is claimed; the controls perform no SQL and change only the declared synthetic files. Foundation-only pre-fault parity does not imply populated rows, migration/CMS histories or integrated restore/journal continuity.

## Evidence credit and remaining work

| Original requirement | Added local evidence | Remaining acceptance boundary |
| --- | --- | --- |
| TA05 | Actual missing/extra/mixed/pair file faults, exact pre-fault admission and subsequent custody refusal | Initial malformed-pair/startup, other custody variants and independent identity authority remain outside this proof; unaccepted |
| TA06 | Actual non-CA root pre-driver rejection, alongside earlier separately credited unrelated-root TLS refusal | No external CA/account/DNS or independent identity authority; unaccepted |
| TA07 | Actual expired/future roots with matching context hashes and sealed material | No injected system-clock skew or hosted certificate lifecycle; unaccepted |
| MC02 | Uses the unchanged four-endpoint admission reader with additive root/material negatives | No new coordination protocol or complete TA coverage; unaccepted |
| BLC-T06 | Narrow actual synthetic TLS/custody observations | Wrong version/identity/routing variants and production admission remain outside this proof; unaccepted |

All 18 journal scenarios, 22 lifecycle cases, 16 MT controls and 20 TA controls retain their original proposed/unaccepted records. Local completion does not select a production authority or supply durability, authentication, target fencing, runtime release or hosted acceptance. The next local priority remains **LR02: routing/resource collision contract review**, with bounded owned controls to be designed separately. LR03 I/O/end/inspection uncertainty and LR04 populated phase-aware preservation remain separate; LR05 actual human/provider decisions stays held.
