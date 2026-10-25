import { createRuntime } from '../../packages/integrations/src/runtime.ts';
import { startWorker } from '../../packages/integrations/src/worker-server.ts';
// Owning S3 service cards supply reviewed SQL job handlers. No product work is enabled by default.
try {
  const runtime = await createRuntime(process.env, () => ({}), {
    record: (event) => console.log(JSON.stringify({ event })),
  });
  const port = Number(process.env.WORKER_PORT ?? 8123),
    origin = process.env.WORKER_ORIGIN;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !origin) {
    await runtime.shutdown();
    throw Error('Invalid worker listener');
  }
  const worker = await startWorker(runtime, port, origin);
  const shutdown = () => {
    void worker
      .stop()
      .then(() => {
        process.exitCode = 0;
      })
      .catch(() => {
        process.exitCode = 1;
      });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch {
  console.error('Worker unavailable');
  process.exitCode = 1;
}
