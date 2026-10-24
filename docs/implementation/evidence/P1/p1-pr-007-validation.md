# P1-PR-007 validation evidence

**October 23, 2026 America/Los_Angeles · accepted after owner approval and merge.** Baseline: approved PR #6 merge `53f9fd1f9dcce8b781fb15f4e465b33443850748`. See the [implementation packet](../../P1-PR-007-cms-seo-ads-analytics-schemas.md) for scope and limits.

## Development evidence

- Red: 14 new scenarios failed on missing tables/collections while all 47 prior schema cases passed. Implementation then added two application migrations and a real Payload-generated CMS delta.
- The first green attempt passed 56/61. It exposed a reused destroyed Payload adapter when two CMS upgrades ran in one process, plus a test expecting a check violation where the dimension registry correctly produced an FK violation. Fresh per-execution Payload keys and the corrected expectation fixed those failures.
- The next focused run passed 62/62, including a new real Payload draft/edit/version-history proof. Review then tightened home-page ad exclusion, fixed staging import identity, added explicit redirect codes and strengthened publication transaction/negative tests.
- Final focused run passed **63/63 schema tests** in disposable project `tt-test-fb2f7242d8deb00b`: 47 previous cases and 16 added in 007. Node 24.22.1 and PostgreSQL 18.6 ran in Linux containers. Owned containers, network and volume were removed.
- Empty/populated application upgrade preserves domain identities, an import publication and a synthetic privacy deletion marker from the 006 baseline, then applies 0010–0011 and replays with zero pending. CMS upgrade applies 0001, inserts a synthetic staff identity, applies 0002, preserves that identity and replays with zero pending. Drift, failed-DDL rollback, ownership, runtime denial and application FK-index checks continue.
- Actual Payload operations create content and publication work in one transaction, prove outside visibility only after commit, edit draft versions, publish reviewed metadata and reject version-content tampering. A SQL rollback test removes both content and work; anonymous access to all nine new collections and runtime table reads are denied. These tests use synthetic migrator authority only inside disposable fixtures.
- Tests cover immutable published projections/configuration, public SEO/canonical restrictions, bounded search metrics, assessment-home/private ad exclusion, complete ad-report revision replacement, immutable snapshot periods, global event dedupe, forbidden properties/times, privacy-blocked/mismatched generation hiding, capped quotas and separate-connection last-slot contention. Redirect tests cover 301/302/410, private paths and unvalidated activation.
- Strict types, lint, formatting, source hygiene, layer boundaries, OpenAPI and 11 app/two CMS checksums passed. Original accepted migrations remain byte-for-byte unchanged. Documentation validation preserves 119 cards/dependency edges, 137 original FR rows, source archives and historical approvals; 21 key tasks are checked and 336 remain unchecked.
- Retained dev and stage each applied two app migrations and one CMS migration, reporting 11 app/two CMS with zero pending. Stage replay applied zero. Local credentials and data volumes were preserved; no native PostgreSQL database or unrelated Docker resource was targeted.

## Final verification

`pnpm verify:push` passed on implementation commit `dc1b7cc2d23aa721fb9e0b11394d7b8685c3459d` with pinned Node 24.22.1/PostgreSQL 18.6 Linux containers. Disposable project: `tt-test-6acb1efa8944379f`; app image: `606f97ad9d2322cb0798f63aa910e31686456db1beb04546f4171f562239e4cc`.

| Check | Observed result |
| --- | --- |
| Unit/use-case | 39 passed |
| Existing PostgreSQL harness | Two passed |
| Foundation integration | Six passed |
| Schema integration | 63 passed: 47 prior and 16 CMS/SEO/ads/analytics/quota cases |
| Quality | Types, lint, formatting, source hygiene, boundaries, OpenAPI and 11 app/two CMS checksums passed |
| Dependencies | No new dependencies; pinned install and audit passed |
| Deliberate failures | All six rejected: failing test and forbidden dependency/client/test/operator imports |
| HTTP/lifecycle | Health and absent product routes, invalid hosted fixture config, shutdown and restart passed |
| Local dev/stage | Two app/one CMS migrations applied; 11 app/two CMS, zero pending; replay zero |
| Cleanup | Owned disposable resources removed; local dev/stage stopped with volumes preserved |

The total is **110 passing tests**. Coverage still applies to small configuration/health packages only; SQL behavior is tested against real PostgreSQL and CMS operations against Payload. Final review commit `19ba4c32229786583a6302e73eb28360c6940eff` passed exact-commit local verification and [independent GitHub CI](https://github.com/xmyqyl4x/tiresandtreads/actions/runs/40065054035). The owner approved [PR #7](https://github.com/xmyqyl4x/tiresandtreads/pull/7); it merged at `ad3822ae51ed969c6d575ff7e661d8e6a1362623` on October 23, 2026 America/Los_Angeles.

## Limits

This is storage evidence for DB16–DB19/DB27, not full CMS publishing, SEO rendering, ad-network integration, analytics collection/erasure, aggregation or HTTP quota acceptance. Provider report completeness/order, public DTO sanitization, consent authorization, multi-window/key-rotation races, worker fencing and performance budgets require their owning repository/service/API cards. Full restore/deletion replay belongs to 008 and later privacy work. No UI, real editorial/user data, paid provider, native PostgreSQL change or hosted deployment is introduced.
