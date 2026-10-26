import type { AssetRepository, AssetLocation } from '../../../application/src/ports/assets.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { hex, integer, one, rev, rid, text, type Row } from './private-values.ts';
const maxBytes = 16 * 1024 * 1024;
function asset(x: Row): AssetLocation {
  if (!['pending', 'ready', 'quarantined', 'deleting', 'deleted'].includes(String(x.state)))
    return stop('integrity');
  const size = Number(x.size_bytes);
  if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes || typeof x.sha256 !== 'string')
    return stop('integrity');
  return {
    id: rid('asset', x.id),
    revision: rev(x.revision),
    key: text(x.object_key),
    mime: text(x.mime_type, 100),
    sha256: hex(x.sha256).toString('hex'),
    size,
    version: x.object_version === null ? null : text(x.object_version, 1024),
    state: x.state as AssetLocation['state'],
  };
}
export function createAssetRepository(
  scope: WriteScope,
  bucket: string,
  keyVersion: string,
): AssetRepository {
  const q = scope.query;
  return guarded(scope, {
    async register(tx, i) {
      if (
        !['report_pdf', 'import_source', 'email_payload'].includes(i.purpose) ||
        !['application/pdf', 'application/json', 'text/csv'].includes(i.mime) ||
        (i.purpose === 'report_pdf' && i.mime !== 'application/pdf') ||
        (i.purpose === 'email_payload' && i.mime !== 'application/json') ||
        integer(i.size, 0) > maxBytes
      )
        stop('invalid_input');
      const hash = hex(i.sha256).toString('hex');
      await q(
        tx,
        `INSERT INTO app.object_assets(id,purpose,bucket,object_key,mime_type,sha256,size_bytes,key_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '30 days') ON CONFLICT(id) DO NOTHING`,
        [i.id, i.purpose, bucket, 'assets/' + i.id, i.mime, hash, i.size, keyVersion],
      );
      const x = one((await q(tx, 'SELECT * FROM app.object_assets WHERE id=$1', [i.id])).rows);
      if (
        x.bucket !== bucket ||
        x.purpose !== i.purpose ||
        x.mime_type !== i.mime ||
        x.sha256 !== hash ||
        Number(x.size_bytes) !== i.size ||
        x.key_version !== keyVersion
      )
        stop('conflict');
      return asset(x);
    },
    async get(tx, id) {
      const x = (
        await q(
          tx,
          `SELECT * FROM app.object_assets WHERE id=$1 AND bucket=$2 AND key_version=$3 AND state='ready' AND expires_at>clock_timestamp()`,
          [id, bucket, keyVersion],
        )
      ).rows[0];
      return x ? asset(x) : null;
    },
    async ready(tx, a, version) {
      one(
        (
          await q(
            tx,
            `UPDATE app.object_assets SET state='ready',object_version=$3,updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1 AND revision=$2 AND state='pending' AND bucket=$4 AND key_version=$5 AND expires_at>clock_timestamp() RETURNING id`,
            [a.id, a.revision.toString(), text(version, 1024), bucket, keyVersion],
          )
        ).rows,
      );
    },
    async deleting(tx, id) {
      return asset(
        one(
          (
            await q(
              tx,
              `UPDATE app.object_assets SET state=CASE WHEN state='deleted' THEN 'deleted' ELSE 'deleting' END,updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1 AND bucket=$2 AND key_version=$3 RETURNING *`,
              [id, bucket, keyVersion],
            )
          ).rows,
        ),
      );
    },
    async deleted(tx, a) {
      one(
        (
          await q(
            tx,
            `UPDATE app.object_assets SET state='deleted',deleted_at=coalesce(deleted_at,clock_timestamp()),updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1 AND revision=$2 AND state IN ('deleting','deleted') RETURNING id`,
            [a.id, a.revision.toString()],
          )
        ).rows,
      );
    },
    async cleanup(tx) {
      return (
        await q(
          tx,
          `SELECT id FROM app.object_assets WHERE bucket=$1 AND key_version=$2 AND (state IN ('deleting','deleted') OR expires_at<=clock_timestamp() OR (state='pending' AND created_at<clock_timestamp()-interval '1 hour')) ORDER BY updated_at,id LIMIT 100`,
          [bucket, keyVersion],
        )
      ).rows.map((x) => rid('asset', x.id));
    },
  } satisfies AssetRepository);
}
