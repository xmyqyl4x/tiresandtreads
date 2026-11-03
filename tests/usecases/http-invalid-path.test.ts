import { it, expect } from 'vitest';
import { createHttpApi } from '../../packages/integrations/src/http/core.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
it.each(['/api/v1/reference/%ZZ', '/api/v1/%C0/reference', '/api/v1/reference/%E0%A4%A'])(
  'returns bounded invalid-input rather than an outage for malformed path %s',
  async (path) => {
    const api = createHttpApi({
      origin: 'http://127.0.0.1:3210',
      routes: [
        {
          operationId: 'read',
          method: 'GET',
          path: '/api/v1/reference/:id',
          access: 'public',
          handle: async () => ok(null),
        },
      ],
      security: { authenticate: async () => null, quota: async () => ({ allowed: true }) },
    });
    const r = await api(new Request('http://127.0.0.1:3210' + path), '127.0.0.1');
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ code: 'invalid_input', retryable: false });
  },
);
