import { it, expect } from 'vitest';
import { assessmentController, usableReference } from '../../apps/web/src/assessment/controller.ts';
import {
  createAssessmentClient,
  referencePageSchema,
} from '../../packages/contracts/src/assessment-client.ts';
import { engineFixture, uuid } from '../fixtures/engine/base.ts';
const source = {
  datasetId: uuid(2),
  fetchedAt: '2026-11-01T00:00:00.000Z',
  expiresAt: { state: 'known', value: '2200-01-01T00:00:00.000Z' },
  rights: { display: true, api: true },
};
const page = {
  coverage: 'available',
  source: { bundleId: uuid(1), components: [{ key: 'fitment', source }] },
  items: [{ fact: { id: uuid(40), wheelPackage: 'Example' }, source }],
  next: null,
};
it('requires complete fresh permitted provenance before enabling lookup choices', () => {
  expect(usableReference(referencePageSchema.parse(page))).toBe(true);
  expect(
    usableReference(
      referencePageSchema.parse({
        ...page,
        items: [
          {
            fact: { id: uuid(40) },
            source: { ...source, expiresAt: { state: 'unknown', reason: 'not_applicable' } },
          },
        ],
      }),
    ),
  ).toBe(true);
  for (const p of [
    { ...page, coverage: 'partial' },
    { ...page, coverage: 'unavailable' },
    { ...page, source: null },
    {
      ...page,
      items: [
        { fact: { id: uuid(40) }, source: { ...source, rights: { display: true, api: false } } },
      ],
    },
    {
      ...page,
      items: [
        {
          fact: { id: uuid(40) },
          source: { ...source, expiresAt: { state: 'unknown', reason: 'not_supplied' } },
        },
      ],
    },
    {
      ...page,
      items: [
        {
          fact: { id: uuid(40) },
          source: { ...source, expiresAt: { state: 'known', value: '2020-01-01T00:00:00.000Z' } },
        },
      ],
    },
  ])
    expect(usableReference(referencePageSchema.parse(p))).toBe(false);
});
it.each([
  { status: 'accepted' },
  { report_version: 2 },
  { resource_id: uuid(8) },
  { report_id: 'bad' },
])('refuses a mismatched creation receipt %j', async (change) => {
  const client = createAssessmentClient('http://127.0.0.1:8380', async () =>
    Response.json({
      data: {
        schema_version: 1,
        resource_id: uuid(7),
        report_id: uuid(7),
        report_version: 1,
        status: 'created',
        ...change,
      },
      requestId: uuid(1),
    }),
  );
  await expect(
    client.create(engineFixture().request, 'a'.repeat(64), 'synthetic_command_0001'),
  ).rejects.toThrow();
});
it('rejects malformed lookup and creation receipts at the boundary', async () => {
  const send: typeof fetch = async () =>
    Response.json({ data: { report_id: 'poison' }, requestId: uuid(1) });
  const c = createAssessmentClient('http://127.0.0.1:8380', send);
  await expect(c.lookup('vehicles', {})).rejects.toThrow();
  await expect(
    c.create(engineFixture().request, 'a'.repeat(64), 'synthetic_command_00001'),
  ).rejects.toThrow();
});
it('pins paginated lookup queries and never creates identity for a lookup', async () => {
  let url = '';
  const c = assessmentController('http://127.0.0.1:8380', async (u) => {
    url = String(u);
    return Response.json({ data: page, requestId: uuid(1) });
  });
  await c.lookup('vehicles', { modelYear: '2026', bundle: uuid(1), after: 'cursor' });
  expect(new URL(url).searchParams.get('bundle')).toBe(uuid(1));
  expect(new URL(url).pathname).toBe('/api/v1/reference');
});
it('coalesces duplicate clicks and safely reuses a request key after an uncertain acknowledgment', async () => {
  let unblock!: () => void;
  const barrier = new Promise<void>((r) => {
      unblock = r;
    }),
    keys: string[] = [];
  let posts = 0,
    keysIssued = 0;
  const send: typeof fetch = async (u, o) => {
    if (new URL(String(u)).pathname === '/api/v1/sessions/current')
      return Response.json({ data: { csrf: 'a'.repeat(64) }, requestId: uuid(1) });
    keys.push(new Headers(o?.headers).get('idempotency-key')!);
    posts++;
    await barrier;
    if (posts === 1) throw Error('lost ack');
    return Response.json({
      data: {
        schema_version: 1,
        resource_id: uuid(7),
        report_id: uuid(7),
        report_version: 1,
        status: 'created',
      },
      requestId: uuid(1),
    });
  };
  const c = assessmentController(
      'http://127.0.0.1:8380',
      send,
      () => `synthetic_command_${++keysIssued}`,
    ),
    a = c.submit(engineFixture().request),
    b = c.submit(engineFixture().request);
  expect(a).toBe(b);
  await expect(c.submit({ ...engineFixture().request, priorities: ['noise'] })).rejects.toThrow();
  unblock();
  await expect(a).rejects.toThrow('lost ack');
  await c.submit(engineFixture().request);
  expect(posts).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  expect(keysIssued).toBe(1);
});
