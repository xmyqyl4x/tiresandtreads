## Behavior and scope

Describe the concrete problem and resulting behavior. Link requirement, work-package, UC, and AT IDs as applicable.

## Design

Identify the live product phase (P1–P4), its usable outcome, and construction stage (S0–S6) and link prerequisite gate evidence. Name affected layers, entity/model/mapping boundaries, API contracts, tables/migrations, and permissions. Explain significant tradeoffs, hot-path impact, and recovery behavior. Use “not applicable” for unaffected areas.

## Validation

- First failing behavioral test and intended failure, or reason TDD does not apply:
- Passing unit and application use-case checks:
- Relevant functional API/UI and real database checks:
- Relevant provider, accessibility, performance, migration, and recovery evidence:
- Remaining external validation or release gates:

## Completion

- [ ] Prerequisite construction gates are met; product frontend work starts only after S4 API acceptance.
- [ ] Existing live product journeys and client contracts remain compatible; rollback and conditional scope are explicit.
- [ ] Source/AI/photo changes include provenance, validation, scope/expiry/invalidation and deletion evidence where affected.
- [ ] Shared business rules and dependency boundaries are preserved.
- [ ] Database load, analytics/limit/cache bounds and dependency changes have appropriate evidence when affected.
- [ ] Relevant negative, boundary, retry, and permission cases are covered.
- [ ] Documentation and requirement/test evidence match the change.
- [ ] Logs, fixtures, and artifacts contain no secrets or personal data.

For documentation-only changes, replace application-test entries with document validation results. Do not mark unrun checks as passing.
