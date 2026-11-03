# P1-PR-034 — local results, explanation and refinement

This implements the second card in the [033–035 local continuation](evidence/P1/local-frontend-development-authorization.json). All six actual S3 gates remain pending with empty records. S3/G0/S4/G3 and live release/deployment acceptance remain held; HS01–HS08 stay proposed, operators/coverage/rates unconfirmed and specialist/licensed work pending. No provisioning, purchase, actual notification, production bootstrap/CLI/preflight/policy change or original lifecycle case/gate closure occurs.

## Saved report views

The private report route loads authoritative owner DTOs through the portable HTTP client. It renders up to five stored picks in server order, front/rear units, recorded reasons and exclusions, evidence confidence and comparability, budget status, available exact price ranges, provenance/as-of/version details and the separate current safety overlay. Missing prices, legacy confidence and physical-condition/maintenance evidence remain explicitly unavailable. Preference scores are not safety ratings. Only the server decides fitment, eligibility, ranking and calculation outcomes.

An owner-only projection adds selected confidence/budget/source metadata. The deliberately redacted shared projection remains separate and unchanged. Positive fitment/scoring statements are not repackaged as unresolved follow-up questions. Large exclusion lists are bounded in the visual summary. Components format stored money using integer cents; they introduce no pricing model, prediction or default estimate.

## Drafts and immutable versions

Draft changes debounce to an owner-authorized save with expected draft revision and base report version. A new owner-only GET `/api/v1/reports/{reportId}/draft` supports restoration through the existing repository transaction and permissions; missing or expired drafts return null. The local API inventory now has 65 operations. No database schema or production grants change.

Saving a draft leaves the report immutable. Refinement requires a confirmed draft, then creates a new version with the existing business-service compare-and-swap rules. Historical versions are read-only. Version conflicts retain the tab's answers, stop automatic overwrites and require an explicit reload/rebase choice. Uncertain save/refine acknowledgments retain the exact request and idempotency key; changed requests cannot silently replace an unresolved attempt. Invalid inputs do not autosave. A before-unload reminder protects unsaved tab edits.

Draft equality compares canonical assessment values, including nested budget field ordering. Browser validation caught and corrected a false-dirty loop caused by ordinary JSON property ordering. Field/status messages distinguish unsaved, saving, confirmed, unavailable and conflict states. Refined-version status receives focus; the view offers return-to-current and start-new-assessment navigation.

## Local validation

Unit/use-case tests cover exact money and unknown values, owner/share privacy boundaries, route/version refusal, canonical draft equality, recovered drafts, immutable history, uncertain acknowledgments and conflicts. Disposable HTTP/PostgreSQL tests exercise owner-only reads, missing/expired drafts, wrong-owner refusal, CAS conflicts, refinement/diffs and five synthetic choices without invented prices. The fixed `SYNTHETIC_FIVE` region exists only in disposable test support and uses no licensed data or actual specialist review. Normal unsupported/default fixtures retain their conservative behavior.

The synthetic local preview command remains `node scripts/dev/web-preview.mjs dev synthetic`. Browser evidence records actual autosave/reload/refine/history/conflict and narrow-width journeys separately. Full quality/build/coverage/database/recovery regression and all nine independent PR/main CI profiles are required before merge. This local evidence does not accept S3/S4/G3, screen-reader, field-vitals, hosted staging or live tire advice.
