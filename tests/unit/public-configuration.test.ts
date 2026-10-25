import { it, expect, vi } from 'vitest';
import {
  publicContent,
  publicConfiguration,
  configurationChecksum,
} from '../../packages/config/src/publication.ts';
import { createPublicConfigurationReader } from '../../packages/integrations/src/public-configuration.ts';
import type { ConfigurationSnapshot } from '../../packages/application/src/ports/publication.ts';
function snapshot(revision = 1): ConfigurationSnapshot {
  const value = publicConfiguration({
    schemaVersion: 1,
    revision,
    issuedAt: '2026-10-24T00:00:00.000Z',
    expiresAt: '2026-10-24T01:00:00.000Z',
    analytics: false,
    advertising: false,
  });
  return { value, checksum: configurationChecksum(value) };
}
const start = Date.parse('2026-10-24T00:01:00.000Z');
it('uses the same exact allowlisted configuration schema and checksum for SQL and object snapshots', async () => {
  let now = start,
    head: ConfigurationSnapshot | null = snapshot();
  const current = vi.fn(async () => head),
    get = vi.fn(async () => new TextEncoder().encode(JSON.stringify(head!.value)));
  const reader = createPublicConfigurationReader({ current, objects: { get }, now: () => now });
  expect(await reader.read()).toEqual(head);
  expect(await reader.read()).toEqual(head);
  expect(current).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith(
    'public-config/1.json',
    expect.objectContaining({ maxBytes: 4096 }),
  );
  head = snapshot(2);
  now += 30001;
  expect((await reader.read())?.value.revision).toBe(2);
  head = snapshot();
  reader.invalidate();
  expect(await reader.read()).toBeNull();
  head = null;
  expect(await reader.read()).toBeNull();
});
it('fails closed on corrupt, oversized, unknown, expired, future or unavailable snapshots and after restart', async () => {
  for (const change of ['checksum', 'bytes', 'shape', 'outage', 'expired', 'future'] as const) {
    const head = snapshot();
    const now =
      change === 'expired' ? start + 3600000 : change === 'future' ? start - 3600000 : start;
    const reader = createPublicConfigurationReader({
      now: () => now,
      current: async () => (change === 'checksum' ? { ...head, checksum: '0'.repeat(64) } : head),
      objects: {
        async get() {
          if (change === 'outage') throw Error('outage');
          return change === 'bytes'
            ? new Uint8Array(4097)
            : new TextEncoder().encode(
                JSON.stringify(
                  change === 'shape'
                    ? { ...head.value, secret: 'forbidden' }
                    : { ...head.value, advertising: true },
                ),
              );
        },
      },
    });
    expect(await reader.read()).toBeNull();
  }
  const head = snapshot(3),
    restarted = createPublicConfigurationReader({
      now: () => start,
      current: async () => head,
      objects: { get: async () => new TextEncoder().encode(JSON.stringify(snapshot(1).value)) },
    });
  expect(await restarted.read()).toBeNull();
  const unavailable = createPublicConfigurationReader({
    current: async () => {
      throw Error('database down');
    },
  });
  expect(await unavailable.read()).toBeNull();
});
it('coalesces refreshes and never serves beyond expiry', async () => {
  let now = start;
  const current = vi.fn(async () => snapshot());
  const reader = createPublicConfigurationReader({ current, now: () => now });
  expect(await Promise.all([reader.read(), reader.read()])).toEqual([snapshot(), snapshot()]);
  expect(current).toHaveBeenCalledTimes(1);
  now = Date.parse(snapshot().value.expiresAt);
  expect(await reader.read()).toBeNull();
});
it('bounds stalled reads and refuses an in-flight snapshot invalidated during object fetch', async () => {
  vi.useFakeTimers();
  try {
    const stalled = createPublicConfigurationReader({ current: () => new Promise(() => {}) });
    const wait = stalled.read();
    await vi.advanceTimersByTimeAsync(2001);
    expect(await wait).toBeNull();
    let resolve!: (bytes: Uint8Array) => void;
    const reader = createPublicConfigurationReader({
      current: async () => snapshot(),
      now: () => start,
      objects: {
        get: () =>
          new Promise((r) => {
            resolve = r;
          }),
      },
    });
    const reading = reader.read();
    await vi.advanceTimersByTimeAsync(0);
    reader.invalidate();
    resolve(new TextEncoder().encode(JSON.stringify(snapshot().value)));
    expect(await reading).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
it('rejects implicit JSON coercions, private fields, excessive content and invalid times', () => {
  const c = snapshot().value;
  for (const bad of [
    null,
    [],
    { ...c, secret: 'x' },
    { ...c, schemaVersion: 2 },
    { ...c, revision: 0 },
    { ...c, analytics: 'true' },
    { ...c, issuedAt: 'yesterday' },
    { ...c, expiresAt: c.issuedAt },
    { ...c, expiresAt: '2026-10-26T00:00:00.000Z' },
  ])
    expect(() => publicConfiguration(bad)).toThrow();
  for (const bad of [
    { title: '', summary: 'a', paragraphs: [] },
    { title: 'a', summary: 'b', paragraphs: Array(101).fill('p') },
    { title: 'a', summary: 'b', paragraphs: ['x'.repeat(2001)] },
    { title: 'a', summary: 'b', paragraphs: ['\0'] },
    { title: 'a', summary: 'b', paragraphs: null },
  ])
    expect(() => publicContent(bad)).toThrow();
  expect(publicContent({ title: 'a', summary: 'b', paragraphs: ['safe'] })).toEqual({
    title: 'a',
    summary: 'b',
    paragraphs: ['safe'],
  });
});
