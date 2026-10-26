# P1-PR-022 validation evidence

**October 25, 2026 · S3 implementation for review.** Baseline: approved PR #21 merge `c7595c59f33481254979e69faf588578c4393951`. See the [service contract](../../P1-PR-022-delivery-orchestration.md). Specialist review and licensed adapters remain pending under the owner's instruction.

## TDD and scope

The first delivery policy test failed because its module did not exist. Unit/provider fixtures then cover retry window/count bounds, UTF-8 message size limits, header/attachment refusal, fixed request replay, ambiguous/definite responses, corrupt/oversized/missing bodies, stalled credentials and redacted retrieval. No live mail is sent. The fixture renderer is explicitly labeled and cannot be submitted through the real provider.

Real migrated PostgreSQL tests cover the atomic contact/consent/send/snapshot/outbox commit, duplicate/changed commands, requested historical report/comparison versions, reviewed learning selection, 60-second cancellation, separate offers intent, address correction, two-connection cancellation/claim ordering, lease takeover, immutable frozen bytes, accepted-timeout retries, lost SQL acknowledgement, permission changes after decryption/read, safe attempt/window exhaustion, private asset metadata and denied reader roles. The first run found an omitted required receipt reconciliation timestamp; it was corrected before acceptance. A large valid snapshot check also enforces the agreed 512-KiB read bound. Tests do not skip or quarantine failures.

## Verification status

Full exact-commit Linux build/quality/coverage/runtime/recovery and retained dev/stage migration results will be recorded before review. Documentation validation preserves all original requirement rows, task IDs/dependencies, source archives and historical approvals.

## Acceptance limits

Headless S3 contracts only. Real legal/visual email/PDF templates, commercial classification/headers, sender authentication, actual abuse controls, API/CSRF/browser journeys, worker cadence/load/latency proof, signed callbacks/operator reconciliation, physical erasure and chosen-host recovery remain at their declared gates. Workflow objects/contact encryption are explicit substitutes alongside earlier Moto/KMS storage proofs. The restore drill verifies the complete schema and existing synthetic deletion graph; P1-PR-025 must add the new request/work dependency order to actual erasure. No actual email, production report issuance, licensed adapter activation or specialist acceptance occurs. DD01/DD02/DD06/G1 remain pending; 98 draft scenarios and zero actual specialist reviews remain unchanged.
