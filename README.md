# Tires & Tread

Tires & Tread helps drivers understand tire fit, compare suitable options, estimate installed costs, and prepare for a conversation with an installer.

This repository currently contains the final design and implementation planning package, dated **October 22, 2026**. Application development has not started. Product behavior and engineering decisions are specified; vendor contracts, tire-data rights, jurisdiction-specific policies, and production launch approvals remain explicit release gates.

## Start here

**Current review proposal:** [Four live releases and eight-point gap review](docs/12-live-product-phases-and-gap-review.md), with [domain data/imports](docs/13-domain-data-and-imports.md) and [AI analysis, PostgreSQL reuse and tire photos](docs/14-ai-analysis-and-photo-design.md). SEO and advertising are P1 foundations; AI/photo/admin imports arrive P2; app/MCP P3; lifecycle and growth operations P4. Earlier approvals remain tied to their reviewed commits; this amendment awaits review.

**Approved architecture foundation:** build PostgreSQL schema → data access/entities → business services → exposed APIs → frontends. The [PostgreSQL and build-order amendment](docs/11-postgresql-and-build-order.md), [approved on October 22, 2026](docs/11-postgresql-and-build-order.md#approval-record), removes ClickHouse, Redis and QStash dependencies, while retaining first-party analytics, limits and bounded caching in PostgreSQL. The [stack/layer signoff](docs/07-stack-and-layer-signoff.md) preserves the original AS01–AS07 approval and identifies the amended AS02/AS07 choices. R0 integration evidence and release gates remain required.

1. [Final product design](docs/01-final-product-design.md) - release scope, visual system, every major screen, interactions, responsive behavior, and tire-advice rules.
2. [Technical architecture](docs/02-technical-architecture.md) - system boundaries, recommendation engine, data model, APIs, authorization, caching, and deployment.
3. [Delivery and privacy operations](docs/03-delivery-and-privacy.md) - email/PDF workflow, offers, consent, retention, privacy requests, analytics, and operational controls.
4. [Implementation plan](docs/04-implementation-plan.md) - sequenced work packages, dependencies, estimates, acceptance criteria, testing, and launch gates.
5. [Requirements traceability](docs/05-requirements-traceability.md) - all 137 source requirement IDs, core requirements, release assignments, and acceptance evidence.
6. [Source review and decisions](docs/00-source-review.md) - source inventory, resolved contradictions, material changes, and decision register.
7. [Verification record](docs/06-verification.md) - checks performed on this documentation package and limits of validation.
8. [Test-driven development](docs/08-test-driven-development.md) - red/green/refactor workflow, unit/functional/use-case tests, UC01–UC18, CI gates, and completion evidence.
9. [Database design](docs/09-database-design.md) - typed table catalogue, ER diagrams, keys/constraints, indexes, transactions, roles, retention, and migration sequence.
10. [Coding standards](docs/10-coding-standards.md) - shared application services, entities/models/mappers, package/API boundaries, patterns, type safety, performance, and review rules.
11. [Live phases and gap review](docs/12-live-product-phases-and-gap-review.md) - eight answers, committed release outcomes, SEO, advertising and completion criteria.
12. [Domain data and imports](docs/13-domain-data-and-imports.md) - manufacturer/reference/recall schemas, provenance, scripts and admin CSV workflow.
13. [AI analysis and tire photos](docs/14-ai-analysis-and-photo-design.md) - inference, persistent exact-match reuse, refresh, photo confirmation, privacy and tests.
14. [PostgreSQL and build-order review](docs/11-postgresql-and-build-order.md) - dependency decisions, replacements, tradeoffs, capacity/failure gates and change record.

Implementation follows the [contribution guide](CONTRIBUTING.md). Each behavioral work package includes tests from its first increment; the final hardening phase validates accumulated evidence. Engineering specification 1.0 was [approved on October 22, 2026](docs/00-source-review.md#engineering-approval-record); the current revisions incorporate the subsequent PostgreSQL/build-order direction. Planned tables, test suites and stage gates are not implemented yet.

## Reference assets

- [Source archive and provenance](docs/sources/README.md), including all four supplied files and eight extracted screen PNGs.
- [Design tokens](docs/design-tokens.json), the numeric baseline for implementation.
- [External reference register](docs/references.md), with primary sources checked for the plan.

The original source files remain unchanged. The reconciled design in `docs/01` through `docs/04`, architecture decisions/history in `docs/07`, engineering specifications in `docs/08` through `docs/10`, the approved amendment in `docs/11`, and the proposed extensions in `docs/12` through `docs/14` govern the planned implementation. Source conflicts are recorded in `docs/00`; the database specification provides the detailed relational contract behind the architecture overview. Source imperatives are requirements to evaluate, not authorization to send emails, buy services, publish a site, or activate data sharing.

## Delivery approach

Complete the [S1 database, S2 data-access, S3 service and S4 API gates](docs/04-implementation-plan.md#build-stages-and-exit-gates) before S5 frontend implementation. The old 16-week calendar is withdrawn; the staged dependency graph must be re-estimated before setting a launch date. Launch a US English website first: an ad-free assessment, up to five evidence-backed tire recommendations, four-item comparison, optional report delivery, education content, and the admin/privacy foundations. Deliver the four usable phases in docs/12, repeating the backend-first gates within each phase. Existing live features continue working during compatible upgrades. App/MCP delivery is committed to P3; optional markets and audience sales retain their independent gates. Recommendation ranking stays independent of commercial placements throughout.
