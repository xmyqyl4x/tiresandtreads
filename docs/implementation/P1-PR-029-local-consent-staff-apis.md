# P1-PR-029 — local consent and staff APIs

This implements the second card in the owner's P1-PR-028–032 local development exception. Actual S3/S4 acceptance, hosting, deployment, specialist/licensed work and live provider effects remain held. HS01–HS08 remain proposed; these fixture identities are not operator appointments or an accepted MFA/identity-provider integration.

## Functional boundaries

The same loopback transport binds eleven consent/privacy/delivery operations and twelve staff operations. It derives actors from trusted credentials and delegates business decisions, transactions, purpose checks, revisions, suppression and audit to the existing services. Controllers do not implement SQL or tire advice. Browser mutations require Origin and CSRF; staff mutations additionally require a server-held synthetic fixture grant with a recent MFA timestamp. Every staff service checks current database permission/status; import admission explicitly checks `data.review` before opening an artifact.

| Operations | Existing service boundary | Authority and local verification |
| --- | --- | --- |
| Current published policy/notice IDs; contact request; browser choices/read | Contact/consent services | Owner session, notice IDs, expected revision; GPC overrides contradictory body data |
| Delivery request, state, cancel | Delivery orchestration | Owned immutable report/comparison; current cancellation revision; another owner receives generic absence |
| Owner/email privacy request, proof confirm/status | Privacy services | Purpose-scoped proof; generic email acknowledgement; status projects only ID, kind, state and due/completed times |
| Queues and recovery | Staff operations | Current database role, recent fixture MFA, masked queue columns; stable recovery ID and existing audit/replay checks |
| Import prepare/status/diff/publish/rollback | Ingestion/publication services | Registered artifact ID, checksum/end-frame validation, trusted actor, approved publication and expected head; no HTTP path, URL, SQL or function inputs |
| Content enqueue; SEO audit/metrics | Content publication | Existing content/SEO roles, CMS revision and publication workflow; asynchronous work remains in the service/worker layer |
| Operations and advertising revenue | Operations/commercial readers | Existing role checks and bounded typed query dimensions; exact counters/money serialize without numeric rounding |

Strict Zod wire schemas and operation-specific query declarations feed the generated local OpenAPI inventory. Typed consent/staff clients use the common transport. Capabilities and staff credentials remain in headers. A caller-supplied staff ID, role or MFA flag never establishes authority. The services retain their own command/source/CMS revision idempotency rules; recovery uses the trusted staff identity plus Idempotency-Key. A transport key does not create a new universal exactly-once execution guarantee.

The composition reserves five extra one-connection application lanes: `local_http_report`, `local_http_catalog`, `local_http_limiter`, `local_http_asset`, `local_http_staff`. Startup refuses missing reservations, invalid private files or non-fixture/non-local environments; shutdown drains the listener, HTTP pools, existing service host and object client.

## Local staff and artifact workflow

Staff is disabled by default. For explicit synthetic development, first prepare a private local directory and an existing synthetic database staff identity with the appropriate fixture roles. With the same validated local service-host environment/settings used by the API, run:

```sh
pnpm exec tsx scripts/runtime/local-staff-session.ts /absolute/private/local-directory SYNTHETIC_STAFF_UUID
```

The command writes new exclusive private grant/client files. Its console output contains paths/expiry only. Set `LOCAL_STAFF_GRANTS_FILE` to the grant file before starting/restarting the local API; keep the client file private and use its bearer and CSRF values with `createStaffClient`. Grants expire after one hour, while mutating and reading staff operations require MFA time within five minutes. Regenerate/restart for another synthetic verification window. The database must still authorize the identity on each service call. Key rotation/restart requires a matching new fixture grant; this is not a live identity-provider session lifecycle. On Windows keep the directory under the current user's private profile and restrict its ACL; Linux checks private mode bits and refuses symlinks. No secret or real customer data belongs in Git.

Set `LOCAL_IMPORT_ARTIFACTS_DIRECTORY` to a private directory containing pre-staged `ARTIFACT_UUID.manifest.json` and `ARTIFACT_UUID.ndjson` pairs conforming to the existing script-first import format. JSON metadata is limited to 16 KiB, data to 20 MiB, and frame/checksum/row-count verification remains in the existing snapshot reader and ingestion service. The API selects these fixed names only. Changes in bytes are detected; a checksum establishes byte consistency, not independent authentication, custody or authority. Licensed feeds remain pending. The P2 CSV administration UI is outside this card.

## Verification and acceptance

Tests first exercised missing modules and then behavioral refusal/immutability cases. Focused unit/client tests cover strict input shapes, current authority delegation, masking, private bounded files, immutable grants, expiry/tamper, trusted fixture issuance, command binding and query limits. Native Windows skips two Unix permission/symlink controls; those execute in Linux regression.

Eleven real HTTP/PostgreSQL journeys cover browser choices/GPC/stale revision, report-only contact, durable delivery request/status/cancel/foreign-owner denial, owner privacy proof projection, known/unknown email acknowledgement, forged staff headers, current role revocation, unsafe import input, actual registered snapshot ingestion/status/diff and audited recovery replay/conflict. This fixture uses synthetic encryption/object/mail/journal ports and never dispatches actual recipient notifications. It deliberately returns unavailable for CMS provider publication rather than manufacturing a successful paired-CMS proof; existing content-service database tests and the later complete local API composition gate cover those separate boundaries.

The complete exact-source Linux build/regression, independent CI and source review are required before merge and recorded in the implementation PR. Local completion does not accept the six actual S3 gates, full S4, real provider delivery, an operator or deployment. No production bootstrap/CLI/preflight or acceptance policy is changed.
