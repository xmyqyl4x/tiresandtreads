import { it, expect, vi } from 'vitest';
import {
  createAdmissionServices,
  createAnalyticsServices,
} from '../../packages/application/src/services/analytics.ts';
import { ServiceFault } from '../../packages/application/src/services/service-work.ts';
import {
  ok,
  fail,
  type Id,
  type Revision,
  type Instant,
} from '../../packages/domain/src/values/core.ts';
import {
  failure,
  type UnitOfWork,
  type TransactionContext,
} from '../../packages/application/src/ports/transactions.ts';
import type { AnalyticsRepository } from '../../packages/application/src/ports/analytics.ts';
const uuid = '88888888-8888-4888-8888-888888888888',
  now = '2026-10-26T12:00:00.000Z';
const uow: UnitOfWork = { run: async (fn) => fn({} as TransactionContext) };
function setup() {
  const limiter = {
      consume: vi.fn(async () => ({ allowed: true as const })),
      cleanup: vi.fn(async () => 0),
    },
    admission = createAdmissionServices({
      uow,
      limiter,
      crypto: { versions: ['v1'], keys: () => [{ keyVersion: 'v1', digest: 'a'.repeat(64) }] },
    });
  const repo: AnalyticsRepository = {
    receive: vi.fn(async () => ({ inserted: 1 })),
    capture: vi.fn(async () => null),
    publish: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    cleanup: vi.fn(async () => 0),
    purgeSubject: vi.fn(async () => 0),
  };
  const deps = {
    authorityUow: uow,
    analyticsUow: uow,
    rebuildUow: uow,
    authority: { grant: vi.fn(async () => null) },
    events: repo,
    rebuild: repo,
    maintenance: { purgeWithdrawn: vi.fn(async () => 0), expireGenerations: vi.fn(async () => 0) },
    crypto: { issue: vi.fn(() => ''), parse: vi.fn(() => null) },
    admission,
    enabled: true,
    policy: 'v1',
    noticeId: uuid as Id<'notice'>,
    now: () => now,
  };
  return { deps, repo, limiter, service: createAnalyticsServices(deps) };
}
it('UC08 refuses optional collection without reaching an unavailable database when GPC/CMP denies it', async () => {
  const s = setup(),
    unavailable: UnitOfWork = { run: async () => fail(failure('unavailable')) };
  const service = createAnalyticsServices({
    ...s.deps,
    authorityUow: unavailable,
    analyticsUow: unavailable,
  });
  expect(await service.issue([], { gpc: true, cmpAvailable: true })).toEqual(
    ok({ status: 'refused' }),
  );
  expect(
    await service.collect('token', '{}', {
      gpc: false,
      cmpAvailable: false,
      bot: 'unknown',
      ip: '192.0.2.1',
    }),
  ).toEqual(ok({ status: 'refused' }));
  expect(s.repo.receive).not.toHaveBeenCalled();
});
it('DB17 empty work is harmless and a publication conflict leaves bounded retry intent', async () => {
  const s = setup();
  expect(await s.service.rebuildOne()).toEqual(ok(null));
  vi.mocked(s.repo.capture).mockResolvedValue({
    day: '2026-10-26',
    token: uuid as Id<'lease'>,
    generation: 1n as Revision,
    privacyRevision: 0n,
    validUntil: now as Instant,
    metrics: [],
  });
  vi.mocked(s.repo.publish).mockRejectedValue(new ServiceFault('conflict'));
  expect(await s.service.rebuildOne()).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(s.repo.retry).toHaveBeenCalledOnce();
});
it('DB19 disabled required quota policy fails closed with an unavailable result', async () => {
  const s = setup();
  s.limiter.consume.mockRejectedValue(new ServiceFault('forbidden'));
  expect(
    await s.deps.admission.admit('report_delivery', {
      ip: '192.0.2.1',
      email: 'fixture@example.invalid',
    }),
  ).toMatchObject({ ok: false, error: { code: 'unavailable' } });
});
it('rejects invalid server signals and cleanup bounds before behavioral work', async () => {
  const s = setup();
  expect((await s.service.issue([], { gpc: 'bad', cmpAvailable: true } as never)).ok).toBe(false);
  expect(
    (
      await s.service.collect('token', '{}', {
        gpc: false,
        cmpAvailable: true,
        bot: 'client-override',
        ip: '192.0.2.1',
      } as never)
    ).ok,
  ).toBe(false);
  expect((await s.service.maintenance(1001)).ok).toBe(false);
  expect(s.repo.receive).not.toHaveBeenCalled();
});
