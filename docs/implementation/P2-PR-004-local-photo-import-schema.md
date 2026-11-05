# P2-PR-004 — Local photo and staff CSV storage

The owner's next-card continuation follows completed [PR #91](https://github.com/xmyqyl4x/tiresandtreads/pull/91). The [authorization record](evidence/P2/p2-pr-004-local-authorization.json) permits this card's local implementation, testing and merge. Actual P1 live acceptance, P2 feasibility/S1/promotion and all existing holds remain open.

**Trace:** storage portions of CAP-04/CAP-07, DB22/DB26 and work packages E36/E41. The [photo specification](../14-ai-analysis-and-photo-design.md), [import plan](../13-domain-data-and-imports.md), [TDD process](../08-test-driven-development.md) and [coding standards](../10-coding-standards.md) govern later layers.

Three separately checksummed [opt-in migrations](../../infra/database/phase-2-local/photo-import/README.md) append to the complete 39-entry P1/partner/AI history. Eight new forced-RLS tables and five guarded views implement storage only. Existing original data, permissions, manifest sources, migration runner and production bootstrap/CLI/preflight remain unchanged. Two expected asset-purpose registry rows are additive; preservation checks compare every original row, not a filtered representative sample.

| Area | Records and authority |
| --- | --- |
| Photo ownership | `photo_asset_claims`, `tire_photo_uploads`: deferred compound owner/upload/asset keys, exclusive scope, bounded intents, existing private asset lifecycle and erasure barriers |
| Processing | `photo_extractions`: existing AI request and durable job, immutable resource identity, current lease token/generation, cancellation/deadline checks, accepted image-bounded artifact |
| Suggestions | `photo_field_candidates`: bounded field vocabulary, explicit unknown/uncertainty, normalized region, sealed immutable candidate set |
| Owner choice | `confirmed_photo_fields`: append revisions, same owner/upload/field candidate, distinct accepted/corrected/manual origins, no automatic assessment application |
| CSV configuration | `csv_template_versions`: immutable versioned declarations, code parser revision, supported types/units and bounded rows/bytes; no executable mappings |
| CSV intake | `csv_intakes`: existing asset, run, source/license and job; raw file hash separate from normalized packet hash |
| CSV review | `csv_review_decisions`: independent authorized reviewer, existing diff/validation artifacts, captured run revision/fence/head and current eligibility |
| Status | Views derive import state/counts from P1 records and hide invalidated approvals; no duplicate staging, queue or publication mechanism |

Photo admission captures the existing AI processing-choice revisions. One scope belongs to one upload. Revoking a ready asset or upload withdraws that scope's existing authority, so its AI artifacts cannot remain reusable. Terminal deletion remains possible after withdrawal. The existing privacy request identifies the same owner. This is a database refusal mechanism, not a claim that physical bytes were deleted or restored safely.

Images are limited to four live intents per assessment batch, 10 MiB, 40 MP, JPEG/PNG/WebP, 24 hours unsaved and one explicit saved-image choice up to 30 days from upload. A view cannot extend retention. Both original and sanitized assets must cover the image lifetime. Artifact/candidate validity is bounded by the image. Cleanup must purge child rows before image records and bytes; current views fail closed while later privacy/restore workers remain unimplemented.

Completed extraction history is immutable. A new request may refresh an image after a previous result expires; only one queued/processing extraction is allowed per upload. This refines the original suggested unique upload/policy pair so refresh does not require rewriting history. A candidate or confirmation is not evidence of safe fitment, recall status, pressure, tread depth or roadworthiness. Confirmed facts will enter ordinary assessment inputs in later services without a reusable image link after image purge.

CSV intake follows basic normalization and registration of the existing P1 dataset/run. Its captured license, template source kind and normalized checksum must match that fixed dataset; rejected datasets are refused. The validation job then tracks validation/preview work, not a second source registry. A claimed live photo asset cannot silently lose its expiry.

CSV eligibility is checked before publication against the existing provider/license, using supported rights schema, review/effective dates and required storage/display/API rights. It does not call a staging dataset published. Template retirement, role revocation, run edits, head movement, cancelled jobs, expired evidence or revoked rights invalidate approval. A stored approval never publishes or grants publication authority. P2 services must recheck approval under the existing P1 publication transaction/CAS; file parsing, formula/URL checks, streaming, semantic validation and admin UI remain later work.

Four fixture-only restricted roles separate owner confirmation/save, photo worker, staff CSV metadata and read-only CSV worker status. Transaction context values must come from the trusted server after authorization. They are not credentials or independent authentication. The database checks no actual scanner, encrypted bytes, bucket ACL, external model identity or provider effect.

Run `node tests/fixtures/phase2/photo-import-run.mjs` for native PostgreSQL validation and owned cleanup. All 83 native cases and type checking pass, including explicit PostgreSQL blocking observations for both confirmation/withdrawal orders, concurrent confirmation revisions, upgrade/replay/checksum/rollback preservation and a 1,000-row bounded indexed read. Fifteen intended red regressions were reproduced and corrected; setup/cast/grant mistakes are excluded from that count. The source-bound [proof record](evidence/P2/p2-pr-004-local-proof.json) records actual passing counts and reproduced red regressions. Exact-commit Linux build, full regression, all PR/main checks and exact-head review are required before completion.

All six S3 gates remain pending, HS01–HS08 proposed, operators/coverage/rates and provider/model/budgets unconfirmed, specialist/licensed work pending. Actual phase/schema/privacy/restore/provider/pilot/deployment acceptance stays held. No provisioning, purchases, actual notifications, model/provider calls, original case closure or gate closure occurs.
