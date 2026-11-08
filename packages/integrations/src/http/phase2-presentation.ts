import { presentationApiContracts } from '../../../contracts/src/phase2-presentation-client.ts';
import { z } from '../../../contracts/src/phase2-wire.ts';
import type { createAnalysisPresentationService } from '../../../application/src/analysis/analysis-presentation.ts';
import { p2Id, p2Parse, p2Query, p2Project } from './phase2-common.ts';
import type { HttpRoute } from './core.ts';
export function analysisPresentationRoutes(
  service: ReturnType<typeof createAnalysisPresentationService>,
): readonly HttpRoute[] {
  return presentationApiContracts.map((c) => ({
    ...c,
    handle: async (ctx) => {
      p2Query(ctx, z.strictObject({}));
      const v = p2Parse(z.string().regex(/^[1-9][0-9]{0,9}$/), ctx.params.version);
      return p2Project(
        await service.read(ctx.actor!.keys, {
          reportId: p2Id('report', ctx.params.report),
          version: p2Parse(z.number().int().min(1).max(2147483647), Number(v)),
        }),
        ['reportId', 'version', 'checkedAt', 'assistance', 'latestRequest', 'selection'],
      );
    },
  }));
}
