import type { PublicationRepository } from '../../../application/src/ports/ingestion.ts';
import { guarded, type WriteScope } from './mutations.ts';
import { lockedRun, stop } from './ingestion.ts';
import { digest, reject, cursor, nextCursor, pageLimit } from './bounds.ts';
import { id } from '../../../domain/src/values/index.ts';

// Cross-dataset references must resolve inside the same pinned manifest. Same-dataset
// children already have composite foreign keys in the accepted source schema.
const crossReferences = [
  ['market_availability', 'sku_id', 'tire_skus'],
  ['prices', 'sku_id', 'tire_skus'],
  ['evidence', 'sku_id', 'tire_skus'],
  ['evidence', 'model_id', 'tire_models'],
  ['vehicle_reference_links', 'vehicle_id', 'vehicles'],
  ['vehicle_reference_links', 'lookup_option_id', 'vehicle_lookup_options'],
  ['tire_model_reference_links', 'tire_model_id', 'tire_models'],
  ['recall_targets', 'sku_id', 'tire_skus'],
  ['recall_targets', 'model_id', 'tire_models'],
] as const;
export function createPublicationRepository(scope: WriteScope): PublicationRepository {
  const sql = scope.query;
  return guarded<PublicationRepository>(scope, {
    async affectedBundles(tx, datasetId, market, page) {
      const limit = pageLimit(page.limit),
        key = ['affectedBundles', datasetId, market],
        last = cursor(key, page.after);
      // Invalidation must still find published dependants after source rights are revoked.
      const result = await sql(
        tx,
        `SELECT DISTINCT b.id FROM app.bundle_members m JOIN app.dataset_bundles b ON b.id=m.bundle_id
        WHERE m.dataset_version_id=$1 AND b.market=$2 AND b.status='published' AND ($3::uuid IS NULL OR b.id>$3)
        ORDER BY b.id LIMIT $4`,
        [datasetId, market, last, limit + 1],
      );
      const rows = result.rows.slice(0, limit);
      return {
        items: rows.map((r) => {
          const parsed = id('bundle', r.id);
          return parsed.ok ? parsed.value : stop('integrity');
        }),
        next: result.rows.length > limit ? nextCursor(key, String(rows.at(-1)!.id)) : null,
      };
    },
    async validate(tx, lease, expectedRows, complete) {
      if (!complete || expectedRows < 0n || expectedRows > 9223372036854775807n) return reject();
      const run = await lockedRun(sql, tx, lease);
      if (run.throughRow !== expectedRows || run.accepted !== expectedRows || run.rejected !== 0n)
        return stop('integrity');
      const rows = await sql(
        tx,
        `SELECT count(*)::text AS total,count(m.row_number)::text AS materialized,
        count(*) FILTER(WHERE s.validation_status<>'accepted' OR s.expires_at<=clock_timestamp())::text AS bad
        FROM app.import_staging_rows s LEFT JOIN app.import_materializations m ON m.run_id=s.run_id AND m.row_number=s.row_number WHERE s.run_id=$1`,
        [run.id],
      );
      const count = rows.rows[0]!;
      if (
        BigInt(String(count.total)) !== expectedRows ||
        BigInt(String(count.materialized)) !== expectedRows ||
        count.bad !== '0'
      )
        return stop('integrity');
      const updated = await sql(
        tx,
        "UPDATE app.dataset_versions SET status='validated',row_count=$2 WHERE id=$1 AND status='staging'",
        [run.datasetId, expectedRows.toString()],
      );
      if (!updated.rowCount) return stop('conflict');
      await sql(
        tx,
        `UPDATE app.import_runs SET status='validated',checkpoint=checkpoint||'{"complete":true}'::jsonb,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,
        [run.id],
      );
    },
    async bundle(tx, input) {
      if (
        input.members.length < 1 ||
        input.members.length > 16 ||
        new Set(input.members.map((m) => m.key)).size !== input.members.length ||
        input.members.some((m) => !/^[a-z][a-z0-9_-]{0,79}$/.test(m.key))
      )
        return reject();
      const members = [...input.members].sort((a, b) => a.key.localeCompare(b.key));
      const hash = digest([input.market, members.map((m) => [m.key, m.datasetId])]);
      await sql(
        tx,
        "INSERT INTO app.dataset_bundles(id,market,manifest_hash,status) VALUES($1,$2,$3,'validated') ON CONFLICT(id) DO NOTHING",
        [input.id, input.market, hash],
      );
      const existing = await sql(
        tx,
        'SELECT manifest_hash,status FROM app.dataset_bundles WHERE id=$1 FOR UPDATE',
        [input.id],
      );
      if (existing.rows[0]?.manifest_hash !== hash) return stop('conflict');
      if (existing.rows[0].status === 'published') return;
      await sql(
        tx,
        `INSERT INTO app.bundle_members(bundle_id,component_key,dataset_version_id) SELECT $1,x.key,x.dataset FROM jsonb_to_recordset($2::jsonb) x(key text,dataset uuid) ON CONFLICT(bundle_id,component_key) DO NOTHING`,
        [input.id, JSON.stringify(members.map((m) => ({ key: m.key, dataset: m.datasetId })))],
      );
      const actual = await sql(
        tx,
        'SELECT component_key,dataset_version_id FROM app.bundle_members WHERE bundle_id=$1 ORDER BY component_key',
        [input.id],
      );
      if (
        digest([input.market, actual.rows.map((r) => [r.component_key, r.dataset_version_id])]) !==
        hash
      )
        return stop('conflict');
    },
    async publish(tx, input) {
      if (
        input.required.length < 1 ||
        input.required.length > 16 ||
        new Set(input.required.map((r) => r.key)).size !== input.required.length
      )
        return reject();
      const previous = await sql(
        tx,
        'SELECT bundle_id,previous_bundle_id,actor_id,approval_record_id FROM app.import_publications WHERE run_id=$1 AND market=$2',
        [input.lease.runId, input.market],
      );
      const receipt = previous.rows[0];
      if (receipt) {
        if (
          receipt.bundle_id !== input.bundleId ||
          receipt.previous_bundle_id !== (input.expectedHead?.bundleId ?? null) ||
          receipt.actor_id !== input.actorId ||
          receipt.approval_record_id !== input.approvalId
        )
          return stop('conflict');
        return input.bundleId;
      }
      const run = await lockedRun(sql, tx, input.lease, 'validated');
      const bundle = await sql(
        tx,
        "SELECT manifest_hash FROM app.dataset_bundles WHERE id=$1 AND market=$2 AND status='validated' FOR UPDATE",
        [input.bundleId, input.market],
      );
      if (!bundle.rows[0]) return stop('conflict');
      const approval = await sql(
        tx,
        `SELECT a.id FROM admin.audit_events a JOIN admin.staff_identities s ON s.id=$2 AND s.status='active'
        WHERE a.id=$1 AND a.action='import.publish' AND a.resource_kind='dataset_bundle' AND a.result='approved' AND a.change_digest=$3 AND a.occurred_at<=statement_timestamp()`,
        [input.approvalId, input.actorId, bundle.rows[0].manifest_hash],
      );
      if (!approval.rowCount) return stop('forbidden');
      await sql(tx, 'SELECT app.lock_publication_sources($1)', [input.bundleId]);
      const members = await sql(
        tx,
        `SELECT m.component_key,d.id,d.kind,d.status FROM app.bundle_members m JOIN app.dataset_versions d ON d.id=m.dataset_version_id
        JOIN app.data_licenses l ON l.id=d.license_id JOIN app.data_providers p ON p.id=d.provider_id
        WHERE m.bundle_id=$1 AND d.status IN ('validated','published') AND d.effective_at<=statement_timestamp() AND d.fetched_at<=statement_timestamp()
        AND p.status='active' AND l.market=$2 AND l.rights_schema_version=1 AND l.reviewed_at<=statement_timestamp()
        AND l.effective_at<=statement_timestamp() AND (l.expires_at IS NULL OR l.expires_at>statement_timestamp())
        AND l.rights->>'display'='true' AND l.rights->>'api'='true' AND l.rights->>'derived'='true' AND l.rights->>'snapshot'='true'
        AND (d.status='published' OR EXISTS(SELECT 1 FROM app.import_runs r WHERE r.dataset_version_id=d.id AND r.status='validated' AND r.checkpoint->>'complete'='true'))
        ORDER BY m.component_key`,
        [input.bundleId, input.market],
      );
      const total = await sql(
        tx,
        'SELECT count(*)::int AS n FROM app.bundle_members WHERE bundle_id=$1',
        [input.bundleId],
      );
      if (
        members.rowCount !== input.required.length ||
        total.rows[0]?.n !== input.required.length ||
        !members.rows.some((m) => m.id === run.datasetId) ||
        input.required.some(
          (r) => !members.rows.some((m) => m.component_key === r.key && m.kind === r.kind),
        )
      )
        return stop('integrity');
      const incoherent = await sql(
        tx,
        crossReferences
          .map(
            ([table, column, target]) =>
              `SELECT 1 FROM app.${table} f JOIN app.bundle_members m ON m.dataset_version_id=f.dataset_version_id AND m.bundle_id=$1 JOIN app.${target} t ON t.id=f.${column} WHERE NOT EXISTS(SELECT 1 FROM app.bundle_members x WHERE x.bundle_id=$1 AND x.dataset_version_id=t.dataset_version_id)`,
          )
          .join(' UNION ALL ') + ' LIMIT 1',
        [input.bundleId],
      );
      if (incoherent.rowCount) return stop('integrity');
      const datasets = members.rows.filter((m) => m.status === 'validated').map((m) => m.id);
      await sql(
        tx,
        "UPDATE app.dataset_versions SET status='published',published_at=clock_timestamp() WHERE id=ANY($1::uuid[]) AND status='validated'",
        [datasets],
      );
      await sql(
        tx,
        "UPDATE app.dataset_bundles SET status='published',published_at=clock_timestamp() WHERE id=$1",
        [input.bundleId],
      );
      const head = input.expectedHead;
      const changed = head
        ? await sql(
            tx,
            'UPDATE app.market_dataset_heads SET bundle_id=$2,revision=revision+1,updated_at=clock_timestamp() WHERE market=$1 AND bundle_id=$3 AND revision=$4',
            [input.market, input.bundleId, head.bundleId, head.revision.toString()],
          )
        : await sql(
            tx,
            'INSERT INTO app.market_dataset_heads(market,bundle_id) VALUES($1,$2) ON CONFLICT(market) DO NOTHING',
            [input.market, input.bundleId],
          );
      if (changed.rowCount !== 1) return stop('conflict');
      const publications = await sql(
        tx,
        `INSERT INTO app.import_publications(run_id,bundle_id,market,previous_bundle_id,actor_id,approval_record_id,published_at)
        SELECT r.id,$2,$3,$4,$5,$6,clock_timestamp() FROM app.import_runs r WHERE r.id=$1 OR (r.dataset_version_id=ANY($7::uuid[]) AND r.status='validated') RETURNING id,run_id`,
        [
          run.id,
          input.bundleId,
          input.market,
          head?.bundleId ?? null,
          input.actorId,
          input.approvalId,
          datasets,
        ],
      );
      const publication = publications.rows.find((p) => p.run_id === run.id);
      if (!publication) return stop('integrity');
      await sql(
        tx,
        `INSERT INTO app.outbox(event_id,aggregate_kind,aggregate_id,event_type,schema_version,payload) VALUES($1,'dataset_bundle',$2,'dataset_bundle.published',1,jsonb_build_object('resource_id',$2::uuid::text,'resource_kind','dataset_bundle','version',1))`,
        [publication.id, input.bundleId],
      );
      await sql(
        tx,
        "UPDATE app.import_runs SET status='published',finished_at=clock_timestamp(),lease_until=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=ANY($1::uuid[])",
        [publications.rows.map((p) => p.run_id)],
      );
      return input.bundleId;
    },
  });
}
