import { it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fixtureServer } from '../setup.ts';
import { createResendProvider } from '../../packages/integrations/src/resend.ts';
import { createFixtureReportRenderer } from '../../packages/integrations/src/delivery-renderer.ts';
import type {
  FrozenDelivery,
  DeliveryDocument,
} from '../../packages/application/src/ports/delivery-services.ts';
const id = '88888888-8888-4888-8888-888888888888',
  key = 'a'.repeat(64);
const payload: FrozenDelivery = {
  schemaVersion: 1,
  from: 'Tires & Tread <reports@example.invalid>',
  recipient: 'driver@example.invalid',
  mail: {
    subject: 'Report',
    html: '<p>Report</p>',
    text: 'Report',
    pdf: 'JVBERi0xLjQK',
    fixture: false,
    commercial: false,
  },
};
const provider = (enabled = true) =>
  createResendProvider({
    enabled,
    senderAddresses: ['reports@example.invalid'],
    apiKey: async () => 'fixture-key',
  });
it('replays exactly the same fixed body and key after an accepted-but-ambiguous response', async () => {
  const bodies: string[] = [],
    keys: string[] = [];
  let effects = 0;
  const seen = new Set<string>();
  fixtureServer.use(
    http.post('https://api.resend.com/emails', async ({ request }) => {
      bodies.push(await request.text());
      keys.push(request.headers.get('idempotency-key')!);
      if (!seen.has(keys.at(-1)!)) {
        effects++;
        seen.add(keys.at(-1)!);
        return HttpResponse.json({ error: 'ambiguous' }, { status: 503 });
      }
      return HttpResponse.json({ id });
    }),
  );
  const p = provider();
  expect((await p.send(key, payload)).outcome).toBe('uncertain');
  expect(await p.send(key, payload)).toEqual({ outcome: 'accepted', messageId: id });
  expect(effects).toBe(1);
  expect(bodies[0]).toBe(bodies[1]);
  expect(keys).toEqual([key, key]);
  expect(JSON.parse(bodies[0]!).attachments[0]).toEqual({
    filename: 'report.pdf',
    content: payload.mail.pdf,
    content_type: 'application/pdf',
  });
});
it.each([400, 401, 403, 404, 422])(
  'classifies definite HTTP %i refusal without exposing the error body',
  async (status) => {
    fixtureServer.use(
      http.post('https://api.resend.com/emails', () =>
        HttpResponse.json({ message: 'private provider body' }, { status }),
      ),
    );
    expect(await provider().send(key, payload)).toEqual({
      outcome: 'definitive_rejection',
      messageId: null,
    });
  },
);
it.each([409, 429, 500, 503, 202])(
  'keeps HTTP %i or missing acceptance identity uncertain',
  async (status) => {
    fixtureServer.use(
      http.post('https://api.resend.com/emails', () =>
        HttpResponse.json({ message: 'private' }, { status }),
      ),
    );
    expect(await provider().send(key, payload)).toEqual({ outcome: 'uncertain', messageId: null });
  },
);
it.each(['malformed', 'oversized', 'empty', 'network'])(
  'contains %s provider failures',
  async (kind) => {
    fixtureServer.use(
      http.post('https://api.resend.com/emails', () =>
        kind === 'malformed'
          ? new HttpResponse('{')
          : kind === 'oversized'
            ? new HttpResponse('x'.repeat(65537))
            : kind === 'empty'
              ? new HttpResponse(null)
              : HttpResponse.error(),
      ),
    );
    expect((await provider().send(key, payload)).outcome).toBe('uncertain');
  },
);
it('refuses disabled providers, fixture messages, unapproved senders, injected headers and invalid keys without HTTP', async () => {
  await expect(provider(false).send(key, payload)).rejects.toThrow('unavailable');
  for (const bad of [
    { ...payload, mail: { ...payload.mail, fixture: true } },
    { ...payload, from: 'other@evil.invalid' },
    { ...payload, from: 'reports@example.invalid\r\nBcc: secret' },
    { ...payload, recipient: 'bad' },
    { ...payload, schemaVersion: 2 },
  ])
    await expect(provider().send(key, bad as never)).rejects.toThrow();
  await expect(provider().send('bad', payload)).rejects.toThrow();
});
it('contains missing credentials and retains only observed provider status', async () => {
  const p = createResendProvider({
    enabled: true,
    senderAddresses: ['reports@example.invalid'],
    apiKey: async () => null,
  });
  expect((await p.send(key, payload)).outcome).toBe('uncertain');
  fixtureServer.use(
    http.get('https://api.resend.com/emails/' + id, () =>
      HttpResponse.json({
        id,
        last_event: 'delivered',
        to: ['private@example.invalid'],
        html: 'private',
      }),
    ),
  );
  expect(await provider().retrieve(id)).toEqual({ id, event: 'delivered' });
  await expect(provider().retrieve('../private')).rejects.toThrow();
});
it.each([404, 500, 200])(
  'handles retrieval HTTP %i with no fabricated acceptance',
  async (status) => {
    fixtureServer.use(
      http.get('https://api.resend.com/emails/' + id, () =>
        HttpResponse.json(
          { id: status === 200 ? id : 'bad', last_event: 'unrecognized' },
          { status },
        ),
      ),
    );
    if (status === 404) expect(await provider().retrieve(id)).toBeNull();
    else if (status === 500) await expect(provider().retrieve(id)).rejects.toThrow();
    else expect(await provider().retrieve(id)).toEqual({ id, event: 'unknown' });
  },
);
it('produces a deterministic labeled PDF fixture and refuses another renderer version', async () => {
  const r = createFixtureReportRenderer(key),
    doc = { fixture: true, template: { rendererHash: key } } as DeliveryDocument;
  const a = await r.render(doc);
  expect(a).toEqual(await r.render(doc));
  expect(Buffer.from(a.pdf, 'base64').toString()).toContain('xref');
  expect(a.text).toContain('NOT TIRE ADVICE');
  expect(a.fixture).toBe(true);
  await expect(r.render({ ...doc, fixture: false })).rejects.toThrow();
  await expect(
    r.render({ ...doc, template: { ...doc.template, rendererHash: 'b'.repeat(64) } }),
  ).rejects.toThrow();
  expect(() => createFixtureReportRenderer('bad')).toThrow();
});
it('bounds a stalled credential source without a live request', async () => {
  vi.useFakeTimers();
  try {
    const p = createResendProvider({
      enabled: true,
      senderAddresses: ['reports@example.invalid'],
      apiKey: () => new Promise(() => {}),
    });
    const pending = p.send(key, payload);
    await vi.advanceTimersByTimeAsync(5001);
    expect((await pending).outcome).toBe('uncertain');
  } finally {
    vi.useRealTimers();
  }
});
it('rejects oversized headers, corrupt identities and injected credentials', async () => {
  fixtureServer.use(
    http.post('https://api.resend.com/emails', () =>
      HttpResponse.json({ id }, { headers: { 'content-length': '65537' } }),
    ),
  );
  expect((await provider().send(key, payload)).outcome).toBe('uncertain');
  fixtureServer.use(
    http.get('https://api.resend.com/emails/' + id, () => HttpResponse.json({ id: 'other' })),
  );
  await expect(provider().retrieve(id)).rejects.toThrow();
  const p = createResendProvider({
    enabled: true,
    senderAddresses: ['reports@example.invalid'],
    apiKey: async () => 'bad\r\nkey',
  });
  expect((await p.send(key, payload)).outcome).toBe('uncertain');
});
