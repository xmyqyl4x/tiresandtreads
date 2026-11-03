import { localPreview, type PreviewEnvironment } from './local-preview.ts';
import document from '../../../docs/api/local-v1.openapi.json';
const operations = Object.entries(document.paths)
  .flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, op]) => ({
      method: method.toUpperCase(),
      path,
      access: op['x-access'],
      limit: op['x-max-body-bytes'],
    })),
  )
  .filter((x) => x.path.startsWith('/api/v1/') && x.access !== 'callback');
function failure(status: number, code: string) {
  const requestId = crypto.randomUUID();
  return Response.json(
    { code, messageKey: 'errors.' + code, fieldErrors: {}, retryable: status === 503, requestId },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'x-request-id': requestId,
      },
    },
  );
}
async function smallBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error('Body timeout')), 5000);
  });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), expiry]);
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) throw Error('Body limit');
      chunks.push(next.value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
// This adapter rewrites Origin only after checking the browser's exact local Host/Origin.
export async function forwardLocalApi(
  request: Request,
  env: PreviewEnvironment,
  send: typeof fetch = fetch,
) {
  const config = localPreview(env);
  if (!config) return failure(404, 'not_found');
  const url = new URL(request.url),
    host = request.headers.get('host'),
    origin = request.headers.get('origin');
  if (
    host !== new URL(config.web).host ||
    (origin !== null && origin !== config.web) ||
    (request.method !== 'GET' && origin !== config.web)
  )
    return failure(403, 'forbidden');
  if (url.search.length > 4096 || /%2f|%5c|\\/i.test(url.pathname))
    return failure(400, 'invalid_input');
  const matching = operations.filter((op) => {
    const pattern = op.path.split('/'),
      actual = url.pathname.split('/');
    return (
      pattern.length === actual.length &&
      pattern.every((p, i) => (p.startsWith('{') ? !!actual[i] : p === actual[i]))
    );
  });
  if (!matching.length) return failure(404, 'not_found');
  const op = matching.find((x) => x.method === request.method);
  if (!op) return failure(405, 'method_not_allowed');
  const headers = new Headers();
  const cookieName = 'tt_owner_web_' + env.APP_ENV!.split('-')[0],
    cookies = (request.headers.get('cookie') ?? '')
      .split(';')
      .map((value) => value.trim())
      .filter((value) => value.startsWith(cookieName + '='));
  if (cookies.length > 1) return failure(400, 'ambiguous_credentials');
  if (cookies.length === 1)
    headers.set('cookie', 'tt_owner=' + cookies[0]!.slice(cookieName.length + 1));
  for (const name of [
    'accept',
    'content-type',
    'authorization',
    'x-csrf-token',
    'idempotency-key',
    'sec-gpc',
    'x-share-token',
  ]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set('origin', config.api);
  let body: Uint8Array | undefined;
  if (request.method !== 'GET') {
    const length = request.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > op.limit))
      return failure(413, 'body_too_large');
    try {
      body = await smallBody(request, op.limit);
    } catch {
      return failure(413, 'body_too_large');
    }
  }
  try {
    const response = await send(config.api + url.pathname + url.search, {
      method: request.method,
      headers,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      ...(body ? { body: new Uint8Array(body) } : {}),
    });
    const safe = new Headers({
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    });
    for (const name of [
      'content-type',
      'content-disposition',
      'x-request-id',
      'retry-after',
      'allow',
      'location',
    ]) {
      const value = response.headers.get(name);
      if (value !== null) safe.set(name, value);
    }
    const sessionCookie = response.headers.get('set-cookie');
    if (sessionCookie?.startsWith('tt_owner='))
      safe.set('set-cookie', cookieName + '=' + sessionCookie.slice('tt_owner='.length));
    return new Response(response.body, { status: response.status, headers: safe });
  } catch {
    return failure(503, 'unavailable');
  }
}
