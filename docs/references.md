# External reference register

Checked October 22, 2026. These primary references support limited corrections to the supplied drafts. Proposed behavior, staffing, budgets, and acceptance targets are design decisions. Recheck provider APIs, policies, legal applicability, and package compatibility when implementing the relevant release; this is not a legal opinion or a vendor quote.

## Tire guidance

- [NHTSA tire safety](https://www.nhtsa.gov/vehicle-safety/tires): distinguishes tire grading, placard-based size/pressure guidance, tread checks, and manufacturer age recommendations. The final design therefore separates measured evidence from suitability scoring and avoids a universal remaining-safe-life forecast.

## Privacy and email

- [FTC CAN-SPAM compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business): commercial-message classification, truthful headers, postal address, and opt-out requirements. The statutory opt-out limit described here is 10 business days; immediate suppression is our stricter operational target.
- [California Attorney General CCPA guidance](https://oag.ca.gov/privacy/ccpa): covered-business GPC handling and request-specific rights/deadlines. A 45-day response period is not a universal clock for every privacy action or jurisdiction.
- [California DROP](https://privacy.ca.gov/drop/): include current Delete Act and data-broker obligations in the review before audience data products activate. Do not infer an exemption solely from having a website relationship.
- [Gmail sender guidelines](https://support.google.com/mail/answer/81126): authentication, alignment, complaint monitoring, and one-click unsubscribe for applicable marketing/subscription senders. The plan applies those controls from the start.
- [Google Consent Mode implementation](https://developers.google.com/tag-platform/security/guides/consent): set defaults before tag commands and update them after a choice. Consent Mode is an integration mechanism, not proof of permission.
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/): review account deletion, tracking, privacy disclosures, and login requirements before the native-app release.

## Engineering

- [Payload Postgres adapter](https://payloadcms.com/docs/database/postgres): the adapter uses Drizzle and owns its generated schema/migrations; custom `schemaName` is documented as experimental at review time. Validate isolation before sharing a production database.
- [Payload migrations](https://payloadcms.com/docs/database/migrations): use reviewed production migrations; development push behavior is not a production migration strategy.
- [Vercel Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js): historical hosting reference; the approved option-C deployment uses portable Node.js containers outside Vercel.
- [Vercel Global Config](https://vercel.com/docs/global-config): historical configuration reference; DP03 replaces this dependency with a portable SQL/S3 public-config adapter.
- [Inngest durable sleep](https://www.inngest.com/docs/durable-execution/primitives/step-sleep): supports a persisted cancellation delay without holding a request process open.
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys): provider deduplication currently lasts 24 hours. The application must retain its own durable send identity and resolve uncertain sends before retrying outside that window.
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): policies default deny when enabled without a matching policy, but table owners normally bypass them. Runtime roles must not own reseller tables or have BYPASSRLS.
- [MCP transport specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports): the reviewed current revision defines Streamable HTTP and request metadata. Validate the pinned SDK and real target clients before publishing tools.

Affiliate commission percentages, network eligibility thresholds, provider pricing, tax rates, market tire laws, and app-store acceptance are intentionally not carried forward as verified facts. They require fresh evidence for the relevant release or application.

## Testing and database engineering

Checked October 22, 2026 for the engineering expansion. Project-specific coverage thresholds, table designs, and performance budgets are design decisions rather than vendor guarantees.

- [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html): row checks, compound keys, referential integrity, and the distinction between constraints and cross-row invariants.
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html): concurrency semantics and serializable transaction behavior.
- [PostgreSQL partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html): selective indexes and query-predicate compatibility.
- [node-postgres transactions](https://node-postgres.com/features/transactions): one checked-out client for all statements in a transaction.
- [Vitest coverage](https://vitest.dev/guide/coverage.html): coverage measurement for the planned unit/application suites.
- [Playwright best practices](https://playwright.dev/docs/best-practices): user-visible behavior assertions and isolated browser tests.
- [TypeScript strict mode](https://www.typescriptlang.org/tsconfig/strict.html): strict static checking; runtime boundary validation remains necessary.

## PostgreSQL consolidation and implementation sequence

Checked October 22, 2026. These sources support available mechanisms; the [consolidation decision](11-postgresql-and-build-order.md), build gates, capacity targets and estimates are project judgments requiring implementation evidence.

- [PostgreSQL INSERT and ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html): conflict-safe event identities and atomic conditional counter updates.
- [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html): short transactions, row locks, contention and deadlock considerations.
- [PostgreSQL partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html): retention/large-table options and partition-key requirements for unique constraints; no unconditional partitioning requirement at launch.
- [PostgreSQL materialized views](https://www.postgresql.org/docs/current/rules-materializedviews.html): persisted query results require refresh and may be stale; the selected design uses explicit aggregate generations.
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling): historical provider reference; Neon is no longer the prescribed database provider. Pooling constraints must be verified for the selected option-C PostgreSQL topology.
- [Inngest schedules and delayed starts](https://www.inngest.com/docs/durable-execution/guides-and-advanced/events-and-triggers/schedules-and-delayed-starts): scheduled execution without a persistent application timer.
- [ClickHouse introduction](https://clickhouse.com/docs/get-started/about/intro) and [Redis data-store guide](https://redis.io/docs/latest/develop/get-started/data-store/): reviewed as alternatives; removed from the current dependency plan because their distinct capabilities are not yet a demonstrated requirement.

## Live phases, reference data, SEO, advertising and AI

Checked October 22, 2026 for the proposed D30–D35 amendment. Four phases, refresh/retention defaults, table structures and test thresholds are project proposals, not external requirements. Recheck source contracts, model/data controls and network/client policies at activation.

- [NHTSA datasets and APIs](https://www.nhtsa.gov/nhtsa-datasets-and-apis): official recall datasets/dictionaries across product types, including tires; use complete-source validation and recorded freshness.
- [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/Home/Index): vehicle/manufacturer metadata and equipment plant codes, including tire/retread types and supported year limits; source metadata is not verified tire fitment.
- [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide): useful accessible public content and crawl/index practices; no ranking guarantee.
- [Google guidance on generative AI content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content): quality and added value matter; mass-generated content without value can violate spam policies.
- [AdSense placement guidance](https://support.google.com/adsense/answer/1282097?hl=en): recognizable ads, permitted labels and usable placement. The project's no-form/two-result-slot/density rules are its own stricter choices.
- [Google publisher CMP requirements](https://support.google.com/adsense/answer/13554116?hl=en): certified TCF CMP requirement for personalized ads to EEA/UK/Switzerland users; certification alone does not establish legal compliance.
- [OpenAI Responses API](https://developers.openai.com/api/reference/responses/overview): server-side API integration boundary; pin and validate supported model/options before implementation.
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): constrained schemas help structure results but do not establish factual correctness.
- [OpenAI images and vision](https://developers.openai.com/api/docs/guides/images-vision): image inputs and known recognition limitations; the project requires human confirmation and makes no photo-based safety diagnosis.
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data): endpoint/model/account retention distinctions, application state and abuse monitoring; `store: false` is not an unconditional zero-retention guarantee.
- [OpenAI plugin documentation](https://developers.openai.com/plugins): current MCP-backed plugin packaging/testing/publishing. The former Apps SDK landing page redirects here at review time; client availability and listing acceptance still need P3 evidence.

## Approved option-C deployment and local validation

The [DP01–DP08 approval](16-deployment-and-local-environments.md#approval-record) selects application containers and PostgreSQL outside Vercel. The deployment plan retains dated Vercel comparisons as alternatives, with direct sources for local tooling, external-provider boundaries and release procedures. These mechanisms still require implementation evidence on the chosen host.

- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting): Node.js/container deployment and cache coordination across replicas.
- [Payload production deployment](https://payloadcms.com/docs/production/deployment): production builds and deployment configuration.
- [PgBouncer features](https://www.pgbouncer.org/features.html): pooling modes and their transaction/session constraints.
- [PostgreSQL continuous archiving](https://www.postgresql.org/docs/current/continuous-archiving.html): WAL archiving and point-in-time recovery mechanisms.
- [Docker Compose project names](https://docs.docker.com/compose/how-tos/project-name/): isolate local environment resources with distinct project identities.
