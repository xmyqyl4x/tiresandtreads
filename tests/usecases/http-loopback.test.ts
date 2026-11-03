import { it, expect } from 'vitest';
import { listenLocalApi } from '../../packages/integrations/src/http/server.ts';
import { createHttpApi } from '../../packages/integrations/src/http/core.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
import { http, passthrough } from 'msw';
import { fixtureServer } from '../setup.ts';
import { createConnection } from 'node:net';
it('serves only a loopback listener and completes a real HTTP response before draining', async () => {
  const server = await listenLocalApi((origin) =>
    createHttpApi({
      origin,
      routes: [
        {
          operationId: 'read',
          method: 'GET',
          path: '/api/v1/reference',
          access: 'public',
          handle: async () => ok({ coverage: 'unavailable' }),
        },
      ],
      security: { authenticate: async () => null, quota: async () => ({ allowed: true }) },
    }),
  );
  fixtureServer.use(http.all(server.origin + '/*', () => passthrough()));
  try {
    const result = await fetch(server.origin + '/api/v1/reference');
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ data: { coverage: 'unavailable' } });
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({
        host: '127.0.0.1',
        port: Number(new URL(server.origin).port),
      });
      let value = '';
      socket.setTimeout(2000, () => socket.destroy(Error('Local test timeout')));
      socket.on('error', reject);
      socket.on('data', (b) => {
        value += b.toString();
      });
      socket.on('end', () => resolve(value));
      socket.on('connect', () =>
        socket.write(
          'GET /api/v1/reference HTTP/1.1\r\nHost: evil.invalid\r\nConnection: close\r\n\r\n',
        ),
      );
    });
    expect(raw).toMatch(/^HTTP\/1.1 403/);
  } finally {
    await server.close();
  }
  await expect(fetch(server.origin + '/api/v1/reference')).rejects.toThrow();
});
