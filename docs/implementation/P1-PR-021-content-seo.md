# P1-PR-021 — Content, public tools and SEO publication services

**October 25, 2026 · S3 implementation for review.** Baseline: owner-approved [PR #20](https://github.com/xmyqyl4x/tiresandtreads/pull/20), merged at `2de57d88b69b7683b9a0ed1831548d2908e06555`. Specialist review and licensed adapters remain pending. This independent card depends on accepted S2 and runtime foundations, PR #13/#14. It advances E15/E37, CAP-02, UC10/UC17, AT16/AT27 and DB16/DB27. Service portions of FR-EML-06/08, FR-SEO-01/02/03/05/06/07/08/09/11/12 and CORE-06/07/08 are covered; their API, editorial, rendered-browser and live acceptance remain later gates.

## Service boundary

`createContentRuntime` verifies separate `tt_content_runtime`, `tt_public_runtime` and `tt_cms_runtime` credentials, then composes the headless application service, SQL/S3 configuration reader and redirect reader. It does not enable a CMS website, guest access, indexing provider or product frontend. Staff identities are supplied only after server-side authentication; current database capabilities `content.publish` and `seo.publish` are checked again at effects. A caller-supplied UUID is not authentication. S4 must map the verified identity and explicitly allowlist public, staff and internal worker methods.

| Boundary | Behavior |
| --- | --- |
| `enqueue`, `dispatch`, `reconcile` | Capture an exact reviewed CMS document/revision, durable queue it, claim a fenced lease, recheck source and current publishing capabilities, commit the public projection and acknowledge CMS work |
| `readPage`, `learn`, `checklist`, `decodeSize`, `scorecard` | Read only current reviewed public DTOs; derive metadata/translation links, select education links and run pure descriptive tools |
| `configure`, `publishRedirects` | Authenticate current publishing capability, validate bounded content, write immutable S3 bytes, reauthorize and advance the SQL head; object/network work happens outside SQL |
| `previewMetadata`, `sitemap` | Force draft previews and nonproduction metadata to noindex; export only current eligible public routes, actual modification times and reviewed locale variants |
| `audit`, `syncSearch`, `searchMetrics`, `searchTrend`, `notify` | Staff-only bounded crawl/metric/notification operations with public-route validation and honest unavailable/missing/stale states |
| `notifyPublication` | **Internal outbox consumer only**; resolve the opaque registered page identity and notify an explicitly enabled provider; never expose this method as an unauthenticated route |

The bridge reads the migrated Payload-owned article/glossary records and exact editorial-review evidence. It cannot create staff, alter editorial text/reviews or administer the database. Native source locks protect the revision during application publication. CMS draft and review workflows remain inaccessible through guest Payload APIs. The later staff/CMS interfaces must author through Payload's versioned operations and maintain review/revision policy; the SQL bridge is not a replacement authoring API.

## Publication, retry and withdrawal

CMS work stores an immutable internal envelope with exact source revision, public allowlisted page, publisher/reviewer references and fixed publication/expiry times. These staff references never enter the public projection. A duplicate capture must match its original envelope. Work leases use a random token, increasing fencing generation, 30-second deadline, eight-attempt limit and bounded backoff; exhausted work remains visibly failed. Reconciliation returns at most 20 candidates. A stale document revision cancels rather than resurrecting old content.

Application publication rechecks both current capabilities, binds the originating CMS identity/key/locale/market/path, and atomically writes immutable content/detail receipts, the public route register and one opaque notification outbox intent. It prevents another document taking over a route or content identity. A retry after application commit and lost CMS acknowledgement adopts the exact receipt without advancing the route revision or duplicating notifications. Rollback is a newly reviewed higher CMS revision; historical rows are not edited. Withdrawal is a higher source revision in draft state and a tombstone, so an old revision cannot return after expiry.

There is no distributed transaction or cross-database foreign key. The CMS lease/source lock is held only through bounded SQL publication/acknowledgement; network calls do not run inside it. An uncertain application commit is retried with its original identity. The P1-PR-027 worker composition must poll/reconcile at a bounded cadence, process pending notifications, report failed/exhausted work and measure queue delay. Local proofs cover immediate propagation to independent SQL readers and 30-second cache convergence. Production's under-60-second acceptance still requires the actual worker/CDN topology and workload; it is not an unlimited-backlog promise.

## Public configuration, redirects and SEO

SQL is the authority on every refresh and restart. Immutable S3 configuration/redirect objects are written before a head can reference them; an orphan cannot activate anything. Revision/checksum mismatches, corrupt/oversized/missing bytes, unavailable SQL/S3, a regressing head or expiry fail closed. Both readers refresh within 30 seconds and check expiry before serving cached values. Explicit invalidation also fences an in-flight refresh. Objects contain public allowlisted values, never credentials, raw contacts or report/owner tokens.

Redirects accept only same-site allowlisted public paths and 301/302/410. Rules are bounded to 200, reject loops, chains, duplicate and ambiguous sources, and never retain the incoming query string. Pattern support is a reviewed linear slug-capture grammar for learn/guides/glossary; arbitrary JavaScript regular expressions are not executed. Bounded quoted CSV interchange uses `source,target,code,mode`; invalid or formula-like values fail policy validation. Publishing a rollback requires a higher snapshot revision.

The route register and public view exclude drafts, removed/unapproved content, expired review/publication and private paths. Title templates have typed variables. Canonical/locale/sitemap paths cannot contain query strings, tokens, fragments, encoded traversal or external origins. JSON-LD is generated from visible approved fields as Article/DefinedTerm and supporting Organization/WebSite/BreadcrumbList data; editors cannot submit arbitrary JSON-LD or self-review claims. Robots/noindex policy is enforced for nonproduction, while actual staging authentication remains a deployment gate. Frontend HTTP headers, XML/JSON escaping and browser crawls remain S4/S5 work.

## Education and pure tools

Controlled topics are shared by publication and deterministic education selection. Select up to six current locale/market-matching links, at most two per topic, and the eligible buying checklist once. Older-but-explicitly-valid material receives the approved freshness factor; expired content is never eligible. Novelty adjustment requires permitted interaction history; the public service supplies none. Fewer reviewed candidates produce fewer links. Report delivery can call the same pure selector after its own current privacy authorization.

The metric-size decoder extracts only supported size components and opaque rating codes. Unknown construction/formats return unsupported; load capacity, speed limits, fitment, recalls and alternative-size suitability are not guessed. The buying checklist requires fourteen reviewed question/good-answer/red-flag/glossary entries. Scorecards count recorded answers and unresolved concerns without declaring mechanical safety. This PR supplies contracts and synthetic fixtures, not 25 accepted glossary articles or specialist-reviewed tire advice. Those editorial/release obligations and the existing specialist gate remain open.

## Crawl and search providers

Audit batches use keyset cursors, at most 20 pages, bounded same-origin response bytes/deadlines and fixed finding codes. They never crawl private paths or follow redirects to another host. Stored findings contain rule codes and public page identities, not scraped content or private URL/token evidence. The scheduler must continue the returned cursor and surface partial/failed batches; nightly scheduling and rendered UI checks join the later runtime/API/SEO gates.

The Search Console adapter requires an explicitly verified matching URL-prefix/domain property and server-supplied read authorization. It requests final daily aggregate data for an exact registered page, with no query/user dimension. Missing rows remain missing, explicit zero remains zero, and newer fetched corrections replace rather than sum totals. Counts remain exact integers; average-position-derived values retain provider measurement precision. Daily comparisons flag a decline greater than 20% only with an observed nonzero baseline. This is a descriptive operational signal. Provider row completeness is not guaranteed. See [Google's query contract](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).

IndexNow accepts only validated same-site registered paths with a configured ownership key, bounded batches, fixed endpoint and separate received/pending-key/disabled outcomes. Receipt does not promise indexing or Google participation. Hosting and verifying the key file, choosing the actual Search Console property and authorizing its credentials remain activation work; no live request is sent by tests. See the [IndexNow protocol](https://www.indexnow.org/documentation).

## Storage and validation

Additive app migration `0025_content_services` adds immutable public page details, redirect publications, two restricted public views, narrow capability locking and a fixed-shape notification function. CMS migration `0003_publication_bridge` grants reviewed source/queue access and document-identity guards without changing Payload collections. Inventory is 127 app tables, 42 app views, 1,638 table/view columns, 28 CMS tables at 25 app/three CMS migrations. Generated Drizzle models retain full parity. Existing migration checksums, original 137 FR rows, task IDs/dependencies and archived approvals remain unchanged.

See the [validation packet](evidence/P1/p1-pr-021-validation.md) and [task card](../tasks/phase-1-prs.md#p1-pr-021). Native PostgreSQL, actual sender/ad/search accounts, hosting, licensed feeds, named specialist reviews and verified report issuance remain outside this technical acceptance.
