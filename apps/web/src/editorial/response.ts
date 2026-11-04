import { localPreview, type PreviewEnvironment } from '../local-preview.ts';
import { editorialDocument } from '../../node_modules/.cache/tt-preview/renderer.mjs';
export function editorialResponse(request: Request, env: PreviewEnvironment = process.env) {
  const c = localPreview(env),
    allowed =
      c &&
      env.LOCAL_EDITORIAL_PREVIEW === 'enabled' &&
      request.headers.get('host') === new URL(c.web).host;
  return new Response(allowed ? editorialDocument() : 'Not found', {
    status: allowed ? 200 : 404,
    headers: {
      'content-type': allowed ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    },
  });
}
export async function forwardEditorial(
  request: Request,
  env: PreviewEnvironment = process.env,
  send: typeof fetch = fetch,
) {
  const c = localPreview(env),
    reply = (status: number, error: string) =>
      Response.json(
        { error },
        {
          status,
          headers: {
            'cache-control': 'no-store',
            'x-robots-tag': 'noindex, nofollow',
            'referrer-policy': 'no-referrer',
          },
        },
      );
  if (!c || env.LOCAL_EDITORIAL_PREVIEW !== 'enabled') return reply(404, 'not_found');
  const u = new URL(request.url),
    origin = request.headers.get('origin');
  if (
    request.headers.get('host') !== new URL(c.web).host ||
    (origin !== null && origin !== c.web) ||
    (request.method === 'POST' && origin !== c.web)
  )
    return reply(403, 'forbidden');
  if (
    !['GET', 'POST'].includes(request.method) ||
    u.search.length > 256 ||
    [...u.searchParams].some(([k]) => !['id', 'identity', 'redirects'].includes(k))
  )
    return reply(400, 'invalid_input');
  try {
    const target = new URL(env.LOCAL_EDITORIAL_API_ORIGIN ?? '');
    if (
      target.protocol !== 'http:' ||
      target.hostname !== '127.0.0.1' ||
      !target.port ||
      target.username ||
      target.password ||
      target.pathname !== '/' ||
      target.search ||
      target.hash
    )
      throw Error();
    const auth = request.headers.get('authorization');
    if (!auth || !/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) return reply(401, 'unauthenticated');
    const reader = request.body?.getReader(),
      chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error()), 5000);
      });
      try {
        while (true) {
          const n = await Promise.race([reader.read(), deadline]);
          if (n.done) break;
          length += n.value.length;
          if (length > 65536) throw Error();
          chunks.push(n.value);
        }
      } finally {
        clearTimeout(timer);
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const b of chunks) {
      body.set(b, offset);
      offset += b.length;
    }
    const response = await send(target.origin + '/local-editorial/api' + u.search, {
      method: request.method,
      headers: {
        authorization: auth,
        origin: target.origin,
        'content-type': request.headers.get('content-type') ?? 'application/json',
      },
      ...(request.method === 'POST' ? { body } : {}),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    if (text.length > 262144) throw Error();
    return new Response(text, {
      status: response.status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
        'referrer-policy': 'no-referrer',
      },
    });
  } catch {
    return reply(503, 'unavailable');
  }
}
