import type { CapabilityRepository } from '../../../application/src/ports/owner-report.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { digestKeys, hex, integer, keyJson, reportGuard, rid, text } from './private-values.ts';

export function createCapabilityRepository(scope: WriteScope): CapabilityRepository {
  const q = scope.query;
  const repo: CapabilityRepository = {
    async share(tx, owner, i) {
      await reportGuard(scope, tx, owner, i.reportId);
      digestKeys([i.key]);
      await q(
        tx,
        "INSERT INTO app.report_capabilities(id,report_id,report_version,scope,version_scope,token_hash,key_version,expires_at) VALUES($1,$2,$3,'view',$4,$5,$6,$7)",
        [
          i.id,
          i.reportId,
          i.version,
          i.version === null ? 'latest' : 'fixed',
          hex(i.key.digest),
          i.key.keyVersion,
          i.expiresAt,
        ],
      );
    },
    async resolveShare(tx, keys) {
      const r = await q(
        tx,
        `SELECT c.id,c.report_id,c.version_binding,coalesce(c.report_version,r.current_version) AS version
        FROM app.report_capabilities c JOIN app.reports r ON r.id=c.report_id JOIN app.subjects s ON s.id=r.owner_subject_id
        JOIN jsonb_to_recordset($1::jsonb) k(key_version text,digest text) ON c.key_version=k.key_version AND c.token_hash=decode(k.digest,'hex')
        WHERE c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND r.status='active' AND r.expires_at>clock_timestamp()
        AND s.status='active' AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp())`,
        [keyJson(keys)],
      );
      if (r.rows.length > 1) return stop('integrity');
      const x = r.rows[0];
      return x
        ? {
            capabilityId: rid('report_capability', x.id),
            reportId: rid('report', x.report_id),
            version: integer(x.version),
            versionBinding: integer(x.version_binding, 0),
          }
        : null;
    },
    async revokeShare(tx, owner, id, capabilityId) {
      await reportGuard(scope, tx, owner, id);
      const r = await q(
        tx,
        'UPDATE app.report_capabilities SET revoked_at=coalesce(revoked_at,clock_timestamp()),updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1 AND report_id=$2 RETURNING id',
        [capabilityId, id],
      );
      if (!r.rows.length) stop('not_found');
    },
    async asset(tx, owner, i) {
      await reportGuard(scope, tx, owner, i.reportId);
      const asset = await q(
        tx,
        "SELECT id FROM app.object_assets WHERE id=$1 AND purpose='report_pdf' AND state='ready' AND (expires_at IS NULL OR expires_at>clock_timestamp())",
        [i.assetId],
      );
      if (!asset.rows.length) stop('conflict');
      await q(
        tx,
        'INSERT INTO app.report_assets(asset_id,report_id,report_version,comparison_revision,renderer_version,locale,view_scope,render_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          i.assetId,
          i.reportId,
          i.version,
          i.comparisonRevision?.toString() ?? null,
          i.rendererVersion,
          i.locale,
          i.scope,
          i.renderKey,
        ],
      );
    },
    async grant(tx, authority, i) {
      digestKeys([i.key]);
      let session = null,
        subject = null,
        capability = null,
        binding = null;
      if ('owner' in authority) {
        await reportGuard(scope, tx, authority.owner, i.reportId);
        session = authority.owner.sessionId;
        subject = authority.owner.subjectId;
      } else {
        const share = await repo.resolveShare(tx, authority.shareKeys);
        if (
          !share ||
          share.reportId !== i.reportId ||
          share.version !== i.version ||
          i.scope !== 'shared'
        )
          return stop('forbidden');
        capability = share.capabilityId;
        binding = share.versionBinding;
      }
      await q(
        tx,
        'INSERT INTO app.download_grants(id,asset_id,report_id,report_version,view_scope,owner_session_id,owner_subject_id,share_capability_id,share_version_binding,token_hash,key_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          i.id,
          i.assetId,
          i.reportId,
          i.version,
          i.scope,
          session,
          subject,
          capability,
          binding,
          hex(i.key.digest),
          i.key.keyVersion,
          i.expiresAt,
        ],
      );
    },
    async download(tx, keys) {
      const r = await q(
        tx,
        `SELECT g.asset_id,g.report_id,g.report_version,g.view_scope,a.sha256,a.size_bytes,a.mime_type
        FROM app.download_grants g JOIN app.reports r ON r.id=g.report_id JOIN app.subjects s ON s.id=r.owner_subject_id
        JOIN app.object_assets a ON a.id=g.asset_id
        LEFT JOIN app.owner_sessions o ON (o.id,o.subject_id)=(g.owner_session_id,g.owner_subject_id)
        LEFT JOIN app.report_capabilities c ON c.id=g.share_capability_id
        JOIN jsonb_to_recordset($1::jsonb) k(key_version text,digest text) ON g.key_version=k.key_version AND g.token_hash=decode(k.digest,'hex')
        WHERE g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND r.status='active' AND r.expires_at>clock_timestamp()
        AND s.status='active' AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp()) AND a.state='ready' AND a.purpose='report_pdf'
        AND (a.expires_at IS NULL OR a.expires_at>clock_timestamp())
        AND ((o.id IS NOT NULL AND o.revoked_at IS NULL AND o.expires_at>clock_timestamp()) OR
          (c.id IS NOT NULL AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND g.view_scope='shared'))`,
        [keyJson(keys)],
      );
      if (r.rows.length > 1) return stop('integrity');
      const x = r.rows[0];
      if (!x) return null;
      if (
        !['owner', 'shared'].includes(String(x.view_scope)) ||
        typeof x.size_bytes !== 'string' ||
        !/^[0-9]+$/.test(x.size_bytes)
      )
        return stop('integrity');
      return {
        assetId: rid('asset', x.asset_id),
        reportId: rid('report', x.report_id),
        version: integer(x.report_version),
        scope: x.view_scope as 'owner' | 'shared',
        sha256: hex(x.sha256).toString('hex'),
        sizeBytes: BigInt(x.size_bytes),
        mimeType: text(x.mime_type),
      };
    },
  };
  return guarded(scope, repo);
}
