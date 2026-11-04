import {
  publicCommerceView,
  affiliateView,
  adsTxtView,
} from '../../../../packages/contracts/src/public-commerce.ts';
import { localPreview, type PreviewEnvironment } from '../local-preview.ts';
import { affiliateDestination } from '../../../../packages/domain/src/commercial-policy.ts';
import { commercialPages } from '../../../../packages/domain/src/commercial-presentation.ts';
// Fixed first-party reads only; owner cookies, report parameters and arbitrary destinations never pass.
async function read(path: string, env: PreviewEnvironment, send: typeof fetch) {
  const c = localPreview(env);
  if (!c || env.LOCAL_COMMERCIAL_UI !== 'enabled') throw Error('Commercial preview unavailable');
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(Error('Commercial read deadline exceeded'));
    }, 5000);
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        const r = await send(c.api + '/api/v1/public-commerce/' + path, {
          headers: { origin: c.api },
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          signal: abort.signal,
        });
        if (abort.signal.aborted) throw Error('Commercial read cancelled');
        if (!r.ok) throw Error('Unavailable');
        reader = r.body?.getReader();
        if (!reader) throw Error('Unavailable');
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const n = await reader.read();
          if (n.done) break;
          length += n.value.length;
          if (length > 32768) throw Error('Bound exceeded');
          chunks.push(n.value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        return (
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as { data: unknown }
        ).data;
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    abort.abort();
    void reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}
export async function readCommercialPage(
  path: string,
  env: PreviewEnvironment = process.env,
  send: typeof fetch = fetch,
) {
  if (!commercialPages.has(path)) return undefined;
  try {
    return publicCommerceView.parse(
      await read('inventory?' + new URLSearchParams({ path }), env, send),
    );
  } catch {
    return undefined;
  }
}
const headers = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
};
export async function commerceResponse(
  request: Request,
  kind: 'affiliate' | 'ads-txt',
  key: string = '',
  env: PreviewEnvironment = process.env,
  send: typeof fetch = fetch,
) {
  const c = localPreview(env),
    u = new URL(request.url);
  if (
    !c ||
    request.headers.get('host') !== new URL(c.web).host ||
    !['GET', 'HEAD'].includes(request.method) ||
    u.search
  )
    return new Response('Not found', { status: 404, headers });
  try {
    if (kind === 'affiliate') {
      if (!/^[a-z0-9_]{1,100}$/.test(key)) throw Error();
      const a = affiliateView.parse(await read('affiliate/' + key, env, send));
      if (affiliateDestination(a.destination, new URL(a.destination).origin) !== a.destination)
        throw Error('Invalid destination');
      return new Response(null, { status: 302, headers: { ...headers, location: a.destination } });
    }
    const a = adsTxtView.parse(await read('ads-txt', env, send));
    return new Response(
      a.status === 'ready' ? a.body : '# No approved advertising seller is configured.\n',
      { headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } },
    );
  } catch {
    return new Response(
      kind === 'affiliate'
        ? 'This retailer link is unavailable.'
        : '# No approved advertising seller is configured.\n',
      {
        status: kind === 'affiliate' ? 404 : 200,
        headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' },
      },
    );
  }
}
