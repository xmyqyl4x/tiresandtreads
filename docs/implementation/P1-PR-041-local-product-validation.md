# P1-PR-041 — Local full-product validation

The joined fixture exercises the built Next server, HTTP authorization, PostgreSQL reports, a captured immutable delivery snapshot, the real email/PDF renderer, persisted private PDF/payload bytes and an explicitly selected bounded local sink. It honors the existing 60-second cancellation clock without disabling triggers or changing deadlines. Replay cannot emit a second synthetic message. The normal fixture behavior is unchanged unless this test-only renderer/sink is supplied. No production composition, schema, grant, dependency or provider is changed.

Synthetic supported fitment produces technical options only: issuanceAuthorized remains false. Unverified manual fitment produces no picks; invalid mileage is rejected and a corrected request succeeds. The joined proof checks unauthenticated private-page fallbacks, no-index/no-referrer protection, denied ads and non-fabricated ads.txt. Frozen renderer links use synthetic syntax-only contexts; this test does not mint or validate those capabilities. Existing owner/share/PDF authorization tests separately cover real local capability checks. The sink is an in-memory fixture, not SMTP or actual inbox acceptance.

## Coverage and regression triage

| Journey / requirement | Executed evidence |
| --- | --- |
| UC01/02/AT01/02: lookup, explicit fitment, unsupported input, saved results | web-product-journey and web-assessment database tests; actual browser lookup, assessment and private result |
| UC03/AT04: draft, version and stale recovery | web-results and HTTP complete journey; actual browser refinement |
| UC04/AT05: quote and comparison | web-comparison, HTTP complete journey and cost/use-case suites |
| UC05/AT06: share/redaction/fork/PDF authority | report-services and web-results tests; existing browser shared-link evidence |
| UC06/07/AT07/08/19: consent, schedule/cancel, fixed templates and independent purposes | joined real renderer/persisted payload proof, delivery-services and web-delivery-privacy suites; browser delivery/cancel |
| UC08/09/AT10/11/14: consent/privacy/recovery | existing PostgreSQL privacy, service-host, deletion replay and web-purpose suites |
| UC10/13/17/AT16/17/27: publication, source gaps, tools, SEO and ad fallbacks | web-education/public-education, NHTSA adapters, public-commerce and safe redirect tests |
| NFR02/AT18: keyboard, reflow and accessible names | browser evidence below; actual assistive technology and inbox acceptance pending |

The first joined run identified an overbroad test assertion that incorrectly rejected the legitimate evidence-confidence label in owner-requested email. The assertion now checks private input field leakage and active/external content rather than rejecting intended report copy. No product defect or production policy workaround was introduced for that finding.

## Accessibility and content readiness

The actual browser checks cover skip-link focus, error-summary focus and linked field focus, described-by targets, native named controls, explicit wheel-package choice, mobile menu Tab/Escape behavior and 320px reflow of form and private results. Screenshots and observations live in [the browser record](evidence/P1/p1-pr-041-browser/browser-checks.json). These structural and keyboard checks do not establish WCAG conformance or replace NVDA/VoiceOver testing. Existing real email HTML/PDF layout tests and renderer browser matrix are rerun; Gmail, Apple Mail, Outlook and Yahoo inbox acceptance remains pending as explicitly directed. The current PDF is untagged; PDF/UA and PDF assistive-technology acceptance remain pending, with HTML/text equivalents available.

Public educational technical fixtures and the 25-article register are validated by the existing publication suites. Actual article review/approval and complete launch content remain pending. Local noindex is deliberate; Search Console ownership, live indexing and canonical-origin acceptance remain pending. House-only layouts and fixed reservations are exercised without a real ad SDK. Lab/field LCP, cumulative CLS and real CMP/provider behavior still require an agreed measurement environment; viewport/reflow checks are not substituted for those metrics.

## Authority and handover

This completes the permitted local technical validation slice, not G3 or live-phase acceptance. Six S3 gates retain pending status and empty records; HS01–HS08 stay proposed; operators, coverage and rates are unconfirmed. Specialist/licensed, editorial, actual inbox/PDF accessibility, privacy/provider and hosted acceptance remain held. Local API/frontend development remains allowed. No provisioning, purchases, actual recipient notifications, hosted/live activation, original design-case or gate closure occurs.

P1-PR-042 follows with permitted local security/mixed-load/recovery and operator handover evidence. P1-PR-043 live release remains blocked by actual decision inputs and acceptance.
