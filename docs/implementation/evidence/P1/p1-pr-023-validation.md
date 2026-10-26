# P1-PR-023 validation evidence

**October 25, 2026 · S3 implementation.** Baseline: approved PR #22 merge `5e6d4cd4866b3258d9f22978966a9adfe46f0e94`. See the [service contract](../../P1-PR-023-mail-events-actions.md). Licensed adapters and specialist review remain pending.

## TDD and scope

The initial callback/redirect test failed because the modules did not exist. Unit tests then cover exact byte signatures, stale/future delivery times, key overlap, tampering, bounded body/header/secret handling, malformed signed JSON, conservative scanner classification, key rotation and unsafe destinations. Use-case tests exercise scanner navigation without final actions and deliberate confirmation delegation. The first real PostgreSQL run exposed a stored bytea link-digest decoding error; it was fixed, and stable duplicate fixture bytes were corrected so the concurrency test models actual callback replay. A reviewed learning-route functional test also guards the existing publication view's actual column contract.

Migrated PostgreSQL tests cover durable callback duplicates/conflicts, independent reordered facts, suppression/tombstones, atomic rollback, early callback and timeout correlation, unknown/conflicting IDs, unsupported semantics, current engagement permission/withdrawal, known-ID provider retrieval, safe recovery commands, ordinary GET/HEAD safety, RFC8058 POST without session input, purpose-bound preferences, immutable feedback, fixed reviewed learning destinations, withdrawal, expiry/revocation and denied public roles. Provider callbacks/retrieval are synthetic signed/HTTP fixtures; no real email, sender credentials or public route is activated.

## Verification status

Full exact-commit verification is pending. Measured results will be recorded before pushing the review branch.

## Acceptance limits

Headless S3 only. S4 owns HTTP routes, request streaming/header parsing, CSRF/browser headers, token log redaction and abuse quotas. S5/release owns rendered templates, real sender authentication, DKIM header coverage, provider/client acceptance and actual user journey. P1-PR-024 owns privacy-aware aggregate analytics; 025 owns the complete erasure/retention graph; 027 owns scheduled recovery and alarms. Full-schema restore uses synthetic fixtures and does not establish actual new-table erasure or hosted recovery. Licensed feeds and specialist acceptance remain open, with report issuance disabled.
