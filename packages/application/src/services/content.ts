import { ok, fail, instant, type Id, type Instant } from '../../../domain/src/values/core.ts';
import {
  checklist as validatedChecklist,
  validatePage,
  metadata,
  publicPath,
  siteOrigin,
  redirectRules,
  learningLinks,
  decodeSize,
  scorecard,
  type PublicPage,
  type Topic,
} from '../../../domain/src/public-policy.ts';
import type { UnitOfWork, TransactionContext as Tx } from '../ports/transactions.ts';
import type {
  CmsRef,
  EditorialRepository,
  ContentServiceRepository,
  ContentPacket,
  ContentIdentity,
  PublicSnapshots,
  RedirectSnapshot,
  PublicCrawler,
  SearchProvider,
} from '../ports/content-services.ts';
import type { PublicConfiguration } from '../ports/publication.ts';
import { serviceWork, demand, serviceFailure, ServiceFault } from './service-work.ts';
import { object, canonical } from './service-records.ts';
export function redirectSnapshot(input: RedirectSnapshot): RedirectSnapshot {
  demand(Object.keys(input).sort().join(',') === 'expiresAt,issuedAt,revision,rules');
  demand(
    Number.isSafeInteger(input.revision) && input.revision > 0 && input.revision <= 2147483647,
  );
  demand(
    instant(input.issuedAt).ok &&
      instant(input.expiresAt).ok &&
      input.expiresAt > input.issuedAt &&
      Date.parse(input.expiresAt) - Date.parse(input.issuedAt) <= 86400000,
  );
  return { ...input, rules: redirectRules(input.rules) };
}
export function createContentServices(d: {
  readonly appUow: UnitOfWork;
  readonly publicUow: UnitOfWork;
  readonly cmsUow: UnitOfWork;
  readonly editorial: EditorialRepository;
  readonly write: ContentServiceRepository;
  readonly read: ContentServiceRepository;
  readonly identity: ContentIdentity;
  readonly snapshots: PublicSnapshots;
  readonly crawler: PublicCrawler;
  readonly search: SearchProvider;
  readonly origin: string;
  readonly production: boolean;
  readonly now: () => string;
}) {
  const origin = siteOrigin(d.origin),
    run = <T>(uow: UnitOfWork, fn: (tx: Tx) => Promise<T>) =>
      serviceWork(uow, async (tx) => ok(await fn(tx)));
  const now = () => {
    const r = instant(d.now());
    demand(r.ok);
    return r.value;
  };
  async function auth(actor: Id<'staff'>, permission: 'content.publish' | 'seo.publish') {
    const r = await run(d.appUow, async (tx) => {
      await d.write.authorize(tx, actor, permission);
    });
    if (!r.ok) throw new ServiceFault(r.error.code, r.error);
  }
  async function page(path: string, locale: string, market: string) {
    const r = await run(d.publicUow, (tx) => d.read.page(tx, path, locale, market));
    if (!r.ok) throw new ServiceFault(r.error.code, r.error);
    demand(r.value, 'not_found');
    return r.value;
  }
  return {
    async enqueue(actor: Id<'staff'>, ref: CmsRef, action: 'publish' | 'withdraw' = 'publish') {
      try {
        demand(action === 'publish' || action === 'withdraw');
        await auth(actor, 'content.publish');
        const at = now();
        return await run(d.cmsUow, async (tx) => {
          const source = await d.editorial.source(tx, ref);
          demand(source, 'not_found');
          demand(source.modifiedAt <= at, 'conflict');
          let publicPage: PublicPage | null = null;
          if (action === 'publish') {
            demand(
              source.published &&
                source.approved &&
                source.reviewerId &&
                source.reviewedAt &&
                source.expiresAt &&
                source.expiresAt > at &&
                source.reviewedAt <= at,
              'forbidden',
            );
            const url = new URL(source.sourceUrl ?? '');
            demand(url.protocol === 'https:' && !url.username && !url.password);
            await auth(source.reviewerId, 'content.publish');
            const body = object(source.body);
            demand(
              Object.keys(body)
                .filter((k) => k !== 'questions')
                .sort()
                .join(',') === 'author,canonical,paragraphs,path,related,reviewer,summary,topics',
            );
            try {
              publicPage = validatePage({
                ...body,
                kind: ref.collection === 'articles' ? 'article' : 'glossary',
                contentKey: source.key,
                title: source.title,
                locale: source.locale,
                market: source.market,
                reviewedAt: source.reviewedAt,
                modifiedAt: source.modifiedAt,
                expiresAt: source.expiresAt,
              } as unknown as PublicPage);
            } catch {
              throw new ServiceFault('invalid_input');
            }
          } else demand(!source.published, 'conflict');
          const packet: ContentPacket = {
            schemaVersion: 1,
            ref,
            key: source.key,
            locale: source.locale,
            market: source.market,
            generation: String(ref.revision),
            publisherId: actor,
            reviewerId: action === 'publish' ? source.reviewerId! : actor,
            publishedAt: source.modifiedAt,
            expiresAt:
              action === 'publish'
                ? source.expiresAt!
                : (new Date(Date.parse(source.modifiedAt) + 86400000).toISOString() as Instant),
            page: publicPage,
          };
          return { id: await d.editorial.enqueue(tx, packet), status: 'pending' as const };
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async dispatch(id: Id<'cms_work'>) {
      const claimed = await run(d.cmsUow, (tx) => d.editorial.lease(tx, id));
      if (!claimed.ok) return claimed;
      if (!claimed.value) return ok(null);
      const l = claimed.value;
      const result = await run(d.cmsUow, async (tx) => {
        if (!(await d.editorial.current(tx, l))) {
          await d.editorial.finish(tx, l, 'cancelled');
          return { status: 'cancelled' as const };
        }
        const p = l.packet;
        demand(
          p.schemaVersion === 1 &&
            p.generation === String(p.ref.revision) &&
            p.publishedAt <= now() &&
            p.expiresAt > now(),
          'conflict',
        );
        const applied = await run(d.appUow, (app) => d.write.apply(app, p));
        if (!applied.ok) throw new ServiceFault(applied.error.code, applied.error);
        const status = applied.value === 'stale' ? 'cancelled' : 'published';
        await d.editorial.finish(tx, l, status);
        return { status };
      });
      if (!result.ok) await run(d.cmsUow, (tx) => d.editorial.fail(tx, l));
      return result;
    },
    async reconcile() {
      return run(d.cmsUow, (tx) => d.editorial.pending(tx));
    },
    async configure(actor: Id<'staff'>, reviewer: Id<'staff'>, value: PublicConfiguration) {
      try {
        await auth(actor, 'seo.publish');
        await auth(reviewer, 'seo.publish');
        // The object is immutable before the SQL head can reference it. SQL never falls back to an orphan.
        demand(value.issuedAt <= now() && value.expiresAt > now());
        demand(
          Object.keys(value).sort().join(',') ===
            'advertising,analytics,expiresAt,issuedAt,revision,schemaVersion',
        );
        demand(
          value.schemaVersion === 1 &&
            typeof value.analytics === 'boolean' &&
            typeof value.advertising === 'boolean' &&
            Number.isSafeInteger(value.revision) &&
            value.revision > 0 &&
            value.revision <= 2147483647 &&
            instant(value.issuedAt).ok &&
            instant(value.expiresAt).ok &&
            Date.parse(value.expiresAt) - Date.parse(value.issuedAt) <= 86400000,
        );
        await d.snapshots.put(
          `public-config/${value.revision}.json`,
          new TextEncoder().encode(canonical(value, 4096)),
        );
        return await run(d.appUow, async (tx) => {
          await d.write.authorize(tx, actor, 'seo.publish');
          await d.write.authorize(tx, reviewer, 'seo.publish');
          return d.write.configure(tx, value, reviewer);
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async publishRedirects(actor: Id<'staff'>, reviewer: Id<'staff'>, input: RedirectSnapshot) {
      try {
        await auth(actor, 'seo.publish');
        await auth(reviewer, 'seo.publish');
        const value = redirectSnapshot(input);
        demand(value.issuedAt <= now() && value.expiresAt > now());
        const checksum = d.identity.checksum(value);
        await d.snapshots.put(
          `public-redirects/${value.revision}.json`,
          new TextEncoder().encode(canonical(value, 65536)),
        );
        return await run(d.appUow, async (tx) => {
          await d.write.authorize(tx, actor, 'seo.publish');
          await d.write.authorize(tx, reviewer, 'seo.publish');
          await d.write.redirects(tx, value, checksum, reviewer);
          return { revision: value.revision, checksum };
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async readPage(path: string, locale: string, market: string) {
      try {
        const r = await page(path, locale, market),
          m = metadata(r.page, origin, d.production, now());
        const translations = await run(d.publicUow, (tx) =>
          d.read.translations(tx, r.page.contentKey),
        );
        if (!translations.ok) return translations;
        return ok({
          content: r.page,
          metadata: m,
          hreflang: translations.value
            .filter((p) => p.canonical === p.path)
            .map((p) => ({ locale: p.locale, url: origin + p.path })),
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async sitemap(locale: string, market: string, after: string | null = null) {
      return run(d.publicUow, async (tx) => {
        const pages = await d.read.pages(tx, locale, market, after, 100),
          at = now();
        return {
          items: pages
            .filter((p) => metadata(p.page, origin, d.production, at).robots === 'index,follow')
            .map((p) => ({ loc: origin + p.page.path, lastmod: p.page.modifiedAt })),
          next: pages.length === 100 ? pages.at(-1)!.page.path : null,
        };
      });
    },
    async learn(locale: string, market: string, weights: Readonly<Partial<Record<Topic, number>>>) {
      return run(d.publicUow, async (tx) => {
        const pages = await d.read.pages(tx, locale, market, null, 100);
        return learningLinks(
          pages.map((p) => ({ ...p.page, checklist: p.page.path === '/guides/before-you-buy' })),
          weights,
          locale,
          market,
          now(),
          { permitted: false, clicked: [] },
        );
      });
    },
    async checklist(locale: string, market: string) {
      try {
        const p = await page('/guides/before-you-buy', locale, market);
        demand(p.page.questions, 'not_found');
        return ok(validatedChecklist(p.page.questions));
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    decodeSize,
    scorecard,
    async audit(actor: Id<'staff'>, locale: string, market: string, after: string | null = null) {
      try {
        await auth(actor, 'seo.publish');
        const listed = await run(d.publicUow, (tx) => d.read.pages(tx, locale, market, after, 20));
        if (!listed.ok) return listed;
        const findings: { id: Id<'seo_page'>; findings: string[] }[] = [],
          start = Date.parse(now());
        let complete = true;
        for (const p of listed.value) {
          if (Date.parse(now()) - start > 20000) {
            complete = false;
            break;
          }
          const rules: string[] = [];
          try {
            const observed = await d.crawler.observe(p.page.path);
            if (observed.status !== 200) rules.push('http_status');
            if (observed.title !== p.page.title) rules.push('title');
            if (observed.description !== p.page.summary) rules.push('description');
            if (observed.canonical !== origin + p.page.canonical) rules.push('canonical');
            if (observed.robots?.includes('noindex')) rules.push('unexpected_noindex');
            if (
              observed.links.some(
                (link) =>
                  /^\/(reports?|api|admin|privacy|assets)(\/|\?|$)/.test(link) ||
                  /[?&](token|email|owner|session)=/i.test(link),
              )
            )
              rules.push('private_link');
          } catch {
            rules.push('unavailable');
            complete = false;
          }
          findings.push({ id: p.id, findings: rules });
        }
        const id = d.identity.id('seo_audit');
        const saved = await run(d.appUow, async (tx) => {
          await d.write.authorize(tx, actor, 'seo.publish');
          await d.write.audit(tx, id, findings, complete);
        });
        if (!saved.ok) return saved;
        return ok({
          id,
          complete,
          scanned: findings.length,
          findings: findings.reduce((n, p) => n + p.findings.length, 0),
          hasMore: listed.value.length === 20,
          next: listed.value.length === 20 ? listed.value.at(-1)!.page.path : null,
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async syncSearch(
      actor: Id<'staff'>,
      path: string,
      locale: string,
      market: string,
      start: string,
      end: string,
    ) {
      try {
        await auth(actor, 'seo.publish');
        const p = await page(path, locale, market);
        demand(
          /^\d{4}-\d{2}-\d{2}$/.test(start) &&
            /^\d{4}-\d{2}-\d{2}$/.test(end) &&
            Number.isFinite(Date.parse(start)) &&
            Number.isFinite(Date.parse(end)) &&
            new Date(start).toISOString().slice(0, 10) === start &&
            new Date(end).toISOString().slice(0, 10) === end &&
            start <= end &&
            Date.parse(end) - Date.parse(start) <= 30 * 86400000,
        );
        if (!d.search.enabled) return ok({ status: 'unavailable' as const, rows: null });
        const rows = await d.search.daily(path, start, end),
          fetched = now();
        demand(
          rows.length <= 31 &&
            new Set(rows.map((r) => r.day)).size === rows.length &&
            rows.every(
              (r) => r.day >= start && r.day <= end && r.clicks >= 0n && r.impressions >= r.clicks,
            ),
        );
        const revision = d.identity.checksum({ path, start, end, fetched, rows });
        const saved = await run(d.appUow, async (tx) => {
          await d.write.authorize(tx, actor, 'seo.publish');
          await d.write.search(tx, p.id, rows, fetched, revision);
        });
        if (!saved.ok) return saved;
        return ok({
          status: rows.length ? ('available' as const) : ('missing' as const),
          rows: rows.length,
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async notify(actor: Id<'staff'>, paths: readonly string[]) {
      try {
        await auth(actor, 'seo.publish');
        demand(paths.length > 0 && paths.length <= 100 && new Set(paths).size === paths.length);
        paths.forEach(publicPath);
        const allowed = await run(d.appUow, async (tx) => {
          for (const path of paths) demand(await d.write.known(tx, path), 'not_found');
        });
        if (!allowed.ok) return allowed;
        return ok({ status: await d.search.notify(paths) });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    // Internal durable outbox consumer; never an unauthenticated public controller.
    async notifyPublication(id: Id<'seo_page'>) {
      try {
        const r = await run(d.appUow, (tx) => d.write.path(tx, id));
        if (!r.ok) return r;
        demand(r.value, 'not_found');
        return ok({ status: await d.search.notify([r.value]) });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async previewMetadata(actor: Id<'staff'>, document: PublicPage) {
      try {
        await auth(actor, 'seo.publish');
        return ok(metadata(document, origin, false, now()));
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async searchTrend(
      actor: Id<'staff'>,
      path: string,
      locale: string,
      market: string,
      baseline: string,
      current: string,
    ) {
      try {
        await auth(actor, 'seo.publish');
        const p = await page(path, locale, market);
        demand(
          /^\d{4}-\d{2}-\d{2}$/.test(baseline) &&
            /^\d{4}-\d{2}-\d{2}$/.test(current) &&
            baseline < current,
        );
        const r = await run(d.appUow, async (tx) => ({
          before: await d.write.metrics(tx, p.id, baseline),
          after: await d.write.metrics(tx, p.id, current),
        }));
        if (!r.ok) return r;
        if (!r.value.before || !r.value.after || r.value.before.clicks === 0n)
          return ok({ status: 'insufficient_data', decline: null });
        return ok({
          status: 'available',
          decline: r.value.after.clicks * 5n < r.value.before.clicks * 4n,
          baselineClicks: r.value.before.clicks,
          currentClicks: r.value.after.clicks,
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async searchMetrics(
      actor: Id<'staff'>,
      path: string,
      locale: string,
      market: string,
      day: string,
    ) {
      try {
        await auth(actor, 'seo.publish');
        const p = await page(path, locale, market);
        demand(/^\d{4}-\d{2}-\d{2}$/.test(day));
        const r = await run(d.appUow, (tx) => d.write.metrics(tx, p.id, day));
        if (!r.ok) return r;
        return ok(
          r.value
            ? {
                status:
                  Date.parse(now()) - Date.parse(r.value.fetchedAt) > 7 * 86400000
                    ? 'stale'
                    : 'available',
                ...r.value,
              }
            : { status: 'missing', clicks: null, impressions: null, positionSum: null },
        );
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
  };
}
