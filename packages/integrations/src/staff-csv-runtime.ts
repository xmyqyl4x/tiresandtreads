import type { createTransactions } from '../../db/src/transactions.ts';
import type {
  CsvRuntimeIdentity,
  CsvFiles,
  CsvMapping,
} from '../../application/src/ports/staff-csv.ts';
import { createStaffCsvServices } from '../../application/src/imports/staff-csv.ts';
import { createStaffCsvRepository } from '../../db/src/repositories/staff-csv.ts';
import { createCsvReviewRepository } from '../../db/src/repositories/csv-reviews.ts';
import { createIngestionRepository } from '../../db/src/repositories/ingestion.ts';
import { createPublicationRepository } from '../../db/src/repositories/publication.ts';
import { createImportOperations } from '../../db/src/repositories/import-operations.ts';
import { decodeImportFact } from './import-files.ts';
import { ok } from '../../domain/src/values/core.ts';
type Scope = ReturnType<typeof createTransactions>;
// Host owns/budgets all pools. This factory selects no credentials, file path, URL or provider.
export async function createStaffCsvRuntime(
  o: Readonly<{
    staff: Scope;
    ingest: Scope;
    publish: Scope;
    files: CsvFiles;
    crypto: CsvRuntimeIdentity;
    mappings: readonly CsvMapping[];
    parserRevision: string;
    now: () => string;
  }>,
) {
  let database: unknown;
  for (const [scope, expected] of [
    [o.staff, 'tt_p2_csv_staff'],
    [o.ingest, 'tt_ingest_runtime'],
    [o.publish, 'tt_publish_runtime'],
  ] as const) {
    const r = await scope.unitOfWork.run(async (tx) =>
      ok(
        (await scope.query(tx, 'SELECT current_user AS role,current_database() AS database'))
          .rows[0],
      ),
    );
    if (
      !r.ok ||
      r.value?.role !== expected ||
      (database !== undefined && database !== r.value.database)
    )
      throw Error('Invalid CSV role/database composition');
    database = r.value.database;
  }
  return createStaffCsvServices({
    staffUow: o.staff.unitOfWork,
    ingestUow: o.ingest.unitOfWork,
    publishUow: o.publish.unitOfWork,
    staff: createStaffCsvRepository(o.staff),
    ingestSupport: createStaffCsvRepository(o.ingest),
    publishSupport: createStaffCsvRepository(o.publish),
    csv: createCsvReviewRepository(o.staff),
    ingest: createIngestionRepository(o.ingest),
    publisher: createIngestionRepository(o.publish),
    publish: createPublicationRepository(o.publish),
    operations: createImportOperations(o.ingest),
    publicationOperations: createImportOperations(o.publish),
    decode: decodeImportFact,
    files: o.files,
    crypto: o.crypto,
    mappings: o.mappings,
    parserRevision: o.parserRevision,
    now: o.now,
  });
}
