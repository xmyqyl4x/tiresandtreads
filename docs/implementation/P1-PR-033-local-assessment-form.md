# P1-PR-033 — local assessment form and reference lookups

The owner extended local implementation/testing/merge authority to 033–035 after PR77. The [new continuation record](evidence/P1/local-frontend-development-authorization.json) preserves the earlier 028–032 record. Actual S3/G0/S4/G3, release and deployment acceptance remain held; all six S3 records remain pending and empty. HS01–HS08 remain proposed, operators/coverage/rates unconfirmed and specialist/licensed-source work pending. No provisioning, purchase, actual notification, original lifecycle case/gate closure or production authority change occurs.

## Form and boundaries

The form collects explicit vehicle/wheel-package selection or manual front/rear sizes, region, seasonal strategy, winter conditions, replacement positions, up to three priorities, budget/basis and optional annual mileage. Nothing chooses a wheel package automatically. Incomplete, ambiguous, unavailable or disallowed lookup data keeps manual recovery available. Explicit size confirmation records the owner's check; it does not approve fitment. No email or advertising permission gates submission.

React components own display, input and focus. A presentation model handles field feedback and exact decimal-to-minor-unit conversion. A controller owns bounded requests, cancellation, generation guards and idempotent submission. Canonical portable contracts validate server responses and assessment input. The existing business services own fitment, seasonal/replacement policy, scoring, authorization and persistence; components implement none of those rules.

Dependent lookups use the same published bundle. Changing year/vehicle/package cancels the earlier request and clears dependent selections, preventing a late response from restoring obsolete values. Pagination is explicit. Unknown/incomplete axle records do not become confirmed sizes. Published source permissions and license expiry are checked for form use; a non-expiring license is explicitly distinguished from missing evidence. License validity and lookup availability do not establish recall freshness or safety clearance. The report service checks current evidence separately.

The controller obtains necessary owner identity only when submitting. It coalesces duplicate clicks and retains the same idempotency key/body after an uncertain acknowledgment. Changed answers receive a new key. The UI preserves inputs on validation, source/network failure and conflict; error-summary links focus their fields, submission status is announced, and the committed receipt is shown only after a validated service response. No browser storage contains private reports or tokens.

## Additive mileage contract

The existing API/normalizer rejected every mileage field despite this task's requirement. `annualMiles` is now optional and nullable, an integer from 0 to 200,000. Missing legacy fields preserve their former normalized shape. Submitted mileage is stored in versioned report input as owner context. It introduces no ranking weight, fitment tolerance, tread-life promise or default forecast. Existing rule, eligibility and acceptance policies are unchanged. Unit tests first demonstrated the rejected valid value and then exercised valid/boundary/invalid cases; HTTP/PostgreSQL tests verify the stored value.

## Local verification

The normal command remains conservative:

```sh
node scripts/dev/web-preview.mjs dev
```

An explicitly synthetic disposable profile exercises the form with two wheel packages and real HTTP/business services/PostgreSQL:

```sh
node scripts/dev/web-preview.mjs dev synthetic
```

The synthetic fixture uses fixed example vehicle/configuration identities, synthetic engine evidence/encryption/object/provider ports and fresh fixture dates. It is not a licensed dataset, actual specialist review, source attestation, provider acceptance or hosted staging. Model year 2027 provides a fixed bounded slow-lookup case for cancellation/recovery testing; 2025 has no matching example. The fixture supports necessary consent without activating optional services. All data and resources belong to its disposable project and are removed on normal shutdown. Retained dev/stage databases and the production bootstrap/CLI/preflight/policy remain unchanged.

Focused tests cover presentation validation, exact cents, unknown values, source rights/expiry, response DTO refusal and duplicate/lost-ack handling. The standalone integration runs Next → HTTP services → PostgreSQL for lookups and report creation, checks one committed version on replay, confirms stored mileage/budget, and preserves unverified manual data. Browser evidence separately records actual keyboard/focus, ambiguous/unknown/slow recovery and responsive observations; it does not claim screen-reader or field-vitals acceptance. The unchanged 120,000-byte gzip budget and full quality/build/coverage/database/recovery/operational regression remain required before merge, followed by nine independent PR and main CI checks.
