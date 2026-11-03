import { z } from 'zod';

export const apiErrorSchema = z.strictObject({
  code: z.string(),
  messageKey: z.string(),
  fieldErrors: z.record(z.string(), z.string()),
  retryable: z.boolean(),
  requestId: z.string().uuid(),
});
export const pageSchema = z.strictObject({
  after: z.string().min(1).max(2048).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const toolInputSchema = z.strictObject({ input: z.unknown() });
export type ApiError = z.infer<typeof apiErrorSchema>;
export type WireValue =
  null | boolean | number | string | WireValue[] | { [key: string]: WireValue };
export interface ApiReply<T> {
  readonly data: T;
  readonly requestId: string;
}
export interface EndpointContract {
  readonly operationId: string;
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly access: 'public' | 'owner' | 'capability' | 'staff' | 'callback';
  readonly command?: boolean;
  readonly bodyMode?: 'json' | 'bytes' | 'form';
  readonly maxBodyBytes?: number;
  readonly successStatuses?: readonly (200 | 201 | 202 | 204 | 302)[];
}
export const sessionContracts = [
  { operationId: 'createOwnerSession', method: 'POST', path: '/api/v1/sessions', access: 'public' },
  {
    operationId: 'getOwnerSession',
    method: 'GET',
    path: '/api/v1/sessions/current',
    access: 'owner',
  },
] as const satisfies readonly EndpointContract[];
// Browser, native-app and AI clients share this transport; credentials stay in the caller's transport.
export function createApiClient(base: string, transport: typeof fetch = fetch) {
  async function perform<T>(
    path: string,
    options: RequestInit,
    allowEmpty: boolean,
  ): Promise<ApiReply<T>> {
    if (!/^\/api\/v1\//.test(path) || path.includes('\\')) throw Error('Invalid API path');
    const url = new URL(path, base);
    if (url.origin !== new URL(base).origin) throw Error('Invalid API origin');
    const response = await transport(url, { ...options, redirect: 'error', cache: 'no-store' });
    if (response.status === 204) {
      const requestId = response.headers.get('x-request-id');
      if (!allowEmpty || !z.string().uuid().safeParse(requestId).success)
        throw Error('Invalid API reply');
      return { data: null as T, requestId: requestId! };
    }
    const value: unknown = await response.json();
    if (!response.ok) throw apiErrorSchema.parse(value);
    return value as ApiReply<T>;
  }
  return {
    request: <T>(path: string, options: RequestInit = {}) => perform<T>(path, options, false),
    requestOptional: <T>(path: string, options: RequestInit = {}) =>
      perform<T | null>(path, options, true),
  };
}
