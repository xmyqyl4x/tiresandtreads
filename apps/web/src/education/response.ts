import { readCommercialPage } from '../commercial/read.ts';
import { localPreview, type PreviewEnvironment } from '../local-preview.ts';
import {
  educationPageSchema,
  educationRedirectSchema,
  sitemapXml,
  decodedMarkingSchema,
  type EducationTool,
  type ChecklistTool,
  checklistAnswersSchema,
  checklistScoreSchema,
} from '../../../../packages/contracts/src/education.ts';
import { educationDocument } from '../../node_modules/.cache/tt-preview/renderer.mjs';
const headers = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
};
export async function educationResponse(
  request: Request,
  env: PreviewEnvironment = process.env,
  send: typeof fetch = fetch,
) {
  const config = localPreview(env),
    url = new URL(request.url);
  const reply = (status: number, text: string, type = 'text/plain; charset=utf-8') =>
    new Response(text, { status, headers: { ...headers, 'content-type': type } });
  if (
    !config ||
    request.headers.get('host') !== new URL(config.web).host ||
    !['GET', 'HEAD'].includes(request.method)
  )
    return reply(404, 'Not found');
  if (url.pathname === '/robots.txt') return reply(200, 'User-agent: *\nDisallow: /\n');
  if (url.pathname === '/sitemap.xml')
    return reply(200, sitemapXml([]), 'application/xml; charset=utf-8');
  if (
    !/^\/(learn|guides|glossary)\/[a-z0-9]+(-[a-z0-9]+)*$/.test(url.pathname) ||
    url.search.length > 256
  )
    return reply(404, 'Not found');
  try {
    const response = await send(
      config.api +
        '/api/v1/content?' +
        new URLSearchParams({ path: url.pathname, locale: 'en-US', market: 'US' }),
      {
        headers: { origin: config.api },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok)
      return reply(
        response.status === 404 ? 404 : 503,
        response.status === 404 ? 'Page unavailable' : 'Education is temporarily unavailable',
      );
    const raw = await response.text();
    if (raw.length > 262144) throw Error('Response bound exceeded');
    const data = (JSON.parse(raw) as { data: unknown }).data,
      redirect = educationRedirectSchema.safeParse(data);
    if (redirect.success) {
      const r = redirect.data.redirect;
      return new Response(r.code === 410 ? 'This page has been removed.' : null, {
        status: r.code,
        headers: { ...headers, ...(r.target ? { location: r.target } : {}) },
      });
    }
    const isChecklist = url.pathname === '/guides/before-you-buy';
    if (
      [...url.searchParams.keys()].some(
        (key) =>
          url.searchParams.getAll(key).length !== 1 ||
          (isChecklist
            ? !/^answer-([1-9]|1[0-4])$/.test(key)
            : key !== 'marking' || url.pathname !== '/guides/size-decoder'),
      )
    )
      return reply(404, 'Not found');
    const page = educationPageSchema.parse(data),
      now = new Date().toISOString();
    if (
      page.content.path !== url.pathname ||
      page.content.modifiedAt > now ||
      page.content.expiresAt <= now
    )
      throw Error('Stale content');
    let tool: EducationTool | undefined;
    let checklist: ChecklistTool | undefined;
    if (isChecklist && url.search) {
      const parsed = checklistAnswersSchema.safeParse(
        Array.from({ length: 14 }, (_, i) => ({
          key: i + 1,
          answer: url.searchParams.get('answer-' + (i + 1)),
        })),
      );
      if (!parsed.success) return reply(400, 'Provide exactly fourteen checklist answers');
      const result = await send(config.api + '/api/v1/tools/scorecard', {
        method: 'POST',
        headers: { origin: config.api, 'content-type': 'application/json' },
        body: JSON.stringify({ input: parsed.data }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!result.ok) return reply(503, 'The checklist summary is temporarily unavailable');
      const text = await result.text();
      if (text.length > 4096) throw Error('Tool response bound exceeded');
      checklist = {
        answers: parsed.data,
        result: checklistScoreSchema.parse((JSON.parse(text) as { data: unknown }).data),
      };
    }
    if (url.searchParams.has('marking')) {
      const input = url.searchParams.get('marking')!;
      if (input.length > 80) return reply(400, 'Marking is too long');
      const result = await send(config.api + '/api/v1/tools/size', {
        method: 'POST',
        headers: { origin: config.api, 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!result.ok) return reply(503, 'The size decoder is temporarily unavailable');
      const text = await result.text();
      if (text.length > 8192) throw Error('Tool response bound exceeded');
      tool = {
        input,
        result: decodedMarkingSchema.parse((JSON.parse(text) as { data: unknown }).data),
      };
    }
    const verification = env.SEARCH_CONSOLE_VERIFICATION;
    if (verification !== undefined && !/^[A-Za-z0-9_-]{10,200}$/.test(verification))
      throw Error('Invalid verification configuration');
    const commerce = await readCommercialPage(url.pathname, env, send);
    return reply(
      200,
      educationDocument(page, {
        ...(commerce ? { commerce } : {}),
        ...(tool ? { tool } : {}),
        ...(checklist ? { checklist } : {}),
        ...(verification ? { verification } : {}),
      }),
      'text/html; charset=utf-8',
    );
  } catch {
    return reply(503, 'Education is temporarily unavailable');
  }
}
