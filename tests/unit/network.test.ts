import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { http, HttpResponse } from 'msw';
import { fixtureServer } from '../setup';

it('ENG-02 serves a named synthetic source fixture', async () => {
  fixtureServer.use(
    http.get('https://source.invalid/catalog', () =>
      HttpResponse.json({ synthetic: true, rows: [] }),
    ),
  );
  const response = await fetch('https://source.invalid/catalog');
  expect(await response.json()).toEqual({ synthetic: true, rows: [] });
});

it('ENG-02 rejects unexpected outbound HTTP instead of contacting a provider', async () => {
  let received = 0;
  const server = createServer((_request, response) => {
    received += 1;
    response.end('should not be reached');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    await expect(fetch(`http://127.0.0.1:${address.port}/unexpected`)).rejects.toThrow();
    expect(received).toBe(0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
