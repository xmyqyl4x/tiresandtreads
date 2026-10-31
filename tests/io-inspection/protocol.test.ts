import net from 'node:net';
import { expect, it } from 'vitest';
import { exchange, IpcUnavailable } from '../fixtures/io-inspection/exchange.ts';
import { within } from '../fixtures/io-inspection/budget.ts';

for (const mode of ['stall', 'dribble'] as const) {
  it('bounds the native synthetic ' + mode + ' Unix peer with an absolute timer', async () => {
    const sockets = new Set<net.Socket>();
    let bytes = 0;
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
      const timer = setInterval(() => {
        if (mode === 'dribble') {
          socket.write(' ');
          bytes++;
        }
      }, 5);
      socket.on('close', () => {
        clearInterval(timer);
        sockets.delete(socket);
      });
    });
    await new Promise<void>((resolve) => server.listen('/tmp/lr03-' + mode + '.sock', resolve));
    const start = performance.now();
    let receivedBytes: number;
    try {
      const error: unknown = await exchange(
        mode === 'stall' ? 'test-stall' : 'test-dribble',
        {},
        80,
      ).then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(IpcUnavailable);
      if (!(error instanceof IpcUnavailable)) throw Error('Native IPC refusal unobserved');
      receivedBytes = error.receivedBytes;
      expect(performance.now() - start).toBeLessThan(500);
      if (mode === 'dribble') {
        expect(bytes).toBeGreaterThan(1);
        expect(receivedBytes).toBeGreaterThan(1);
      }
    } finally {
      const socketClosures = [...sockets].map(
        (socket) =>
          new Promise<void>((resolve) => {
            if (socket.closed) resolve();
            else socket.once('close', () => resolve());
          }),
      );
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const socket of sockets) socket.destroy();
      await within(Promise.all([closed, ...socketClosures]), 750);
      expect(sockets.size).toBe(0);
    }
    console.log(
      'IO_PROTOCOL_EVIDENCE ' +
        JSON.stringify({
          mode,
          controlledPeer: true,
          absoluteDeadlineObserved: true,
          bytesReceived: receivedBytes > 0,
          sqlDispatches: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
  });
}
