# P1-PR-011 validation evidence

**October 24, 2026 America/Los_Angeles · owner acceptance pending.** Baseline: approved PR #10 merge `18a264a7056c11f2b7a2fe90c8698337f20d3e3a`. See the [implementation packet](../../P1-PR-011-owner-report-delivery.md) for protocols and limits.

## TDD and focused evidence

- The versioned digest/ciphertext/JSON unit suite first failed because `private-values.ts` did not exist. Implementation then passed both cases, including empty/duplicate/malformed keys, plaintext envelopes, arrays, bigint JSON and oversize rejection.
- Initial real PostgreSQL repository run passed 130 combined tests (89 unit/use-case, 41 database). Coverage: 97.11% lines, 91.73% statements, 99.55% functions and 86.45% branches; thresholds unchanged. Additional revision/rotation/lease and cancellation contention tests were then added for identified lifecycle cases.
- Real-role tests cover owner isolation/revocation, exact bigint quotes and nullable evidence, four comparison slots, report/draft revisions, scope-bound pages, concurrent contact registration and HMAC overlap, immutable consent evidence, suppression scopes, shared/owner grants, canceled/accepted/rejected/uncertain delivery, withdrawal before claim, and one-client rollback across report/contact/consent/send/outbox writes.
- Test fixtures use synthetic data only. The cancellation clock fixture adjusts only its isolated schedule through the migration owner; the runtime role still runs real state/time constraints. No provider or native PostgreSQL instance is contacted.

- A separate real-database regression first failed with revision `1n` where `2n` was expected after draft expiry. Replacing the expired row now increments its revision instead of deleting/recreating it; an old client revision is rejected. The full pipeline is rerun after this fix.

## Full verification

Exact-commit pipeline, retained dev/stage upgrade and final counts will be recorded after verification. No owner acceptance or live product release is claimed.

## Remaining gates

Cryptography, authentication/confirmation evidence, current permission policy, shared rendering/signing, workers, provider handoff/reconciliation and complete multi-store privacy erasure remain S3. These tests prove repository persistence and serialization; they do not prove external delivery, legal compliance, production capacity or hosted RPO/RTO. Operations repositories remain 012, complete S2 acceptance 013, product frontend work after 031.
