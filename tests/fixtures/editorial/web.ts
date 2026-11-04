import { editorialFixture } from './runtime.ts';
import { startWebPreview } from '../http/web-preview.ts';
import { listenLocalApi } from '../../../packages/integrations/src/http/server.ts';
import { editorialHttp } from '../../../packages/integrations/src/editorial-http.ts';
import { readEducation } from '../../../packages/integrations/src/education-public.ts';
export async function startEditorialPreview(webOrigin = 'http://127.0.0.1:8380', publish = true) {
  const fixture = await editorialFixture(webOrigin);
  let server: Awaited<ReturnType<typeof listenLocalApi>> | undefined;
  try {
    const records = await fixture.seed(publish);
    server = await listenLocalApi((origin) => {
      const editorial = editorialHttp({ origin, service: fixture.service });
      return async (request) => {
        const url = new URL(request.url);
        if (url.pathname === '/local-editorial/api') return editorial(request);
        if (url.pathname === '/api/v1/content' && request.method === 'GET') {
          const r = await readEducation(fixture.content, url.searchParams);
          return Response.json(r.ok ? { data: r.value } : { error: r.error.code }, {
            status: r.ok ? 200 : r.error.code === 'not_found' ? 404 : 503,
          });
        }
        if (url.pathname === '/api/v1/tools/size' && request.method === 'POST') {
          const input = (await request.json()) as { input: unknown };
          return Response.json({ data: fixture.content.services.decodeSize(input.input) });
        }
        if (url.pathname === '/api/v1/tools/scorecard' && request.method === 'POST') {
          const input = (await request.json()) as {
            answers: Parameters<typeof fixture.content.services.scorecard>[0];
          };
          return Response.json({ data: fixture.content.services.scorecard(input.answers) });
        }
        return new Response('Not found', { status: 404 });
      };
    });
    const api = server;
    const web = await startWebPreview(webOrigin, 'dev', 'unsupported', {
      fixture: { cleanup: () => fixture.cleanup() },
      api: { origin: api.origin, shutdown: () => api.close() },
      env: {
        LOCAL_EDITORIAL_PREVIEW: 'enabled',
        LOCAL_EDITORIAL_API_ORIGIN: api.origin,
        SEARCH_CONSOLE_VERIFICATION: 'synthetic-local-verification-token',
      },
    });
    return { web, fixture, records, cleanup: () => web.cleanup() };
  } catch (e) {
    await server?.close();
    await fixture.cleanup();
    throw e;
  }
}
