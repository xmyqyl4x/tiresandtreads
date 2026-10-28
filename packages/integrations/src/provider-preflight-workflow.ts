import { Inngest } from 'inngest';
import { serve } from 'inngest/edge';
import { localProviderProject } from '../../config/src/provider-preflight.ts';
import { boundedIO } from './bounded-io.ts';
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const url = 'http://test:8124/internal/preflight-inngest?probe=trust';

// In-process SDK authentication probe only: no listener, functions, sync or outbound requests.
export function createLocalSignaturePreflight(
  env: Readonly<Record<string, string | undefined>>,
  signingKey: string,
) {
  let project: string;
  try {
    project = localProviderProject(env);
    if (!/^signkey-test-[a-f0-9]{64}$/.test(signingKey)) throw Error();
  } catch {
    throw Error('Invalid local signature preflight');
  }
  const client = new Inngest({
    id: 'provider-preflight-' + project.slice(8),
    isDev: false,
    signingKey,
    // Do not inherit a workstation/provider fallback signing authority.
    signingKeyFallback: signingKey,
    baseUrl: 'http://inngest:8288',
    logger: silent,
    internalLogger: silent,
    fetch: async () => {
      throw Error('Local signature preflight network disabled');
    },
  });
  const handler = serve({
    client,
    functions: [],
    serveOrigin: 'http://test:8124',
    servePath: '/internal/preflight-inngest',
    streaming: false,
  });
  const result = (status: number) =>
    new Response(JSON.stringify({ scope: 'local-fixture', verified: status === 200 }), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  return async (request: Request): Promise<Response> => {
    if (request.url !== url || request.method !== 'POST') return result(404);
    if (Number(request.headers.get('content-length') ?? 0) > 8192) return result(413);
    try {
      return await boundedIO(async (signal) => {
        const reader = request.body?.getReader();
        if (!reader) return result(400);
        const parts: Uint8Array[] = [];
        let size = 0;
        const cancel = () => {
          void reader.cancel().catch(() => {});
        };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          for (;;) {
            const r = await reader.read();
            if (r.done) break;
            size += r.value.length;
            if (size > 8192) return result(413);
            parts.push(r.value);
          }
        } finally {
          signal.removeEventListener('abort', cancel);
          await reader.cancel().catch(() => {});
        }
        if (signal.aborted) return result(503);
        const headers = new Headers(request.headers);
        headers.set('host', 'test:8124');
        const response = await handler(
          new Request(url, {
            method: 'POST',
            headers,
            body: Buffer.concat(parts),
            signal,
          }),
        );
        await response.body?.cancel();
        return result(response.status === 200 ? 200 : response.status === 401 ? 401 : 400);
      });
    } catch {
      return result(503);
    }
  };
}
