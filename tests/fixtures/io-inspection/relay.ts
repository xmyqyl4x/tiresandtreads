import net from 'node:net';
import { readFileSync } from 'node:fs';
import { binding } from '../tls-admission/resources.ts';
import { digest } from '../tls-admission/contract.ts';
import { context, publicPlan } from '../multitarget-coordination/transport.ts';
import { within } from './budget.ts';

type Mode = 'pass' | 'stall-connect' | 'drop-connect' | 'hold-read' | 'drop-read';

// Opaque loopback relay inside the disposable observer. Native pg/TLS uses the
// original canonical host/port; only fixed hosts entries redirect to loopback.
// Upstream is the parent's original private binding, never a caller destination.
export async function relays() {
  const c = context(publicPlan());
  const b = binding(JSON.parse(readFileSync('/binding.json', 'utf8')));
  if (b.project !== c.project || b.fixtureGeneration !== c.generation || b.variant !== 'valid')
    throw Error('I/O private routing refused');
  const controls = [];
  try {
    for (const slot of [0, 1] as const) {
      let mode: Mode = 'pass';
      const sockets = new Set<net.Socket>();
      const counts = {
        accepted: 0,
        upstreamOpened: 0,
        clientBytes: 0,
        withheldBytes: 0,
        upstreamEnded: false,
      };
      const server = net.createServer({ allowHalfOpen: true }, (down) => {
        if (++counts.accepted > 8) return down.destroy();
        sockets.add(down);
        let up: net.Socket | undefined;
        const watchdog = setTimeout(() => {
          down.destroy();
          up?.destroy();
        }, 12000);
        down.on('error', () => {});
        down.on('close', () => {
          clearTimeout(watchdog);
          sockets.delete(down);
          up?.destroy();
        });
        if (!['stall-connect', 'drop-connect'].includes(mode)) {
          counts.upstreamOpened++;
          up = net.createConnection({
            host: b.domains[slot]!.address,
            port: 5432,
            allowHalfOpen: true,
          });
          sockets.add(up);
          up.on('error', () => down.destroy());
          up.on('close', () => {
            sockets.delete(up!);
            down.destroy();
          });
          up.on('drain', () => down.resume());
          up.on('data', (chunk) => {
            if (['hold-read', 'drop-read'].includes(mode)) {
              counts.withheldBytes += chunk.length;
              if (mode === 'drop-read' || counts.withheldBytes > 65536) {
                down.destroy();
                up!.destroy();
              }
            } else if (!down.write(chunk)) up!.pause();
          });
          up.on('end', () => {
            counts.upstreamEnded = true;
            down.end();
          });
        }
        down.on('drain', () => up?.resume());
        down.on('data', (chunk) => {
          counts.clientBytes += chunk.length;
          if (mode === 'drop-connect') down.destroy();
          else if (up && !up.write(chunk)) down.pause();
        });
        down.on('end', () => up?.end());
      });
      await within(
        new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(5432, slot === 0 ? '127.0.0.1' : '127.0.0.2', resolve);
        }),
        750,
      );
      controls.push({
        slot,
        bindingDigest: digest(b),
        counts,
        set(next: Mode) {
          mode = next;
        },
        async stop() {
          const socketClosures = [...sockets].map(
            (socket) =>
              new Promise<void>((resolve) => {
                if (socket.closed) resolve();
                else socket.once('close', () => resolve());
              }),
          );
          const closed = new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
          for (const socket of sockets) socket.destroy();
          await within(Promise.all([closed, ...socketClosures]), 750);
          if (sockets.size) throw Error('I/O relay closure unobserved');
        },
      });
    }
    return controls;
  } catch {
    await Promise.allSettled(controls.map((control) => control.stop()));
    throw Error('Owned I/O relay preparation unavailable');
  }
}
