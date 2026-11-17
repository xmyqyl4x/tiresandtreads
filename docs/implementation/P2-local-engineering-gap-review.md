# Phase 2 local engineering gap review

November 16, 2026. The owner selected “Stay in Phase 2 and identify remaining local engineering gaps.” This review covers all 27 Phase 2 cards against current main, existing code, test evidence and release limitations. Phase 3 stays at planning only. It identifies three concrete engineering follow-ups; it does not declare Phase 2 accepted or claim an exhaustive independent security audit.

## Finding and baseline

All 27 original card PRs (#89–#115) are merged. Main is `b5a4ce021c08e6b4f28df221c5a6e34c9913dfa3` (PR #125), tree `3eaa7885c43609361c69fee563df2e1c1320b373`, with 4,856 full executions and nine actual PR plus nine main checks verified. These are historical baseline results; this audit's own source/build/review/merge cycle is separate. [The source-bound register](evidence/P2/p2-local-engineering-gap-review.json) maps all cards, original merges, current source hashes and observed limitations without rewriting historical receipts.

The 31 original unchecked tasks across11 cards mix actual acceptance requirements with locally implemented UI tasks whose original checkboxes were retained. They are not 31 missing features. This review preserves every checkbox, separates present local construction from missing integration, and leaves all external decisions and gates open. The unpromoted local chain remains 55 migrations/225 tables; default bootstrap stays 33 app/three CMS.

## P2-L01: verified staff integration

The shared [workbench](../../apps/web/src/phase2/workbench.tsx) and [private proxy](../../apps/web/src/phase2/proxy.ts) restrict credentials to 16–128 URL-safe opaque characters. They cannot carry the signed staff sessions supported by the new P1 verifier. In addition, [withPartnerSessions](../../packages/integrations/src/http/partner-security.ts) constructs a new security object without preserving `authenticateStaff`. Staff CSV handlers can use a verified staff ID, but review/operations handlers also require a partner handle; [partner context](../../packages/application/src/partners/partner-work.ts) and [analysis operations](../../packages/application/src/analysis/analysis-operations.ts) parse a partner-shaped principal, including email/domain assertions. Widening a regex alone would leave the integration incomplete.

A network-disabled read-only probe exercised both proxies: the opaque control forwarded to a stub (200), while a syntactic three-part signed-token shape was refused locally (401) with zero upstream dispatches. A separate sentinel confirmed the dedicated verifier property was omitted. The probe did not generate/verify a real provider session and does not establish an exploitable public bypass. The existing refusal remains safe; this is a compatibility/composition gap.

**Proposed PR 1 — verified Phase 2 staff integration.** Define a staff authority contract that does not invent verified business-email/domain facts. Preserve dedicated staff verification without falling back to owner/partner credentials; bind current database identity, roles, recent MFA and stable session/CSRF. Carry bounded signed credentials only on staff/operations paths, preserve legacy fixture support explicitly, and update service adapters as well as UI/proxy bounds. Prove uploader/reviewer/publisher independence, permission/session revocation, same-subject renewal, forged/wrong-realm rejection and unchanged cookie/CSP/body/path protections. Reuse the approved staff verifier with generated local signatures and a mock provider; no account provisioning or new identity-provider selection. Unit/use-case controls plus real Next→HTTP→SDK→PostgreSQL CSV/review/operations journeys are required. Actual authentication/security acceptance stays held.

## P2-L02: durable local runtime composition

The [current local service host](../../packages/integrations/src/service-host.ts) composes P1 services; the [default worker](../../scripts/runtime/worker.ts) deliberately starts with no product handlers. P2 has substantial service/API factories and durable SQL repositories, but its combined journeys are assembled by disposable test fixtures. For example, [partner composition](../../tests/fixtures/phase2/compose-partner-services.ts) keeps sessions/private object bytes in process-local maps, and [owner composition](../../tests/fixtures/phase2/owner-web.ts) supplies synthetic owner authority. Passing these scenarios does not establish that all P2 services, configuration/keys, workers and private bytes survive a local host restart.

**Proposed PR 2 — opt-in restartable Phase 2 local host.** Compose the existing service/repository/API layers through explicit dependency/configuration contracts and bounded pools; do not copy business rules or substitute a superuser. Use local durable private-object/key configuration, registered SQL jobs/schedules, current permission checks and the verified staff boundary from PR 1. Keep provider/model/scanner effects synthetic and explicitly supplied, with missing dependencies failing closed. Prove startup refusal, readiness, connection budgets, graceful drain, abrupt worker interruption, command/outcome reconciliation, immutable report/attachment bytes and restart continuity. Start with randomly owned disposable resources. Persistent dev/stage installation, default migration promotion and production composition require their own explicit scope and actual inputs; this PR must not silently change bootstrap/CLI/preflight/admission. It does not claim current SQL job/dedupe or P2 business services are absent.

## P2-L03: complete latest-chain local recovery

The [archive helper](../../tests/fixtures/phase2/security-archive.ts) and [security test](../../tests/database/phase2-security-gate.test.ts) prove SQL row/catalog parity for the 55-migration, 225-table chain and leave runtime CONNECT revoked. Their marker explicitly sets `objectArchiveRestored:false`, `postBackupDeletionReplay:false` and `independentlyDurableCustody:false`. Earlier 33-app/three-CMS recovery profiles remain valid in their own scope; they cannot fill these missing latest-chain observations by being cited together.

**Proposed PR 3 — latest-chain SQL/object/deletion recovery.** Using the local host contracts from PR 2, archive a populated synthetic latest-chain database and encrypted private object versions with a bounded manifest. Record a later deletion/withdrawal and unknown charge/outcome outside that snapshot; restore only into fixed owned quarantined targets, validate SQL and object-version/checksum parity, then replay newer barriers before any product access. Exercise missing/wrong keys, absent/tampered objects, foreign receipts, missing/stale/partial replay, stale worker completion, uncertain cost/provider outcomes and unsupported restore inputs. Demonstrate original-owner P1 reads and denial of erased P2 photos/analysis/coupons without dropping unresolved charges or fabricating provider reconciliation. Keep parent-held simulated keys/journal custody explicitly labeled; no independent durability/authentication/fencing, off-host/PITR/RPO/RTO or hosted acceptance claim. These are local proof requirements, not permission to provision a target or dispatch provider effects.

## All 27 card dispositions

| Card | Scope | Original merge cycle | Current construction | Follow-up area |
| --- | --- | --- | --- | --- |
| P2-PR-001 | Scope/evaluation inputs | [#89](https://github.com/xmyqyl4x/tiresandtreads/pull/89) | Preparation/validation present | external-inputs |
| P2-PR-002 | Partner schemas | [#90](https://github.com/xmyqyl4x/tiresandtreads/pull/90) | Local implementation present | No additional gap identified in this review |
| P2-PR-003 | AI/reuse/cost schemas | [#91](https://github.com/xmyqyl4x/tiresandtreads/pull/91) | Local implementation present | No additional gap identified in this review |
| P2-PR-004 | Photo/CSV schemas | [#92](https://github.com/xmyqyl4x/tiresandtreads/pull/92) | Local implementation present | No additional gap identified in this review |
| P2-PR-005 | Schema/upgrade validation | [#93](https://github.com/xmyqyl4x/tiresandtreads/pull/93) | Preparation/validation present | P2-L03 |
| P2-PR-006 | Partner repositories | [#94](https://github.com/xmyqyl4x/tiresandtreads/pull/94) | Local implementation present | No additional gap identified in this review |
| P2-PR-007 | Analysis/photo/CSV repositories | [#95](https://github.com/xmyqyl4x/tiresandtreads/pull/95) | Local implementation present | No additional gap identified in this review |
| P2-PR-008 | Data-access validation | [#96](https://github.com/xmyqyl4x/tiresandtreads/pull/96) | Preparation/validation present | No additional gap identified in this review |
| P2-PR-009 | Onboarding/moderation services | [#97](https://github.com/xmyqyl4x/tiresandtreads/pull/97) | Local implementation present | P2-L01, P2-L02 |
| P2-PR-010 | Matching/coupons/delivery | [#98](https://github.com/xmyqyl4x/tiresandtreads/pull/98) | Local implementation present | P2-L02, P2-L03 |
| P2-PR-011 | Insights/disputes/operations | [#99](https://github.com/xmyqyl4x/tiresandtreads/pull/99) | Local implementation present | P2-L01, P2-L02 |
| P2-PR-012 | Bounded report analysis | [#100](https://github.com/xmyqyl4x/tiresandtreads/pull/100) | Local implementation present | P2-L02, P2-L03 |
| P2-PR-013 | Exact reuse/refresh/cost admission | [#101](https://github.com/xmyqyl4x/tiresandtreads/pull/101) | Local implementation present | P2-L02, P2-L03 |
| P2-PR-014 | Private photo/confirmation | [#102](https://github.com/xmyqyl4x/tiresandtreads/pull/102) | Local implementation present | P2-L02, P2-L03 |
| P2-PR-015 | AI/photo privacy/frozen delivery | [#103](https://github.com/xmyqyl4x/tiresandtreads/pull/103) | Local implementation present | P2-L02, P2-L03 |
| P2-PR-016 | CSV review/publication | [#104](https://github.com/xmyqyl4x/tiresandtreads/pull/104) | Local implementation present | P2-L01, P2-L02 |
| P2-PR-017 | Service/evaluation readiness | [#105](https://github.com/xmyqyl4x/tiresandtreads/pull/105) | Preparation/validation present | P2-L01, P2-L02, P2-L03 |
| P2-PR-018 | Partner/staff APIs | [#106](https://github.com/xmyqyl4x/tiresandtreads/pull/106) | Local implementation present | P2-L01, P2-L02 |
| P2-PR-019 | Analysis/photo APIs | [#107](https://github.com/xmyqyl4x/tiresandtreads/pull/107) | Local implementation present | P2-L02 |
| P2-PR-020 | API validation | [#108](https://github.com/xmyqyl4x/tiresandtreads/pull/108) | Preparation/validation present | P2-L01, P2-L02, P2-L03 |
| P2-PR-021 | Reseller portal | [#109](https://github.com/xmyqyl4x/tiresandtreads/pull/109) | Local implementation present | P2-L02 |
| P2-PR-022 | CSV/moderation screens | [#110](https://github.com/xmyqyl4x/tiresandtreads/pull/110) | Local implementation present | P2-L01, P2-L02 |
| P2-PR-023 | Assisted report/delivery UI | [#111](https://github.com/xmyqyl4x/tiresandtreads/pull/111) | Local implementation present | P2-L02, P2-L03 |
| P2-PR-024 | Photo capture/confirmation UI | [#112](https://github.com/xmyqyl4x/tiresandtreads/pull/112) | Local implementation present | P2-L02, P2-L03 |
| P2-PR-025 | Operations dashboard | [#113](https://github.com/xmyqyl4x/tiresandtreads/pull/113) | Local implementation present | P2-L01, P2-L02 |
| P2-PR-026 | Integrated security/recovery | [#114](https://github.com/xmyqyl4x/tiresandtreads/pull/114) | Preparation/validation present | P2-L01, P2-L02, P2-L03 |
| P2-PR-027 | Release preparation | [#115](https://github.com/xmyqyl4x/tiresandtreads/pull/115) | Preparation/validation present | P2-L01, P2-L02, P2-L03, external-inputs |

“No additional gap identified” means this targeted review found none beyond the existing evidence and stated limits; it is not a fresh correctness/security certification of every implementation line. Schema/repository/ranking/coupon/AI/photo/CSV/consent logic and their existing tests remain valuable and are retained. Follow-up integration tests must rerun P1/P2 regression rather than replace those implementations.

## External or activation work remains separate

Actual source/license contracts, provider/model/scanner and identity configuration, representative specialist-labeled 50-explanation/50-image evaluation, accepted cost/quality/privacy controls, real 5–10 reseller onboarding, named operators/coverage/rates, independent security review and real device/browser/assistive-technology/inbox/host observations remain pending inputs. These cannot be completed by inventing a contract, selecting an unapproved provider, labeling synthetic output as real evaluation or sending notifications. Actual provider adapters may still need implementation once their selected contracts exist; generic ports and mocks do not certify those integrations. The three proposed local PRs do not replace this work.

Six S3 gates stay open, HS01–HS08 proposed, specialist/licensed work pending and all actual stage/phase/provider/privacy/security/hosting/live acceptance held. Local API/frontend work remains permitted; Phase 3 implementation remains unauthorized. No provisioning, purchases, actual recipient notifications, live provider/model effects, production bootstrap/CLI/preflight/admission changes or original case/gate closure occurs in this audit. The three follow-up PRs are proposals, with no execution or acceptance results claimed here.

Implementation authorization on November 16 covers all three proposed follow-ups. P2-L01 is implemented in the [staff integration cycle](P2-L01-staff-access-integration.md); final validation and merge status are recorded separately. The audit above remains the historical pre-implementation finding. P2-L02 and P2-L03 remain in progress until their own completed cycles.

P2-L02 is implemented in the [durable local runtime](P2-L02-durable-local-runtime.md). P2-L01 is merged as PR #127 with all actual checks; P2-L03 remains in progress. This updates local construction only; no original acceptance case or gate is closed.
