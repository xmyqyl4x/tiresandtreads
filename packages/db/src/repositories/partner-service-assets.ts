import type {
  PartnerServiceAssets,
  PartnerAssetPurpose,
} from '../../../application/src/ports/partner-services.ts';
import type { AssetLocation } from '../../../application/src/ports/assets.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { createAssetRepository } from './assets.ts';
import { uid, word, integer, sha, at, rev } from './partner-service-values.ts';
const purposeMap = {
  agreement: 'agreement',
  verification: 'import_evidence',
  coupon_pool: 'import_source',
  logo: 'cms_media',
} as const;
export function createPartnerServiceAssets(
  s: WriteScope,
  bucket: string,
  keyVersion: string,
  lockReads = true,
): PartnerServiceAssets {
  word(bucket);
  word(keyVersion);
  const base = createAssetRepository(s, bucket, keyVersion),
    q = s.query;
  const read = async (
    tx: Parameters<PartnerServiceAssets['get']>[0],
    org: Parameters<PartnerServiceAssets['get']>[1],
    id: Parameters<PartnerServiceAssets['get']>[2],
    purpose: PartnerAssetPurpose,
  ): Promise<AssetLocation> => {
    const r =
      (
        await q(
          tx,
          `SELECT a.* FROM app.object_assets a JOIN partners.organization_assets b ON b.asset_id=a.id WHERE b.org_id=$1 AND b.asset_id=$2 AND b.purpose=$3 AND b.state<>'revoked' AND a.bucket=$4 AND a.key_version=$5 AND a.expires_at>clock_timestamp() ${lockReads ? 'FOR SHARE OF a,b' : ''}`,
          [uid('organization', org), uid('asset', id), purpose, bucket, keyVersion],
        )
      ).rows[0] ?? stop('not_found');
    if (
      r.purpose !== purposeMap[purpose] ||
      typeof r.object_key !== 'string' ||
      r.object_key !== 'assets/' + id ||
      !['pending', 'ready', 'quarantined'].includes(String(r.state))
    )
      return stop('integrity');
    return Object.freeze({
      id,
      revision: rev(r.revision),
      key: r.object_key,
      mime: word(r.mime_type, 100),
      sha256: sha(r.sha256),
      size: integer(r.size_bytes, 1, 16777216),
      version: r.object_version === null ? null : word(r.object_version, 1024),
      state: r.state as AssetLocation['state'],
    });
  };
  return guarded<PartnerServiceAssets>(s, {
    async register(tx, org, purpose, id, mime, size, hash, expires) {
      if (
        !Object.hasOwn(purposeMap, purpose) ||
        (purpose === 'logo'
          ? mime !== 'image/png'
          : purpose === 'coupon_pool'
            ? mime !== 'text/csv'
            : mime !== 'application/json')
      )
        return stop('invalid_input');
      await q(
        tx,
        'INSERT INTO app.object_assets(id,purpose,bucket,object_key,mime_type,sha256,size_bytes,key_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING',
        [
          uid('asset', id),
          purposeMap[purpose],
          bucket,
          'assets/' + id,
          mime,
          sha(hash),
          integer(size, 1, 16777216),
          keyVersion,
          at(expires),
        ],
      );
      await q(
        tx,
        'INSERT INTO partners.organization_assets(org_id,asset_id,purpose) VALUES($1,$2,$3) ON CONFLICT(asset_id) DO NOTHING',
        [uid('organization', org), id, purpose],
      );
      const asset = await read(tx, org, id, purpose);
      const r =
        (await q(tx, 'SELECT expires_at FROM app.object_assets WHERE id=$1', [id])).rows[0] ??
        stop('integrity');
      if (
        asset.mime !== mime ||
        asset.size !== size ||
        asset.sha256 !== hash ||
        at(r.expires_at) !== expires
      )
        return stop('conflict');
      return asset;
    },
    get: read,
    async ready(tx, org, asset, version) {
      const binding =
        (
          await q(
            tx,
            "SELECT purpose FROM partners.organization_assets WHERE org_id=$1 AND asset_id=$2 AND state='pending' FOR UPDATE",
            [org, asset.id],
          )
        ).rows[0] ?? stop('conflict');
      await base.ready(tx, asset, word(version, 1024));
      await q(
        tx,
        "UPDATE partners.organization_assets SET state='ready' WHERE org_id=$1 AND asset_id=$2 AND purpose=$3",
        [org, asset.id, binding.purpose],
      );
    },
  });
}
