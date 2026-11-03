import { it, expect } from 'vitest';
import { comparisonController } from '../../apps/web/src/comparison/controller.ts';
import { createComparisonClient } from '../../packages/contracts/src/comparison-client.ts';
import { blankQuote, quoteBody } from '../../apps/web/src/comparison/model.ts';
import { uuid } from '../fixtures/engine/base.ts';
const report = uuid(10),
  quote = uuid(11),
  cap = uuid(12),
  requestId = uuid(13),
  asset = uuid(14);
const reply = (data: unknown) => Response.json({ data, requestId });
function input() {
  const v = quoteBody({
    ...blankQuote(),
    product: 'Example',
    amount: '800.09',
    quantity: '4',
    basis: 'installed_set',
    observedOn: '2026-11-03',
  });
  if (!v.ok) throw Error('fixture');
  return v.input;
}
const detail = {
  quote: {
    id: quote,
    currency: 'USD',
    totalMinor: '80009',
    quantity: 4,
    basis: 'installed_set',
    observedOn: '2026-11-03',
    expiresAt: '2200-01-01T00:00:00.000Z',
  },
  private: { productText: 'Example', shopName: 'Private fixture shop' },
};
const comparison = {
  reportId: report,
  version: 1,
  comparison: { revision: '1', items: [] },
  safety: {
    checkedAt: '2026-11-03T00:00:00.000Z',
    status: 'review_required',
    unresolved: true,
    matched: [],
  },
  scenario: {
    asOf: '2026-11-03T00:00:00.000Z',
    ownershipScenario: 'not_requested',
    issuanceAuthorized: false,
  },
};
it('captures a quote request before waiting for owner identity so later caller edits cannot change it', async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  let sent: Record<string, unknown> | undefined;
  const send: typeof fetch = async (u, o) => {
    const path = new URL(String(u)).pathname;
    if (path.endsWith('/sessions/current')) {
      await wait;
      return reply({ csrf: 'a'.repeat(64) });
    }
    if (o?.method === 'POST') {
      sent = JSON.parse(String(o.body));
      return reply({
        schema_version: 1,
        resource_id: quote,
        report_id: report,
        status: 'accepted',
        result_revision: '1',
      });
    }
    return reply(detail);
  };
  const c = comparisonController('http://127.0.0.1:8380', report, 1, send),
    body = input(),
    pending = c.saveQuote(body);
  body.totalMinor = '999';
  release();
  await pending;
  expect(sent?.totalMinor).toBe('80009');
});
it('replays an uncertain quote with one key and refuses changed answers until confirmation', async () => {
  const keys: string[] = [],
    bodies: string[] = [];
  let posts = 0;
  const send: typeof fetch = async (u, o) => {
    const p = new URL(String(u)).pathname;
    if (p.endsWith('/sessions/current')) return reply({ csrf: 'a'.repeat(64) });
    if (o?.method === 'POST') {
      keys.push(new Headers(o.headers).get('idempotency-key')!);
      bodies.push(String(o.body));
      if (++posts === 1) throw Error('ack lost');
      return reply({
        schema_version: 1,
        resource_id: quote,
        report_id: report,
        status: 'accepted',
        result_revision: '1',
      });
    }
    return reply(detail);
  };
  const c = comparisonController('http://127.0.0.1:8380', report, 1, send);
  await expect(c.saveQuote(input())).rejects.toThrow('ack lost');
  await expect(c.saveQuote({ ...input(), totalMinor: '10' })).rejects.toThrow('unconfirmed');
  await c.saveQuote(input());
  expect(new Set(keys).size).toBe(1);
  expect(new Set(bodies).size).toBe(1);
});
it('keeps the same comparison body/key through a lost acknowledgement and binds the returned revision', async () => {
  let posts = 0;
  const keys: string[] = [];
  const send: typeof fetch = async (u, o) => {
    if (new URL(String(u)).pathname.endsWith('/sessions/current'))
      return reply({ csrf: 'a'.repeat(64) });
    if (o?.method === 'POST') {
      keys.push(new Headers(o.headers).get('idempotency-key')!);
      if (++posts === 1) throw Error('lost');
      return reply({
        schema_version: 1,
        resource_id: report,
        report_id: report,
        report_version: 1,
        status: 'accepted',
        result_revision: '1',
      });
    }
    return reply(comparison);
  };
  const c = comparisonController('http://127.0.0.1:8380', report, 1, send),
    items = [{ kind: 'catalog' as const, key: uuid(101) }];
  await expect(c.compare(items, null)).rejects.toThrow('lost');
  expect(await c.compare(items, null)).toMatchObject({ comparison: { revision: '1' } });
  expect(keys[0]).toBe(keys[1]);
});
it('refuses a mismatched owner comparison receipt and retains the request for a safe retry', async () => {
  const send: typeof fetch = async (u) =>
    new URL(String(u)).pathname.endsWith('/sessions/current')
      ? reply({ csrf: 'a'.repeat(64) })
      : reply({
          schema_version: 1,
          resource_id: uuid(999),
          report_id: report,
          report_version: 1,
          status: 'accepted',
          result_revision: '1',
        });
  await expect(
    comparisonController('http://127.0.0.1:8380', report, 1, send).compare(
      [{ kind: 'catalog', key: uuid(101) }],
      null,
    ),
  ).rejects.toThrow('receipt');
});
it('sends share/download capabilities in authorization headers with credentials omitted', async () => {
  const seen: {
    url: string;
    credentials: RequestCredentials | undefined;
    authorization: string | null;
  }[] = [];
  const send: typeof fetch = async (u, o) => {
    seen.push({
      url: String(u),
      credentials: o?.credentials,
      authorization: new Headers(o?.headers).get('authorization'),
    });
    return new Response('%PDF-1.4\nfixture', { headers: { 'content-type': 'application/pdf' } });
  };
  const c = createComparisonClient('http://127.0.0.1:8380', send),
    token = 'download.test.' + cap + '.' + 'a'.repeat(64);
  expect(new TextDecoder().decode(await c.download(token))).toContain('%PDF-');
  expect(seen).toEqual([
    {
      url: 'http://127.0.0.1:8380/api/v1/download',
      credentials: 'omit',
      authorization: 'Bearer ' + token,
    },
  ]);
});
it.each([
  new Response('not pdf', { headers: { 'content-type': 'application/pdf' } }),
  new Response('%PDF-x', { headers: { 'content-type': 'text/html' } }),
  new Response('%PDF-x', {
    headers: { 'content-type': 'application/pdf', 'content-length': '10485761' },
  }),
])('refuses an unavailable, wrong-type or oversized private PDF', async (response) => {
  await expect(
    createComparisonClient('http://127.0.0.1:8380', async () => response.clone()).download(
      'download.test.' + asset + '.' + 'a'.repeat(64),
    ),
  ).rejects.toThrow();
});

it('cancels an oversized PDF stream without buffering the entire response', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(10485761));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    createComparisonClient(
      'http://127.0.0.1:8380',
      async () => new Response(body, { headers: { 'content-type': 'application/pdf' } }),
    ).download('download.test.' + asset + '.' + 'a'.repeat(64)),
  ).rejects.toThrow('too large');
  expect(cancelled).toBe(true);
});
it.each(['mismatch', 'expired', 'invalid-date', 'bad-version'])(
  'refuses a %s share capability receipt',
  async (mode) => {
    const token =
      (mode === 'bad-version' ? 'share.bad version.' : 'share.test.') +
      (mode === 'mismatch' ? uuid(999) : cap) +
      '.' +
      'c'.repeat(64);
    const send: typeof fetch = async () =>
      reply({
        schema_version: 1,
        resource_id: cap,
        report_id: report,
        report_version: 1,
        status: 'created',
        expires_at:
          mode === 'expired'
            ? '2020-01-01T00:00:00.000Z'
            : mode === 'invalid-date'
              ? 'bad'
              : '2200-01-01T00:00:00.000Z',
        token,
      });
    await expect(
      createComparisonClient('http://127.0.0.1:8380', send).share(
        report,
        { version: 1, comparisonRevision: null },
        'a'.repeat(64),
        'synthetic_command_0001',
      ),
    ).rejects.toThrow('share');
  },
);

it('permits corrected quote values after a definitive validation refusal with a new command key', async () => {
  let count = 0,
    number = 0;
  const keys: string[] = [];
  const send: typeof fetch = async (u, o) => {
    if (new URL(String(u)).pathname.endsWith('/sessions/current'))
      return reply({ csrf: 'a'.repeat(64) });
    if (o?.method === 'POST') {
      keys.push(new Headers(o.headers).get('idempotency-key')!);
      if (++count === 1)
        return Response.json(
          {
            code: 'invalid_input',
            messageKey: 'request.invalid',
            fieldErrors: { sizeCode: 'invalid' },
            retryable: false,
            requestId,
          },
          { status: 400 },
        );
      return reply({
        schema_version: 1,
        resource_id: quote,
        report_id: report,
        status: 'accepted',
        result_revision: '1',
      });
    }
    return reply(detail);
  };
  const c = comparisonController(
    'http://127.0.0.1:8380',
    report,
    1,
    send,
    () => 'synthetic_key_' + String(++number).padStart(4, '0'),
  );
  await expect(c.saveQuote({ ...input(), sizeCode: 'bad' })).rejects.toMatchObject({
    code: 'invalid_input',
  });
  await c.saveQuote({ ...input(), sizeCode: '225/45R18' });
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe(keys[1]);
});
