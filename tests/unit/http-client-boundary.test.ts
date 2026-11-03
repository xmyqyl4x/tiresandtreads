import { it, expect, vi } from 'vitest';
import { createApiClient } from '../../packages/contracts/src/http.ts';
const uuid = '11111111-1111-4111-8111-111111111111';
it.each([
  '/api/v1/../../private',
  '/api/v1/%2e%2e/%2e%2e/private',
  '/api/v1/reports/../../../health/live',
  '/api/v1/reference#private',
])('refuses namespace escaping or fragment-bearing API path %s before transport', async (path) => {
  const send = vi.fn(async () => new Response(JSON.stringify({ data: null, requestId: uuid }))),
    api = createApiClient('http://127.0.0.1:3210', send as typeof fetch);
  await expect(api.request(path)).rejects.toThrow('Invalid API path');
  expect(send).not.toHaveBeenCalled();
});
it.each(['file:///', 'ftp://example.invalid/', 'http://user:secret@127.0.0.1:3210'])(
  'refuses a non-HTTP or credential-bearing API base %s',
  async (base) => {
    const send = vi.fn(async () => new Response(JSON.stringify({ data: null, requestId: uuid }))),
      api = createApiClient(base, send as typeof fetch);
    await expect(api.request('/api/v1/reference')).rejects.toThrow('Invalid API origin');
    expect(send).not.toHaveBeenCalled();
  },
);
it.each([
  { data: null, requestId: 'not-a-server-id' },
  { data: null, requestId: uuid, debug: 'private' },
  { requestId: uuid },
])(
  'refuses malformed success envelopes instead of returning an unchecked client result',
  async (value) => {
    const api = createApiClient(
      'http://127.0.0.1:3210',
      async () => new Response(JSON.stringify(value)),
    );
    await expect(api.request('/api/v1/reference')).rejects.toThrow('Invalid API reply');
  },
);
