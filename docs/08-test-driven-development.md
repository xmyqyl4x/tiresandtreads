# Test driven development and acceptance strategy

**Engineering specification 1.0 · October 22, 2026.** This extends the approved architecture with the user's requested test-driven process. It defines implementation obligations; no application tests have run yet. The [implementation plan](04-implementation-plan.md) assigns delivery work, and the [database design](09-database-design.md) and [coding standards](10-coding-standards.md) define the boundaries to test.

## Required development cycle

Every new business behavior and bug fix follows **specify → red → green → refactor → integrate**. Test code is part of the feature, not a final hardening phase.

1. **Specify:** identify the requirement and use case, actors, inputs, permissions, expected outputs, persisted changes, forbidden side effects, and failure/retry behavior. Write examples with product/domain reviewers before coding disputed rules. Identify relevant AT01–AT20 cases and database invariants.
2. **Red:** write the smallest useful behavioral test and run it against the missing or faulty behavior. Confirm it fails for the intended reason, rather than setup, syntax, credentials, or a broken fixture. Record the test name and failure in PR evidence; a separate failing commit is not required.
3. **Green:** implement enough production behavior to pass the test through the intended layer. Do not weaken assertions, skip the test, or copy expected output from the new implementation.
4. **Refactor:** improve naming, responsibilities, dependencies, and algorithms while preserving the behavior. Run the affected tests; add boundary cases when a refactor exposes a real requirement gap.
5. **Integrate:** verify real persistence, API contracts, and relevant user journeys. Run affected authorization, concurrency, privacy, accessibility, and performance checks. Update traceability and operational documentation in the same change.

For a defect, reproduce it with a failing regression test before fixing it. For legacy behavior without tests, characterize the externally observable contract before changing it. An exploratory vendor spike may precede tests when discovering an unknown API; it remains a spike until findings become contracts, tests, and production-quality code. Pure copy, styling, or documentation edits receive proportionate review rather than artificial unit tests.

## Test categories and boundaries

These categories answer different questions. A use-case scenario is a business specification that can be exercised at application, API, and browser boundaries; it is not synonymous with a large browser script.

| Category | Question answered | Implementation and dependencies | Required examples |
| --- | --- | --- | --- |
| Unit and property | Does one rule produce the correct result for normal and boundary inputs? | Vitest; pure functions/value objects; explicit clock/IDs; small port fakes only where needed | Fitment exclusion, missing evidence, score normalization, monetary arithmetic, state transitions, token scope policy |
| Application use-case | Does an actor complete a business action with correct outcome and side effects? | Vitest calling public application services; narrow port fakes for fast red/green, then the same contract exercised with real repositories | Create report, rerun version, compare, schedule/cancel, withdraw permission, delete report |
| Functional API | Does the running HTTP boundary enforce its public contract? | Playwright API requests or equivalent HTTP harness against the running app; real test PostgreSQL; test identity/capability contexts | 201/202/409/422 behavior, schema validation, CSRF, idempotency, pagination, object-level denial, webhook signatures |
| Database integration | Do SQL constraints and transactions hold under real access roles and concurrency? | Vitest + isolated PostgreSQL matching production major/extensions; independent connections for races | FK/check failures, version conflicts, lease recovery, cancellation races, tenant RLS, coupon and budget contention |
| Adapter contract | Does a provider adapter honor our port and the provider's protocol? | Versioned sanitized fixtures and HTTP boundary stubs; targeted provider sandbox tests during integration/release | Signed/delayed webhook, accepted-but-timeout send, storage denial, CMS auth/revalidation, import schema changes |
| Functional UI and browser | Can a user operate each feature through accessible controls? | Playwright; isolated browser storage/data; labels/roles; real backend for core journeys | Form validation, results/unknowns, compare limits, refine conflicts, cancel feedback, download authorization |
| End-to-end use case | Does the complete experience work across the necessary modules? | A small representative browser/API suite plus provider sandbox evidence | Assessment → report → compare → delivery → PDF; deny tracking; revoke share; delete and verify all stores |
| Nonfunctional | Does behavior remain acceptable under load, failure, and assistive technology? | Measured performance scenarios, failure injection, restore/deletion drills, axe-core plus manual checks | Slow database, queue outage, stale safety feed, backup replay, mobile reflow, keyboard/screen reader, email-client rendering |

Mocks must not substitute for the behavior being proven. Database tests use PostgreSQL, not SQLite or in-memory repositories. A fake mail adapter can prove orchestration without sending mail; it cannot prove provider deduplication, DKIM, deliverability, or a signed webhook integration. Browser tests that stub the entire report API verify UI behavior only and must be labeled accordingly.

## Use-case catalogue

Maintain each case with preconditions, Given/When/Then scenarios, alternate outcomes, postconditions, and evidence links. The test names include the UC ID plus the relevant FR/CORE/AT ID. Existing requirement IDs remain authoritative; these UC IDs organize implementation coverage.

| ID | Actor and business outcome | Normal, alternate, and forbidden behavior | Existing acceptance and work |
| --- | --- | --- | --- |
| UC01 | Driver creates a fitment-supported assessment | Resolve axle/wheel package; incomplete/unknown fitment stays unverified; budget cannot weaken eligibility; stale recall feed blocks verified issuance | AT01, AT02, AT17; CORE-01/03; E05–E08 |
| UC02 | Driver understands recommendations and costs | Up to five supported picks; missing metrics remain unknown; consistent quantity/currency/price basis; paid terms cannot change rankings | AT03, AT20; CORE-03/04; E06/E09 |
| UC03 | Owner refines a saved report | Save draft with revision; stale concurrent edit conflicts; rerun creates immutable version and meaningful diff; old link stays pinned | FR-EXT-01/02/03; E08/E10 |
| UC04 | Driver compares tires and a shop quote | At most four items; unknown product stays unverified; invalid cost basis is qualified; 320px interaction preserves labels/focus | AT04, AT05, AT18; E10 |
| UC05 | Owner shares and revokes report access | View-only redacted report; expiry/revocation enforced on each read/download; share holder cannot edit/send or recover ownership | AT06; E08 |
| UC06 | Owner requests or cancels delivery | One scheduled identity on retry; actual 60-second cancellation; same report/comparison version; requested report can survive marketing opt-out with no marketing content | AT07, AT19; E11–E13 |
| UC07 | Operations reconciles delivery reliably | Accepted timeout stays uncertain; duplicate/delayed events dedupe; scanner GET cannot mutate consent/feedback/coupon state | AT08, AT12, AT13; E13 |
| UC08 | Visitor controls processing purposes | Restrictive defaults/GPC; core report works without analytics; queued work rechecks withdrawal; R2 removes ineligible offers before dispatch | AT10, AT11; E11/E16, later E23 |
| UC09 | Subject exercises deletion and retention rights | Verify proportionately; revoke access; erase required stores and mappings; replayed batches/backups cannot reintroduce deleted data | AT14; E14 |
| UC10 | Editor publishes reviewed education | Role-scoped draft/publish; published revision propagated within target; invalid redirects denied; failure visible/retriable | AT16; E15/E17 |
| UC11 | Reseller participates in a safe pilot | Tenant isolation in API/export/jobs; one live reservation for last code; no paid charge in pilot; recipient identity stays hidden | AT09, AT15; R2 E21–E26 |
| UC12 | Returning/partner clients use later capabilities | Web/mobile/MCP share business results; offline conflicts explicit; billing events dedupe and balance; exports require current permission and distinct approvals | R3/R4 E27–E33; add capability-specific cases before activation |

### Worked example for delivery

**UC06 / AT07:** Given an authorized owner, a fixed report version, and an allowed recipient, when the same delivery command is submitted twice with the same key, then both responses identify one send and one cancellation deadline. When cancelled at 30 seconds, the send becomes cancelled and the provider receives zero send attempts.

Build this incrementally:

1. Unit test the deadline/state transition with an explicit clock: before deadline, at the boundary, after handoff, and already cancelled.
2. Application test that duplicate commands return one identity, a changed body with the same key conflicts, and unauthorized callers create no outbox/send records.
3. Integration test two committed transactions racing to cancel/claim using separate connections and a barrier. Assert one winner, stable final state, and no dispatch from a cancelled row. Do not use an outer test rollback that hides commits from the other connection.
4. API test the 202 response, 200 cancellation, 409 after claim, owner scope, and missing CSRF/origin rejection.
5. Browser test that the visible state says Scheduled, the deadline is understandable, cancellation updates the screen, and reload preserves the result.
6. Adapter/recovery test that a lost response after provider acceptance reuses the frozen payload/key and enters reconciliation when safe deduplication can no longer be established.

Fake time is appropriate for domain deadlines. Real database races and workflow integration must also be demonstrated; fake timers alone do not prove durable scheduling.

## Test data and isolation

- Use small named synthetic fixtures for rules and licensed, sanitized schema samples where provider contracts require them. Never put real contact addresses, capability secrets, or production exports into tests or snapshots.
- Builders create valid default aggregates; each test changes only the fields relevant to its scenario. Expected outcomes are independently reviewed facts or arithmetic, not a call to the same function under test.
- Maintain at least 50 reviewed golden tire scenarios from the implementation plan. Record dataset/engine/policy versions, expected eligible/excluded configurations, reason codes, and the tire specialist's review. Snapshot updates require an explained domain change.
- Fix clocks, seeds, locale, timezone, and ordering. Test DST/timezone boundaries for reminders later; use UTC for persistence. Inject IDs/randomness through narrow ports when identity affects assertions.
- Allocate a disposable database or schema plus distinct test roles per integration worker. Database creation/migrations use a fixture owner; assertions use actual runtime roles. Multi-connection tests commit and clean up their own fixtures.
- Keep CMS and application test databases separate. Test their publication bridge through retries and partial failure; do not emulate a cross-database transaction.
- Provider sandbox tests use allowlisted addresses and isolated namespaces. Unit/functional CI cannot send real messages or mutate production resources. Test doubles must fail unexpected outbound requests.

## CI and release gates

These are planned CI check names to implement in E02, not commands available today.

| Gate | When | Required checks and result |
| --- | --- | --- |
| `quality` | Every code PR | Frozen install, formatting, lint, strict types, import boundaries, secret/dependency checks; all pass |
| `unit-usecases` | Every behavior PR | Affected unit/property and application use-case tests with coverage; include direct and transitive dependents |
| `db-contracts` | Persistence/API/auth changes | Real database/role/transaction/migration tests, DTO/OpenAPI compatibility, provider contract fixtures |
| `functional-smoke` | App behavior PRs | Core running API and one representative browser journey; public/private authorization regressions |
| `render-accessibility` | UI/template changes | Relevant viewport/keyboard/axe checks, email/PDF fixtures; manual checks recorded where needed |
| `performance` | Query, algorithm, cache, bundle, or workload changes | Before/after profile on representative data and agreed device/concurrency; explain regressions and enforce approved budgets |
| `release-acceptance` | Before relevant release | All applicable UC/AT and golden cases, full critical browser matrix, provider sandbox checks, security/privacy, restore and deletion evidence |

Change-aware selection must follow dependency edges. A contracts, engine, authorization, migration, or build-config change expands the affected suites; if dependency analysis is uncertain, run the relevant full suite. Documentation-only changes run document checks. Do not rerun unrelated slow suites after a passing result without new changes or an unresolved concern.

Initial coverage gates for production code, to configure at R0: **engine/domain/application: 95% statements/lines and 90% branches; other testable application modules: 85% statements/lines and 80% branches**. Include unimported source files so a missing test cannot disappear from the denominator. Generated types, migrations, vendored components, and declarative fixtures require explicit exclusions and their own appropriate verification. Coverage does not replace the rule that every safety, authorization, privacy, money, and state-machine decision has a negative/boundary test. Review targeted mutation testing for these critical rules at E19; do not add a slow blanket mutation gate to every PR.

Use [Vitest coverage](https://vitest.dev/guide/coverage.html) for measurement. Thresholds above are project policies, not vendor recommendations. [Playwright's guidance](https://playwright.dev/docs/best-practices) supports user-visible assertions and independent test data. Prefer role/label locators and observable conditions over CSS implementation details or arbitrary sleeps.

On a flaky failure, retain the initial trace and investigate. A retry pass does not erase the failure. Quarantine requires an issue, owner, expiry, and replacement coverage; no critical safety, authorization, deletion, or money gate may be bypassed by quarantine. Tests must remain deterministic, readable, and independently executable.

## Definition of ready and done

**Ready:** named requirement/use case; acceptance examples agreed; UI/API/domain/data ownership identified; adverse paths and test fixtures specified; migrations/permissions/performance risks identified; dependencies and external gates understood.

**Done:** red/green evidence for new behavior or a documented proportional exception; relevant unit, functional and use-case tests pass; actual SQL/provider boundaries verified where affected; accessibility/performance budgets checked; migrations/rollback/recovery and observability documented; requirement matrix points to PR, tests, and release evidence. Reviewers verify outcomes and separation of concerns, not just a green test count.

PR evidence should contain requirement/UC/AT IDs, a short behavior change, first failing test and reason, passing check commands/results, relevant database/query evidence, and remaining external validation. A test stub, skipped scenario, or mock-only demo does not mark a requirement implemented. The E19 phase broadens and validates evidence accumulated throughout development.
