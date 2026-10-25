import { ok, fail } from '../../../domain/src/values/core.ts';
import type { Id } from '../../../domain/src/values/index.ts';
import { failure, type UnitOfWork } from '../ports/transactions.ts';
import type {
  IngestionRepository,
  PublicationRepository,
  PublishInput,
  StagingRow,
} from '../ports/ingestion.ts';
import type {
  FactDecoder,
  ImportFact,
  ImportOperations,
  ImportSnapshot,
  RollbackInput,
  ImportClock,
} from '../ports/import-service.ts';

export function createImportService(deps: {
  readonly ingest: IngestionRepository;
  readonly publisher: IngestionRepository;
  readonly publish: PublicationRepository;
  readonly operations: ImportOperations;
  readonly publicationOperations: ImportOperations;
  readonly ingestUow: UnitOfWork;
  readonly publishUow: UnitOfWork;
  readonly decode: FactDecoder;
  readonly expires: ImportClock['expires'];
}) {
  const {
    ingest,
    publisher,
    publish,
    operations,
    publicationOperations,
    ingestUow,
    publishUow,
    decode,
  } = deps;
  return {
    // Dry-run and resume share this path: private staging/validation only, never a head change.
    async prepare(snapshot: ImportSnapshot) {
      const input = snapshot.registration;
      if (
        input.semantics !== 'complete_snapshot' ||
        !Number.isSafeInteger(input.expectedRows) ||
        input.expectedRows < 0 ||
        input.expectedRows > 100000
      )
        return fail(failure('invalid_input'));
      const registered = await ingestUow.run(async (tx) => {
        const datasetId = await ingest.dataset(tx, input);
        return ok(
          await ingest.register(tx, {
            datasetId,
            mode: 'full',
            identity: {
              providerId: input.providerId,
              kind: input.kind,
              checksum: input.checksum,
              upstreamRunKey: input.upstreamRunKey,
              schemaVersion: input.schemaVersion,
              mappingVersion: input.mappingVersion,
            },
          }),
        );
      });
      if (!registered.ok) return registered;
      if (['validated', 'published'].includes(registered.value.status))
        return registered.value.throughRow === BigInt(input.expectedRows) &&
          registered.value.rejected === 0n
          ? registered
          : fail(failure('integrity'));
      const claimed = await ingestUow.run(async (tx) =>
        ok(await ingest.lease(tx, registered.value.id, 300)),
      );
      if (!claimed.ok) return claimed;
      const lease = { runId: claimed.value.id, fence: claimed.value.fence };
      let count = 0n,
        ended = false;
      let batchBytes = 0;
      let batch: { row: StagingRow; fact: ImportFact | null }[] = [];
      const flush = () =>
        ingestUow.run(async (tx) => {
          await operations.renew(tx, lease.runId, lease.fence);
          await ingest.batch(
            tx,
            lease,
            batch.map((x) => x.row),
            deps.expires(),
          );
          // Only accepted rows materialize; duplicate source keys stay critical rejects.
          const staged = await ingest.staged(tx, lease, batch[0]!.row.rowNumber - 1n, batch.length);
          const accepted = batch.filter(
            (x): x is typeof x & { fact: ImportFact } =>
              x.fact !== null &&
              staged.some((s) => s.rowNumber === x.row.rowNumber && s.status === 'accepted'),
          );
          // Batch adjacent kinds while preserving parent-before-child source order.
          for (const x of accepted)
            for (const identity of x.fact.identities ?? []) await ingest.entity(tx, identity);
          for (let start = 0; start < accepted.length;) {
            const kind = accepted[start]!.fact.kind;
            let end = start + 1;
            while (end < accepted.length && accepted[end]!.fact.kind === kind) end++;
            await ingest.append(
              tx,
              lease,
              kind,
              accepted
                .slice(start, end)
                .map((x) => ({ rowNumber: x.row.rowNumber, record: x.fact.record })),
            );
            start = end;
          }
          return ok(undefined);
        });
      try {
        for await (const frame of snapshot.frames()) {
          if (ended) return fail(failure('integrity'));
          if ('end' in frame) {
            ended = true;
            continue;
          }
          if (++count > BigInt(input.expectedRows)) return fail(failure('integrity'));
          const parsed = decode(frame.row);
          const fact = parsed.ok ? parsed.value : null;
          const entry = {
            fact,
            row: {
              rowNumber: count,
              sourceKey: fact
                ? 'sourceRecordKey' in fact.record
                  ? fact.record.sourceRecordKey
                  : fact.record.id
                : 'invalid-row-' + count,
              normalized: fact
                ? JSON.parse(
                    JSON.stringify({ kind: fact.kind, record: fact.record }, (_key, v) =>
                      typeof v === 'bigint' ? v.toString() : v,
                    ),
                  )
                : { error: 'invalid_record' },
              status: fact ? ('accepted' as const) : ('rejected' as const),
            },
          };
          const bytes = new TextEncoder().encode(
            JSON.stringify(entry.row, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)),
          ).length;
          if (batch.length && batchBytes + bytes > 180000) {
            const r = await flush();
            if (!r.ok) return r;
            batch = [];
            batchBytes = 0;
          }
          batch.push(entry);
          batchBytes += bytes;
          if (batch.length === 25) {
            const r = await flush();
            if (!r.ok) return r;
            batch = [];
            batchBytes = 0;
          }
        }
        if (!ended || count !== BigInt(input.expectedRows)) return fail(failure('integrity'));
        if (batch.length) {
          const r = await flush();
          if (!r.ok) return r;
        }
        const validated = await publishUow.run(async (tx) => {
          await publish.validate(tx, lease, count, true);
          return ok(undefined);
        });
        if (!validated.ok) return validated;
        return ingestUow.run(async (tx) => ok(await operations.status(tx, lease.runId)));
      } catch {
        return fail(failure('invalid_input'));
      } finally {
        await ingestUow.run(async (tx) => {
          await operations.release(tx, lease.runId, lease.fence);
          return ok(undefined);
        });
      }
    },
    status(runId: Id<'import_run'>) {
      return ingestUow.run(async (tx) => ok(await operations.status(tx, runId)));
    },
    diff(runId: Id<'import_run'>, against: Id<'bundle'> | null) {
      return publishUow.run(async (tx) => ok(await publicationOperations.diff(tx, runId, against)));
    },
    publish(
      input: Omit<PublishInput, 'lease'> & {
        readonly runId: Id<'import_run'>;
        readonly members: Parameters<PublicationRepository['bundle']>[1]['members'];
      },
    ) {
      // Replays go to the repository receipt before lease acquisition.
      return publishUow.run(async (tx) => {
        const state = await publicationOperations.status(tx, input.runId);
        const lease =
          state.status === 'published'
            ? { runId: input.runId, fence: state.fence }
            : { runId: input.runId, fence: (await publisher.lease(tx, input.runId, 300)).fence };
        await publish.bundle(tx, {
          id: input.bundleId,
          market: input.market,
          members: input.members,
        });
        return ok(await publish.publish(tx, { ...input, lease }));
      });
    },
    rollback(input: RollbackInput) {
      return publishUow.run(async (tx) => ok(await publicationOperations.rollback(tx, input)));
    },
  };
}
