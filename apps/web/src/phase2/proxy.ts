import { localPreview, type PreviewEnvironment } from '../local-preview.ts';
import { partnerApiContracts } from '../../../../packages/contracts/src/phase2-partners.ts';
import { p2Uuid } from '../../../../packages/contracts/src/phase2-wire.ts';
const privateHeaders = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};
export function p2ProxyContract(path: string, method: string) {
  const parts = path.split('/');
  return (
    partnerApiContracts.find(
      (c) =>
        c.method === method &&
        c.path.split('/').length === parts.length &&
        c.path
          .split('/')
          .every((p, i) =>
            p.startsWith(':') ? p2Uuid.safeParse(parts[i]).success : p === parts[i],
          ),
    ) ?? null
  );
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
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) throw new RangeError('body_limit');
      chunks.push(next.value);
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export async function forwardP2(
  request: Request,
  env: PreviewEnvironment = process.env,
  send: typeof fetch = fetch,
) {
  const c = localPreview(env);
  const refuse = (status: number, code: string) =>
    Response.json(
      {
        code,
        messageKey: 'errors.' + code,
        fieldErrors: {},
        retryable: status === 503,
        requestId: crypto.randomUUID(),
      },
      { status, headers: privateHeaders },
    );
  if (!c || env.LOCAL_P2_UI !== 'enabled') return refuse(404, 'not_found');
  const u = new URL(request.url),
    origin = request.headers.get('origin');
  if (
    request.headers.get('host') !== new URL(c.web).host ||
    (origin !== null && origin !== c.web) ||
    (request.method !== 'GET' && origin !== c.web)
  )
    return refuse(403, 'forbidden');
  const path = u.pathname.slice('/local-p2-api'.length),
    contract = p2ProxyContract(path, request.method);
  if (
    !u.pathname.startsWith('/local-p2-api/') ||
    !contract ||
    u.search.length > 2048 ||
    new Set(u.searchParams.keys()).size !== [...u.searchParams].length ||
    request.headers.has('content-encoding')
  )
    return refuse(400, 'invalid_input');
  const auth = request.headers.get('authorization');
  if (!auth || !/^Bearer [A-Za-z0-9_-]{16,128}$/.test(auth)) return refuse(401, 'unauthorized');
  let body: Uint8Array;
  try {
    body = await bounded(
      request.body,
      request.method === 'GET' ? 0 : (contract.maxBodyBytes ?? 262144),
    );
  } catch (e) {
    return refuse(
      e instanceof RangeError ? 413 : 503,
      e instanceof RangeError ? 'invalid_input' : 'unavailable',
    );
  }
  try {
    const target = new URL(env.LOCAL_P2_API_ORIGIN ?? '');
    if (
      target.protocol !== 'http:' ||
      target.hostname !== '127.0.0.1' ||
      Number(target.port) < 1024 ||
      target.origin === c.web ||
      target.username ||
      target.password ||
      target.pathname !== '/' ||
      target.search ||
      target.hash
    )
      throw Error();
    const headers = new Headers({ authorization: auth, origin: target.origin });
    for (const name of ['x-csrf-token', 'idempotency-key', 'content-type']) {
      const value = request.headers.get(name);
      if (value !== null) {
        if (value.length > 2048) throw Error();
        headers.set(name, value);
      }
    }
    const response = await send(target.origin + path + u.search, {
      method: request.method,
      headers,
      ...(request.method === 'GET' ? {} : { body: Uint8Array.from(body).buffer }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const bytes = await bounded(response.body, 2097152);
    return new Response(bytes, {
      status: response.status,
      headers: { ...privateHeaders, 'content-type': 'application/json' },
    });
  } catch {
    return refuse(503, 'unavailable');
  }
}
