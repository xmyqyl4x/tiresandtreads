import { createLocalServiceHost } from '../../packages/integrations/src/service-host.ts';
import { startWorker } from '../../packages/integrations/src/worker-server.ts';
try {
  const command = process.argv[2] ?? 'check';
  if (!['check', 'run'].includes(command)) throw Error();
  const port = Number(process.env.WORKER_PORT ?? 8123),
    origin = process.env.WORKER_ORIGIN;
  if (command === 'run') {
    if (!origin || !Number.isInteger(port) || port < 1024 || port > 65535) throw Error();
    const u = new URL(origin);
    if (
      u.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', 'test', 'service-host'].includes(u.hostname) ||
      Number(u.port) !== port ||
      u.username ||
      u.password ||
      u.pathname !== '/' ||
      u.search ||
      u.hash
    )
      throw Error();
  }
  const host = await createLocalServiceHost(process.env);
  try {
    if (command === 'check') {
      console.log(JSON.stringify(host.metadata));
      await host.shutdown();
    } else {
      const worker = await startWorker(host, port, origin!);
      console.log(JSON.stringify(host.metadata));
      const stop = () => {
        void worker
          .stop()
          .then(() => {
            process.exitCode = 0;
          })
          .catch(() => {
            process.exitCode = 1;
          });
      };
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
    }
  } catch {
    await host.shutdown();
    throw Error();
  }
} catch {
  console.error('Local service host unavailable');
  process.exitCode = 1;
}
