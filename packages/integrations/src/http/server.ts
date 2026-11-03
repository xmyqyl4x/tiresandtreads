import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';

// Deliberately separate from the production web and worker hosts. No environment flag can bind it publicly.
export async function listenLocalApi(
  factory: (origin: string) => (request: Request, peer: string) => Promise<Response>,
) {
  let active = 0,
    stopping = false;
  const server = createServer(async (incoming, outgoing) => {
    if (stopping || active >= 32) {
      outgoing.writeHead(503, { 'retry-after': '1' });
      outgoing.end();
      return;
    }
    active++;
    try {
      if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) {
        outgoing.writeHead(400);
        outgoing.end();
        return;
      }
      const headers = new Headers();
      for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
        const name = incoming.rawHeaders[i]!,
          value = incoming.rawHeaders[i + 1]!;
        if (headers.has(name) && !['accept', 'accept-encoding'].includes(name.toLowerCase())) {
          outgoing.writeHead(400);
          outgoing.end();
          return;
        }
        headers.append(name, value);
      }
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const init: RequestInit & { duplex?: 'half' } = { method: incoming.method ?? 'GET', headers };
      if (!['GET', 'HEAD'].includes(init.method!)) {
        init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        init.duplex = 'half';
      }
      const result = await handler(
        new Request(origin + incoming.url, init),
        incoming.socket.remoteAddress ?? '',
      );
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(503);
      outgoing.end();
    } finally {
      active--;
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const handler = (() => {
    try {
      return factory(origin);
    } catch (error) {
      server.close();
      throw error;
    }
  })();
  return {
    origin,
    async close() {
      stopping = true;
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    },
  };
}
