# P1-PR-011 validation evidence

**October 24, 2026 America/Los_Angeles · accepted after owner approval and merge.** Baseline: approved PR #10 merge `18a264a7056c11f2b7a2fe90c8698337f20d3e3a`. See the [implementation packet](../../P1-PR-011-owner-report-delivery.md) for protocols and limits.

## TDD and focused evidence

- The versioned digest/ciphertext/JSON unit suite first failed because `private-values.ts` did not exist. Implementation then passed both cases, including empty/duplicate/malformed keys, plaintext envelopes, arrays, bigint JSON and oversize rejection.
- Initial real PostgreSQL repository run passed 130 combined tests (89 unit/use-case, 41 database). Coverage: 97.11% lines, 91.73% statements, 99.55% functions and 86.45% branches; thresholds unchanged. Additional revision/rotation/lease and cancellation contention tests were then added for identified lifecycle cases.
- Real-role tests cover owner isolation/revocation, exact bigint quotes and nullable evidence, four comparison slots, report/draft revisions, scope-bound pages, concurrent contact registration and HMAC overlap, immutable consent evidence, suppression scopes, shared/owner grants, canceled/accepted/rejected/uncertain delivery, withdrawal before claim, and one-client rollback across report/contact/consent/send/outbox writes.
- Test fixtures use synthetic data only. The cancellation clock fixture adjusts only its isolated schedule through the migration owner; the runtime role still runs real state/time constraints. No provider or native PostgreSQL instance is contacted.

- A separate real-database regression first failed with revision `1n` where `2n` was expected after draft expiry. Replacing the expired row now increments its revision instead of deleting/recreating it; an old client revision is rejected. The full pipeline is rerun after this fix.

## Full verification

`pnpm verify:push` passed on corrected implementation commit `3697aa1aa050b464bcb6054114909ce494ec65dd` with pinned Node 24.22.1/PostgreSQL 18.6 Linux containers and Payload 3.92.0. The stale-draft regression is green. Main project: `tt-test-557ff5cc8bb4f133`. The [redacted verification record](p1-pr-011-verification.json) retains image, inventory/archive hashes, timing and injected recovery failures.

| Check | Observed result |
| --- | --- |
| Unit/use-case | 89 passed |
| Database | 45 passed: 20 private repository, 14 catalog/import, nine transaction and two harness cases |
| Foundation | Six passed |
| Schema | All 63 passed, preserving ownership, upgrades and retention constraints |
| Recovery | All 11 passed in `tt-test-8ce9e9c3b192ba7b`; 120 app/28 CMS tables and 31 app views preserved |
| Quality | Strict types, expected type failures, lint, formatting, hygiene, boundaries, OpenAPI and 13 app/two CMS checksums passed |
| Dependencies | Frozen pinned install and advisory audit passed; versions/lockfile unchanged |
| Failure gates | All seven deliberate failures rejected |
| HTTP/lifecycle | Health-only routes, absent product routes, invalid hosted config, shutdown and restart passed |
| Retained dev/stage | Each added only the private role credential and one app migration; 13 app/two CMS, zero pending, replay zero; all existing credentials/CMS secrets preserved |
| Cleanup | Random test environments removed their own containers/networks/volumes; dev/stage stopped with volumes retained |

Total: **214 passing tests**. Recovery elapsed 22696 ms including preparation; synthetic backup window 4626 ms. These are local proof measurements, not production RTO/RPO.

Final head `3f0e3a7a2501da1a6ec793a379af627d89c42ed5` passed full local verification and [independent GitHub CI](https://github.com/xmyqyl4x/tiresandtreads/actions/runs/40122893512). The owner approved [PR #11](https://github.com/xmyqyl4x/tiresandtreads/pull/11), merged at `e94c7cd1f415e303193c546e8a8c7c3ca026e4d5`. P1-PR-011 is accepted; the complete S2 gate at 013 remains open.

## Remaining gates

Cryptography, authentication/confirmation evidence, current permission policy, shared rendering/signing, workers, provider handoff/reconciliation and complete multi-store privacy erasure remain S3. These tests prove repository persistence and serialization; they do not prove external delivery, legal compliance, production capacity or hosted RPO/RTO. Operations repositories remain 012, complete S2 acceptance 013, product frontend work after 031.
