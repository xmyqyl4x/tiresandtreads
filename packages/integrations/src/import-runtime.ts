import { createImportService } from '../../application/src/services/ingestion.ts';
import { createIngestionRepository } from '../../db/src/repositories/ingestion.ts';
import { createPublicationRepository } from '../../db/src/repositories/publication.ts';
import { createImportOperations } from '../../db/src/repositories/import-operations.ts';
import { createTransactions } from '../../db/src/transactions.ts';
import { createRuntimePool } from '../../db/src/runtime-pool.ts';
import { decodeImportFact } from './import-files.ts';
import { instant, ok } from '../../domain/src/values/core.ts';
import { createSourceRepository } from '../../db/src/repositories/sources.ts';
import { createSourceRefresh } from '../../application/src/services/source-refresh.ts';
import { createNhtsaAdapter } from './sources/nhtsa.ts';
import type { SourceDefinition } from '../../application/src/ports/sources.ts';
import type { Id } from '../../domain/src/values/core.ts';

export async function createImportRuntime(env: Readonly<Record<string, string | undefined>>) {
  const urls = [env.INGEST_DATABASE_URL, env.PUBLISH_DATABASE_URL].map((raw, n) => {
    if (!raw) throw Error('Import database configuration required');
    const u = new URL(raw);
    if (
      !['postgres:', 'postgresql:'].includes(u.protocol) ||
      u.username !== ['tt_ingest_runtime', 'tt_publish_runtime'][n] ||
      !u.password
    )
      throw Error('Invalid import database role');
    return raw;
  });
  const a = new URL(urls[0]!),
    b = new URL(urls[1]!);
  if (a.hostname !== b.hostname || a.port !== b.port || a.pathname !== b.pathname)
    throw Error('Import databases must match');
  const other = Number(env.IMPORT_DB_OTHER_CONNECTIONS ?? '20'),
    reserve = Number(env.IMPORT_DB_RESERVE ?? '10');
  if (!Number.isSafeInteger(other) || other < 0 || !Number.isSafeInteger(reserve) || reserve < 10)
    throw Error('Invalid import connection budget');
  const pools = urls.map((url) => createRuntimePool(url, 1));
  const [ingestScope, publishScope] = pools.map((p) => createTransactions(p.pool));
  const ingest = ingestScope!,
    publish = publishScope!;
  const shutdown = () => Promise.all(pools.map((p) => p.drain())).then(() => {});
  try {
    for (const [n, scope] of [ingest, publish].entries()) {
      const checked = await scope.unitOfWork.run(async (tx) => {
        const r = (
          await scope.query(
            tx,
            "SELECT current_user AS role,current_setting('max_connections')::int AS capacity",
            [],
          )
        ).rows[0]!;
        if (
          r.role !== ['tt_ingest_runtime', 'tt_publish_runtime'][n] ||
          2 + other + reserve > Number(r.capacity)
        )
          throw Error('Invalid import connection budget');
        return ok(undefined);
      });
      if (!checked.ok) throw Error('Import runtime preflight failed');
    }
    const service = createImportService({
      ingest: createIngestionRepository(ingest),
      publisher: createIngestionRepository(publish),
      publish: createPublicationRepository(publish),
      operations: createImportOperations(ingest),
      publicationOperations: createImportOperations(publish),
      ingestUow: ingest.unitOfWork,
      publishUow: publish.unitOfWork,
      decode: decodeImportFact,
      expires: () => {
        const x = instant(new Date(Date.now() + 86400000).toISOString());
        if (!x.ok) throw Error('Clock unavailable');
        return x.value;
      },
    });
    const sources = createSourceRepository(ingest);
    return {
      service,
      sourceRefresh: createSourceRefresh({
        uow: ingest.unitOfWork,
        sources,
        adapter: createNhtsaAdapter(),
        imports: service,
      }),
      registerSource: (
        input: SourceDefinition & { actorId: Id<'staff'>; approvalId: Id<'audit_event'> },
      ) =>
        ingest.unitOfWork.run(async (tx) => {
          await sources.register(tx, input);
          return ok(input.id);
        }),
      shutdown,
    };
  } catch {
    await shutdown();
    throw Error('Import runtime unavailable');
  }
}
