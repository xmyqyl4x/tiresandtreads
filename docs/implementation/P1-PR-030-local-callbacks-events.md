# P1-PR-030 — local callbacks, event intake and email actions

This card implements nineteen additional operations, bringing the local contract to 64. It uses the owner's P1-PR-028–032 implementation exception. The six actual S3 gates, full S4/live acceptance, HS01–HS08 decisions, operators/coverage/rates, specialist/licensed work and deployment remain held.

## Transport and service boundaries

| Surface | Service and authority | Result |
| --- | --- | --- |
| Resend-shaped callback | Original bytes, Svix message ID/timestamp/signature, separate local mail keyring; existing mail-event service | 202 after receipt/facts commit; replay is stable and conflicting identity/digest is 409 |
| Fixed existing SQL job wake | Separate workflow keyring, signed raw JSON, message ID exactly `job_JOB_UUID`; existing workflow dispatch/lease path | 202 accepts the wake attempt; it does not assert that a job exists, was claimed or completed |
| Analytics grant and collection | Current owner/consent authority, signed collection proof, trusted socket peer, GPC and explicit CMP availability; existing PostgreSQL services | 202 after event commit, 204 when refused, 409 conflicting event identity, 429 admission limit |
| Fourteen email action/read operations | Signed purpose proofs in API headers or compatibility email paths; existing contact/link services and a read-only confirmation query | Scanner GETs only read; explicit confirmation, feedback and RFC8058 withdrawal remain separate POST operations |
| Retailer redirect | Existing approved terms, exact-origin and current revision-bound health checks | 302 to the approved HTTPS destination; missing/stale eligibility is generic absence |

Controllers select these fixed operations and call the application layer. They do not accept SQL, caller-selected job kinds, methods, provider URLs or actor identities. The job wake cannot register a job or expand the service host's handler allowlist. Existing reconciliation remains authoritative when a job is unclaimed, already complete or deferred. The actual private Inngest worker/SDK integration stays a separate boundary.

Raw JSON bytes reach signature verification before decoding. The body ceilings are 256 KiB for mail callbacks, 8 KiB for job wake/forms and 64 KiB for collection and ordinary JSON. Forms reject duplicate fields and malformed encoding. Callback routes use their signature/purpose proof rather than browser cookies; ordinary owner and capability mutations retain their Origin/CSRF rules. One-click unsubscribe accepts the exact RFC8058 form without login or a browser Origin requirement. Its GET counterpart cannot withdraw consent.

Confirmation GET uses a dedicated application query that validates the verification audience and current stored proof, guards the contact and returns only purpose, consent state and expiry. It neither creates an unsubscribe capability nor confirms consent. Unsubscribe preferences retain their own audience. API clients can read both through header-only proofs; URL proofs exist for email compatibility routes. Responses are private, no-store, noindex and no-referrer.

The common client explicitly supports empty 204 results using the server's request ID. JSON successes, empty responses and HTTPS redirects have distinct transport projections and generated contracts. OpenAPI is derived from the actual route bindings, including content types, required signature/CMP headers, success status codes and path-proof parameters. The domain service retains event/name/route/time and consent decisions. `createEventClient` supplies typed grant, collection, confirmation, preference, withdrawal and feedback requests for web/app/connector consumers.

## Local keys and observations

Callbacks are disabled without an explicit `LOCAL_CALLBACK_KEYS_FILE`. The private file has schema version 1, mode `synthetic-local` and separate `mail`/`workflow` arrays. Each accepts up to four canonical Svix-format keys; duplicates and cross-purpose reuse refuse. Loaded keyrings are copied/frozen. Malformed configured files refuse API startup before services open.

With `LOCAL_PRODUCT_API=enabled`, `APP_ENV` set to a fixture-local profile, and `PROVIDER_MODE=fixtures`, create an exclusive private fixture file in an existing private directory:

```sh
pnpm exec tsx scripts/runtime/local-callback-keys.ts /absolute/private/local-directory
```

The issuer prints file location/mode only. Restart the API with that file configured to apply a changed keyring. These keys establish local synthetic protocol tests; actual provider credentials, custody, rotation/offboarding and provider acceptance require their outstanding decisions and evidence. Windows directories must remain private to the user; Linux also checks private modes and refuses symlinks. Keep these files out of Git.

`LOCAL_HTTP_OBSERVATIONS=enabled` emits only declared operation ID, fixed method, status, server-generated request ID and bounded duration. Raw URLs/path tokens, query parameters, headers, payloads, emails, IPs and provider exceptions are excluded. Observer failure cannot alter a committed result. Unknown observation flag values refuse startup. This optional local output is separate from actual hosted monitoring/recipient acceptance.

## Verification

Tests exposed and corrected a confirmation GET incorrectly using the unsubscribe-only reader, and exercised raw-byte verification, bounded bodies/forms, unsafe redirects, missing/expired/cross-purpose signatures, immutable keyrings, CLI mode refusal, safe observations and empty-response client handling. The two pre-existing Unix file controls plus one new key-file control execute in Linux; native Windows skips those controls.

Thirteen real HTTP/PostgreSQL journeys cover concurrent signed mail replay, forged/expired/mutated callbacks with no receipt, digest conflict, uncertain delivery reconciliation, one SQL effect under concurrent job wakes, a simulated lost HTTP acknowledgement after SQL commit/retry, arbitrary job command refusal, read-only scanner visits and one-click withdrawal, explicit signed feedback, consented event commit/replay/conflict/GPC/withdrawal, and approved education/retailer redirects with later withdrawal/revision refusal. Recipient, object, provider-retrieval and destination-health ports are explicitly synthetic. No real recipient is notified and no destination is followed by the server.

The job test's acknowledgement loss is simulated after a real database transaction. It does not establish independent custody, durability, authentication or target fencing for the original lifecycle design. Original design cases and acceptance gates remain open. Existing production bootstrap/CLI/preflight and policy are unchanged.

Complete exact-source Linux build/quality/coverage/recovery/environment regression, independent CI, source review and main checks are required for merge and recorded in the implementation PR. Full local API composition/inventory/load review follows in P1-PR-031; actual S4/live acceptance remains separate.
