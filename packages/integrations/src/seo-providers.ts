import type {
  SearchProvider,
  SearchDay,
  PublicCrawler,
} from '../../application/src/ports/content-services.ts';
import { publicPath, siteOrigin } from '../../domain/src/public-policy.ts';
import { boundedIO } from './bounded-io.ts';
async function body(r: Response, max: number) {
  if (!r.body) throw Error('Unavailable response');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for await (const chunk of r.body) {
      size += chunk.byteLength;
      if (size > max) throw Error('Oversized response');
      chunks.push(chunk);
    }
  } catch {
    await r.body.cancel().catch(() => {});
    throw Error('Invalid response');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
export function createSearchProvider(o: {
  readonly origin: string;
  readonly property?: string;
  readonly accessToken?: () => Promise<string>;
  readonly indexNowKey?: string;
  readonly verified: boolean;
}): SearchProvider {
  const origin = siteOrigin(o.origin),
    host = new URL(origin).hostname;
  if (o.property !== undefined && o.property !== origin + '/' && o.property !== 'sc-domain:' + host)
    throw Error('Invalid search property');
  if (o.indexNowKey !== undefined && !/^[A-Za-z0-9-]{8,128}$/.test(o.indexNowKey))
    throw Error('Invalid IndexNow key');
  return {
    enabled: o.verified && !!o.property && !!o.accessToken,
    async daily(path, start, end) {
      publicPath(path);
      if (!this.enabled) throw Error('Search unavailable');
      return boundedIO(async (signal) => {
        const token = await o.accessToken!();
        if (!token || /[\r\n]/.test(token)) throw Error('Invalid authorization');
        const r = await fetch(
          `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(o.property!)}/searchAnalytics/query`,
          {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              startDate: start,
              endDate: end,
              dimensions: ['date'],
              type: 'web',
              dataState: 'final',
              aggregationType: 'byPage',
              rowLimit: 25000,
              dimensionFilterGroups: [
                {
                  groupType: 'and',
                  filters: [{ dimension: 'page', operator: 'equals', expression: origin + path }],
                },
              ],
            }),
            redirect: 'error',
            credentials: 'omit',
            signal,
          },
        );
        if (r.status !== 200) {
          await r.body?.cancel();
          throw Error('Search unavailable');
        }
        const data = JSON.parse(await body(r, 262144));
        if (
          !data ||
          typeof data !== 'object' ||
          data.responseAggregationType !== 'byPage' ||
          (data.rows !== undefined && !Array.isArray(data.rows)) ||
          data.rows?.length > 31
        )
          throw Error('Invalid search response');
        const rows: SearchDay[] = (data.rows ?? []).map((x: Record<string, unknown>) => {
          if (
            !Array.isArray(x.keys) ||
            x.keys.length !== 1 ||
            typeof x.keys[0] !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(x.keys[0]) ||
            x.keys[0] < start ||
            x.keys[0] > end ||
            !Number.isSafeInteger(x.clicks) ||
            !Number.isSafeInteger(x.impressions) ||
            Number(x.clicks) < 0 ||
            Number(x.impressions) < Number(x.clicks) ||
            typeof x.position !== 'number' ||
            !Number.isFinite(x.position) ||
            x.position < 0 ||
            x.position * Number(x.impressions) > 1e15
          )
            throw Error('Invalid search row');
          return {
            day: x.keys[0],
            clicks: BigInt(Number(x.clicks)),
            impressions: BigInt(Number(x.impressions)),
            positionSum: String(x.position * Number(x.impressions)),
          };
        });
        if (new Set(rows.map((x) => x.day)).size !== rows.length)
          throw Error('Duplicate search day');
        return rows;
      }, 5000);
    },
    async notify(paths) {
      paths.forEach(publicPath);
      if (!o.verified || !o.indexNowKey) return 'disabled';
      if (!paths.length || paths.length > 100 || new Set(paths).size !== paths.length)
        throw Error('Invalid notifications');
      return boundedIO(async (signal) => {
        const r = await fetch('https://api.indexnow.org/indexnow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host,
            key: o.indexNowKey,
            keyLocation: `${origin}/${o.indexNowKey}.txt`,
            urlList: paths.map((p) => origin + p),
          }),
          redirect: 'error',
          credentials: 'omit',
          signal,
        });
        await r.body?.cancel();
        if (r.status === 200) return 'received';
        if (r.status === 202) return 'pending_key';
        throw Error('Notification unavailable');
      }, 5000);
    },
  };
}
export function createPublicCrawler(originInput: string): PublicCrawler {
  const origin = siteOrigin(originInput);
  return {
    async observe(path) {
      publicPath(path);
      return boundedIO(async (signal) => {
        const r = await fetch(origin + path, {
          redirect: 'manual',
          credentials: 'omit',
          headers: { 'User-Agent': 'TiresAndTreads-public-audit/1.0', Accept: 'text/html' },
          signal,
        });
        const html = await body(r, 262144),
          head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? '';
        const attrs = (tag: string) =>
          Object.fromEntries(
            [...tag.matchAll(/([a-z][a-z0-9-]*)\s*=\s*(["'])([^"']*)\2/gi)].map((m) => [
              m[1]!.toLowerCase(),
              m[3]!,
            ]),
          );
        const metas = [...head.matchAll(/<meta\b[^>]{0,4000}>/gi)].map((m) => attrs(m[0])),
          links = [...head.matchAll(/<link\b[^>]{0,4000}>/gi)].map((m) => attrs(m[0]));
        return {
          status: r.status,
          title: head.match(/<title\b[^>]*>([^<]{0,500})<\/title\s*>/i)?.[1] ?? null,
          description: metas.find((m) => m.name?.toLowerCase() === 'description')?.content ?? null,
          canonical: links.find((m) => m.rel?.toLowerCase() === 'canonical')?.href ?? null,
          robots:
            r.headers.get('x-robots-tag') ??
            metas.find((m) => m.name?.toLowerCase() === 'robots')?.content ??
            null,
          links: [...html.matchAll(/<a\b[^>]{0,4000}>/gi)]
            .slice(0, 500)
            .map((m) => attrs(m[0]).href)
            .filter((s): s is string => typeof s === 'string'),
        };
      }, 5000);
    },
  };
}
