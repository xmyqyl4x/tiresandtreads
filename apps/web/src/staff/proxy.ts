import { localPreview, type PreviewEnvironment } from '../local-preview.ts';
const headers = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};
export function staffProxyPath(path: string, method: string) {
  const read =
    /^\/api\/v1\/(staff-console\/(session|reports|sources|strategy|findings|configuration)|staff\/(queues\/(mail|callbacks|privacy|imports|seo)|operations|advertising\/revenue))$/;
  const write = /^\/api\/v1\/(staff-console\/(preview|publish)|staff\/recover)$/;
  return method === 'GET' ? read.test(path) : method === 'POST' && write.test(path);
}
async function bounded(stream: ReadableStream<Uint8Array> | null, limit: number) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error('deadline')), 5000);
  });
  try {
    while (true) {
      const n = await Promise.race([reader.read(), deadline]);
      if (n.done) break;
      length += n.value.length;
      if (length > limit) throw Error('bounded');
      chunks.push(n.value);
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export async function forwardStaff(
  request: Request,
  env: PreviewEnvironment = process.env,
  send: typeof fetch = fetch,
) {
  const c = localPreview(env),
    reply = (status: number, error: string) => Response.json({ error }, { status, headers });
  if (!c || env.LOCAL_STAFF_CONSOLE !== 'enabled') return reply(404, 'not_found');
  const u = new URL(request.url),
    origin = request.headers.get('origin'),
    path = u.pathname.slice('/local-staff-api'.length);
  if (
    request.headers.get('host') !== new URL(c.web).host ||
    (origin !== null && origin !== c.web) ||
    (request.method === 'POST' && origin !== c.web)
  )
    return reply(403, 'forbidden');
  if (
    !u.pathname.startsWith('/local-staff-api/') ||
    !staffProxyPath(path, request.method) ||
    u.search.length > 2048 ||
    new Set(u.searchParams.keys()).size !== [...u.searchParams].length
  )
    return reply(400, 'invalid_input');
  const auth = request.headers.get('authorization');
  if (!auth || !/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) return reply(401, 'unauthenticated');
  try {
    const target = new URL(env.LOCAL_STAFF_API_ORIGIN ?? '');
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
    const body = await bounded(request.body, 65536),
      out = new Headers({
        authorization: auth,
        origin: target.origin,
        'content-type': 'application/json',
      });
    for (const name of ['x-csrf-token', 'idempotency-key', 'x-reviewer-authorization']) {
      const value = request.headers.get(name);
      if (value !== null) {
        if (value.length > 128) throw Error();
        out.set(name, value);
      }
    }
    const response = await send(target.origin + path + u.search, {
      method: request.method,
      headers: out,
      ...(request.method === 'POST' ? { body } : {}),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    const result = await bounded(response.body, 262144);
    return new Response(result, {
      status: response.status,
      headers: { ...headers, 'content-type': 'application/json' },
    });
  } catch {
    return reply(503, 'unavailable');
  }
}
