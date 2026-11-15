# P1-PR-037 local template completion

November 15, 2026. This is the card's additional implementation cycle under the owner's direction to finish Phase 1 engineering independently of live release. The original PR82 evidence remains immutable. Real inbox-client and assistive-technology acceptance remains pending, together with all six S3 gates, HS01–HS08, operators/coverage/rates, specialist and licensed work. No provisioning, purchases, actual notifications, live provider effects or original case/gate closure occurs.

## Concurrent recipient isolation

The renderer previously keyed in-flight work only by the report document and looked up context asynchronously. Two requests for the same report could therefore receive the second request's preference proof. Four failing controls reproduced cross-recipient reuse, late context mutation, invalid-context reuse and failed-lookup reuse. Each call now clones its context synchronously and includes that captured context in its coalescing key. A failed lookup gets a unique bounded admission slot and cannot poison or reuse another result. Existing four-request refusal/recovery behavior and duplicate-call coalescing remain covered.

The renderer still consumes authorized context supplied by composition. It does not create capabilities or reconstruct current report state. Completing durable per-send capture and the application binding is tracked separately against delivery orchestration, P1-PR-022; this change does not turn syntax-only synthetic links into a custody proof.

## Tagged PDF structure and layout

The previous React PDF wrapper did not expose the tagged-document construction used by its already pinned PDFKit0.20.1 engine. The PDF adapter now uses a narrow, typed boundary to that engine directly. The integrations package declares the same existing resolved version; no new package version or provider is selected. An exact lockfile transition in the read-only source review preserves original manifests, receipts and unrelated drift refusal. The approved common presentation, renderer port, React Email HTML/text layer and delivery interfaces remain intact.

PDFs now contain a Document structure with H1/H2/H3 headings, paragraphs, ordered marked content, structured public link annotations and structure-based page tab order. Repeating page labels are pagination artifacts. Embedded licensed Noto fonts, fixed report timestamps, Letter geometry and the absence of recipient addresses/private capability links remain unchanged. Each document owns its font state; serialization, four-request admission, font-size limits, output-size limits and a bounded page count limit resource use. Fitting option/provenance blocks stay together and section headings stay with the first fitting option. Oversized text flows across pages without fixed-height clipping.

[PDFKit's public accessibility contract](https://pdfkit.org/docs/accessibility.html) describes structure, marked content, artifacts, title and language. Tests inspect the actual pinned engine's output, including structured link annotations. No PDF/UA identifier or compliance claim is added; human assistive-technology validation remains outstanding. Semantic HTML/text remains available.

## Verification

The initial PDF regression failed because StructTreeRoot was absent. The four context controls failed before their fix. Final focused validation passed 31 template/source-pin unit controls, 11 renderer use-case controls, strict compilation, two fresh-process byte comparisons and a portable ESM bundle with zero external I/O. Automated checks inspect structure roles, language/date, link privacy, page/tab geometry, heading placement, bounded work and immutable bytes.

[Current synthetic samples](evidence/P1/p1-pr-037-tagged-renderer/samples.json) and [PDF observations](evidence/P1/p1-pr-037-tagged-renderer/pdf-observations.json) record three PDFs/eight pages. Poppler rasterization and page-by-page visual inspection checked the final hashes, accent rendering, full paragraph wrapping, complete provenance, comparison headings, footer clearance and public links. The normal/missing specimens each have two pages; the long four-quote specimen has four. No clipping, overlap or missing glyphs was observed in the final specimens. No real inbox or screen reader was exercised.

The exact committed source must additionally pass the full Linux regression, fresh review, all nine PR checks, merge and all nine main checks before this cycle is reported merged. The PR provides execution/checkout links; a focused pass alone does not fulfill that requirement. All historical evidence remains at its original bytes. All other Phase 1 cards retain their own implementation/review cycles and external acceptance requirements.
