import {
  analysisDeliveryContract,
  analysisDeliveryInput,
} from '../../../contracts/src/phase2-owner-client.ts';
import { z } from '../../../contracts/src/phase2-wire.ts';
import type { createAnalysisDeliveryServices } from '../../../application/src/analysis/analysis-delivery.ts';
import {
  p2Commands,
  p2Id,
  p2Parse,
  p2Project,
  p2Query,
  type P2HttpAdmission,
} from './phase2-common.ts';
import type { HttpRoute } from './core.ts';
// Opt-in scheduling only. Selection is explicit and frozen in the existing business transaction;
// neither completion of analysis nor this route dispatches a provider or recipient notification.
export function analysisDeliveryRoutes(
  d: Readonly<{
    delivery: Pick<ReturnType<typeof createAnalysisDeliveryServices>, 'request'>;
    admission: P2HttpAdmission;
    secret: Uint8Array;
  }>,
): readonly HttpRoute[] {
  const commands = p2Commands(d.admission, d.secret);
  return [
    {
      ...analysisDeliveryContract,
      handle: async (c) => {
        p2Query(c, z.strictObject({}));
        const v = p2Parse(analysisDeliveryInput, c.body);
        return commands.execute(c, analysisDeliveryContract.operationId, v, async () =>
          p2Project(
            await d.delivery.request(c.actor!.keys, c.key, {
              email: v.email,
              offers: v.offers,
              analysis: v.analysis,
              ...(v.comparisonRevision === undefined
                ? {}
                : { comparisonRevision: v.comparisonRevision }),
              report: { id: p2Id('report', v.report.id), version: v.report.version },
              notices: {
                report: p2Id('notice', v.notices.report),
                ...(v.notices.offers ? { offers: p2Id('notice', v.notices.offers) } : {}),
              },
            }),
            ['id', 'revision', 'state', 'sendAfter', 'cancelDeadline'],
          ),
        );
      },
    },
  ];
}
