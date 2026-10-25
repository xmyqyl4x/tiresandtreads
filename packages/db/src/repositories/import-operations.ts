import type {
  ImportOperations,
  RollbackInput,
} from '../../../application/src/ports/import-service.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { lockedRun, runState } from './ingestion.ts';
import { facts } from './facts.ts';
import { digest } from './bounds.ts';
import type { FactKind } from '../../../application/src/ports/catalog-records.ts';

export function rollbackDigest(input: RollbackInput) {
  return digest([
    'rollback',
    input.market,
    input.bundleId,
    input.expectedHead.bundleId,
    input.expectedHead.revision.toString(),
    input.actorId,
  ]);
}
export function createImportOperations(scope: WriteScope): ImportOperations {
  const q = scope.query;
  return guarded<ImportOperations>(scope, {
    async status(tx, runId) {
      const r = await q(tx, 'SELECT * FROM app.import_runs WHERE id=$1', [runId]);
      if (!r.rows[0]) return stop('not_found');
      return runState(r.rows[0]);
    },
    async release(tx, runId, fence) {
      await q(tx, 'UPDATE app.import_runs SET lease_until=NULL WHERE id=$1 AND fence=$2', [
        runId,
        fence.toString(),
      ]);
    },
    async renew(tx, runId, fence) {
      await lockedRun(q, tx, { runId, fence });
      await q(
        tx,
        "UPDATE app.import_runs SET lease_until=clock_timestamp()+interval '300 seconds' WHERE id=$1 AND fence=$2",
        [runId, fence.toString()],
      );
    },
    async diff(tx, runId, against) {
      const found = await q(tx, 'SELECT dataset_version_id FROM app.import_runs WHERE id=$1', [
        runId,
      ]);
      if (!found.rowCount) return stop('not_found');
      if (
        against &&
        !(
          await q(tx, "SELECT id FROM app.dataset_bundles WHERE id=$1 AND status='published'", [
            against,
          ])
        ).rowCount
      )
        return stop('not_found');
      const result = [];
      for (const [kind, definition] of Object.entries(facts)) {
        const fields = Object.entries(definition.fields);
        const source =
          'sourceRecordKey' in definition.fields ? 'f.source_record_key' : 'f.id::text';
        const object = fields
          .filter(([key]) => key !== 'id')
          .map(
            ([key, f]) =>
              `'${key}',${f.codec === 'instant' ? `to_char(f.${f.column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` : f.codec === 'bigint' ? `f.${f.column}::text` : `f.${f.column}`}`,
          )
          .join(',');
        const decimals = fields
          .filter(([, f]) => f.codec === 'decimal')
          .map(([key]) => `'${key}',(normalized#>>'{record,${key}}')::numeric`)
          .join(',');
        const candidateValue = `((normalized->'record')-'id')${decimals ? ` || jsonb_build_object(${decimals})` : ''}`;
        const r = (
          await q(
            tx,
            `WITH prior AS (
          SELECT ${source} AS key,jsonb_build_object(${object}) AS value FROM app.${definition.table} f
          JOIN app.bundle_members m ON m.dataset_version_id=f.dataset_version_id AND m.bundle_id=$2
          JOIN app.dataset_versions d ON d.id=f.dataset_version_id JOIN app.dataset_versions n ON n.id=$3 AND n.kind=d.kind
        ), candidate AS (SELECT source_key AS key,${candidateValue} AS value FROM app.import_staging_rows WHERE run_id=$1 AND validation_status='accepted' AND normalized->>'kind'=$4)
        SELECT count(*) FILTER(WHERE p.key IS NULL)::text AS added,count(*) FILTER(WHERE c.key IS NULL)::text AS removed,
        count(*) FILTER(WHERE p.key IS NOT NULL AND c.key IS NOT NULL AND p.value IS DISTINCT FROM c.value)::text AS changed
        FROM prior p FULL JOIN candidate c USING(key)`,
            [runId, against, found.rows[0]!.dataset_version_id, kind],
          )
        ).rows[0]!;
        result.push({
          kind: kind as FactKind,
          added: BigInt(String(r.added)),
          removed: BigInt(String(r.removed)),
          changed: BigInt(String(r.changed)),
        });
      }
      return result;
    },
    async rollback(tx, input) {
      const revision = (input.expectedHead.revision + 1n).toString();
      // Reauthorize even a replay. This digest binds target, expected head and actor.
      const approved = await q(
        tx,
        `SELECT a.id FROM admin.audit_events a JOIN admin.staff_identities s ON s.id=$2 AND s.status='active'
        WHERE a.id=$1 AND a.action='import.rollback' AND a.resource_kind='dataset_bundle' AND a.result='approved' AND a.change_digest=$3 AND a.occurred_at<=statement_timestamp()`,
        [input.approvalId, input.actorId, rollbackDigest(input)],
      );
      if (!approved.rowCount) return stop('forbidden');
      const receipt = (
        await q(tx, 'SELECT aggregate_id,event_type,payload FROM app.outbox WHERE event_id=$1', [
          input.approvalId,
        ])
      ).rows[0];
      if (receipt) {
        if (
          receipt.aggregate_id !== input.bundleId ||
          receipt.event_type !== 'dataset_bundle.rolled_back' ||
          (receipt.payload as Record<string, unknown>).revision !== revision
        )
          return stop('conflict');
        return input.bundleId;
      }
      await q(tx, 'SELECT app.lock_publication_sources($1)', [input.bundleId]);
      const allowed = await q(
        tx,
        `SELECT b.id FROM app.dataset_bundles b WHERE b.id=$1 AND b.market=$2 AND b.status='published'
        AND EXISTS(SELECT 1 FROM app.bundle_members WHERE bundle_id=b.id)
        AND NOT EXISTS(SELECT 1 FROM app.bundle_members m JOIN app.dataset_versions d ON d.id=m.dataset_version_id
          JOIN app.data_licenses l ON l.id=d.license_id JOIN app.data_providers p ON p.id=l.provider_id WHERE m.bundle_id=b.id
          AND (d.status<>'published' OR p.status<>'active' OR l.market<>$2 OR l.rights_schema_version<>1 OR l.reviewed_at>statement_timestamp() OR l.effective_at>statement_timestamp()
            OR l.expires_at<=statement_timestamp() OR l.rights->>'display'<>'true' OR l.rights->>'api'<>'true' OR l.rights->>'derived'<>'true' OR l.rights->>'snapshot'<>'true'))`,
        [input.bundleId, input.market],
      );
      if (!allowed.rowCount) return stop('forbidden');
      const head = (
        await q(
          tx,
          'SELECT bundle_id,revision FROM app.market_dataset_heads WHERE market=$1 FOR UPDATE',
          [input.market],
        )
      ).rows[0];
      if (
        !head ||
        head.bundle_id !== input.expectedHead.bundleId ||
        String(head.revision) !== input.expectedHead.revision.toString()
      )
        return stop('conflict');
      // Exact safety-component equality is deliberately conservative. It also covers
      // mixed catalog/recall datasets and empty declared recall snapshots.
      const safety = await q(
        tx,
        `WITH safety AS (SELECT m.bundle_id,m.dataset_version_id FROM app.bundle_members m JOIN app.dataset_versions d ON d.id=m.dataset_version_id
        WHERE m.bundle_id=ANY($1::uuid[]) AND (d.kind ILIKE '%recall%' OR EXISTS(SELECT 1 FROM app.recalls r WHERE r.dataset_version_id=d.id) OR EXISTS(SELECT 1 FROM app.recall_targets r WHERE r.dataset_version_id=d.id) OR EXISTS(SELECT 1 FROM app.recall_source_targets r WHERE r.dataset_version_id=d.id)))
        SELECT 1 FROM ((SELECT dataset_version_id FROM safety WHERE bundle_id=$2 EXCEPT SELECT dataset_version_id FROM safety WHERE bundle_id=$3)
        UNION ALL (SELECT dataset_version_id FROM safety WHERE bundle_id=$3 EXCEPT SELECT dataset_version_id FROM safety WHERE bundle_id=$2)) delta LIMIT 1`,
        [
          [input.bundleId, input.expectedHead.bundleId],
          input.bundleId,
          input.expectedHead.bundleId,
        ],
      );
      if (safety.rowCount) return stop('forbidden');
      await q(
        tx,
        'UPDATE app.market_dataset_heads SET bundle_id=$2,revision=revision+1,updated_at=clock_timestamp() WHERE market=$1',
        [input.market, input.bundleId],
      );
      await q(
        tx,
        `INSERT INTO app.outbox(event_id,aggregate_kind,aggregate_id,event_type,schema_version,payload)
        VALUES($1,'dataset_bundle',$2,'dataset_bundle.rolled_back',1,jsonb_build_object('resource_id',$2::uuid::text,'resource_kind','dataset_bundle','version',1,'revision',$3::text))`,
        [input.approvalId, input.bundleId, revision],
      );
      return input.bundleId;
    },
  });
}
