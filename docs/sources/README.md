# Source resources

These files were supplied for review and archived without changing their contents. Filenames were normalized for stable repository links. Exact original filenames, sizes, and SHA-256 hashes are in [manifest.json](manifest.json).

| Source | Contents | Use in the final design |
| --- | --- | --- |
| [Product requirements v2.1](originals/product-requirements-v2.1.md) | 1,376 lines; October 2026 draft; 137 distinct numbered functional requirements | Primary requirements baseline |
| [Requirements PDF export](originals/requirements-export.pdf) | 59 pages; same v2.1 requirements and the same 137 IDs; pages 58–59 contain only print headers/footers | Readable export and cross-check; its original filename refers to report/email design but it is not a separate email layout |
| [Site designs PDF](originals/site-designs.pdf) | 13 pages of desktop/mobile form, results, compare, refine, and delivery mockups | Visual and interaction reference |
| [Original PNG archive](originals/site-designs-png.zip) | Eight complete, long-form PNG screens | Original full-resolution visual assets |

## Screen index

| Screen | PDF pages | Interpretation |
| --- | --- | --- |
| [Home and form](screens/01-home-and-form.png) | 1–2 | Brand, hero, assessment layout; remove form-page ad and early email field |
| [Mobile form](screens/02-form-mobile.png) | 3 | Single-column progressive assessment; restore all desktop options |
| [Matching state](screens/03-matching-state.png) | 4 | Dark surface, yellow progress motif; remove prototype bypass |
| [Desktop results](screens/04-results-desktop.png) | 5–8 | Conditions rail, stacked recommendation cards, costs and education |
| [Mobile results](screens/05-results-mobile.png) | 9 | Compact cards and sticky compare/report actions |
| [Original comparison](screens/06-compare-original.png) | 10 | Superseded three-item layout, retained for provenance |
| [Refine and report delivery](screens/07-refine-and-delivery-v2.png) | 11–12 | Optional refinement, version diff, independent delivery choices |
| [Four-item comparison](screens/08-compare-four-v2.png) | 13 | Governing comparison layout, with quote and scenario support |

The tire names, vehicle fitments, prices, scores, legal statements, and addresses in these screens are illustrative. They must not seed production catalog facts or consent defaults. These references contain selected checkboxes to demonstrate state; a new visitor starts with optional delivery choices unchecked.

## Archive handling

Keep these source files immutable. Record a later revision as a separate source entry with its own hash. Extracted PNG bytes match their ZIP members exactly. All files are small enough for ordinary Git; no Git LFS setup is necessary for this package. Local text extractions, PDF renders, and contact sheets live in ignored `.work/` scratch space and are not part of the deliverable.
