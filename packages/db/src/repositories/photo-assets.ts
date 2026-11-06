import type { PhotoAssetRepository } from '../../../application/src/ports/photo-repositories.ts';
import type { AssetLocation } from '../../../application/src/ports/assets.ts';
import { createAssetRepository } from './assets.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { uid, word, hash, num, at, revisionValue, choice } from './analysis-values.ts';
import { reject } from './bounds.ts';
export function createPhotoAssetRepository(
  s: WriteScope,
  bucket: string,
  keyVersion: string,
): PhotoAssetRepository {
  word(bucket);
  word(keyVersion);
  const base = createAssetRepository(s, bucket, keyVersion);
  return guarded<PhotoAssetRepository>(s, {
    ...base,
    async register(tx, input) {
      const i = {
        id: uid('asset', input.id),
        purpose: 'tire_photo_' + choice(input.kind, ['original', 'sanitized']),
        mime: choice(input.mime, ['image/jpeg', 'image/png', 'image/webp']),
        hash: hash(input.sha256),
        size: num(input.size, 1, 10485760),
        until: at(input.expiresAt),
      };
      await s.query(
        tx,
        'INSERT INTO app.object_assets(id,purpose,bucket,object_key,mime_type,sha256,size_bytes,key_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING',
        [i.id, i.purpose, bucket, 'assets/' + i.id, i.mime, i.hash, i.size, keyVersion, i.until],
      );
      const r =
        (await s.query(tx, 'SELECT * FROM app.object_assets WHERE id=$1', [i.id])).rows[0] ??
        stop('not_found');
      if (
        r.purpose !== i.purpose ||
        r.bucket !== bucket ||
        r.mime_type !== i.mime ||
        r.sha256 !== i.hash ||
        String(r.size_bytes) !== String(i.size) ||
        r.key_version !== keyVersion ||
        at(r.expires_at) !== i.until
      )
        return stop('conflict');
      if (typeof r.object_key !== 'string' || !r.object_key.startsWith('assets/')) return reject();
      return Object.freeze({
        id: i.id,
        revision: revisionValue(r.revision),
        key: r.object_key,
        mime: i.mime,
        sha256: i.hash,
        size: i.size,
        version: r.object_version === null ? null : word(r.object_version, 1024),
        state: choice(r.state, ['pending', 'ready', 'quarantined', 'deleting', 'deleted']),
      }) satisfies AssetLocation;
    },
  });
}
