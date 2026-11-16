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

The initial reconciled focused run passes 195 executions (164 unit and 31 native). The [evidence record](evidence/P2/p2-l01-staff-integration.json) preserves the failed first full attempt, corrected expectations and the separate cleanup timeout/cascade; its checkpoint delay has no established cause. No timeout was relaxed. Final exact-source regression, coverage, fresh source review and all actual PR/main checks are required before merge. Evidence is recorded in the cycle validation receipts; no historical result is rewritten.

## Retained holds

Six S3 gates stay open; HS01–HS08 remain proposed; operators/coverage/rates are unconfirmed. Licensed feeds, specialist review, actual identity/provider/model/scanner/inbox/AT/editorial/privacy/security/hosting/pilot/phase/live acceptance remain pending. No default 33-app/3-CMS manifest, opt-in 55-migration/225-table promotion, production bootstrap/CLI/preflight/admission policy, live provider/model effect, provisioning, purchase, actual recipient notification or original case/gate closure is introduced.

## Dependency correction discovered by CI

CI's current advisory lookup identified [GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h), affecting the pinned Next.js 16.4.3. The advisory specifies 16.4.5 as patched. This cycle pins 16.4.5 and regenerates the lockfile before a fresh complete build/regression and same-source review. The earlier successful 4,884-execution source remains historical evidence; it is not a pass for the dependency revision. Existing audit thresholds and the independent deepmerge mitigation remain unchanged. Earlier advisory receipts are not overwritten; current CI audits are evaluated on their actual contents.

## Contact-reveal review correction

Fresh PR review identified one remaining partner-principal lookup in the initial contact-reveal step. It now uses the same dedicated staff authority as visitor reference issuance and both subsequent reveal authorization checks. No verified business-email/domain assertion is required. The visitor reference remains bound to the same staff subject, the audit must commit before decryption, and current permissions/session authority are checked before returning plaintext. Three behavioral regressions fail against the reviewed source (50 existing cases pass), then all 53 contact/insights use cases pass after the fix. Native PostgreSQL coverage also exercises dedicated staff reveal with a partner verifier that refuses the credential. The in-progress dependency-patch full run was explicitly stopped and its owned fixture removed for this correction; it is not recorded as final validation.

The final focused set passes 296 executions: 164 unit, 53 use-case and 79 native tests, with lint and strict TypeScript compilation. It includes the dedicated reveal audit/reauthorization proof as well as the signed Next/HTTP/SQL journeys. The expected final exact-source full total is 4,887; only the final cycle receipts can establish that result.

The final full run also detected the expected lockfile digest drift in historical evidence review. An additional exact transition advances only `pnpm-lock.yaml` from its approved Clerk digest to the security-patched digest. Historical manifests/receipts and the six existing path exceptions remain unchanged; arbitrary subsequent lockfile bytes are still refused by the existing adverse regressions. This is current-source reconciliation, not acceptance or a change to production admission.

All 15 existing CI/photo-dependency/restore-file attestation regressions pass with the transition, including arbitrary lockfile drift refusals. The interrupted source had six known pin assertions failing; it is not reported as a completed full run. The final revised source requires its own complete regression.

The next root regression completed 4,777 tests: 4,776 passed and one historical product-pin expectation failed. That expectation now selects the exact reviewed security successor before the historical Clerk digest. All 71 pin/readiness/dependency compatibility tests across eight files pass, including arbitrary drift refusals. No new test or threshold change was introduced. A fresh exact-source full cycle is still required.

The companion TypeScript declaration also exports the reviewed pin transition. Complete static quality checks (including strict TypeScript, boundaries, generated contracts, schema and S3 preservation) and all 71 related regressions pass together before the final full cycle.
