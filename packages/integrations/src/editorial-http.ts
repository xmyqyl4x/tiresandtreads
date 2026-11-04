import {
  editorialCommandSchema,
  redirectEditorCommandSchema,
} from '../../contracts/src/editorial-client.ts';
import { parseRedirectCsv } from './redirect-csv.ts';
import type { createEditorialService } from '../../application/src/services/editorial.ts';
export function editorialHttp(d: {
  readonly origin: string;
  readonly service: ReturnType<typeof createEditorialService>;
}) {
  const origin = new URL(d.origin);
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    !origin.port ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw Error('Local editorial origin refused');
  const headers = {
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  };
  let active = 0;
  return async (request: Request) => {
    const reply = (status: number, value: unknown) => Response.json(value, { status, headers });
    const url = new URL(request.url),
      source = request.headers.get('origin'),
      credential = request.headers.get('authorization');
    if (
      request.headers.get('host') !== origin.host ||
      url.origin !== origin.origin ||
      url.pathname !== '/local-editorial/api' ||
      (source !== null && source !== origin.origin) ||
      (request.method === 'POST' && source !== origin.origin)
    )
      return reply(403, { error: 'forbidden' });
    if (!['GET', 'POST'].includes(request.method))
      return reply(405, { error: 'method_not_allowed' });
    if (!credential || !/^Bearer [A-Za-z0-9_-]{43}$/.test(credential))
      return reply(401, { error: 'unauthenticated' });
    if (active >= 4) return reply(503, { error: 'unavailable' });
    active++;
    try {
      let data: unknown;
      if (request.method === 'GET') {
        if (
          [...url.searchParams].some(([k]) => !['id', 'identity', 'redirects'].includes(k)) ||
          [...url.searchParams].length > 1 ||
          (url.searchParams.has('identity') && url.searchParams.get('identity') !== '1') ||
          (url.searchParams.has('redirects') && url.searchParams.get('redirects') !== '1')
        )
          throw Error('invalid_input');
        data = url.searchParams.has('redirects')
          ? await d.service.redirects(credential.slice(7))
          : url.searchParams.has('identity')
            ? await d.service.identity(credential.slice(7))
            : url.searchParams.has('id')
              ? await d.service.read(credential.slice(7), url.searchParams.get('id')!)
              : await d.service.list(credential.slice(7));
      } else {
        if (url.search || request.headers.get('content-type')?.split(';')[0] !== 'application/json')
          throw Error('invalid_input');
        const reader = request.body?.getReader();
        if (!reader) throw Error('invalid_input');
        let bytes = 0;
        const chunks: Uint8Array[] = [];
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error('invalid_input')), 5000);
        });
        try {
          while (true) {
            const next = await Promise.race([reader.read(), deadline]);
            if (next.done) break;
            bytes += next.value.length;
            if (bytes > 65536) throw Error('invalid_input');
            chunks.push(next.value);
          }
        } finally {
          clearTimeout(timer);
          void reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
        const joined = new Uint8Array(bytes);
        let offset = 0;
        for (const b of chunks) {
          joined.set(b, offset);
          offset += b.length;
        }
        const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined)) as {
          action?: unknown;
        };
        if (body?.action === 'redirects') {
          const input = redirectEditorCommandSchema.parse(body);
          let rules;
          try {
            rules = parseRedirectCsv(input.csv);
          } catch {
            throw Error('invalid_input');
          }
          data = await d.service.publishRedirects(credential.slice(7), input.reviewerCredential, {
            revision: input.revision,
            issuedAt: input.issuedAt,
            expiresAt: input.expiresAt,
            rules,
          });
        } else
          data = await d.service.execute(credential.slice(7), editorialCommandSchema.parse(body));
      }
      return reply(200, { data });
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      const known = [
        'forbidden',
        'conflict',
        'not_found',
        'unauthenticated',
        'invalid_input',
      ].includes(message);
      const code = known
        ? message
        : e instanceof SyntaxError || (e instanceof Error && e.name === 'ZodError')
          ? 'invalid_input'
          : 'unavailable';
      return reply(
        code === 'forbidden'
          ? 403
          : code === 'conflict'
            ? 409
            : code === 'not_found'
              ? 404
              : code === 'unauthenticated'
                ? 401
                : code === 'invalid_input'
                  ? 400
                  : 503,
        { error: code },
      );
    } finally {
      active--;
    }
  };
}
