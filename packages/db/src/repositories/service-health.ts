import type { ServiceHealthRepository } from '../../../application/src/ports/service-maintenance.ts';
import { guarded, type WriteScope } from './mutations.ts';
import { text, stamp, integer } from './private-values.ts';
export function createServiceHealthRepository(scope: WriteScope): ServiceHealthRepository {
  return guarded(scope, {
    async snapshot(tx) {
      return (
        await scope.query(
          tx,
          'SELECT code,queued,oldest_at,sampled_at,capacity FROM admin.service_health ORDER BY code',
        )
      ).rows.map((r) => ({
        code: text(r.code),
        queued: integer(r.queued, 0),
        oldestAt: r.oldest_at === null ? null : stamp(r.oldest_at),
        sampledAt: stamp(r.sampled_at),
        capacity: r.capacity === null ? null : integer(r.capacity),
      }));
    },
  });
}
