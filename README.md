# Tires & Tread

Tires & Tread helps drivers understand tire fit, compare suitable options, estimate installed costs, and prepare for a conversation with an installer.

This repository currently contains the final design and implementation planning package, dated **October 22, 2026**. Application development has not started. Product behavior and engineering decisions are specified; vendor contracts, tire-data rights, jurisdiction-specific policies, and production launch approvals remain explicit release gates.

## Start here

**Approved architecture:** [Technology stack and application layer signoff](docs/07-stack-and-layer-signoff.md) records the user's October 22, 2026 approval of AS01–AS07: the stack, seven logical layers, functional module ownership, and deployment boundaries. The baseline incorporates separate CMS database ownership and explicit analytics activation; R0 integration evidence and release gates remain required.

1. [Final product design](docs/01-final-product-design.md) - release scope, visual system, every major screen, interactions, responsive behavior, and tire-advice rules.
2. [Technical architecture](docs/02-technical-architecture.md) - system boundaries, recommendation engine, data model, APIs, authorization, caching, and deployment.
3. [Delivery and privacy operations](docs/03-delivery-and-privacy.md) - email/PDF workflow, offers, consent, retention, privacy requests, analytics, and operational controls.
4. [Implementation plan](docs/04-implementation-plan.md) - sequenced work packages, dependencies, estimates, acceptance criteria, testing, and launch gates.
5. [Requirements traceability](docs/05-requirements-traceability.md) - all 137 source requirement IDs, core requirements, release assignments, and acceptance evidence.
6. [Source review and decisions](docs/00-source-review.md) - source inventory, resolved contradictions, material changes, and decision register.
7. [Verification record](docs/06-verification.md) - checks performed on this documentation package and limits of validation.

## Reference assets

- [Source archive and provenance](docs/sources/README.md), including all four supplied files and eight extracted screen PNGs.
- [Design tokens](docs/design-tokens.json), the numeric baseline for implementation.
- [External reference register](docs/references.md), with primary sources checked for the plan.

The original source files remain unchanged. The reconciled design in `docs/01` through `docs/04`, together with the approved architecture decisions in `docs/07`, governs the planned implementation where a source conflict is explicitly recorded in `docs/00`. Source imperatives are requirements to evaluate, not authorization to send emails, buy services, publish a site, or activate data sharing.

## Delivery approach

Launch a US English website first: an ad-free assessment, up to five evidence-backed tire recommendations, four-item comparison, optional report delivery, education content, and the admin/privacy foundations. Add reseller offers, expanded markets, the Expo app, and the MCP connector in independently gated releases. Recommendation ranking stays independent of commercial placements throughout.
