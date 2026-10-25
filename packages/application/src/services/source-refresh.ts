import { ok, fail } from '../../../domain/src/values/core.ts';
import type { Id } from '../../../domain/src/values/core.ts';
import { failure, type UnitOfWork } from '../ports/transactions.ts';
import type { SourceRepository, SourceAdapter } from '../ports/sources.ts';
import type { createImportService } from './ingestion.ts';
export function createSourceRefresh(deps: {
  readonly uow: UnitOfWork;
  readonly sources: SourceRepository;
  readonly adapter: SourceAdapter;
  readonly imports: Pick<ReturnType<typeof createImportService>, 'prepare'>;
}) {
  const { uow, sources, adapter, imports } = deps;
  async function refresh(id: Id<'source_connector'>) {
    const claimed = await uow.run(async (tx) => ok(await sources.claim(tx, id)));
    if (!claimed.ok || !claimed.value) return claimed;
    if ('denied' in claimed.value) return fail(failure('forbidden'));
    const lease = claimed.value;
    let pulled: Awaited<ReturnType<SourceAdapter['pull']>>;
    try {
      pulled = await adapter.pull(lease);
    } catch {
      pulled = fail(failure('unavailable'));
    }
    if (!pulled.ok) {
      await uow.run(async (tx) => {
        await sources.failed(
          tx,
          lease,
          pulled.error.code === 'unavailable' ? 'source_unavailable' : 'source_contract',
        );
        return ok(undefined);
      });
      return pulled;
    }
    const value = pulled.value;
    try {
      if (!value.changed) {
        if (!lease.previous) return fail(failure('integrity'));
        return uow.run(async (tx) => {
          await sources.complete(
            tx,
            lease,
            { ...lease.previous!, validators: value.validators },
            value.full,
          );
          return ok({ state: 'unchanged' as const, datasetId: lease.previous!.datasetId });
        });
      }
      const canonical = await uow.run(async (tx) =>
        ok(await sources.canonical(tx, value.snapshot.registration)),
      );
      if (!canonical.ok) {
        await uow.run(async (tx) => {
          await sources.failed(tx, lease, 'source_contract');
          return ok(undefined);
        });
        return canonical;
      }
      const prepared = await imports.prepare({ ...value.snapshot, registration: canonical.value });
      if (!prepared.ok) {
        await uow.run(async (tx) => {
          await sources.failed(tx, lease, 'source_contract');
          return ok(undefined);
        });
        return prepared;
      }
      return uow.run(async (tx) => {
        await sources.complete(
          tx,
          lease,
          {
            checksum: value.checksum,
            datasetId: prepared.value.datasetId,
            runId: prepared.value.id,
            validators: value.validators,
          },
          true,
        );
        return ok({ state: 'validated' as const, datasetId: prepared.value.datasetId });
      });
    } finally {
      if (value.changed) await value.cleanup();
    }
  }
  return {
    refresh,
    async tick() {
      const due = await uow.run(async (tx) => ok(await sources.due(tx)));
      if (!due.ok) return due;
      const results = [];
      for (const id of due.value) results.push({ id, result: await refresh(id) });
      return ok(results);
    },
    requireRecall(dataset: Id<'dataset'>) {
      return uow.run(async (tx) =>
        (await sources.recallReady(tx, dataset)) ? ok(undefined) : fail(failure('unavailable')),
      );
    },
  };
}
