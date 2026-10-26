import { it, expect, vi } from 'vitest';
import { createServiceMaintenance } from '../../packages/application/src/services/service-maintenance.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import type {
  MaintenanceBindings,
  MaintenanceAction,
} from '../../packages/application/src/ports/service-maintenance.ts';
const names = [
  'callbacks',
  'publication',
  'privacy',
  'analytics',
  'quotas',
  'retention',
  'assets',
  'sources',
  'delivery',
  'privacy_verification',
] as const;
function fixture() {
  const action = () =>
    vi.fn<MaintenanceBindings[MaintenanceAction]>(async () => ok({ processed: 1 }));
  const bindings = Object.fromEntries(names.map((n) => [n, action()])) as Record<
    MaintenanceAction,
    ReturnType<typeof action>
  >;
  return { bindings, service: createServiceMaintenance({ bindings, enabled: [] }) };
}
it('performs no maintenance or external work unless the host explicitly enables the named action', async () => {
  const s = fixture();
  expect(await s.service.run('delivery')).toEqual(ok({ action: 'delivery', status: 'disabled' }));
  for (const action of Object.values(s.bindings)) expect(action).not.toHaveBeenCalled();
});
it('rejects arbitrary actions and bounds a cycle to four named actions', async () => {
  const s = fixture();
  expect(await s.service.run('force_resend' as never)).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
  expect(
    await s.service.cycle(['privacy', 'quotas', 'assets', 'analytics', 'sources']),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
});
it('redacts failures, continues independent actions and prevents overlapping local cycles', async () => {
  const s = fixture();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  s.bindings.privacy.mockImplementation(async () => {
    await blocked;
    return ok({ processed: 1 });
  });
  s.bindings.analytics.mockImplementation(async () => {
    throw Error('private@email.invalid');
  });
  const service = createServiceMaintenance({
    bindings: s.bindings,
    enabled: ['privacy', 'analytics', 'quotas'],
  });
  const first = service.cycle(['privacy', 'analytics', 'quotas']);
  await vi.waitFor(() => expect(s.bindings.privacy).toHaveBeenCalled());
  expect(await service.cycle(['privacy'])).toEqual(ok({ status: 'busy', results: [] }));
  release();
  const r = await first;
  expect(JSON.stringify(r)).not.toContain('@');
  expect(s.bindings.quotas).toHaveBeenCalledOnce();
  expect(r).toMatchObject({
    ok: true,
    value: {
      status: 'completed',
      results: [{ status: 'completed' }, { status: 'failed' }, { status: 'completed' }],
    },
  });
});
it('preserves safe typed failures and does not automatically retry an action', async () => {
  const s = fixture();
  s.bindings.privacy.mockImplementation(async () => fail(failure('unavailable')));
  const service = createServiceMaintenance({ bindings: s.bindings, enabled: ['privacy'] });
  expect(await service.run('privacy')).toEqual(
    ok({ action: 'privacy', status: 'failed', error: 'unavailable' }),
  );
  expect(s.bindings.privacy).toHaveBeenCalledOnce();
});
it('rejects invalid configuration and redacts invalid action results without leaking fields', async () => {
  const s = fixture();
  expect(() =>
    createServiceMaintenance({ bindings: s.bindings, enabled: ['privacy', 'privacy'] }),
  ).toThrow('configuration');
  expect(() =>
    createServiceMaintenance({ bindings: s.bindings, enabled: ['force_resend' as never] }),
  ).toThrow('configuration');
  s.bindings.privacy.mockResolvedValue(ok({ processed: 1001 }));
  const service = createServiceMaintenance({ bindings: s.bindings, enabled: ['privacy'] });
  expect(await service.run('privacy')).toMatchObject({
    ok: true,
    value: { status: 'failed', error: 'unavailable' },
  });
  expect(await service.cycle([])).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  expect(await service.cycle(['privacy', 'privacy'])).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
});
it('bounds individual invocation overlap and releases the guard after completion', async () => {
  const s = fixture();
  let release!: () => void;
  const blocked = new Promise<void>((r) => {
    release = r;
  });
  s.bindings.privacy.mockImplementation(async () => {
    await blocked;
    return ok({ processed: 0 });
  });
  const service = createServiceMaintenance({ bindings: s.bindings, enabled: ['privacy'] });
  const first = service.run('privacy');
  await vi.waitFor(() => expect(s.bindings.privacy).toHaveBeenCalledOnce());
  expect(await service.run('privacy')).toEqual(ok({ action: 'privacy', status: 'busy' }));
  release();
  await first;
  expect((await service.run('privacy')).ok).toBe(true);
});
