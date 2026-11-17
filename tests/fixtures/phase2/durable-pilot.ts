import { composePilot } from './compose-pilot.ts';
import type { durablePhase2Fixture } from './durable-fixture.ts';
import { id, revision } from '../../../packages/domain/src/values/core.ts';
import { value } from './compose-partner-services.ts';
// Synthetic setup on an already populated local catalog. Capture its real head in the publication transaction.
export function composeDurablePilot(f: Awaited<ReturnType<typeof durablePhase2Fixture>>['f']) {
  return composePilot({
    ...f,
    publish: {
      ...f.publish,
      async publish(tx, input) {
        const row = (
          await f.publishScope.query(
            tx,
            'SELECT bundle_id,revision::text FROM app.market_dataset_heads WHERE market=$1',
            [input.market],
          )
        ).rows[0];
        return f.publish.publish(tx, {
          ...input,
          expectedHead: row
            ? {
                bundleId: value(id('bundle', row.bundle_id)),
                revision: value(revision(row.revision)),
              }
            : null,
        });
      },
    },
  });
}
