# P1-PR-022 validation evidence

**October 25, 2026 · S3 implementation approved and merged in PR #22 at `5e6d4cd4866b3258d9f22978966a9adfe46f0e94`.** Baseline: approved PR #21 merge `c7595c59f33481254979e69faf588578c4393951`. See the [service contract](../../P1-PR-022-delivery-orchestration.md). Specialist review and licensed adapters remain pending under the owner's instruction.

## TDD and scope

The first delivery policy test failed because its module did not exist. A separate real-database regression also reproduced cross-operation resource collisions before delivery identities were namespaced; the correction preserves existing contact proofs and command replay. Unit/provider fixtures then cover retry window/count bounds, UTF-8 message size limits, header/attachment refusal, fixed request replay, ambiguous/definite responses, corrupt/oversized/missing bodies, stalled credentials and redacted retrieval. No live mail is sent. The fixture renderer is explicitly labeled and cannot be submitted through the real provider.

Real migrated PostgreSQL tests cover the atomic contact/consent/send/snapshot/outbox commit, duplicate/changed commands, requested historical report/comparison versions, reviewed learning selection, 60-second cancellation, separate offers intent, address correction, two-connection cancellation/claim ordering, lease takeover, immutable frozen bytes, accepted-timeout retries, lost SQL acknowledgement, permission changes after decryption/read, safe attempt/window exhaustion, private asset metadata and denied reader roles. The first run found an omitted required receipt reconciliation timestamp; it was corrected before acceptance. A large valid snapshot check also enforces the agreed 512-KiB read bound. Tests do not skip or quarantine failures.

## Full verification

`pnpm verify:push` passed on implementation commit `b377c41a0587b95334bd1ff574eb75563650e69a` at `2026-10-26T05:17:24.147Z`. The [redacted machine record](p1-pr-022-verification.json) captures that exact run. The evidence/task-list commit receives the full gate again before push; its final head and independent CI status are recorded in [PR #22](https://github.com/xmyqyl4x/tiresandtreads/pull/22).

| Check | Observed result |
| --- | --- |
| Unit/use-case | 574 passed, including 44 new policy/provider/render fixture tests |
| Database/provider | 186 passed, including 29 new migrated delivery service tests |
| Foundation/schema/recovery | Six / 63 / 11 passed |
| Total | **840 passing tests**, including 73 new delivery tests |
| Coverage | 97.14% lines, 93.98% statements, 98.4% functions, 90.06% branches; thresholds unchanged |
| Quality/build | Frozen Linux production build/advisory audit, source hygiene, format, lint, TypeScript, 168-module boundaries, health contract and reviewed migration checksums passed |
| Storage | 129 app tables, 42 views, 1,656 table/view columns, 250 codec fields/25 fact families, 28 CMS tables; 27 app/three CMS migrations; generated Drizzle parity passed |
| Failure propagation | Seven deliberate verification failures rejected |
| Runtime | Production stop/restart, bundled worker/import/source entry points and invalid hosted-configuration refusal passed |
| Recovery | Complete app/CMS synthetic restore/deletion replay passed at 27 app/three CMS, including corrupt restore, stale/missing journal, incomplete deletion and inter-database crash retry |
| Documentation | 119 cards/137 original FR rows/dependency edges/source archives/historical approvals preserved; 63 checked tasks/294 unchecked |

Retained Docker dev and stage targets both have **27 app/three CMS applied, zero pending**, and are stopped with their volumes retained. Native PostgreSQL, existing credentials and unrelated projects are unchanged. Disposable projects `tt-test-37cdd938affe3d60` and `tt-test-7c0c2e7ce84b9253` and their volumes were removed by exact identity. Synthetic recovery does not establish hosted RPO/RTO, PITR or external provider/object recovery; actual new delivery-work erasure remains at P1-PR-025.

## Acceptance limits

Headless S3 contracts only. Real legal/visual email/PDF templates, commercial classification/headers, sender authentication, actual abuse controls, API/CSRF/browser journeys, worker cadence/load/latency proof, signed callbacks/operator reconciliation, physical erasure and chosen-host recovery remain at their declared gates. Workflow objects/contact encryption are explicit substitutes alongside earlier Moto/KMS storage proofs. The restore drill verifies the complete schema and existing synthetic deletion graph; P1-PR-025 must add the new request/work dependency order to actual erasure. No actual email, production report issuance, licensed adapter activation or specialist acceptance occurs. DD01/DD02/DD06/G1 remain pending; 98 draft scenarios and zero actual specialist reviews remain unchanged.
