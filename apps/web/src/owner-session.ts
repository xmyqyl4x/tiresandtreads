import { createApiClient } from '@tt/contracts/transport';
type Session = { csrf: string };
const browserKey = Symbol.for('tt.pending-owner-session.v1');
const isolated = new Map<string, Promise<Session>>();
export function ownerSession(origin: string, send: typeof fetch = fetch) {
  // Both independently bundled entry points share only the in-flight promise, never a cached token.
  const browser = globalThis as unknown as { [key: symbol]: Map<string, Promise<Session>> };
  const pending = typeof window === 'undefined' ? isolated : (browser[browserKey] ??= new Map());
  const key = new URL(origin).origin;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = initialize(origin, send).finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  return request;
}
async function initialize(origin: string, send: typeof fetch): Promise<Session> {
  const bounded: typeof fetch = (url, options) =>
    send(url, { ...options, signal: options?.signal ?? AbortSignal.timeout(15000) });
  const api = createApiClient(origin, bounded);
  let reply;
  try {
    reply = await api.request<{ csrf: string }>('/api/v1/sessions/current', {
      credentials: 'same-origin',
    });
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'unauthorized')
      throw error;
    reply = await api.request<{ csrf: string }>('/api/v1/sessions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
  }
  if (!/^[a-f0-9]{64}$/.test(reply.data.csrf)) throw Error('Invalid session reply');
  return reply.data;
}
