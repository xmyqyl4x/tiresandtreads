# P1-PR-036 — local delivery, cancellation, purpose and rights controls

The owner continuation after PR80 authorizes finishing the current PR and implementing, testing and merging the next card, P1-PR-036. This is local product development under the existing API/frontend exception. All six actual S3 gates remain pending with empty records; S3/G0/S4/G3, live release and deployment acceptance remain held. HS01–HS08 stay proposed; operators, coverage, rates, specialist review and licensed work remain unconfirmed/pending. No production bootstrap/CLI/preflight/policy, schema, privilege or provider activation changes are included.

## Shared contracts and responsibilities

The browser consumes existing delivery/contact, consent-policy, purpose-capability and rights APIs. The generated local inventory remains 66 operations. Portable input schemas are shared with the existing HTTP adapter without changing its wire contract or policy. The new small SDK validates response projections, canonical timestamps, send/request bindings, proof audiences, omitted credentials on capability calls and a 15-second timeout independently of the UI. It never implements delivery dispatch, report rendering, consent authorization or rights fulfillment in the browser.

## Independent report and offers requests

`/preview/delivery` accepts a saved report/version and optional saved comparison revision from the report/comparison navigation. Both purpose boxes begin unchecked. Report-only and both use the delivery service; offers-only uses the contact service with no report binding. Only selected notice references are submitted. Entering an existing email does not reveal or overwrite its verified preferences. An acknowledgement never claims a new confirmed offers subscription. Optional analytics/advertising and identity sharing are not inferred from either email choice.

The UI blocks submission until current published notice references are available and preserves field-level errors and focus. Purpose copy describes the technical preview; actual production notice/legal acceptance remains pending. Browser testing exposed an error-classification gap that labeled a missing address as unavailable notices; regressions now require field-specific errors and refusal of hidden address control characters.

## Scheduling, uncertainty and correction

The service supplies the actual cancellation deadline and earliest send time. Scheduled, dispatching, accepted, uncertain, failed, suppressed, manual-review and cancelled states have distinct copy. Provider acceptance is not proof of delivery. A browser clock is not cancellation authority; the service decides under compare-and-swap. Unknown outcomes never create a replacement send or trigger provider retries. Refresh reads existing state.

Commands snapshot their bodies before identity I/O, coalesce duplicate in-flight submissions and keep the same body/key after an uncertain acknowledgement. Definite refusals permit correction. Cancel uses the observed server revision; conflicts require checking current status, never a recall promise. Correcting an address cancels first with the existing correction reason, invalidates that request's pending wrong-address proofs, clears address and purpose choices, then requires an explicit new submission. A normal report cancellation leaves separate verified preferences unchanged.

Restored send views show only the existing masked status projection. They do not present URL-supplied report parameters as the authoritative binding of the restored request, or redisplay its recipient. The request form is hidden after acknowledgement/restoration. No queued recipient is edited in place.

## Browser choices and purpose-specific private links

The existing Privacy choices control is available on the privacy page and footer with distinct accessible dialog IDs. Necessary storage remains on, identity sharing off, and optional purposes default denied. GPC masks targeted ads and is included in the explicit save. Email purposes remain independent. Consent commands retain their original revision/body/key across a lost read acknowledgement; a later conflicting revision requires an explicit reload. Standalone consent SDK calls are bounded. Modal focus, save status and unchanged retry controls are preserved; closing cannot discard an in-flight save.

`/preview/email-confirmation#verify…`, `/preview/email-preferences#unsubscribe…` and `/preview/privacy-request#privacy…` use purpose-bound proofs only in fragments and authorization headers. Capability requests omit owner cookies and need no account. Opening, refreshing or keyboard skip navigation performs no confirmation, withdrawal or fulfillment and preserves the fragment. Mutations require explicit POST actions. Invalid, expired, revoked, wrong-purpose and unavailable views use generic refusals. Proofs are not put into query parameters, telemetry or application browser storage.

## Rights requests and status

The privacy page separates browser-owned and email-owned requests. Request type and privacy region are explicit; restrictive owner instructions require an acknowledgement. An unsupported/unreviewed region is unavailable rather than assigned an invented policy. Owner commands can recover their original private status link. Public email acknowledgement is masked. An ambiguous public email request is not automatically resubmitted, because that existing endpoint does not promise an idempotent verification request.

The status view displays only the server request ID, kind, state, due date and recorded completion. Pending, verified, processing, manual review and completed are distinct. Inbox proof must satisfy the existing delivered-proof guard and then an explicit confirmation action; viewing alone never verifies it. Access/export/correction may require operator fulfillment. No UI claim substitutes for actual workflow completion.

## Validation and fixture boundaries

Unit/use-case tests cover independent purposes, notice bindings, exact report/version/comparison inputs, malformed/private DTO refusal, safe retries, duplicate clicks, owner initialization recovery, GPC and private transport bounds. Real HTTP/PostgreSQL journeys cover report-only/offers-only/both, stable sends, the actual 60-second delay, cancellation/deadline refusal, immutable correction, masked/expired proofs, purpose withdrawal, private status and inbox verification. A historical scheduled record is inserted for the deadline test; existing identity guards stay enabled.

Manual browser support is confined to `tests/fixtures/http/serve-delivery-preview.ts` and an owned disposable harness. It observes at most 1,000 safe operation/method/status records and 40 fixed `p1-pr-036-…@example.invalid` private links, with a 30-minute lifetime and checked teardown. Its email-rights inbox is the existing in-memory fixture port; it does not send to a recipient or call an external mail provider. No proof-discovery HTTP endpoint is added. These observations can establish local request behavior, not actual inbox delivery, independent custody/authentication or live acceptance.

The browser evidence record distinguishes actual UI actions, bounded failure/recovery, viewport captures and synthetic inbox observations from HTTP/unit evidence. The unchanged 120,000-byte complete-client gzip budget, full quality/build/coverage/database/recovery/operational gate, clean current-source review and all nine PR/main CI profiles are required before completion. None of this closes an original lifecycle design case, S3/S4/G3 or deployment gate.
