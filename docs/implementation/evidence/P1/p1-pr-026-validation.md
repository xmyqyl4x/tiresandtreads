# P1-PR-026 validation evidence

**October 26, 2026 · S3 implementation for owner review.** Baseline: approved PR #25 merge `7aa1b54216b50fc687ff8990fb7edb93a83f8d4c`. See the [staff/commercial service contract](../../P1-PR-026-staff-commerce-revenue.md).

## TDD and scope

The initial unit policy suite failed with the domain module absent; the initial database/application suite failed with the integration factory absent. Implementation then passed domain policy and real PostgreSQL scenarios. A fixture initially named a webhook column incorrectly; it was corrected to the actual signature-verification column without weakening the schema. Domain UTC arithmetic was kept pure after lint rejected use of host `Date` in that layer.

Tests cover route/shape/consent rejection, house fallback, category/URL gates, approved origins, bounded aggregate arithmetic, current roles/reviewer separation, concurrent CAS publication, masked queue pagination, role revocation, once-per-receipt recovery, failed/unknown recovery without resending, stale affiliate checks, suspended terms/accounts, global kill switch, real engine-output parity, exact revenue ratios, omitted-dimension/currency replacement, negative/finalized/empty corrections, complete-batch rollback and immutable approved history. A 10,000-callback fixture measures the actual indexed masked query. External mail, privacy recovery and affiliate checker ports use explicit fixtures; no live provider acceptance is inferred.

## Measured verification

The complete exact-commit Linux run and redacted machine evidence are recorded here after verification. No current run is claimed before completion.

## Remaining gates

Headless S3 only. Actual staff identity/MFA, HTTP/browser/admin UI, real affiliate/network contracts, production link checker, network ads.txt validation, CMP protocol, vendor block synchronization, invalid-traffic monitoring, field performance and actual provider financial reconciliation remain required at their stage/activation gates. No live ads are clicked and no provider approvals or staff assignments are seeded. Specialist review and licensed adapters remain pending; 98 draft scenarios/zero actual specialist reviews. Report issuance, real email and product collection remain disabled. P1-PR-027 must preserve those distinctions when assembling S3 evidence.
