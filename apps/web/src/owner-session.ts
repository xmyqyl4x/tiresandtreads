import { createApiClient } from '@tt/contracts/transport';
export async function ownerSession(origin: string, send: typeof fetch = fetch) {
  const api = createApiClient(origin, send);
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
