import type { createTransactions } from '../../../db/src/transactions.ts';
import { ok } from '../../../domain/src/values/core.ts';
import type { P2HttpAdmission } from './phase2-common.ts';
export function createP2HttpAdmission(
  scope: ReturnType<typeof createTransactions>,
): P2HttpAdmission {
  return {
    async claim(commandHash, fingerprint) {
      if (!/^[a-f0-9]{64}$/.test(commandHash) || !/^[a-f0-9]{64}$/.test(fingerprint))
        throw Error('Bound HTTP command required');
      const r = await scope.unitOfWork.run(async (tx) =>
        ok(
          (
            await scope.query(tx, 'SELECT admin.p2_http_admit($1,$2) AS admitted', [
              commandHash,
              fingerprint,
            ])
          ).rows[0]?.admitted,
        ),
      );
      if (!r.ok || typeof r.value !== 'boolean') throw Error('HTTP admission unavailable');
      return r.value;
    },
  };
}
