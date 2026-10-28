import {
  alertSchema,
  acknowledgementSchema,
  type FixtureAlert,
} from '../../packages/config/src/observation-preflight.ts';
export function fixtureAlertTransport(endpoint: string, project: string, token: string) {
  try {
    const u = new URL(endpoint);
    if (
      u.protocol !== 'http:' ||
      u.hostname !== '127.0.0.1' ||
      Number(u.port) < 1024 ||
      Number(u.port) > 65535 ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== '/internal/fixture-alerts' ||
      !/^tt-test-[a-f0-9]{16}$/.test(project) ||
      !/^([a-f0-9]{64})$/.test(token)
    )
      throw Error();
  } catch {
    throw Error('Invalid fixture alert transport');
  }
  return async (input: FixtureAlert) => {
    try {
      const message = alertSchema.parse(input);
      if (message.project !== project) throw Error();
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fixture-token': token },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(1000),
        redirect: 'error',
      });
      if (!r.ok) {
        await r.body?.cancel();
        throw Error();
      }
      const reader = r.body?.getReader();
      if (!reader) throw Error();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const c = await reader.read();
          if (c.done) break;
          size += c.value.length;
          if (size > 2048) throw Error();
          chunks.push(c.value);
        }
      } finally {
        await reader.cancel();
      }
      const ack = acknowledgementSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (ack.id !== message.id || ack.project !== project) throw Error();
    } catch {
      throw Error('Fixture alert delivery unavailable');
    }
  };
}
