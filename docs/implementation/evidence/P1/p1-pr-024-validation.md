# P1-PR-024 validation evidence

**October 26, 2026 · S3 implementation.** Baseline: approved PR #23 merge `c71df71471544868fd0a47b9ca7275508670e7ae`. See the [service/database/budget contract](../../P1-PR-024-analytics-limits-operations.md). Specialist review and licensed adapters remain pending.

## TDD and scope

The initial event policy test failed because the module did not exist. Unit cases then cover registered event/name/route/property schemas, UTF-8/body/replay bounds, purpose-separated context and quota HMACs, short expiry, key overlap, canonical address/IP aliases and connection-plan validation. Application use cases cover denied collection without a database, stale-publication retry intent, disabled quota refusal and invalid trusted signals. A 200-iteration uncached technical evaluation profile proves output parity and records local timings; it activates no cache or tire issuance.

Real migrated PostgreSQL cases exercise parallel duplicate receipts, context refresh, GPC/CMP/withdrawal/suppression, per-attempt admission persistence, changed digest refusal, privacy-hidden generations, old worker fences, partial purge/regrant/re-dated replay refusal, expiry/deadline changes, concurrent hour/day/burst quotas, global row-cap rollback, key alias/retirement checks, bounded expiry cleanup, staff dashboards, reader denial and physical pool isolation/budget failure. Initial runs found missing narrow schema usage and row-lock column grants; corrected grants preserve private ownership without granting history mutation. The deadline test checks the captured deadline and uses a migration-owner clock fixture, avoiding a fragile timed wait. Runtime constraints remain enabled.

## Verification status

The first exact-commit run rejected the deadline fixture because its simulated expiry preceded its effective time. The fixture now moves both times consistently; the production lifetime check is unchanged.

Full exact-commit verification is pending. Measured counts, coverage, workload/profile results and retained dev/stage migrations will be recorded before pushing for review.

## Acceptance limits

Headless S3 only. No public collector, browser SDK, UI, real vendor, hosted capacity, or data product is enabled. Initial collector/security policies remain disabled pending S4/activation review. S4/S6 still owe report/dashboard p95, actual 10× forecast mixed load and client/HTTP/admission evidence. P1-PR-025 owns the complete rights/retention/deletion/restore graph; 027 owns automatic cadence and alarms. Local full-schema synthetic restore is not the future actual new-table erasure graph or hosted RPO/RTO. No optional cache table exists. Licensed adapters and specialist acceptance remain open; report issuance and real mail remain disabled.
