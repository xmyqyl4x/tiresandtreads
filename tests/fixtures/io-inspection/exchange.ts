import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { within } from './budget.ts';

const paths = {
  resource: '/control/admission.sock',
  sql: '/control/sql.sock',
  'test-stall': '/tmp/lr03-stall.sock',
  'test-dribble': '/tmp/lr03-dribble.sock',
} as const;
export class IpcUnavailable extends Error {
  constructor(readonly receivedBytes: number) {
    super('I/O custody unavailable');
  }
}

// Internal disposable support only. No endpoint, program, SQL or callback ingress.
export async function exchange(
  kind: keyof typeof paths,
  body: Record<string, unknown>,
  limit: number,
) {
  if (!Object.hasOwn(paths, kind) || !Number.isFinite(limit) || limit < 1 || limit > 1500)
    throw Error('Fixed bounded I/O path required');
  const nonce = randomBytes(8).toString('hex');
  const socket = net.createConnection(paths[kind]);
  let receivedBytes = 0;
  const pending = new Promise<string>((resolve, reject) => {
    let raw = '';
    socket.on('connect', () => socket.write(JSON.stringify({ version: 1, nonce, ...body }) + '\n'));
    socket.on('data', (chunk) => {
      receivedBytes += chunk.length;
      raw += chunk.toString('utf8');
      if (Buffer.byteLength(raw) > 8192) socket.destroy(Error('Bounded I/O reply exceeded'));
    });
    socket.on('end', () => resolve(raw.trim()));
    socket.on('error', () => reject(Error('I/O custody unavailable')));
  });
  try {
    const raw = await within(pending, Math.min(750, limit));
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== 1 || value.nonce !== nonce) throw Error('I/O nonce refused');
    return value;
  } catch {
    throw new IpcUnavailable(receivedBytes);
  } finally {
    socket.destroy();
  }
}
