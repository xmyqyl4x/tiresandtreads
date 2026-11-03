import { strictObject, unknown, uuid } from 'zod/mini';
import { apiErrorSchema } from './http-views.ts';
export interface ApiReply<T> {
  readonly data: T;
  readonly requestId: string;
}
// Browser, native-app and AI clients share this transport; credentials stay in the caller's transport.
export function createApiClient(base: string, transport: typeof fetch = fetch) {
  async function perform<T>(
    path: string,
    options: RequestInit,
    allowEmpty: boolean,
  ): Promise<ApiReply<T>> {
    if (!/^\/api\/v1\//.test(path) || path.includes('\\')) throw Error('Invalid API path');
    let origin: URL;
    try {
      origin = new URL(base);
    } catch {
      throw Error('Invalid API origin');
    }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)
      throw Error('Invalid API origin');
    const url = new URL(path, origin);
    if (url.origin !== origin.origin) throw Error('Invalid API origin');
    if (!url.pathname.startsWith('/api/v1/') || url.hash) throw Error('Invalid API path');
    const response = await transport(url, { ...options, redirect: 'error', cache: 'no-store' });
    if (response.status === 204) {
      const requestId = response.headers.get('x-request-id');
      if (!allowEmpty || !uuid().safeParse(requestId).success) throw Error('Invalid API reply');
      return { data: null as T, requestId: requestId! };
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw Error('Invalid API reply');
    }
    if (!response.ok) throw apiErrorSchema.parse(value);
    const parsed = strictObject({ data: unknown(), requestId: uuid() }).safeParse(value);
    if (!parsed.success || !Object.hasOwn(parsed.data, 'data')) throw Error('Invalid API reply');
    return parsed.data as ApiReply<T>;
  }
  return {
    request: <T>(path: string, options: RequestInit = {}) => perform<T>(path, options, false),
    requestOptional: <T>(path: string, options: RequestInit = {}) =>
      perform<T | null>(path, options, true),
  };
}
