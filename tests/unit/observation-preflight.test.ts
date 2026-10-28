import { expect, it, vi } from 'vitest';
import { healthCodes } from '../../packages/integrations/src/local-observer.ts';
import { createFreshObserver, capacityReading } from '../../scripts/observability/observer.ts';
import { fixtureAlertTransport } from '../../scripts/observability/transport.ts';

const now = Date.parse('2026-10-28T12:00:00.000Z');
const rows = () =>
  healthCodes.map((code) => ({
    code,
    queued: 0,
    ageSeconds: null,
    capped: false,
    alerts: [],
    sampledAt: new Date(now).toISOString(),
  }));
const capacity = () => ({
  raw: 75,
  superReserved: 3,
  roleReserved: 2,
  required: 69,
  backends: 55,
  sampledAt: new Date(now).toISOString(),
});
function fixture() {
  const review = vi.fn(async (): Promise<unknown> => ({ ok: true, value: rows() }));
  const readCapacity = vi.fn(async (): Promise<unknown> => capacity());
  const probe = vi.fn(async (): Promise<unknown> => ({
    healthy: true,
    sampledAt: new Date(now).toISOString(),
  }));
  return {
    review,
    readCapacity,
    probe,
    observer: createFreshObserver({
      review,
      readCapacity,
      checks: { host_readiness: probe, storage_fixture: probe, workflow_freshness: probe },
      now: () => now,
      capacityThreshold: 8000,
    }),
  };
}
it('uses usable PostgreSQL capacity independently of rate-limit row capacity', () => {
  expect(capacityReading({ ...capacity(), backends: 56 }, now, 8000)).toMatchObject({
    raw: 75,
    serverReserved: 5,
    usable: 70,
    usedBasisPoints: 8000,
    reasons: ['capacity'],
  });
  expect(capacityReading({ ...capacity(), required: 71 }, now, 8000).reasons).toContain(
    'overbooked',
  );
});
it.each([
  { ...capacity(), raw: 0 },
  { ...capacity(), backends: -1 },
  { ...capacity(), backends: NaN },
  { ...capacity(), required: 1.5 },
  { ...capacity(), sampledAt: new Date(now - 10001).toISOString() },
  { ...capacity(), sampledAt: new Date(now + 1001).toISOString() },
  { ...capacity(), secret: 'not allowed' },
])('refuses invalid, stale, future or unknown capacity evidence', (input) =>
  expect(() => capacityReading(input, now, 8000)).toThrow(/^Observation evidence unavailable$/),
);
it('never clears a known capacity alarm from failed/stale evidence', async () => {
  const f = fixture();
  f.readCapacity.mockResolvedValue({ ...capacity(), backends: 56 });
  expect((await f.observer.sample()).activeAlerts).toContain('database_capacity');
  f.readCapacity.mockRejectedValue(Error('postgresql://secret'));
  const failed = await f.observer.sample();
  expect(failed.capacity).toBeNull();
  expect(failed.activeAlerts).toEqual(
    expect.arrayContaining(['database_capacity', 'capacity_telemetry']),
  );
  expect(JSON.stringify(failed)).not.toContain('secret');
  f.readCapacity.mockResolvedValue(capacity());
  expect((await f.observer.sample()).healthy).toBe(true);
});
it('preserves queue alarms for stale, future, malformed or denied snapshots', async () => {
  const f = fixture(),
    data = rows();
  Object.assign(data[0]!, { alerts: ['backlog'], queued: 101 });
  f.review.mockResolvedValue({ ok: true, value: data });
  await f.observer.sample();
  for (const input of [
    {
      ok: true,
      value: data.map((r) => ({ ...r, sampledAt: new Date(now - 10001).toISOString() })),
    },
    { ok: true, value: data.map((r) => ({ ...r, sampledAt: 'bad' })) },
    { ok: false, error: { code: 'forbidden', details: 'private' } },
  ]) {
    f.review.mockResolvedValue(input);
    const sample = await f.observer.sample();
    expect(sample.fresh).toBe(false);
    expect(sample.activeAlerts).toContain(healthCodes[0]);
    expect(sample.queues).toBeNull();
  }
  f.review.mockResolvedValue({ ok: true, value: rows() });
  expect((await f.observer.sample()).healthy).toBe(true);
});
it('refuses stale dependency success and suppresses unchanged alerts', async () => {
  const f = fixture();
  f.probe.mockResolvedValue({ healthy: true, sampledAt: new Date(now - 10001).toISOString() });
  const sample = await f.observer.sample();
  expect(sample.healthy).toBe(false);
  expect(sample.dependencyStatus.host_readiness).toBe('stale');
  expect((await f.observer.sample()).events).toEqual([]);
  f.probe.mockRejectedValue(Error('private'));
  expect(JSON.stringify(await f.observer.sample())).not.toContain('private');
  f.probe.mockResolvedValue({ healthy: true, sampledAt: new Date(now).toISOString() });
  expect((await f.observer.sample()).healthy).toBe(true);
});
it('rejects overlapping observation loops', async () => {
  const f = fixture();
  let finish!: (v: unknown) => void;
  f.readCapacity.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const running = f.observer.sample();
  await vi.waitFor(() => expect(f.readCapacity).toHaveBeenCalledOnce());
  await expect(f.observer.sample()).rejects.toThrow('already running');
  finish(capacity());
  await running;
});
it.each([
  'https://example.invalid/alerts',
  'http://localhost:8080/internal/fixture-alerts',
  'http://127.0.0.1:8080/internal/fixture-alerts?token=secret',
  'http://127.0.0.1:8080/other',
])('refuses external or unapproved alert transport before fetch', (url) => {
  expect(() => fixtureAlertTransport(url, 'tt-test-0123456789abcdef', 'a'.repeat(64))).toThrow(
    /^Invalid fixture alert transport$/,
  );
});
