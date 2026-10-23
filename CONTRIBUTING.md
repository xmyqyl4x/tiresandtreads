# Contributing to Tires and Tread

Application development has not started. The approved architecture and engineering specifications define how implementation changes will be built and reviewed.

1. Start from the relevant [requirement](docs/05-requirements-traceability.md), work package, and [use case](docs/08-test-driven-development.md#use-case-catalogue). Specify normal, denied, boundary, and recovery behavior.
2. Use a focused `codex/` branch and a reviewable change. Follow the [test-driven cycle](docs/08-test-driven-development.md#required-development-cycle): demonstrate the intended failure, implement, refactor, then verify affected real integration boundaries.
3. Respect [package and API boundaries](docs/10-coding-standards.md), the [database design](docs/09-database-design.md), and the [approved decisions](docs/07-stack-and-layer-signoff.md#7-signoff-decisions). Shared application/domain logic serves all channels.
4. Include tests and migrations with the feature. Use real PostgreSQL for constraints, transactions, and tenant isolation; use synthetic data and allowlisted provider sandboxes. No production contacts in fixtures or previews.
5. Run the affected quality gates and link evidence in the PR. Exact commands will be defined and committed during E02; do not report a planned check as an executed test.
6. Update traceability, contracts, operational documentation, and relevant design decisions. Changes to scope, permissions, rankings, or architecture need an explicit rationale and review.

Documentation-only work uses link/structure/consistency checks. Implementation is complete only when the [definition of done](docs/08-test-driven-development.md#definition-of-ready-and-done) is satisfied.
