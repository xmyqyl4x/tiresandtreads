import type {
  IngestionRepository,
  Lease,
  RunState,
  StagingRow,
} from '../../../application/src/ports/ingestion.ts';
import type { TransactionContext } from '../../../application/src/ports/transactions.ts';
import { id, revision, instant } from '../../../domain/src/values/index.ts';
import type { Sql } from './catalog.ts';
import { boundedJson, pageLimit, reject } from './bounds.ts';
import { spec, encode } from './codec.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
export { stop } from './mutations.ts';
export function runState(row: Record<string, unknown>): RunState {
  const run = id('import_run', row.id),
    dataset = id('dataset', row.dataset_version_id),
    rev = revision(row.revision);
  const checkpoint = row.checkpoint as Record<string, unknown> | null;
  if (
    !run.ok ||
    !dataset.ok ||
    !rev.ok ||
    !checkpoint ||
    checkpoint.schemaVersion !== 1 ||
    typeof checkpoint.throughRow !== 'string' ||
    !/^\d{1,19}$/.test(checkpoint.throughRow)
  )
    return stop('integrity');
  return Object.freeze({
    id: run.value,
    datasetId: dataset.value,
    revision: rev.value,
    fence: BigInt(String(row.fence)),
    status: String(row.status),
    throughRow: BigInt(checkpoint.throughRow),
    accepted: BigInt(String(row.accepted_count)),
    rejected: BigInt(String(row.rejected_count)),
  });
}
const runColumns =
  'r.id,r.dataset_version_id,r.revision,r.fence,r.status,r.checkpoint,r.accepted_count,r.rejected_count';
export async function lockedRun(
  sql: Sql,
  tx: TransactionContext,
  lease: Lease,
  status = 'staging',
): Promise<RunState> {
  const result = await sql(
    tx,
    `SELECT ${runColumns} FROM app.import_runs r JOIN app.dataset_versions d ON d.id=r.dataset_version_id
    JOIN app.data_licenses l ON l.id=d.license_id JOIN app.data_providers p ON p.id=d.provider_id
    WHERE r.id=$1 AND r.fence=$2 AND r.lease_until>clock_timestamp() AND r.status=$3
    AND p.status='active' AND l.rights_schema_version=1 AND l.rights->>'cache'='true'
    AND l.reviewed_at<=statement_timestamp() AND l.effective_at<=statement_timestamp() AND (l.expires_at IS NULL OR l.expires_at>statement_timestamp()) FOR UPDATE OF r`,
    [lease.runId, lease.fence.toString(), status],
  );
  if (!result.rows[0]) return stop('conflict');
  return runState(result.rows[0]);
}
function normalized(record: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      typeof item === 'bigint' ? item.toString() : item,
    ]),
  );
}
export function createIngestionRepository(scope: WriteScope): IngestionRepository {
  const sql = scope.query;
  return guarded<IngestionRepository>(scope, {
    async dataset(tx, input) {
      const args = [
        input.id,
        input.providerId,
        input.licenseId,
        input.kind,
        input.externalVersion,
        input.checksum,
        input.effectiveAt,
        input.fetchedAt,
      ];
      await sql(
        tx,
        `INSERT INTO app.dataset_versions(id,provider_id,license_id,kind,external_version,checksum,effective_at,fetched_at,row_count)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,0 FROM app.data_licenses l JOIN app.data_providers p ON p.id=l.provider_id
        WHERE l.id=$3 AND l.provider_id=$2 AND p.status='active' AND l.rights_schema_version=1 AND l.rights->>'cache'='true'
        AND l.reviewed_at<=statement_timestamp() AND l.effective_at<=statement_timestamp() AND (l.expires_at IS NULL OR l.expires_at>statement_timestamp())
        ON CONFLICT(provider_id,kind,external_version) DO NOTHING`,
        args,
      );
      const result = await sql(
        tx,
        `SELECT id FROM app.dataset_versions WHERE provider_id=$1 AND kind=$2 AND external_version=$3 AND license_id=$4 AND checksum=$5 AND effective_at=$6 AND fetched_at=$7`,
        [
          input.providerId,
          input.kind,
          input.externalVersion,
          input.licenseId,
          input.checksum,
          input.effectiveAt,
          input.fetchedAt,
        ],
      );
      const parsed = id('dataset', result.rows[0]?.id);
      if (!parsed.ok) return stop('conflict');
      return parsed.value;
    },
    async entity(tx, input) {
      await sql(
        tx,
        `INSERT INTO app.domain_entities(id,kind,stable_key,status) VALUES($1,$2,$3,'active') ON CONFLICT(stable_key) DO NOTHING`,
        [input.id, input.kind, input.stableKey],
      );
      const found = await sql(
        tx,
        'SELECT id FROM app.domain_entities WHERE stable_key=$1 AND id=$2 AND kind=$3',
        [input.stableKey, input.id, input.kind],
      );
      if (!found.rowCount) return stop('conflict');
    },
    async register(tx, input) {
      const i = input.identity;
      const dataset = await sql(tx, 'SELECT id FROM app.dataset_versions WHERE id=$1 FOR UPDATE', [
        input.datasetId,
      ]);
      if (!dataset.rowCount) return stop('not_found');
      const other = await sql(
        tx,
        'SELECT id FROM app.import_runs WHERE dataset_version_id=$1 AND (provider_id<>$2 OR upstream_run_key<>$3)',
        [input.datasetId, i.providerId, i.upstreamRunKey],
      );
      if (other.rowCount) return stop('conflict');
      await sql(
        tx,
        `INSERT INTO app.import_runs(provider_id,dataset_version_id,status,checkpoint,started_at,upstream_run_key,mode,mapping_version,content_hash,schema_version)
        SELECT $1,d.id,'registered','{"schemaVersion":1,"throughRow":"0","complete":false}',clock_timestamp(),$3,$4,$5,$6,$7
        FROM app.dataset_versions d WHERE d.id=$2 AND d.provider_id=$1 AND d.kind=$8 AND d.checksum=$6 AND d.status='staging'
        ON CONFLICT(provider_id,upstream_run_key) DO NOTHING`,
        [
          i.providerId,
          input.datasetId,
          i.upstreamRunKey,
          input.mode,
          i.mappingVersion,
          i.checksum,
          i.schemaVersion,
          i.kind,
        ],
      );
      const result = await sql(
        tx,
        `SELECT ${runColumns} FROM app.import_runs r JOIN app.dataset_versions d ON d.id=r.dataset_version_id
        WHERE r.provider_id=$1 AND r.upstream_run_key=$2 AND r.dataset_version_id=$3 AND r.mode=$4 AND r.mapping_version=$5 AND r.content_hash=$6 AND r.schema_version=$7 AND d.kind=$8`,
        [
          i.providerId,
          i.upstreamRunKey,
          input.datasetId,
          input.mode,
          i.mappingVersion,
          i.checksum,
          i.schemaVersion,
          i.kind,
        ],
      );
      if (!result.rows[0]) return stop('conflict');
      return runState(result.rows[0]);
    },
    async lease(tx, runId, seconds) {
      if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 300) return reject();
      const result = await sql(
        tx,
        `UPDATE app.import_runs r SET status=CASE WHEN status='validated' THEN 'validated' ELSE 'staging' END,fence=fence+1,lease_until=clock_timestamp()+$2*interval '1 second',updated_at=clock_timestamp(),revision=revision+1
        WHERE id=$1 AND status IN ('registered','staging','failed','validated') AND (lease_until IS NULL OR lease_until<=clock_timestamp()) RETURNING ${runColumns}`,
        [runId, seconds],
      );
      if (!result.rows[0]) return stop('conflict');
      return runState(result.rows[0]);
    },
    async batch(tx, lease, rows, expiresAt) {
      if (rows.length < 1 || rows.length > 100 || !instant(expiresAt).ok) return reject();
      const encoded = rows.map((row, index) => {
        if (
          row.rowNumber < 1n ||
          row.rowNumber > 9223372036854775807n ||
          (index > 0 && row.rowNumber !== rows[index - 1]!.rowNumber + 1n) ||
          row.sourceKey.trim().length < 1 ||
          row.sourceKey.length > 512 ||
          !['accepted', 'rejected', 'duplicate'].includes(row.status)
        )
          return reject();
        return {
          row_number: row.rowNumber.toString(),
          source_key: row.sourceKey,
          normalized: JSON.parse(boundedJson(row.normalized, 16384)),
          validation_status: row.status,
        };
      });
      boundedJson(encoded, 262144);
      const state = await lockedRun(sql, tx, lease),
        first = rows[0]!.rowNumber,
        last = rows.at(-1)!.rowNumber;
      if (last <= state.throughRow) {
        const existing = await sql(
          tx,
          `SELECT row_number,source_key,normalized,validation_status FROM app.import_staging_rows WHERE run_id=$1 AND row_number BETWEEN $2 AND $3 ORDER BY row_number`,
          [lease.runId, first.toString(), last.toString()],
        );
        if (
          existing.rowCount !== rows.length ||
          existing.rows.some(
            (r, n) =>
              r.source_key !== encoded[n]!.source_key ||
              boundedJson(r.normalized, 16384) !== boundedJson(encoded[n]!.normalized, 16384) ||
              (r.validation_status !== encoded[n]!.validation_status &&
                !(
                  r.validation_status === 'duplicate' &&
                  encoded[n]!.validation_status === 'accepted'
                )),
          )
        )
          return stop('conflict');
        return state;
      }
      if (first !== state.throughRow + 1n) return stop('conflict');
      const duplicates = await sql(
        tx,
        'SELECT DISTINCT source_key FROM app.import_staging_rows WHERE run_id=$1 AND source_key=ANY($2::text[])',
        [lease.runId, encoded.map((r) => r.source_key)],
      );
      const seen = new Set(duplicates.rows.map((r) => String(r.source_key)));
      for (const row of encoded) {
        if (seen.has(row.source_key)) row.validation_status = 'duplicate';
        seen.add(row.source_key);
      }
      const accepted = encoded.filter((r) => r.validation_status === 'accepted').length;
      const inserted = await sql(
        tx,
        `INSERT INTO app.import_staging_rows(run_id,row_number,source_key,normalized,validation_status,expires_at)
        SELECT $1,x.row_number,x.source_key,x.normalized,x.validation_status,$3 FROM jsonb_to_recordset($2::jsonb) x(row_number bigint,source_key text,normalized jsonb,validation_status text)
        WHERE $3::timestamptz>clock_timestamp() AND $3::timestamptz<=clock_timestamp()+interval '30 days'`,
        [lease.runId, boundedJson(encoded, 262144), expiresAt],
      );
      if (inserted.rowCount !== rows.length) return reject();
      const updated = await sql(
        tx,
        `UPDATE app.import_runs r SET accepted_count=accepted_count+$2,rejected_count=rejected_count+$3,checkpoint=jsonb_build_object('schemaVersion',1,'throughRow',$4::text,'complete',false),updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1 RETURNING ${runColumns}`,
        [lease.runId, accepted, rows.length - accepted, last.toString()],
      );
      return runState(updated.rows[0]!);
    },
    async staged(tx, lease, after, limit) {
      pageLimit(limit);
      if (after < 0n) return reject();
      await lockedRun(sql, tx, lease);
      const result = await sql(
        tx,
        `SELECT row_number,source_key,normalized,validation_status FROM app.import_staging_rows WHERE run_id=$1 AND row_number>$2 ORDER BY row_number LIMIT $3`,
        [lease.runId, after.toString(), limit],
      );
      return result.rows.map((r) => ({
        rowNumber: BigInt(String(r.row_number)),
        sourceKey: String(r.source_key),
        normalized: JSON.parse(boundedJson(r.normalized, 16384)),
        status: r.validation_status as StagingRow['status'],
      }));
    },
    async append(tx, lease, kind, records) {
      if (
        records.length < 1 ||
        records.length > 100 ||
        new Set(records.map((r) => r.rowNumber)).size !== records.length
      )
        return reject();
      const definition = spec(kind),
        entries = Object.entries(definition.fields);
      const values = records.map((r) => encode(kind, r.record));
      boundedJson(values, 262144);
      const state = await lockedRun(sql, tx, lease);
      const staged = await sql(
        tx,
        `SELECT row_number,source_key,normalized FROM app.import_staging_rows WHERE run_id=$1 AND row_number=ANY($2::bigint[]) AND validation_status='accepted' AND expires_at>clock_timestamp()`,
        [lease.runId, records.map((r) => r.rowNumber.toString())],
      );
      if (
        staged.rowCount !== records.length ||
        records.some(
          (r) =>
            !staged.rows.some(
              (s) =>
                String(s.row_number) === r.rowNumber.toString() &&
                s.source_key ===
                  ('sourceRecordKey' in r.record ? r.record.sourceRecordKey : r.record.id) &&
                boundedJson(s.normalized, 16384) ===
                  boundedJson({ kind, record: normalized(r.record) }, 16384),
            ),
        )
      )
        return stop('integrity');
      const dataset = await sql(
        tx,
        "SELECT id FROM app.dataset_versions WHERE id=$1 AND status='staging' FOR SHARE",
        [state.datasetId],
      );
      if (!dataset.rowCount) return stop('conflict');
      const prior = await sql(
        tx,
        'SELECT row_number,record_kind,record_id FROM app.import_materializations WHERE run_id=$1 AND row_number=ANY($2::bigint[])',
        [lease.runId, records.map((r) => r.rowNumber.toString())],
      );
      const pending = records
        .map((r, n) => ({ r, n }))
        .filter(({ r }) => {
          const old = prior.rows.find((p) => String(p.row_number) === r.rowNumber.toString());
          if (old && (old.record_kind !== kind || old.record_id !== r.record.id))
            return stop('conflict');
          return !old;
        });
      if (!pending.length) return;
      const parameters: unknown[] = [];
      const tuples = pending.map(({ n }) => {
        const items = [state.datasetId, ...values[n]!];
        return (
          '(' +
          items
            .map((item) => {
              parameters.push(item);
              return '$' + parameters.length;
            })
            .join(',') +
          ')'
        );
      });
      await sql(
        tx,
        `INSERT INTO app.${definition.table}(dataset_version_id,${entries.map(([, f]) => f.column).join(',')}) VALUES ${tuples.join(',')}`,
        parameters,
      );
      await sql(
        tx,
        `INSERT INTO app.import_materializations(run_id,row_number,record_kind,record_id) SELECT $1,x.row_number,$2,x.record_id FROM jsonb_to_recordset($3::jsonb) x(row_number bigint,record_id uuid)`,
        [
          lease.runId,
          kind,
          boundedJson(
            pending.map(({ r }) => ({
              row_number: r.rowNumber.toString(),
              record_id: r.record.id,
            })),
            262144,
          ),
        ],
      );
    },
  });
}
