import { it, expect, vi } from 'vitest';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import {
  failure,
  type UnitOfWork,
  type TransactionContext,
} from '../../packages/application/src/ports/transactions.ts';
import { createSourceRefresh } from '../../packages/application/src/services/source-refresh.ts';
import type {
  SourceAdapter,
  SourceRepository,
  SourceLease,
} from '../../packages/application/src/ports/sources.ts';
import type { createImportService } from '../../packages/application/src/services/ingestion.ts';
import type { ImportSnapshot } from '../../packages/application/src/ports/import-service.ts';
const tx = {} as TransactionContext;
function fixture() {
  const lease = {
    id: 'connector',
    spec: { type: 'nhtsa-tire-recalls' },
    previous: { checksum: 'hash', datasetId: 'dataset', runId: 'run', validators: {} },
  } as unknown as SourceLease;
  const sources = {
    claim: vi.fn(async () => lease),
    complete: vi.fn(),
    failed: vi.fn(),
    canonical: vi.fn(async (r) => r),
    due: vi.fn(async () => [lease.id]),
    recallReady: vi.fn(async () => false),
  } as unknown as SourceRepository;
  const adapter: SourceAdapter = {
    pull: vi.fn(async () => ok({ changed: false as const, full: false, validators: {} })),
  };
  const imports = {
    prepare: vi.fn(async () => ok({ id: 'run', datasetId: 'dataset' })),
  } as unknown as Pick<ReturnType<typeof createImportService>, 'prepare'>;
  const uow: UnitOfWork = { run: (work) => work(tx) };
  return {
    lease,
    sources,
    adapter,
    imports,
    uow,
    service: createSourceRefresh({ sources, adapter, imports, uow }),
  };
}
it('does not fetch while a lease is held, not due, or source rights are denied', async () => {
  const f = fixture();
  vi.mocked(f.sources.claim).mockResolvedValueOnce(null);
  expect(await f.service.refresh(f.lease.id)).toEqual(ok(null));
  expect(f.adapter.pull).not.toHaveBeenCalled();
  vi.mocked(f.sources.claim).mockResolvedValueOnce({ denied: true });
  expect(await f.service.refresh(f.lease.id)).toMatchObject({ error: { code: 'forbidden' } });
  expect(f.adapter.pull).not.toHaveBeenCalled();
});
it('records no-change success only over a previously validated receipt', async () => {
  const f = fixture();
  expect(await f.service.refresh(f.lease.id)).toMatchObject({
    ok: true,
    value: { state: 'unchanged' },
  });
  expect(f.sources.complete).toHaveBeenCalledWith(tx, f.lease, f.lease.previous, false);
  expect(f.imports.prepare).not.toHaveBeenCalled();
  vi.mocked(f.sources.claim).mockResolvedValueOnce({ ...f.lease, previous: null });
  expect(await f.service.refresh(f.lease.id)).toMatchObject({ error: { code: 'integrity' } });
});
it('turns network and source contract failures into bounded persisted failures', async () => {
  for (const code of ['unavailable', 'integrity'] as const) {
    const f = fixture();
    vi.mocked(f.adapter.pull).mockResolvedValueOnce(fail(failure(code)));
    expect((await f.service.refresh(f.lease.id)).ok).toBe(false);
    expect(f.sources.failed).toHaveBeenCalledWith(
      tx,
      f.lease,
      code === 'unavailable' ? 'source_unavailable' : 'source_contract',
    );
  }
});
it('persists unexpected adapter outages instead of abandoning the rest of a scheduler tick', async () => {
  const f = fixture();
  vi.mocked(f.adapter.pull).mockRejectedValueOnce(Error('private provider detail'));
  expect(await f.service.refresh(f.lease.id)).toMatchObject({ error: { code: 'unavailable' } });
  expect(f.sources.failed).toHaveBeenCalledWith(tx, f.lease, 'source_unavailable');
});
it('cleans private artifacts after canonical registration, validation, and fenced health completion', async () => {
  const f = fixture(),
    cleanup = vi.fn(async () => {}),
    snapshot = { registration: { id: 'dataset' } } as unknown as ImportSnapshot;
  vi.mocked(f.adapter.pull).mockResolvedValue(
    ok({ changed: true, checksum: 'hash', snapshot, validators: {}, cleanup }),
  );
  expect(await f.service.refresh(f.lease.id)).toMatchObject({
    ok: true,
    value: { state: 'validated' },
  });
  expect(f.sources.canonical).toHaveBeenCalledWith(tx, snapshot.registration);
  expect(cleanup).toHaveBeenCalled();
  vi.mocked(f.imports.prepare).mockResolvedValueOnce(fail(failure('integrity')));
  expect((await f.service.refresh(f.lease.id)).ok).toBe(false);
  expect(f.sources.failed).toHaveBeenCalledWith(tx, f.lease, 'source_contract');
  expect(cleanup).toHaveBeenCalledTimes(2);
});
it('limits a scheduler tick to repository-selected work and refuses stale recall readiness', async () => {
  const f = fixture();
  expect(await f.service.tick()).toMatchObject({ ok: true });
  expect(f.adapter.pull).toHaveBeenCalledTimes(1);
  expect(await f.service.requireRecall(f.lease.previous!.datasetId)).toMatchObject({
    error: { code: 'unavailable' },
  });
  vi.mocked(f.sources.recallReady).mockResolvedValueOnce(true);
  expect(await f.service.requireRecall(f.lease.previous!.datasetId)).toEqual(ok(undefined));
});
