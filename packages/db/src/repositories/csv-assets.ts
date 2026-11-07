import { createAssetRepository } from './assets.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { uid, word, num, hash, at, revisionValue, choice } from './analysis-values.ts';
import type { AssetLocation } from '../../../application/src/ports/assets.ts';
import type { Instant, Id } from '../../../domain/src/values/core.ts';
export function createCsvAssetRepository(s: WriteScope, bucket: string, keyVersion: string) {
  word(bucket, 200);
  word(keyVersion, 100);
  const base = createAssetRepository(s, bucket, keyVersion);
  const register = async (
    tx: Parameters<typeof s.query>[0],
    input: Readonly<{
      id: Id<'asset'>;
      purpose: 'import_source' | 'import_evidence';
      mime: 'text/csv' | 'application/json';
      sha256: string;
      size: number;
      expiresAt: Instant;
    }>,
  ): Promise<AssetLocation> => {
    const id = uid('asset', input.id),
      purpose = choice(input.purpose, ['import_source', 'import_evidence']),
      mime = choice(input.mime, ['text/csv', 'application/json']),
      sha = hash(input.sha256),
      size = num(input.size, 1, 16777216),
      until = at(input.expiresAt);
    if ((purpose === 'import_source') !== (mime === 'text/csv')) return stop('invalid_input');
    await s.query(
      tx,
      "INSERT INTO app.object_assets(id,purpose,bucket,object_key,mime_type,sha256,size_bytes,key_version,expires_at) SELECT $1,$2,$3,'assets/'||$1::uuid::text,$4,$5,$6,$7,$8 WHERE $8::timestamptz>clock_timestamp() AND $8::timestamptz<=clock_timestamp()+interval '30 days' ON CONFLICT(id) DO NOTHING",
      [id, purpose, bucket, mime, sha, size, keyVersion, until],
    );
    const r = (await s.query(tx, 'SELECT * FROM app.object_assets WHERE id=$1', [id])).rows[0];
    if (
      !r ||
      r.purpose !== purpose ||
      r.bucket !== bucket ||
      r.object_key !== 'assets/' + id ||
      r.mime_type !== mime ||
      r.sha256 !== sha ||
      Number(r.size_bytes) !== size ||
      r.key_version !== keyVersion ||
      at(r.expires_at) !== until
    )
      return stop('conflict');
    return Object.freeze({
      id,
      revision: revisionValue(r.revision),
      key: 'assets/' + id,
      mime,
      sha256: sha,
      size,
      version: r.object_version === null ? null : word(r.object_version, 1024),
      state: choice(r.state, ['pending', 'ready', 'quarantined', 'deleting', 'deleted']),
    });
  };
  return guarded(s, { ...base, register });
}
