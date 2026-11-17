import { createInterface } from 'node:readline';
import { openDurableHost } from './durable-host.ts';
const emit = (state: string, details: Record<string, unknown> = {}) =>
  process.stdout.write('P2_LOCAL_RUNTIME_CONTROL ' + JSON.stringify({ state, ...details }) + '\n');
let host: Awaited<ReturnType<typeof openDurableHost>> | undefined;
try {
  if (process.argv.length !== 3) throw Error('Fixed local child protocol required');
  host = await openDurableHost(process.argv[2]!, () => emit('provider-started'));
  emit('ready', { pid: process.pid, metadata: host.metadata });
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (line === 'tick') {
      const result = await host.tick();
      emit('ticked', { result });
    } else if (line === 'stop') {
      await host.shutdown();
      input.close();
      process.stdin.destroy();
      emit('stopped');
      break;
    } else throw Error('Fixed local child protocol required');
  }
} catch {
  emit('failed');
  process.exitCode = 1;
} finally {
  await host?.shutdown();
}
