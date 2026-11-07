import { createHash } from 'node:crypto';
import { createCsvAssetRepository } from '../../db/src/repositories/csv-assets.ts';
import type { createTransactions } from '../../db/src/transactions.ts';
import type { PrivateObjects } from '../../application/src/ports/assets.ts';
import type { CsvFiles } from '../../application/src/ports/staff-csv.ts';
import { ok } from '../../domain/src/values/core.ts';
import { boundedIO } from './bounded-io.ts';
export function createStaffCsvFiles(
  o: Readonly<{
    scope: ReturnType<typeof createTransactions>;
    objects: PrivateObjects;
    bucket: string;
    keyVersion: string;
  }>,
): CsvFiles {
  const assets = createCsvAssetRepository(o.scope, o.bucket, o.keyVersion),
    sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  return Object.freeze<CsvFiles>({
    async store(id, purpose, mime, raw, expiresAt) {
      if (!(raw instanceof Uint8Array) || raw.length < 1 || raw.length > 16777216)
        throw Error('CSV artifact unavailable');
      const bytes = new Uint8Array(raw);
      const r = await o.scope.unitOfWork.run(async (tx) =>
        ok(
          await assets.register(tx, {
            id,
            purpose,
            mime,
            size: bytes.length,
            sha256: sha(bytes),
            expiresAt,
          }),
        ),
      );
      if (!r.ok || !['pending', 'ready'].includes(r.value.state))
        throw Error('CSV artifact unavailable');
      const a = r.value;
      const version = await boundedIO(() => o.objects.put(a, bytes), 10000);
      if (a.state === 'ready') {
        if (a.version !== version) throw Error('CSV artifact conflict');
        return a;
      }
      const committed = await o.scope.unitOfWork.run(async (tx) => {
        await assets.ready(tx, a, version);
        return ok(await assets.get(tx, id));
      });
      if (!committed.ok || !committed.value) throw Error('CSV artifact unavailable');
      return committed.value;
    },
    async read(id) {
      const r = await o.scope.unitOfWork.run(async (tx) => ok(await assets.get(tx, id)));
      if (
        !r.ok ||
        !r.value ||
        r.value.key !== 'assets/' + id ||
        !['text/csv', 'application/json'].includes(r.value.mime)
      )
        throw Error('CSV artifact unavailable');
      const bytes = await boundedIO(() => o.objects.get(r.value!), 10000);
      if (bytes.length !== r.value.size || sha(bytes) !== r.value.sha256)
        throw Error('CSV artifact unavailable');
      return bytes;
    },
  });
}
