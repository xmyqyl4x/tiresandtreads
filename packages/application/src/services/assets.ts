import type { AssetInput, AssetRepository, PrivateObjects } from '../ports/assets.ts';
import type { Id } from '../../../domain/src/values/index.ts';
import type { UnitOfWork } from '../ports/transactions.ts';
import type { CapabilityRepository } from '../ports/owner-report.ts';
import type { KeyDigest } from '../ports/private-records.ts';
import { ok } from '../../../domain/src/values/core.ts';

// Storage I/O never holds a SQL transaction; late writes cannot resurrect a tombstone.
export function createAssetService(deps: {
  readonly uow: UnitOfWork;
  readonly assets: AssetRepository;
  readonly objects: PrivateObjects;
  readonly authority: UnitOfWork;
  readonly capabilities: Pick<CapabilityRepository, 'download'>;
}) {
  const { uow, assets, objects, authority, capabilities } = deps;
  async function authorized(keys: readonly KeyDigest[]) {
    const r = await authority.run(async (tx) => ok(await capabilities.download(tx, keys)));
    if (!r.ok || !r.value) throw Error('Asset unavailable');
    return r.value;
  }
  return {
    async upload(input: AssetInput, bytes: Uint8Array) {
      const r = await uow.run(async (tx) => ok(await assets.register(tx, input)));
      if (!r.ok || !['pending', 'ready'].includes(r.value.state)) throw Error('Asset unavailable');
      const asset = r.value;
      const version = await objects.put(asset, bytes);
      if (asset.state === 'ready') {
        if (asset.version !== version) throw Error('Asset unavailable');
        return asset.id;
      }
      const committed = await uow.run(async (tx) => {
        await assets.ready(tx, asset, version);
        return ok(asset.id);
      });
      if (!committed.ok) throw Error('Asset unavailable');
      return committed.value;
    },
    async download(keys: readonly KeyDigest[]) {
      const permit = await authorized(keys);
      const r = await uow.run(async (tx) => ok(await assets.get(tx, permit.assetId)));
      if (
        !r.ok ||
        !r.value ||
        r.value.state !== 'ready' ||
        r.value.sha256 !== permit.sha256 ||
        BigInt(r.value.size) !== permit.sizeBytes
      )
        throw Error('Asset unavailable');
      const bytes = await objects.get(r.value);
      const current = await authorized(keys);
      if (current.assetId !== permit.assetId || current.sha256 !== permit.sha256)
        throw Error('Asset unavailable');
      return { bytes, mime: permit.mimeType };
    },
    async erase(id: Id<'asset'>) {
      const r = await uow.run(async (tx) => ok(await assets.deleting(tx, id)));
      if (!r.ok) throw Error('Asset unavailable');
      await objects.erase(r.value);
      const completed = await uow.run(async (tx) => {
        await assets.deleted(tx, r.value);
        return ok(null);
      });
      if (!completed.ok) throw Error('Asset unavailable');
    },
    async reconcile() {
      const r = await uow.run(async (tx) => ok(await assets.cleanup(tx)));
      if (!r.ok) throw Error('Asset unavailable');
      return r.value;
    },
  };
}

export function createAssetRetentionService(
  services: readonly Pick<ReturnType<typeof createAssetService>, 'reconcile' | 'erase'>[],
) {
  return async (dryRun = true) => {
    if (typeof dryRun !== 'boolean') throw Error('Invalid retention mode');
    let candidates = 0,
      erased = 0;
    for (const service of services) {
      const ids = await service.reconcile();
      candidates += ids.length;
      if (!dryRun)
        for (const id of ids) {
          await service.erase(id);
          erased++;
        }
    }
    return { dryRun, candidates, erased };
  };
}
