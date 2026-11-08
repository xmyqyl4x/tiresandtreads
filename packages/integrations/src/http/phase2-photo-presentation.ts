import {
  photoPresentationContracts,
  photoOptionsQuery,
} from '../../../contracts/src/phase2-photo-presentation-client.ts';
import type { createPhotoPresentationService } from '../../../application/src/analysis/photo-presentation.ts';
import { p2Query, p2Project } from './phase2-common.ts';
import type { HttpRoute } from './core.ts';
export function photoPresentationRoutes(
  service: ReturnType<typeof createPhotoPresentationService>,
): readonly HttpRoute[] {
  return photoPresentationContracts.map((c) => ({
    ...c,
    handle: async (ctx) => {
      const q = p2Query(ctx, photoOptionsQuery);
      return p2Project(await service.read(ctx.actor!.keys, q.after ?? null), [
        'checkedAt',
        'processing',
        'items',
        'next',
      ]);
    },
  }));
}
