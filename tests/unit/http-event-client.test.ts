import { it, expect, vi } from 'vitest';
import { createEventClient } from '../../packages/contracts/src/event-client.ts';
const uuid = '11111111-1111-4111-8111-111111111111';
it('handles a consent-refused empty204 using the server request ID and preserves the explicit CMP signal', async () => {
  const send = vi.fn(
      async () => new Response(null, { status: 204, headers: { 'x-request-id': uuid } }),
    ),
    client = createEventClient('http://127.0.0.1:3210', send as typeof fetch);
  const r = await client.collect(
    'private-collection-token',
    {
      events: [
        {
          id: uuid,
          name: 'public_page_view',
          occurredAt: '2026-11-03T10:00:00.000Z',
          route: '/',
          props: {},
        },
      ],
    },
    true,
  );
  expect(r).toEqual({ data: null, requestId: uuid });
  const [url, options] = send.mock.calls[0]! as unknown as [URL, RequestInit];
  expect(String(url)).not.toContain('private-collection-token');
  expect(options.headers).toMatchObject({
    authorization: 'Bearer private-collection-token',
    'x-tt-cmp-available': 'true',
  });
});
it('uses header-only purpose proofs for preferences/confirmation/withdrawal/feedback', async () => {
  const send = vi.fn(
      async () => new Response(JSON.stringify({ data: { status: 'recorded' }, requestId: uuid })),
    ),
    client = createEventClient('http://127.0.0.1:3210', send as typeof fetch);
  await client.preferences('private-proof');
  await client.confirm('private-proof');
  await client.withdraw('private-proof');
  await client.feedback('private-proof', 'yes');
  for (const [url, options] of send.mock.calls as unknown as [URL, RequestInit][]) {
    expect(String(url)).not.toContain('private-proof');
    expect(options.headers).toMatchObject({ authorization: 'Bearer private-proof' });
  }
  expect(
    String((send.mock.calls as unknown as [URL, RequestInit][])[3]![0]).endsWith(
      '/api/v1/email/feedback',
    ),
  ).toBe(true);
});
it('rejects private/unknown analytics fields before transmission and never fabricates a missing204 request ID', async () => {
  const send = vi.fn(async () => new Response(null, { status: 204 })),
    client = createEventClient('http://127.0.0.1:3210', send as typeof fetch);
  expect(() =>
    client.collect('proof', { events: [], email: 'private@example.invalid' } as never, true),
  ).toThrow();
  expect(send).not.toHaveBeenCalled();
  await expect(
    client.collect(
      'proof',
      {
        events: [
          {
            id: uuid,
            name: 'public_page_view',
            occurredAt: '2026-11-03T10:00:00.000Z',
            route: '/',
            props: {},
          },
        ],
      },
      true,
    ),
  ).rejects.toThrow('Invalid API reply');
});
