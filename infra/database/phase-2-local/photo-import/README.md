# Disposable photo and CSV extension

This opt-in S1 track implements P2-PR-004 only. It pins the unchanged Phase 1 app manifest and the complete partner/AI extension. The existing migrator appends 0040–0042 to the populated 39-entry history. Default bootstrap, CLI, preflight, role inventory, entities and runtime do not discover or promote this track.

Run `node tests/fixtures/phase2/photo-import-run.mjs` with the pinned runtime and Docker. The fixture creates four restricted identities only inside the owned disposable test cluster, observes complete prior records read-only, verifies permissions/history, and removes its database, roles, volumes and network. Never run these migrations against retained dev/stage or production.

| Migration | Storage |
| --- | --- |
| 0040 | Private asset claims, compound upload owner keys, bounded batch and retention, existing AI choice revisions, existing deletion link and revocation |
| 0041 | Existing request/job references, lease-checked extraction states, immutable image-bounded artifact provenance, sealed candidates, explicit append-only owner confirmations and guarded views |
| 0042 | Versioned declarative CSV templates, private intakes bound to existing runs/assets/jobs/licenses, independent immutable review and derived workflow/approval views |

Eight new forced-RLS tables are private. The only registry addition is two photo asset-purpose values; original rows and existing table/function ACLs are preserved. Existing asset/AI triggers gain additive constraints in this track. Owner and staff context settings are trusted server-derived inputs, never authentication credentials. New roles do not gain legacy asset, source publication, job dispatch or model authority.

Photo metadata bounds are four intents per owner/batch, 10 MiB and 40 MP, JPEG/PNG/WebP, 24 hours unsaved or one explicit saved choice bounded by 30 days from upload. Metadata does not prove file signatures, scanning, isolation, EXIF stripping, encoding or storage ACLs. Existing assets must cover the selected retention. Scope is exclusive to one upload, so image revocation can invalidate its existing AI permission authority without invalidating other uploads.

CSV templates contain column/type/unit declarations and a code revision; they contain no executable mappings. Intakes reuse P1 import runs, jobs and evidence artifacts. Raw CSV and normalized packet hashes remain distinct. A review never publishes: later services must recheck current approval inside the existing publication CAS/transaction. The original source/staging/rejection/status/publishing system remains authoritative.

Physical purge, restore replay, real file parsing/model evaluation, repositories/services/APIs/UI and actual P2 S1/provider/privacy/deployment acceptance remain separate held work. All six S3 gates stay open; HS01–HS08 proposed; no purchases, hosted provisioning or notifications.

