# P2-PR-016 — Local staff CSV review and publication

The owner authorized local completion, verification and merge of this card after P2-PR-015. The implementation adds explicit backend factories and an offline script adapter. No runtime or endpoint is activated, no migration promoted and no actual acceptance approved.

## One ingestion and publication engine

`createStaffCsvServices` composes the existing P1 import, staging, validation, diff, dataset and market-head publication services. The same application service methods serve the future admin UI and `runStaffCsvCommand`; neither has a separate ingestion engine. Commands cover versioned templates/schema download/retirement, private upload, validation, diff/validation evidence, review, publish, cancellation and safe error export. Existing workflow/job inspection remains available through the service facade.

Two installed code mappings are supplied: `tire_models_v1` and `domain_companies_v1`. They use canonical record/entity UUIDs, source keys and the shared P1 fact decoder. Templates pin their exact ordered columns, units, schema/mapping versions, parser artifact revision, bounds and definition hash. A template cannot redefine an installed mapping or execute uploaded conversion code. Adding other feed shapes requires a reviewed mapping and tests; no actual licensed contract is implied by these synthetic examples.

## Bounded private input

The parser accepts strict UTF8 with an optional BOM, CSV quoting/doubled quotes and CRLF/LF. It rejects duplicate/reordered/unknown headers, broken row shapes, control characters and cells over4096 characters. Uploads are capped at16 MiB,100000 rows,100 columns and500000 total cells. Integer values retain exact signed64 text, decimals retain canonical text, boolean values are explicit, dates use calendar validation and HTTPS references are checked for syntax without fetching them. Formula prefixes after whitespace are rejected; ordinary negative numbers are accepted in numeric columns.

The common fact decoder checks mapped records; duplicate source keys and invalid critical records remain rejects in the existing engine. Diagnostics retain only row number, reviewed column name and closed error code, with at most1000 errors. Error CSV never echoes source cells, formulas, paths or arbitrary exception text. The canonical internal JSONL packet is separately bounded at32 MiB. Invalid structural input causes no upload reservation or object write.

Uploads and evidence use exact private asset IDs, bytes, checksum, size, storage bucket/key/version and the existing encryption/versioning interfaces. A durable reservation precedes I/O. Retries keep original identities and the original expiry; a changed body conflicts. Upload retention is24 hours, consistent with the existing validation-job deadline. Failed or orphaned objects remain under existing retention cleanup; this is not acceptance of the complete privacy/custody graph. Object I/O is bounded and occurs outside SQL transactions. A failure while writing the second evidence artifact can be replayed without changing either identity.

## Review and atomic publication

Opt-in migration0053 adds `admin.csv_upload_commands` and `admin.csv_preview_commands`, both forced-RLS, plus fixed functions for the existing purpose roles. The full opt-in chain has53 migrations and223 tables; default manifests remain33 app and3 CMS. No new runtime identity, generic SQL capability or production bootstrap change is introduced.

Current active staff permissions are checked for every effect. The uploader and reviewer need `data.review`; the publisher needs `data.publish`. Review must be independent from the uploader, and publication must be independent from both. Review receipts pin current reviewer role revision, exact run revision/fence, private artifact identities and expected market head. A source/license/template/evidence change or advancing head blocks publication. A new preview and independent review recover from a head conflict.

Publication admission, approval audit, bundle creation, existing P1 publication and head compare-and-swap share one publisher transaction. A transaction-identity guard rejects attempts to bypass CSV review through the original P1 script publisher path. Concurrent publishers have one winner; the loser leaves no partial publication, audit or head update. The original script path for non-CSV imports remains unchanged. An exact authorized replay returns the historical publication receipt even if its template is later retired; it does not republish or rewind the head. Cancellation fences outstanding validation work and leaves live datasets unchanged.

## Local script parity and host responsibilities

`runStaffCsvCommand(args, services, managedDirectory)` is an opt-in adapter, not a registered production CLI. It accepts a closed command list and a bounded JSON plan containing only `actorId` and `input`. Upload bytes must come from a regular file inside the explicitly configured managed directory. Absolute input paths, escapes, outside symlinks, nonfiles, oversized/changed files, invalid UTF8, unknown options and arbitrary URL/SQL/program handlers are refused before service dispatch. Reads are bounded and verify file identity around access. The future authenticated host must supply trusted staff context and manage the import directory; an actor UUID in a local fixture plan is not authentication or MFA.

The focused runner `node tests/fixtures/phase2/staff-csv-services-run.mjs` exercises real PostgreSQL roles/RLS and encrypted/versioned owned local storage, shared P1 registration/staging/publication, both installed mappings, script/admin parity, malformed/formula CSV, critical/duplicate rejects, independent permissions, role-revision invalidation, stale-head recovery, simultaneous publish, bypass refusal, object/evidence failures and receipt/cancel replay. Full quality, build, regression, review and PR/main CI are verified separately against the final committed source.

All six S3 gates remain open; HS01–HS08 proposed; operators/coverage/rates/provider/model/budgets unconfirmed; specialist/licensed work pending. Actual S1/S2/authentication/MFA/full privacy/rights/source/latest-chain restore/scanner/model/provider/inbox/pilot/phase/deployment acceptance remains held. No provisioning, purchases, external application provider/model calls, actual recipient notifications or original case/gate closure. P2-PR-017 is limited to authorized local journey/evaluation/readiness preparation; its real model and acceptance tasks remain pending.
