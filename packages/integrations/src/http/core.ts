import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { EndpointContract } from '../../../contracts/src/http.ts';
import type { KeyDigest } from '../../../application/src/ports/private-records.ts';
import type { Id, Result } from '../../../domain/src/values/core.ts';
import type { ApplicationFailure } from '../../../application/src/ports/transactions.ts';

export interface HttpActor {
  readonly keys: readonly KeyDigest[];
  readonly csrf: string;
  readonly csrfAliases?: readonly string[];
  readonly staff?: Id<'staff'>;
  readonly mfaAt?: number;
  readonly partner?: Readonly<{ handle: string; subject: string }>;
}
export interface HttpContext {
  readonly request: Request;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
  readonly actor: HttpActor | null;
  readonly key: string;
  readonly peer: string;
  readonly responseHeaders: Headers;
}
export interface HttpRoute extends EndpointContract {
  readonly handle: (context: HttpContext) => Promise<Result<unknown, ApplicationFailure>>;
}
export interface HttpSecurity {
  authenticate(request: Request): Promise<HttpActor | null>;
  quota(
    peer: string,
    operation: string,
  ): Promise<Readonly<{ allowed: boolean; retryAfterSeconds?: number }>>;
}
export class PrivateDownload {
  readonly bytes: Uint8Array;
  readonly mime: string;
  constructor(bytes: Uint8Array, mime: string) {
    this.bytes = bytes;
    this.mime = mime;
  }
}
export class HttpSuccess {
  readonly status: 201 | 202 | 204;
  readonly data: unknown;
  constructor(status: 201 | 202 | 204, data: unknown = null) {
    if (![201, 202, 204].includes(status) || (status === 204 && data !== null))
      throw Error('Invalid HTTP success');
    this.status = status;
    this.data = data;
  }
}
export class HttpRedirect {
  readonly location: string;
  constructor(location: string) {
    const url = new URL(location);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw Error('Invalid HTTP redirect');
    this.location = url.toString();
  }
}
export interface HttpObservation {
  readonly operationId: string;
  readonly method: string;
  readonly status: number;
  readonly requestId: string;
  readonly durationMs: number;
}
export class HttpFailure extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const statuses: Readonly<Record<string, number>> = {
  invalid_input: 400,
  not_found: 404,
  forbidden: 404,
  conflict: 409,
  unavailable: 503,
  timeout: 503,
  commit_unknown: 503,
};
export function createHttpApi(d: {
  readonly origin: string;
  readonly routes: readonly HttpRoute[];
  readonly security: HttpSecurity;
  readonly now?: () => number;
  readonly observe?: (record: HttpObservation) => void;
}) {
  const origin = new URL(d.origin);
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    origin.pathname !== '/' ||
    origin.username ||
    origin.password
  )
    throw Error('Local HTTP requires a loopback origin');
  if (new Set(d.routes.map((r) => r.method + ' ' + r.path)).size !== d.routes.length)
    throw Error('Duplicate HTTP route');
  for (const route of d.routes) {
    const mode = route.bodyMode ?? 'json',
      limit = route.maxBodyBytes ?? (mode === 'form' ? 8192 : 65536);
    if (
      !['json', 'bytes', 'form'].includes(mode) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > (mode === 'form' ? 8192 : mode === 'bytes' ? 16777216 : 65536) ||
      (route.bodyContentType !== undefined && mode !== 'bytes')
    )
      throw Error('Invalid HTTP body declaration');
  }
  const routes = d.routes.map((route) => ({ route, parts: route.path.split('/') }));
  let binaryActive = 0;
  return async function handle(request: Request, peer = '127.0.0.1'): Promise<Response> {
    let binaryAdmitted = false;
    const requestId = randomUUID();
    const started = performance.now();
    let observedOperation = 'unmatched',
      observedMethod = 'OTHER',
      observedStatus = 503;
    const headers = new Headers({
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-request-id': requestId,
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    });
    const reply = (status: number, value: unknown) => {
      observedStatus = status;
      return new Response(
        JSON.stringify(value, (_key, item: unknown) =>
          typeof item === 'bigint' ? item.toString() : item,
        ),
        { status, headers },
      );
    };
    const error = (status: number, code: string, retryable = false) =>
      reply(status, {
        code,
        messageKey: 'errors.' + code,
        fieldErrors: {},
        retryable,
        requestId,
      });
    try {
      const url = new URL(request.url);
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) || url.origin !== origin.origin)
        throw new HttpFailure(403, 'forbidden');
      if (request.headers.has('host') && request.headers.get('host') !== origin.host)
        throw new HttpFailure(403, 'forbidden');
      if (url.search.length > 4096 || /%2f|%5c|\\/i.test(url.pathname))
        throw new HttpFailure(400, 'invalid_input');
      let parts: string[];
      try {
        parts = url.pathname.split('/').map((p) => decodeURIComponent(p));
      } catch {
        throw new HttpFailure(400, 'invalid_input');
      }
      const matching = routes.filter(
        (r) =>
          r.parts.length === parts.length &&
          r.parts.every((p, i) => (p.startsWith(':') ? !!parts[i] : p === parts[i])),
      );
      if (!matching.length) throw new HttpFailure(404, 'not_found');
      const matched = matching.find((r) => r.route.method === request.method);
      if (!matched) {
        headers.set('allow', [...new Set(matching.map((r) => r.route.method))].join(', '));
        throw new HttpFailure(405, 'method_not_allowed');
      }
      const { route } = matched;
      observedOperation = route.operationId;
      observedMethod = route.method;
      if (new Set(url.searchParams.keys()).size !== [...url.searchParams.keys()].length)
        throw new HttpFailure(400, 'invalid_input');
      if ([...url.searchParams.keys()].some((k) => /^(token|email|owner|session)$/i.test(k)))
        throw new HttpFailure(400, 'invalid_input');
      const mutation = request.method !== 'GET';
      const ownerCookie = request.headers
        .get('cookie')
        ?.split(';')
        .some((value) => value.trim().startsWith('tt_owner='));
      if (route.access === 'owner' && request.headers.has('authorization') && ownerCookie)
        throw new HttpFailure(400, 'ambiguous_credentials');
      if (
        mutation &&
        route.access !== 'callback' &&
        request.headers.get('origin') !== origin.origin
      )
        throw new HttpFailure(403, 'forbidden');
      const actor =
        route.access === 'owner' || route.access === 'staff' || route.access === 'partner'
          ? await d.security.authenticate(request)
          : null;
      if (['owner', 'staff', 'partner'].includes(route.access) && !actor)
        throw new HttpFailure(401, 'unauthorized');
      if (route.access === 'partner' && !actor?.partner) throw new HttpFailure(401, 'unauthorized');
      if (
        route.access === 'staff' &&
        (!actor?.staff ||
          !actor.mfaAt ||
          (d.now?.() ?? Date.now()) - actor.mfaAt > 300000 ||
          actor.mfaAt > (d.now?.() ?? Date.now()))
      )
        throw new HttpFailure(403, 'forbidden');
      const suppliedCsrf = request.headers.get('x-csrf-token');
      const csrfAllowed =
        actor &&
        suppliedCsrf !== null &&
        (actor.csrfAliases ?? [actor.csrf]).some(
          (value) =>
            Buffer.byteLength(value) === Buffer.byteLength(suppliedCsrf) &&
            timingSafeEqual(Buffer.from(value), Buffer.from(suppliedCsrf)),
        );
      if (mutation && actor && !csrfAllowed) throw new HttpFailure(403, 'forbidden');
      const key = request.headers.get('idempotency-key') ?? '';
      if (route.command && !/^[A-Za-z0-9_-]{16,100}$/.test(key))
        throw new HttpFailure(400, 'invalid_input');
      const quota = await d.security.quota(peer, route.operationId);
      if (!quota.allowed) {
        headers.set(
          'retry-after',
          String(Math.min(3600, Math.max(1, quota.retryAfterSeconds ?? 60))),
        );
        throw new HttpFailure(429, 'rate_limited');
      }
      let body: unknown = null;
      if (mutation) {
        const mode = route.bodyMode ?? 'json',
          limit = route.maxBodyBytes ?? (mode === 'form' ? 8192 : 65536);
        if (mode === 'bytes' && route.bodyContentType === 'application/octet-stream') {
          if (binaryActive >= 2) {
            headers.set('retry-after', '1');
            throw new HttpFailure(429, 'rate_limited');
          }
          binaryActive++;
          binaryAdmitted = true;
        }
        if (
          request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
          (route.bodyContentType ??
            (mode === 'form' ? 'application/x-www-form-urlencoded' : 'application/json'))
        )
          throw new HttpFailure(415, 'unsupported_media_type');
        const length = request.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || Number(length) > limit))
          throw new HttpFailure(413, 'body_too_large');
        const reader = request.body?.getReader();
        if (reader) {
          const chunks: Uint8Array[] = [];
          let total = 0;
          try {
            while (true) {
              const next = await reader.read();
              if (next.done) break;
              total += next.value.byteLength;
              if (total > limit) {
                await reader.cancel();
                throw new HttpFailure(413, 'body_too_large');
              }
              chunks.push(next.value);
            }
          } finally {
            reader.releaseLock();
          }
          const raw = Buffer.concat(chunks);
          try {
            if (mode === 'bytes') body = new Uint8Array(raw);
            else {
              const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
              if (mode === 'json') body = JSON.parse(text);
              else {
                const pairs = text
                  .split('&')
                  .filter(Boolean)
                  .map((entry) => {
                    const index = entry.indexOf('=');
                    if (index < 0) throw Error('Invalid form');
                    return [entry.slice(0, index), entry.slice(index + 1)].map((value) =>
                      decodeURIComponent(value.replaceAll('+', ' ')),
                    ) as [string, string];
                  });
                if (pairs.length > 8 || new Set(pairs.map(([key]) => key)).size !== pairs.length)
                  throw Error('Invalid form');
                body = Object.fromEntries(pairs);
              }
            }
          } catch {
            throw new HttpFailure(400, 'invalid_input');
          }
        } else throw new HttpFailure(400, 'invalid_input');
      }
      const params = Object.fromEntries(
        matched.parts.flatMap((p, i) => (p.startsWith(':') ? [[p.slice(1), parts[i]!]] : [])),
      );
      const result = await route.handle({
        request,
        params,
        query: url.searchParams,
        body,
        actor,
        key,
        peer,
        responseHeaders: headers,
      });
      if (!result.ok)
        return error(
          statuses[result.error.code] ?? 500,
          result.error.code === 'forbidden' ? 'not_found' : result.error.code,
          result.error.retryable,
        );
      if (result.value instanceof PrivateDownload) {
        if (result.value.mime !== 'application/pdf' || result.value.bytes.byteLength > 10485760)
          throw new HttpFailure(503, 'unavailable');
        headers.set('content-type', 'application/pdf');
        headers.set('content-disposition', 'attachment; filename="tire-report.pdf"');
        observedStatus = 200;
        return new Response(Buffer.from(result.value.bytes), { status: 200, headers });
      }
      if (result.value instanceof HttpRedirect) {
        observedStatus = 302;
        headers.set('location', result.value.location);
        return new Response(null, { status: 302, headers });
      }
      if (result.value instanceof HttpSuccess) {
        if (result.value.status === 204) {
          observedStatus = 204;
          return new Response(null, { status: 204, headers });
        }
        return reply(result.value.status, { data: result.value.data, requestId });
      }
      return reply(200, { data: result.value, requestId });
    } catch (cause) {
      if (cause instanceof HttpFailure)
        return error(cause.status, cause.code, cause.status === 429);
      if (cause instanceof URIError) return error(400, 'invalid_input');
      // Never expose raw SQL, tokens, provider exceptions or supplied request identifiers.
      return error(503, 'unavailable', true);
    } finally {
      if (binaryAdmitted) binaryActive--;
      try {
        void Promise.resolve(
          d.observe?.({
            operationId: observedOperation,
            method: observedMethod,
            status: observedStatus,
            requestId,
            durationMs: Math.min(60000, Math.max(0, Math.round(performance.now() - started))),
          }),
        ).catch(() => {});
      } catch {
        /* Observation cannot change a committed HTTP outcome. */
      }
    }
  };
}
