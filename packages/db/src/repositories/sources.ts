import type {
  SourceRepository,
  SourceLease,
  SourceDefinition,
  SourceReceipt,
} from '../../../application/src/ports/sources.ts';
import type { Registration } from '../../../application/src/ports/import-service.ts';
import type { TransactionContext } from '../../../application/src/ports/transactions.ts';
import {
  parseSourceSpec,
  sourceKey,
  sourceInterval,
} from '../../../application/src/services/source-policy.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { digest, boundedJson } from './bounds.ts';
import { rid, stamp } from './private-values.ts';
export function sourceApprovalDigest(input: SourceDefinition) {
  return digest([
    input.id,
    input.providerId,
    input.licenseId,
    input.spec,
    input.origin,
    input.path,
  ]);
}
export function createSourceRepository(scope: WriteScope): SourceRepository {
  const q = scope.query;
  async function definition(tx: TransactionContext, connector: string) {
    const row = (
      await q(tx, 'SELECT * FROM app.source_connectors WHERE id=$1 FOR UPDATE', [connector])
    ).rows[0];
    if (!row) return stop('not_found');
    const spec = parseSourceSpec(row.configuration);
    if (
      !spec.ok ||
      row.status !== 'active' ||
      row.schema_version !== '1' ||
      row.kind !== sourceKey(spec.value) ||
      !row.approval_record_id ||
      !row.reviewed_by ||
      !row.license_id
    )
      return stop('forbidden');
    const def: SourceDefinition = {
      id: rid('source_connector', row.id),
      providerId: rid('provider', row.provider_id),
      licenseId: rid('license', row.license_id),
      spec: spec.value,
      origin: String(row.allowed_origin),
      path: String(row.allowed_path_prefix),
    };
    const approval = await q(
      tx,
      "SELECT id FROM admin.audit_events WHERE id=$1 AND action='source.register' AND resource_kind='source_connector' AND result='approved' AND change_digest=$2 AND occurred_at<=statement_timestamp()",
      [row.approval_record_id, sourceApprovalDigest(def)],
    );
    if (!approval.rowCount) return stop('forbidden');
    await q(tx, 'SELECT app.lock_refresh_source($1,$2)', [def.providerId, def.licenseId]);
    const allowed = await q(
      tx,
      `SELECT l.id FROM app.data_licenses l JOIN app.data_providers p ON p.id=l.provider_id
   WHERE l.id=$1 AND l.provider_id=$2 AND p.status='active' AND l.market='US' AND l.rights_schema_version=1 AND l.effective_at<=statement_timestamp() AND l.reviewed_at<=statement_timestamp() AND (l.expires_at IS NULL OR l.expires_at>statement_timestamp())
   AND l.rights->>'cache'='true' AND l.rights->>'snapshot'='true' AND l.rights->>'derived'='true' AND l.rights->>'display'='true' AND l.rights->>'api'='true'`,
      [def.licenseId, def.providerId],
    );
    if (!allowed.rowCount) return stop('forbidden');
    return def;
  }
  function receipt(x: unknown): SourceReceipt | null {
    if (x === null) return null;
    if (!x || typeof x !== 'object' || Array.isArray(x)) return stop('integrity');
    const r = x as Record<string, unknown>;
    if (
      typeof r.checksum !== 'string' ||
      !/^[a-f0-9]{64}$/.test(r.checksum) ||
      !r.validators ||
      typeof r.validators !== 'object' ||
      Array.isArray(r.validators) ||
      Object.keys(r.validators).length > 2
    )
      return stop('integrity');
    const validators: Record<string, { etag: string | null; modified: string | null }> = {};
    for (const [key, value] of Object.entries(r.validators)) {
      if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key) || !value || typeof value !== 'object')
        return stop('integrity');
      const v = value as Record<string, unknown>;
      if (
        !(v.etag === null || (typeof v.etag === 'string' && v.etag.length <= 512)) ||
        !(v.modified === null || (typeof v.modified === 'string' && v.modified.length <= 128))
      )
        return stop('integrity');
      validators[key] = { etag: v.etag, modified: v.modified };
    }
    return {
      checksum: r.checksum,
      datasetId: rid('dataset', r.datasetId),
      runId: rid('import_run', r.runId),
      validators,
    };
  }
  async function active(tx: TransactionContext, lease: SourceLease) {
    const def = await definition(tx, lease.id);
    if (
      digest(def) !==
      digest({
        id: lease.id,
        providerId: lease.providerId,
        licenseId: lease.licenseId,
        spec: lease.spec,
        origin: lease.origin,
        path: lease.path,
      })
    )
      return stop('conflict');
    const row = (
      await q(
        tx,
        'SELECT provider_id FROM app.feed_health WHERE provider_id=$1 AND kind=$2 AND lease_token=$3 AND fence=$4 AND lease_until>clock_timestamp() FOR UPDATE',
        [lease.providerId, sourceKey(lease.spec), lease.token, lease.fence.toString()],
      )
    ).rows[0];
    if (!row) return stop('conflict');
  }
  return guarded<SourceRepository>(scope, {
    async register(tx, input) {
      const spec = parseSourceSpec(input.spec);
      if (!spec.ok) return stop('invalid_input');
      const approval = await q(
        tx,
        `SELECT a.id FROM admin.audit_events a JOIN admin.staff_identities s ON s.id=$2 AND s.status='active' WHERE a.id=$1 AND a.action='source.register' AND a.resource_kind='source_connector' AND a.result='approved' AND a.change_digest=$3 AND a.occurred_at<=statement_timestamp()`,
        [input.approvalId, input.actorId, sourceApprovalDigest(input)],
      );
      if (!approval.rowCount) return stop('forbidden');
      await q(
        tx,
        `INSERT INTO app.source_connectors(id,provider_id,kind,allowed_origin,allowed_path_prefix,schema_version,schedule_key,status,license_id,configuration,approval_record_id,reviewed_by) VALUES($1,$2,$3,$4,$5,'1',$3,'active',$6,$7::jsonb,$8,$9) ON CONFLICT(provider_id,kind) DO NOTHING`,
        [
          input.id,
          input.providerId,
          sourceKey(spec.value),
          input.origin,
          input.path,
          input.licenseId,
          boundedJson(spec.value, 2048),
          input.approvalId,
          input.actorId,
        ],
      );
      const actual = await definition(tx, input.id);
      if (
        digest(actual) !==
        digest({
          id: input.id,
          providerId: input.providerId,
          licenseId: input.licenseId,
          spec: input.spec,
          origin: input.origin,
          path: input.path,
        })
      )
        return stop('conflict');
      await q(
        tx,
        "INSERT INTO app.feed_health(provider_id,kind,last_attempt_at,error_code) VALUES($1,$2,clock_timestamp(),'not_checked') ON CONFLICT(provider_id,kind) DO NOTHING",
        [input.providerId, sourceKey(spec.value)],
      );
    },
    async due(tx) {
      const rows = await q(
        tx,
        `SELECT s.id FROM app.feed_health h JOIN app.source_connectors s ON s.provider_id=h.provider_id AND s.kind=h.kind WHERE s.status='active' AND s.configuration IS NOT NULL AND h.next_check_at<=clock_timestamp() AND (h.lease_until IS NULL OR h.lease_until<=clock_timestamp()) ORDER BY h.next_check_at,s.id LIMIT 4`,
        [],
      );
      return rows.rows.map((r) => rid('source_connector', r.id));
    },
    async claim(tx, id) {
      const permitted = await q(
        tx,
        `SELECT s.id,s.provider_id,s.kind,(s.status='active' AND l.id IS NOT NULL AND p.status='active' AND l.market='US' AND l.rights_schema_version=1 AND l.effective_at<=statement_timestamp() AND l.reviewed_at<=statement_timestamp() AND (l.expires_at IS NULL OR l.expires_at>statement_timestamp()) AND l.rights->>'cache'='true' AND l.rights->>'snapshot'='true' AND l.rights->>'derived'='true' AND l.rights->>'display'='true' AND l.rights->>'api'='true') AS allowed FROM app.source_connectors s LEFT JOIN app.data_licenses l ON l.id=s.license_id AND l.provider_id=s.provider_id LEFT JOIN app.data_providers p ON p.id=s.provider_id WHERE s.id=$1`,
        [id],
      );
      const source = permitted.rows[0];
      if (!source) return stop('not_found');
      if (source.allowed !== true) {
        const denied = await q(
          tx,
          `UPDATE app.feed_health SET error_code='source_rights',last_attempt_at=clock_timestamp(),next_check_at=clock_timestamp()+interval '1 hour',failure_count=failure_count+1,lease_token=NULL,lease_until=NULL,fence=fence+1,updated_at=clock_timestamp(),revision=revision+1 WHERE provider_id=$1 AND kind=$2 AND next_check_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp()) RETURNING revision`,
          [source.provider_id, source.kind],
        );
        if (denied.rowCount)
          await q(
            tx,
            `INSERT INTO app.outbox(event_id,aggregate_kind,aggregate_id,event_type,schema_version,payload) VALUES(gen_random_uuid(),'source_connector',$1,'source.refresh_failed',1,jsonb_build_object('resource_id',$1::uuid::text,'resource_kind','source_connector','revision',$2::text))`,
            [id, String(denied.rows[0]!.revision)],
          );
        return { denied: true };
      }
      const def = await definition(tx, id),
        kind = sourceKey(def.spec);
      const r = (
        await q(
          tx,
          `UPDATE app.feed_health SET lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '15 minutes',fence=fence+1,error_code='refresh_in_progress',last_attempt_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 WHERE provider_id=$1 AND kind=$2 AND next_check_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp()) RETURNING lease_token,fence,source_receipt,(last_full_at IS NULL OR last_full_at<=clock_timestamp()-interval '7 days') AS force_full`,
          [def.providerId, kind],
        )
      ).rows[0];
      if (!r) return null;
      const previous = receipt(r.source_receipt);
      return {
        ...def,
        token: rid('lease', r.lease_token),
        fence: BigInt(String(r.fence)),
        forceFull: r.force_full === true,
        previous,
      };
    },
    async canonical(tx, input) {
      const r = (
        await q(
          tx,
          'SELECT checksum,provider_id,license_id,kind,external_version,effective_at,fetched_at FROM app.dataset_versions WHERE id=$1',
          [input.id],
        )
      ).rows[0];
      if (!r) return input;
      if (
        r.checksum !== input.checksum ||
        r.provider_id !== input.providerId ||
        r.license_id !== input.licenseId ||
        r.kind !== input.kind ||
        r.external_version !== input.externalVersion
      )
        return stop('conflict');
      return {
        ...input,
        effectiveAt: stamp(r.effective_at),
        fetchedAt: stamp(r.fetched_at),
      } satisfies Registration;
    },
    async complete(tx, lease, value, full) {
      await active(tx, lease);
      const parsed = receipt(JSON.parse(boundedJson(value, 8192)))!;
      const run = await q(
        tx,
        `SELECT r.id FROM app.import_runs r JOIN app.dataset_versions d ON d.id=r.dataset_version_id WHERE r.id=$1 AND d.id=$2 AND r.provider_id=$3 AND d.license_id=$4 AND d.kind=$5 AND d.external_version=$6 AND r.upstream_run_key=d.kind||':'||$6 AND r.status IN('validated','published') AND r.checkpoint->>'complete'='true' AND r.rejected_count=0 AND d.status IN('validated','published')`,
        [
          parsed.runId,
          parsed.datasetId,
          lease.providerId,
          lease.licenseId,
          sourceKey(lease.spec),
          parsed.checksum,
        ],
      );
      if (!run.rowCount) return stop('integrity');
      await q(
        tx,
        `UPDATE app.feed_health SET source_receipt=$3::jsonb,last_attempt_at=clock_timestamp(),last_success_at=clock_timestamp(),last_run_id=$4,error_code=NULL,last_full_at=CASE WHEN $5 THEN clock_timestamp() ELSE last_full_at END,next_check_at=LEAST(clock_timestamp()+$6*interval '1 second',(SELECT expires_at FROM app.data_licenses WHERE id=$7)),lease_token=NULL,lease_until=NULL,failure_count=0,updated_at=clock_timestamp(),revision=revision+1 WHERE provider_id=$1 AND kind=$2`,
        [
          lease.providerId,
          sourceKey(lease.spec),
          boundedJson(parsed, 8192),
          parsed.runId,
          full,
          sourceInterval(lease.spec),
          lease.licenseId,
        ],
      );
      await q(
        tx,
        `INSERT INTO app.outbox(event_id,aggregate_kind,aggregate_id,event_type,schema_version,payload) VALUES($1,'source_connector',$2,'source.refresh_succeeded',1,jsonb_build_object('resource_id',$2::uuid::text,'resource_kind','source_connector','revision',$3::text))`,
        [lease.token, lease.id, lease.fence.toString()],
      );
    },
    async failed(tx, lease, code) {
      const changed = await q(
        tx,
        `UPDATE app.feed_health SET last_attempt_at=clock_timestamp(),error_code=$5,next_check_at=clock_timestamp()+LEAST(3600,60*power(2,LEAST(failure_count,6))) * interval '1 second',lease_token=NULL,lease_until=NULL,failure_count=failure_count+1,updated_at=clock_timestamp(),revision=revision+1 WHERE provider_id=$1 AND kind=$2 AND lease_token=$3 AND fence=$4 AND lease_until>clock_timestamp()`,
        [lease.providerId, sourceKey(lease.spec), lease.token, lease.fence.toString(), code],
      );
      if (changed.rowCount !== 1) return stop('conflict');
      await q(
        tx,
        `INSERT INTO app.outbox(event_id,aggregate_kind,aggregate_id,event_type,schema_version,payload) VALUES($1,'source_connector',$2,'source.refresh_failed',1,jsonb_build_object('resource_id',$2::uuid::text,'resource_kind','source_connector','revision',$3::text))`,
        [lease.token, lease.id, lease.fence.toString()],
      );
    },
    async recallReady(tx, dataset) {
      const r = await q(
        tx,
        `SELECT s.id FROM app.source_connectors s JOIN app.feed_health h ON h.provider_id=s.provider_id AND h.kind=s.kind JOIN app.dataset_versions d ON d.id=$1 AND d.provider_id=s.provider_id AND d.license_id=s.license_id JOIN app.data_licenses l ON l.id=s.license_id JOIN app.data_providers p ON p.id=s.provider_id JOIN app.import_runs r ON r.id=h.last_run_id AND r.dataset_version_id=d.id
   WHERE s.configuration->>'type'='nhtsa-tire-recalls' AND s.status='active' AND s.approval_record_id IS NOT NULL AND p.status='active' AND h.error_code IS NULL AND h.last_success_at>=statement_timestamp()-interval '48 hours' AND h.last_success_at<=statement_timestamp() AND (h.source_receipt->>'datasetId')=$1::uuid::text AND r.status='published' AND d.status='published'
   AND l.rights_schema_version=1 AND l.effective_at<=statement_timestamp() AND l.reviewed_at<=statement_timestamp() AND (l.expires_at IS NULL OR l.expires_at>statement_timestamp()) AND l.rights->>'cache'='true' AND l.rights->>'display'='true' AND l.rights->>'api'='true' AND l.rights->>'derived'='true' AND l.rights->>'snapshot'='true'
   AND EXISTS(SELECT 1 FROM app.bundle_members m JOIN app.market_dataset_heads head ON head.bundle_id=m.bundle_id WHERE head.market='US' AND m.dataset_version_id=d.id)`,
        [dataset],
      );
      if (r.rowCount !== 1) return false;
      await definition(tx, String(r.rows[0]!.id));
      return true;
    },
  });
}
