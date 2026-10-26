import type {
  ContentServiceRepository,
  RegisteredPage,
  RedirectSnapshot,
} from '../../../application/src/ports/content-services.ts';
import { validatePage, publicPath, type PublicPage } from '../../../domain/src/public-policy.ts';
import { canonical } from '../../../application/src/services/service-records.ts';
import { createContentPublicationRepository } from './content.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { one, rid, stamp, text, obj, integer } from './private-values.ts';
function registered(r: Record<string, unknown>): RegisteredPage {
  return {
    id: rid('seo_page', r.id),
    page: validatePage(obj(r.document, 240000) as unknown as PublicPage),
  };
}
export function createContentServiceRepository(s: WriteScope): ContentServiceRepository {
  const q = s.query,
    publish = createContentPublicationRepository(s);
  const repo: ContentServiceRepository = {
    async authorize(tx, actor, permission) {
      if (
        !(await q(tx, 'SELECT admin.authorize_content($1,$2) AS allowed', [actor, permission]))
          .rows[0]?.allowed
      )
        stop('forbidden');
    },
    async apply(tx, p) {
      await repo.authorize(tx, p.publisherId, 'content.publish');
      await repo.authorize(tx, p.reviewerId, 'content.publish');
      await q(tx, 'SELECT pg_advisory_xact_lock(hashtextextended($1,2100))', [
        p.key + ':' + p.locale + ':' + p.market,
      ]);
      await q(tx, 'SELECT pg_advisory_xact_lock(hashtextextended($1,2101))', [
        p.ref.collection + ':' + p.ref.id,
      ]);
      const previous = (
        await q(
          tx,
          'SELECT * FROM app.public_page_details WHERE document_id=$1 AND collection=$2 ORDER BY generation DESC LIMIT 1',
          [p.ref.id, p.ref.collection],
        )
      ).rows[0];
      const origin = (
        await q(
          tx,
          'SELECT document_id,collection FROM app.public_page_details WHERE content_key=$1 AND locale=$2 AND market=$3 LIMIT 1',
          [p.key, p.locale, p.market],
        )
      ).rows[0];
      if (origin && (origin.document_id !== p.ref.id || origin.collection !== p.ref.collection))
        return stop('conflict');
      if (
        previous &&
        (previous.content_key !== p.key ||
          previous.locale !== p.locale ||
          previous.market !== p.market ||
          (p.page && previous.public_path !== p.page.path))
      )
        return stop('conflict');
      const head = (
        await q(
          tx,
          'SELECT generation FROM app.content_publication_heads WHERE content_key=$1 AND locale=$2 AND market=$3',
          [p.key, p.locale, p.market],
        )
      ).rows[0];
      if (head && BigInt(String(head.generation)) > BigInt(p.generation)) return 'stale';
      if (p.page) validatePage(p.page);
      else if (!previous) return stop('not_found');
      const path = p.page?.path ?? text(previous!.public_path);
      const document = p.page ? canonical(p.page, 240000) : null;
      await publish.publish(tx, {
        key: p.key,
        locale: p.locale,
        market: p.market,
        generation: BigInt(p.generation),
        cmsRevision: p.ref.collection + ':' + p.ref.id + ':' + p.ref.revision,
        publishedAt: p.publishedAt,
        expiresAt: p.expiresAt,
        content: p.page
          ? { title: p.page.title, summary: p.page.summary, paragraphs: p.page.paragraphs }
          : null,
      });
      await q(
        tx,
        'INSERT INTO app.public_page_details(content_key,locale,market,generation,document_id,collection,public_path,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
        [p.key, p.locale, p.market, p.generation, p.ref.id, p.ref.collection, path, document],
      );
      const stored = one(
        (
          await q(
            tx,
            'SELECT document FROM app.public_page_details WHERE content_key=$1 AND locale=$2 AND market=$3 AND generation=$4',
            [p.key, p.locale, p.market, p.generation],
          )
        ).rows,
      );
      if (canonical(stored.document) !== canonical(p.page)) return stop('conflict');
      if (
        head &&
        String(head.generation) === p.generation &&
        previous &&
        String(previous.generation) === p.generation
      )
        return 'published';
      const kind =
        path === '/'
          ? 'home'
          : path.startsWith('/glossary/')
            ? 'glossary'
            : path.startsWith('/tires/models/')
              ? 'tire_model'
              : path.startsWith('/tires/sizes/')
                ? 'tire_size'
                : 'education';
      // Every route is bound to the original content identity; another source cannot take it over.
      const existing = (
        await q(
          tx,
          'SELECT content_key FROM admin.seo_page_registry WHERE public_path=$1 AND locale=$2 FOR UPDATE',
          [path, p.locale],
        )
      ).rows[0];
      if (existing && existing.content_key !== p.key) return stop('conflict');
      await q(
        tx,
        `INSERT INTO admin.seo_page_registry(public_path,locale,market,content_key,page_class,owner_staff_id,review_due_at,index_status,canonical_path) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(public_path,locale) DO UPDATE SET review_due_at=excluded.review_due_at,index_status=excluded.index_status,canonical_path=excluded.canonical_path,revision=seo_page_registry.revision+1,updated_at=clock_timestamp()`,
        [
          path,
          p.locale,
          p.market,
          p.key,
          kind,
          p.publisherId,
          p.expiresAt,
          p.page ? 'eligible' : 'removed',
          p.page?.canonical ?? path,
        ],
      );
      await q(
        tx,
        'SELECT admin.notify_content(id,$3) FROM admin.seo_page_registry WHERE public_path=$1 AND locale=$2',
        [path, p.locale, Number(p.generation)],
      );
      return 'published';
    },
    async configure(tx, value, reviewer) {
      await q(tx, 'SELECT pg_advisory_xact_lock(1202,1)');
      const h = (await q(tx, 'SELECT max(version) AS revision FROM app.public_configurations'))
        .rows[0];
      if (h?.revision && Number(h.revision) > value.revision) return stop('conflict');
      return publish.configure(tx, value, reviewer);
    },
    async redirects(tx, value, checksum, reviewer) {
      await q(tx, 'SELECT pg_advisory_xact_lock(2102,1)');
      const h = (
        await q(
          tx,
          'SELECT revision,checksum FROM app.redirect_publications ORDER BY revision DESC LIMIT 1',
        )
      ).rows[0];
      if (h && Number(h.revision) >= value.revision) {
        if (Number(h.revision) === value.revision && h.checksum === checksum) return;
        return stop('conflict');
      }
      await q(
        tx,
        'INSERT INTO app.redirect_publications(revision,issued_at,expires_at,rules,checksum,reviewer_id) VALUES($1,$2,$3,$4,$5,$6)',
        [
          value.revision,
          value.issuedAt,
          value.expiresAt,
          JSON.stringify(value.rules),
          checksum,
          reviewer,
        ],
      );
    },
    async currentRedirects(tx) {
      const x = (
        await q(
          tx,
          'SELECT *,issued_at<=clock_timestamp() AND expires_at>clock_timestamp() AS live FROM app.current_redirects',
        )
      ).rows[0];
      return x && x.live
        ? {
            value: {
              revision: Number(x.revision),
              issuedAt: stamp(x.issued_at),
              expiresAt: stamp(x.expires_at),
              rules: x.rules as RedirectSnapshot['rules'],
            },
            checksum: text(x.checksum, 64),
          }
        : null;
    },
    async page(tx, path, locale, market) {
      publicPath(path);
      const x = (
        await q(
          tx,
          'SELECT id,document FROM app.public_pages WHERE public_path=$1 AND locale=$2 AND market=$3',
          [path, text(locale, 35), text(market, 16)],
        )
      ).rows[0];
      return x ? registered(x) : null;
    },
    async pages(tx, locale, market, after, limit) {
      if (after !== null) publicPath(after);
      integer(limit);
      if (limit > 100) return stop('invalid_input');
      return (
        await q(
          tx,
          'SELECT id,document FROM app.public_pages WHERE locale=$1 AND market=$2 AND ($3::text IS NULL OR public_path>$3) ORDER BY public_path LIMIT $4',
          [text(locale, 35), text(market, 16), after, limit],
        )
      ).rows.map(registered);
    },
    async known(tx, path) {
      publicPath(path);
      return (
        (await q(tx, 'SELECT id FROM admin.seo_page_registry WHERE public_path=$1 LIMIT 1', [path]))
          .rows.length > 0
      );
    },
    async path(tx, id) {
      const r = (await q(tx, 'SELECT public_path FROM admin.seo_page_registry WHERE id=$1', [id]))
        .rows[0];
      return r ? publicPath(r.public_path) : null;
    },
    async translations(tx, key) {
      return (
        await q(
          tx,
          'SELECT document FROM app.public_pages WHERE content_key=$1 ORDER BY locale,market LIMIT 50',
          [text(key)],
        )
      ).rows.map((x) => validatePage(obj(x.document, 240000) as unknown as PublicPage));
    },
    async audit(tx, id, pages, complete) {
      if (pages.length > 20) return stop('invalid_input');
      await q(
        tx,
        "INSERT INTO admin.seo_audit_runs(id,started_at,finished_at,crawler_version,state,page_count) VALUES($1,clock_timestamp(),clock_timestamp(),'bounded-public-v1',$2,$3)",
        [id, complete ? 'completed' : 'failed', pages.length],
      );
      for (const p of pages)
        for (const rule of new Set(p.findings))
          await q(
            tx,
            "INSERT INTO admin.seo_findings(run_id,page_id,rule_code,severity,status) VALUES($1,$2,$3,'error','open')",
            [id, p.id, text(rule, 100)],
          );
    },
    async search(tx, page, rows, fetched, revision) {
      if (rows.length > 31) return stop('invalid_input');
      await q(tx, 'SELECT pg_advisory_xact_lock(hashtextextended($1,2103))', [page]);
      for (const row of rows) {
        const old = (
          await q(
            tx,
            "SELECT fetched_at,source_revision FROM admin.search_daily_metrics WHERE page_id=$1 AND day=$2 AND source='search_console' FOR UPDATE",
            [page, row.day],
          )
        ).rows[0];
        if (old && stamp(old.fetched_at) >= fetched) {
          if (stamp(old.fetched_at) === fetched && old.source_revision === revision) continue;
          return stop('conflict');
        }
        await q(
          tx,
          `INSERT INTO admin.search_daily_metrics(page_id,day,source,clicks,impressions,position_sum,source_revision,fetched_at) VALUES($1,$2,'search_console',$3,$4,$5,$6,$7) ON CONFLICT(page_id,day,source) DO UPDATE SET clicks=excluded.clicks,impressions=excluded.impressions,position_sum=excluded.position_sum,source_revision=excluded.source_revision,fetched_at=excluded.fetched_at,updated_at=clock_timestamp(),revision=search_daily_metrics.revision+1`,
          [
            page,
            row.day,
            row.clicks.toString(),
            row.impressions.toString(),
            row.positionSum,
            revision,
            fetched,
          ],
        );
      }
    },
    async metrics(tx, page, day) {
      const x = (
        await q(
          tx,
          "SELECT * FROM admin.search_daily_metrics WHERE page_id=$1 AND day=$2 AND source='search_console'",
          [page, day],
        )
      ).rows[0];
      return x
        ? {
            day,
            clicks: BigInt(String(x.clicks)),
            impressions: BigInt(String(x.impressions)),
            positionSum: x.position_sum === null ? null : String(x.position_sum),
            fetchedAt: stamp(x.fetched_at),
          }
        : null;
    },
  };
  return guarded(s, repo);
}
