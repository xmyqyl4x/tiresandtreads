# P2-L01 — Verified staff access integration

The owner authorized implementation of all three local Phase 2 engineering follow-ups on November 16, 2026. This cycle implements staff access. Runtime composition and complete SQL/object recovery are separate cycles. Phase 3 remains planning only.

## Behavior

The data/review and assistance workspaces accept bounded signed session credentials in page memory. Partner and owner workspaces retain their existing opaque credential contract. Both staff proxies preserve the credential and enforce the existing local enablement, loopback Host/Origin, route, query, body, timeout, cookie stripping, response, CSP and no-store boundaries. The SDK stays on the server.

The partner security decorator preserves a configured dedicated staff verifier. A refusal never falls back to ordinary partner/owner authentication. A verified actor carries an internal canonical provider subject, mapped staff ID, conservative recent MFA time and bounded expiry. None of these internal facts, the bearer or identity-provider details are projected into API responses. No business email verification or domain is manufactured.

Services use an explicit staff-authority port. It reuses the same current Clerk verification and DB identity mapping; existing SQL permission, tenant affiliation and independent reviewer/publisher checks remain authoritative. Partner-only methods still require the original verified business principal. Legacy opaque test authorities work only where no dedicated staff authority is configured.

Staff-only partner decisions now select the staff realm in the endpoint contract. Lifecycle and dispute commands explicitly support both realms because business owners and staff have distinct permitted actions. On these two shared contracts a three-part signed credential selects only the dedicated verifier; an opaque credential selects only the partner verifier. This is transport routing, never a grant from decoded claims, and failure does not change realms. Service authorization still decides which action is permitted. The generated OpenAPI records the distinction.

Same-subject/session token renewal retains CSRF binding. Every request rechecks current identity and provider session state; services check current SQL permissions. Existing command fingerprints and uncertain-outcome reconciliation do not change.

## Validation

Three behavioral regressions fail against the previous source: the decorator loses its dedicated verifier and both staff proxies reject signed transport. Generated RSA signatures and fixed synthetic GET session records exercise the installed Clerk backend SDK. Native tests run actual built Next → private proxy → HTTP → service → PostgreSQL journeys for CSV upload/review/publication and independent partner review, plus operations, purpose-specific queues, pilot metadata, renewal, wrong audience, forgery, owner-realm refusal, role removal and provider-session revocation. These tests do not claim interactive browser or real-provider authentication acceptance.

Final exact-source regression, coverage, fresh source review and all actual PR/main checks are required before merge. Evidence is recorded in the cycle validation receipts; no historical result is rewritten.

## Retained holds

Six S3 gates stay open; HS01–HS08 remain proposed; operators/coverage/rates are unconfirmed. Licensed feeds, specialist review, actual identity/provider/model/scanner/inbox/AT/editorial/privacy/security/hosting/pilot/phase/live acceptance remain pending. No default 33-app/3-CMS manifest, opt-in 55-migration/225-table promotion, production bootstrap/CLI/preflight/admission policy, live provider/model effect, provisioning, purchase, actual recipient notification or original case/gate closure is introduced.
