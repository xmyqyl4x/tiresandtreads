import { it, expect, vi } from 'vitest';
import {
  createLocalObserver,
  healthCodes,
} from '../../packages/integrations/src/local-observer.ts';
const rows = () =>
  healthCodes.map((code) => ({ code, queued: 0, ageSeconds: null, capped: false, alerts: [] }));
function fixture() {
  const review = vi.fn(async (): Promise<unknown> => ({ ok: true, value: rows() }));
  const ready = vi.fn(async () => true);
  return {
    review,
    ready,
    observer: createLocalObserver({
      review,
      checks: { host_readiness: ready, storage_fixture: ready, workflow_freshness: ready },
      now: () => 1000,
    }),
  };
}
it('emits one masked alert per changed reason set and one recovery, suppressing stable repeats', async () => {
  const f = fixture();
  expect((await f.observer.sample()).healthy).toBe(true);
  const data = rows();
  Object.assign(data[0]!, {
    queued: 1001,
    capped: true,
    ageSeconds: 3600,
    alerts: ['backlog', 'lag'],
    email: 'private@example.invalid',
  });
  f.review.mockResolvedValue({ ok: true, value: data });
  const first = await f.observer.sample();
  expect(first.events).toEqual([
    { component: healthCodes[0], state: 'alert', reasons: ['backlog', 'lag'] },
  ]);
  expect(first.healthy).toBe(false);
  expect(JSON.stringify(first)).not.toMatch(/private|email|subject|proof|token/);
  expect((await f.observer.sample()).events).toEqual([]);
  f.review.mockResolvedValue({ ok: true, value: rows() });
  expect((await f.observer.sample()).events).toEqual([
    { component: healthCodes[0], state: 'recovered', reasons: [] },
  ]);
});
it('retains queue alarms when access is revoked or a sample fails and clears only after fresh authorized evidence', async () => {
  const f = fixture(),
    data = rows();
  Object.assign(data[0]!, { alerts: ['review_required'] });
  f.review.mockResolvedValue({ ok: true, value: data });
  await f.observer.sample();
  f.review.mockResolvedValue({ ok: false, error: { code: 'forbidden', details: 'secret' } });
  const denied = await f.observer.sample();
  expect(denied.activeAlerts).toEqual(expect.arrayContaining([healthCodes[0], 'telemetry']));
  expect(denied.events).toEqual([
    { component: 'telemetry', state: 'alert', reasons: ['access_denied'] },
  ]);
  f.review.mockRejectedValue(Error('postgresql://private'));
  expect(JSON.stringify(await f.observer.sample())).not.toContain('postgresql');
  f.review.mockResolvedValue({ ok: true, value: rows() });
  expect((await f.observer.sample()).activeAlerts).toEqual([]);
});
it('reports dependency failures independently and recovers them without leaking exceptions', async () => {
  const f = fixture();
  f.ready.mockRejectedValue(Error('sensitive host'));
  const failed = await f.observer.sample();
  expect(failed.activeAlerts).toEqual(['host_readiness', 'storage_fixture', 'workflow_freshness']);
  expect(JSON.stringify(failed)).not.toContain('sensitive');
  f.ready.mockResolvedValue(true);
  expect((await f.observer.sample()).events.every((e) => e.state === 'recovered')).toBe(true);
});
it('refuses missing, duplicate, unknown or malformed health rows without clearing earlier alarms', async () => {
  for (const value of [
    [],
    [...rows(), rows()[0]],
    rows().slice(1),
    rows().map((r, i) => (i ? r : { ...r, code: 'secret' })),
    rows().map((r, i) => (i ? r : { ...r, queued: -1 })),
    rows().map((r, i) => (i ? r : { ...r, ageSeconds: NaN })),
    rows().map((r, i) => (i ? r : { ...r, alerts: ['private'] })),
    rows().map((r, i) => (i ? r : { ...r, capped: 'false' })),
  ]) {
    const f = fixture();
    f.review.mockResolvedValue({ ok: true, value });
    const sample = await f.observer.sample();
    expect(sample.fresh).toBe(false);
    expect(sample.activeAlerts).toEqual(['telemetry']);
  }
});
it('does not allow overlapping polls or fan out unbounded database reads', async () => {
  const f = fixture();
  let finish!: (v: unknown) => void;
  f.review.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const first = f.observer.sample();
  await vi.waitFor(() => expect(f.review).toHaveBeenCalledOnce());
  await expect(f.observer.sample()).rejects.toThrow('already running');
  finish({ ok: true, value: rows() });
  await first;
  f.review.mockResolvedValue({ ok: true, value: rows() });
  expect((await f.observer.sample()).healthy).toBeDefined();
}, 1000);
