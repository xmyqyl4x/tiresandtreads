# P1-PR-016 — Local adapter completion cycle

The owner authorized completing Phase 1 engineering independently of live release, with a separate implementation, validation, review and merge cycle per card. The [43-card register](evidence/P1/phase-1-local-closeout.json) preserves previously accepted work and queues the remaining local reviews. Its cycle status is separate from original card acceptance. This cycle is limited to P1-PR-016; it does not mark the later cards complete.

## Implemented correction

A stored source receipt can legitimately have neither an ETag nor Last-Modified value. Previously the HTTP adapter accepted a 304 response whenever the previous receipt object existed, even though it had sent no conditional request header. This could falsely report an unchanged archive without receiving its bytes. The adapter now refuses that response as `Unbased not-modified`. A response-supplied ETag cannot retroactively establish that a conditional request was sent. Existing ETag and Last-Modified conditional responses still work and create no output file.

The first regression failed because the unconditional request incorrectly resolved to `modified: false`. After the correction, three new controls and the existing official-source suites pass: **14 tests in three files**. The existing refresh service records adapter integrity failures and cannot advance successful source health on this failure. The complete pinned Linux quality/build/real PostgreSQL/recovery and all affected source refresh tests remain required for the exact committed source, followed by fresh review and the PR/main checks. Results must be read from their completed runs before merge is reported.

## Task disposition

| Task | Engineering evidence | Remaining input |
| --- | --- | --- |
| Official source connectors | Four implemented profiles, schema/unit/date/count semantics, bounded archive/pagination/HTTP and explicit no-fitment lookup projection | Actual public-source use/rights review remains unconfirmed |
| Source normalization | Unknown recall targets retained; campaign counts and missing fields not invented; registration/publication remain separate | Licensed units, field mappings and reviewed cross-source links require the selected contracts |
| Refresh/reconciliation | Existing source lease/fence, bounded retries/backoff, complete receipt and unchanged-source controls; the new regression prevents unbased 304 success | Actual provider/host/operator acceptance |
| Report integration | The implemented report evidence resolver checks catalog rights/expiry and `ReportRecallRepository.checkedAt` before using source-backed data; existing database source/report tests cover rejection | Actual source coverage, specialist acceptance and production issuance remain held |
| Licensed catalog/fitment/price/climate adapters | Shared import/connector boundaries and explicit unknown-profile refusal are implemented | **Provider-specific adapters remain unimplemented until a provider, contract and permitted sample exist.** This is an external engineering prerequisite, not merely a live release task |

The original mixed checkboxes are split so completed official-source work is visible independently of the unimplemented licensed scope. No supplier format or sample contract is invented. Full card acceptance remains pending; this cycle cannot honestly label that licensed scope complete.

All six S3 gates remain open, HS01–HS08 proposed, operator/coverage/rates unconfirmed and specialist/licensed work pending. No provisioning, purchases, actual notifications, live provider effects or original case/gate closure occurs. Production bootstrap, CLI, preflight, policy, schemas, grants and historical evidence retain their existing behavior and bytes.
