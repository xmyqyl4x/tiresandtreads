import { createHash } from 'node:crypto';
import type { createTransactions } from '../../db/src/transactions.ts';
import type { PrivateObjects } from '../../application/src/ports/assets.ts';
import type { DeliveryFiles } from '../../application/src/ports/delivery-services.ts';
import { createAssetRepository } from '../../db/src/repositories/assets.ts';
import { ok } from '../../domain/src/values/core.ts';
export const deliveryChecksum = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export function createDeliveryFiles(o: {
  readonly scope: ReturnType<typeof createTransactions>;
  readonly objects: PrivateObjects;
  readonly bucket: string;
  readonly keyVersion: string;
}): DeliveryFiles {
  const assets = createAssetRepository(o.scope, o.bucket, o.keyVersion);
  return {
    async put(id, purpose, bytes) {
      const registered = await o.scope.unitOfWork.run(async (tx) =>
        ok(
          await assets.register(tx, {
            id,
            purpose,
            mime: purpose === 'report_pdf' ? 'application/pdf' : 'application/json',
            sha256: deliveryChecksum(bytes),
            size: bytes.byteLength,
          }),
        ),
      );
      if (!registered.ok || !['pending', 'ready'].includes(registered.value.state))
        throw Error('Delivery asset unavailable');
      const asset = registered.value,
        version = await o.objects.put(asset, bytes);
      if (asset.state === 'ready') {
        if (asset.version !== version) throw Error('Delivery asset unavailable');
        return;
      }
      const ready = await o.scope.unitOfWork.run(async (tx) => {
        await assets.ready(tx, asset, version);
        return ok(null);
      });
      if (!ready.ok) throw Error('Delivery asset unavailable');
    },
    async get(id) {
      const read = await o.scope.unitOfWork.run(async (tx) => ok(await assets.get(tx, id)));
      if (!read.ok || !read.value) throw Error('Delivery asset unavailable');
      const bytes = await o.objects.get(read.value);
      if (bytes.length !== read.value.size || deliveryChecksum(bytes) !== read.value.sha256)
        throw Error('Delivery asset unavailable');
      return bytes;
    },
  };
}
