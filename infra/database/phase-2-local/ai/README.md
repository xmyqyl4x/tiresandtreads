# Opt-in local AI storage

P2-PR-003 extends the disposable local track with three migrations and twelve forced-RLS tables. Its [owner continuation](../../../../docs/implementation/evidence/P2/p2-pr-003-local-authorization.json) authorizes this next card while actual phase acceptance and deployment remain held. No ordinary manifest, production bootstrap/CLI/preflight, P1 model or runtime discovers this directory.

The manifest binds the original P1 manifest and exact partner-track manifest/head. Fixed test support validates every source checksum and supplies the complete 39-migration sequence to the existing restricted-owner migration runner. Applying to the populated 36-entry baseline adds three entries; replay does nothing. Original entries are never rewritten. P2-PR-005 retains actual empty/upgrade/schema/promotion and recovery acceptance.

| Migration | Storage |
| --- | --- |
| 0037 | Immutable evaluated policies/scopes, current permission and deletion guards, exact-digest requests and bounded attempts |
| 0038 | Accepted immutable artifacts and sealed sources, exact reuse rows/leases, report attachments and frozen send selections |
| 0039 | Currency/policy-bound budget windows and reservations with atomic conservation and explicit uncertainty |

The only P1 table alteration adds a compound send/owner/report/version unique key for frozen-selection references. Existing business rows, relation/function permissions, partner sources, default roles and packages remain unchanged. The fixture observes complete rows through its owned read-only observation connection, including a retained owner report and partner organization/membership. Runtime tests use three separate non-owning AI roles; that observation capability is not granted to them.

`tt_p2_ai_runtime` reads own bounded status/output and report projections using transaction-local `tt.p2_ai_subject`. `tt_p2_ai_worker` owns AI persistence commands, private provenance and fixed lease functions. `tt_p2_ai_staff` records policy/scope/permission/configuration metadata. None owns tables or bypasses RLS. Existing P1 and partner roles gain no AI access. Actor context and reviewed metadata are trusted server inputs, not external authentication or actual specialist/provider acceptance.

Use `app.ai_current_reuse` for current exact reuse reads, bounded by scope/key; raw entry state alone is insufficient. `app.ai_report_analysis` exposes owner-filtered output without provider identifiers, manifests or budget details. Both recheck current authorization, policy, rights, expiry and complete source sets. Source-to-AI rights require explicit `ai_processing`, `cache`, `derived` and `snapshot` booleans in `data_licenses.rights`, plus current typed source metadata. Stored flags do not establish a real license; tests use only synthetic rights.

Lease claims and publication use fixed, qualified SQL under row locks and a captured generation. Expired or superseded workers cannot publish using their old generation. This is a database concurrency proof, not authenticated worker authority or fencing of an external provider effect. Services must follow subject/policy/permission → request/attempt → key/budget lock order, retry transaction conflicts and call providers outside transactions. They must select the correct configured budget windows and conservative amounts; database conservation does not evaluate model pricing or authorize spend.

Artifact source rows are inserted in the artifact's creation transaction and sealed with an exact count. Missing sources fail reads even during partial privileged purging. Shared scopes accept only reviewed generic policies and fixed nonpersonal parameter codes; they cannot contain photo hashes. Shared attachments still require a separate current owner authorization scope. Photo task requests require an exact sanitized-image hash; actual upload/image ownership and expiry links belong to P2-PR-004 and later services.

Budget counters change only through reservation accounting. Uncertain usage stays held until explicit settlement or evidence-backed noncharge reconciliation. Terminal states cannot rewind or charge twice. Existing P1 erasure/recovery and delivery renderers do not consume these new records: P2 service/privacy/deletion replay, frozen-byte integration, provider evaluations and operational capacity acceptance remain future cards. No actual AI processing, notification or promotion is enabled.

Run the fixed local proof with `node tests/fixtures/phase2/ai-run.mjs`. It accepts no arguments, provisions only randomly named owned disposable test resources, type checks, runs the native schema file and verifies cleanup. These tests also run in the existing full regression; there is no skipped acceptance counted as passing.
