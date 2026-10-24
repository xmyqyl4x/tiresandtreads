# P1-PR-006 validation evidence

**October 23, 2026 America/Los_Angeles · owner acceptance pending.** Baseline: approved PR #5 merge `2d8acd2c8476e12debae29b5738ae74cd8d3cd4b`. See the [implementation packet](../../P1-PR-006-report-consent-delivery-schemas.md) for scope and limits.

## Development evidence

- Red: 17 new scenarios failed with missing `app.reports`; all 27 existing schema tests passed. Disposable project: `tt-test-d5b935c888718b4e`.
- First implementation run: 43/44 passed. A quote fixture sent a JavaScript array using PostgreSQL array encoding; it now explicitly serializes JSON. Strengthened tests then needed two expected-code corrections: immutable webhook identity rejects before NOT NULL, and PostgreSQL RESTRICT deletion reports `23001`.
- The next focused run passed 45/45, including separate-connection command contention, rollback recovery, committed duplicate rejection and lease-generation checks. Disposable project: `tt-test-ac8b4e4943b79394`.
- The upgrade test starts empty, applies 004 and its synthetic seed, then 005 with a synthetic published dataset/bundle/import publication. It applies 006–009, preserves existing identities and the publication with NULL approval, verifies new valid/invalid audit references, then replays all migrations as a no-op. Existing drift, failed-DDL rollback, executor lock, CMS isolation and FK-index tests continue.
- Additional cases verify ordered privileged report/version/private-data deletion, denied GPC purposes and immutable reviewed templates. No production/provider data or email is used.
- Final focused run passed all **47 schema tests** in disposable project `tt-test-a5380f2217262851`: 27 previous cases and 20 added in 006. The runner removed its containers/network/volume.
- Local dev and stage each applied four additive app migrations and zero CMS migrations, then reported nine app/one CMS with zero pending. Stage replay applied zero. Both services were stopped with migrated data volumes and existing local credentials preserved; native PostgreSQL and unrelated Docker resources were untouched.
- Strict types, lint, formatting, source hygiene, layer boundaries, OpenAPI and nine app/one CMS checksums passed. Documentation checks preserved 119 cards/dependency edges, 137 original FR rows, source archives and historical approvals; 18 key tasks are checked and 339 remain unchecked.

## Final verification

Final focused tests, local dev/stage upgrade and clean-commit Linux verification are recorded here before review completion. Independent GitHub CI and the final reviewed SHA will be recorded in the PR.

## Limits

This is persistence evidence for DB01–DB08, DB13 and DB15; it is not complete UC03–UC09 or report/delivery/privacy service acceptance. SQL shape checks do not prove encryption, sanitized snapshots, correct policy decisions, complete deletion, safe provider retry or stale-worker authorization. Actual retention procedures, query plans, cancellation/withdrawal/provider races, restore replay and hosted integration remain at their assigned cards. No UI, new dependency, live mail, native database changes or production throughput claim is introduced.
