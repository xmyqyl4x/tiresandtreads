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
- [Vercel Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js): supports the proposed TypeScript request handlers; verify current runtime support and deployment limits during bootstrap.
- [Vercel Global Config](https://vercel.com/docs/global-config): read-heavy configuration distribution for public redirect and feature snapshots; keep contacts and secrets elsewhere.
- [Inngest durable sleep](https://www.inngest.com/docs/durable-execution/primitives/step-sleep): supports a persisted cancellation delay without holding a request process open.
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys): provider deduplication currently lasts 24 hours. The application must retain its own durable send identity and resolve uncertain sends before retrying outside that window.
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): policies default deny when enabled without a matching policy, but table owners normally bypass them. Runtime roles must not own reseller tables or have BYPASSRLS.
- [MCP transport specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports): the reviewed current revision defines Streamable HTTP and request metadata. Validate the pinned SDK and real target clients before publishing tools.

Affiliate commission percentages, network eligibility thresholds, provider pricing, tax rates, market tire laws, and app-store acceptance are intentionally not carried forward as verified facts. They require fresh evidence for the relevant release or application.
