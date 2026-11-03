import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { listenLocalApi } from '../../../packages/integrations/src/http/server.ts';
import { createHttpApi } from '../../../packages/integrations/src/http/core.ts';
import { ok } from '../../../packages/domain/src/values/core.ts';
import { apiErrorSchema } from '../../../packages/contracts/src/http.ts';
function raw(origin: string) {
  return new Promise<string>((resolve, reject) => {
    const url = new URL(origin),
      socket = createConnection({ host: '127.0.0.1', port: Number(url.port) });
    let data = '';
    socket.setTimeout(8000, () => socket.destroy(Error('Synthetic admission socket timeout')));
    socket.on('error', reject);
    socket.on('data', (b) => {
      data += b.toString();
    });
    socket.on('end', () => resolve(data));
    socket.on('connect', () =>
      socket.write(
        'GET /api/v1/reference HTTP/1.1\r\nHost: ' + url.host + '\r\nConnection: close\r\n\r\n',
      ),
    );
  });
}
async function proveAdmission() {
  let entered = 0,
    release!: () => void,
    full!: () => void;
  const blocked = new Promise<void>((r) => {
      release = r;
    }),
    admitted = new Promise<void>((r) => {
      full = r;
    });
  const server = await listenLocalApi((origin) =>
    createHttpApi({
      origin,
      security: { authenticate: async () => null, quota: async () => ({ allowed: true }) },
      routes: [
        {
          operationId: 'boundedRead',
          method: 'GET',
          path: '/api/v1/reference',
          access: 'public',
          handle: async () => {
            if (++entered === 32) full();
            await blocked;
            return ok({ ready: true });
          },
        },
      ],
    }),
  );
  const pending = Array.from({ length: 32 }, () => raw(server.origin));
  try {
    await Promise.race([
      admitted,
      new Promise((_, reject) => setTimeout(() => reject(Error('Local admission timeout')), 4000)),
    ]);
    const refused = await raw(server.origin),
      body = refused.split('\r\n\r\n')[1]!;
    assert.match(refused, /^HTTP\/1.1 503/);
    assert.ok(refused.includes('retry-after: 1'));
    assert.ok(refused.includes('cache-control: no-store'));
    // Node uses chunked framing; locate the single bounded JSON envelope independently of framing.
    const error = apiErrorSchema.parse(
      JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)),
    );
    assert.equal(error.code, 'unavailable');
    assert.equal(error.retryable, true);
    assert.ok(refused.includes('x-request-id: ' + error.requestId));
  } finally {
    release();
    const done = await Promise.allSettled(pending);
    assert.ok(done.every((x) => x.status === 'fulfilled' && x.value.startsWith('HTTP/1.1 200')));
    const closing = server.close();
    assert.equal(server.close(), closing);
    await closing;
  }
}
await proveAdmission();
console.log(JSON.stringify({ admitted: 32, refused: 1, drained: 32, loopbackOnly: true }));
