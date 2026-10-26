import { createServer } from 'node:http';
import { once } from 'node:events';
import { serve } from 'inngest/node';
import type { createRuntime } from './runtime.ts';
export async function startWorker(
  runtime: Pick<Awaited<ReturnType<typeof createRuntime>>, 'workflows' | 'shutdown'> & {
    readonly ready?: () => Promise<boolean>;
  },
  port: number,
  origin: string,
) {
  const callback = serve({
    client: runtime.workflows.client,
    functions: runtime.workflows.functions,
    serveOrigin: origin,
    servePath: '/internal/inngest',
  });
  let stopping = false;
  const server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 3000 },
    (req, res) => {
      const path = new URL(req.url ?? '/', origin).pathname;
      res.setHeader('Cache-Control', 'no-store');
      if (stopping) {
        res.writeHead(503).end();
        return;
      }
      if (path === '/health/ready' && req.method === 'GET') {
        const finish = (value: boolean) => {
          const ready = value && !stopping;
          res
            .writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ ready }));
        };
        void Promise.resolve()
          .then(() => runtime.ready?.() ?? true)
          .then(finish, () => finish(false));
        return;
      }
      if (path !== '/internal/inngest') {
        res.writeHead(404).end();
        return;
      }
      if (Number(req.headers['content-length']) > 65536) {
        res.writeHead(413, { Connection: 'close' }).end();
        return;
      }
      let size = 0;
      // Count emitted bytes without starting flowing mode before the SDK attaches its reader.
      const emit = req.emit.bind(req);
      req.emit = (event: string | symbol, ...args: unknown[]) => {
        if (event === 'data' && Buffer.isBuffer(args[0])) {
          size += args[0].length;
          if (size > 65536) {
            req.destroy();
            return false;
          }
        }
        return emit(event, ...args);
      };
      void Promise.resolve(callback(req, res)).catch(() => {
        if (!res.headersSent) res.writeHead(503);
        res.end();
      });
    },
  );
  server.keepAliveTimeout = 1000;
  server.listen(port, '0.0.0.0');
  await once(server, 'listening');
  let shutdown: Promise<void> | undefined;
  return {
    server,
    stop() {
      stopping = true;
      return (shutdown ??= (async () => {
        const timer = setTimeout(() => server.closeAllConnections(), 5000);
        try {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        } finally {
          clearTimeout(timer);
          await runtime.shutdown();
        }
      })());
    },
  };
}
