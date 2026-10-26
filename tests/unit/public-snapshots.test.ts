import { it, expect, vi } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';
import { createPublicSnapshots } from '../../packages/integrations/src/public-snapshots.ts';
import { createPublicRoutingReader } from '../../packages/integrations/src/public-routing.ts';
import { contentIdentity } from '../../packages/integrations/src/content-identity.ts';
const bytes = new TextEncoder().encode('{}');
it('writes immutable public objects and adopts only identical bytes after an uncertain put', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(Error('uncertain'))
    .mockResolvedValueOnce({
      ContentLength: 2,
      Body: (async function* () {
        yield bytes;
      })(),
    });
  const p = createPublicSnapshots({ send } as unknown as S3Client, 'synthetic');
  await p.put('public-config/1.json', bytes);
  await p.put('public-config/1.json', bytes);
  expect(send).toHaveBeenCalledTimes(3);
  expect(send.mock.calls[0]?.[0].input.IfNoneMatch).toBe('*');
  await expect(p.put('assets/private', bytes)).rejects.toThrow();
  await expect(p.put('public-config/2.json', new Uint8Array(65537))).rejects.toThrow();
  send.mockRejectedValueOnce(Error('conflict')).mockResolvedValueOnce({
    ContentLength: 2,
    Body: (async function* () {
      yield new TextEncoder().encode('[]');
    })(),
  });
  await expect(p.put('public-config/1.json', bytes)).rejects.toThrow();
});
it('bounds public object reads and refuses absent, unknown or oversized data', async () => {
  const send = vi.fn(),
    p = createPublicSnapshots({ send } as unknown as S3Client, 'synthetic'),
    options = { maxBytes: 65536, signal: new AbortController().signal };
  for (const response of [
    { ContentLength: 65537 },
    { ContentLength: 2 },
    {
      ContentLength: 1,
      Body: (async function* () {
        yield new Uint8Array(65537);
      })(),
    },
  ]) {
    send.mockResolvedValueOnce(response);
    await expect(p.get('public-redirects/1.json', options)).rejects.toThrow();
  }
  await expect(p.get('assets/private', options)).rejects.toThrow();
  await expect(p.get('public-config/1.json', { ...options, maxBytes: 0 })).rejects.toThrow();
});
const value = (revision = 1) => ({
  revision,
  issuedAt: '2026-10-25T00:00:00.000Z',
  expiresAt: '2026-10-25T01:00:00.000Z',
  rules: [{ source: '/learn/old', target: null, code: 410 as const, mode: 'exact' as const }],
});
it('redirect replicas independently refresh within 30 seconds, reject regressions, and fail closed after restart', async () => {
  let at = Date.parse('2026-10-25T00:01:00.000Z'),
    head = value();
  const current = vi.fn(async () => ({ value: head, checksum: contentIdentity.checksum(head) })),
    get = vi.fn(async () => new TextEncoder().encode(JSON.stringify(head)));
  const a = createPublicRoutingReader({ current, objects: { get }, now: () => at }),
    b = createPublicRoutingReader({ current, objects: { get }, now: () => at });
  expect(await a.read()).toEqual(head);
  expect(Object.isFrozen((await a.read())?.rules)).toBe(true);
  expect(await a.read()).toEqual(head);
  expect(await b.read()).toEqual(head);
  head = value(2);
  at += 30001;
  expect((await a.read())?.revision).toBe(2);
  expect((await b.read())?.revision).toBe(2);
  head = value(1);
  a.invalidate();
  expect(await a.read()).toBeNull();
  head = value(3);
  get.mockResolvedValueOnce(new TextEncoder().encode('{}'));
  expect(await a.read()).toBeNull();
  current.mockResolvedValueOnce(null as never);
  b.invalidate();
  expect(await b.read()).toBeNull();
  at += 7200000;
  expect(
    await createPublicRoutingReader({ current, objects: { get }, now: () => at }).read(),
  ).toBeNull();
});
it('invalidation and concurrent reads cannot publish an old in-flight redirect snapshot', async () => {
  let resolve!: (x: Uint8Array) => void;
  const head = value(),
    current = vi.fn(async () => ({ value: head, checksum: contentIdentity.checksum(head) })),
    get = vi.fn(
      async () =>
        new Promise<Uint8Array>((r) => {
          resolve = r;
        }),
    ),
    r = createPublicRoutingReader({
      current,
      objects: { get },
      now: () => Date.parse('2026-10-25T00:01:00.000Z'),
    });
  const one = r.read(),
    two = r.read();
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  r.invalidate();
  resolve(new TextEncoder().encode(JSON.stringify(head)));
  expect(await one).toBeNull();
  expect(await two).toBeNull();
});
