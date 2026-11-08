import {
  reviewApiContracts,
  reviewQueueInput,
  reviewEvidenceInput,
} from '../../../contracts/src/phase2-review-client.ts';
import { z } from '../../../contracts/src/phase2-wire.ts';
import type { createPartnerReviewServices } from '../../../application/src/partners/partner-review.ts';
import { p2Id, p2Query, p2Project } from './phase2-common.ts';
import { ok } from '../../../domain/src/values/core.ts';
import { HttpFailure, type HttpRoute } from './core.ts';
export function partnerReviewRoutes(
  service: ReturnType<typeof createPartnerReviewServices>,
): readonly HttpRoute[] {
  return reviewApiContracts.map((c) => ({
    ...c,
    handle: async (ctx) => {
      if (!ctx.actor?.staff) throw new HttpFailure(401, 'unauthorized');
      if (c.operationId === 'p2StaffSession') {
        p2Query(ctx, z.strictObject({}));
        return ok({ schemaVersion: 1, csrf: ctx.actor.csrf, kind: 'staff-session' });
      }
      const handle = ctx.actor.partner?.handle;
      if (!handle) throw new HttpFailure(401, 'unauthorized');
      switch (c.operationId) {
        case 'p2BusinessQueue':
        case 'p2OfferQueue': {
          const q = p2Query(ctx, reviewQueueInput);
          return p2Project(
            await service.queue(
              handle,
              c.operationId === 'p2BusinessQueue' ? 'businesses' : 'offers',
              q.after,
              q.limit,
            ),
            ['items', 'next'],
          );
        }
        case 'p2BusinessReview':
          p2Query(ctx, z.strictObject({}));
          return p2Project(await service.business(handle, p2Id('organization', ctx.params.org)), [
            'organization',
            'profile',
            'assets',
            'agreements',
            'locations',
            'truncated',
          ]);
        case 'p2OfferReviewDetail': {
          p2Query(ctx, z.strictObject({}));
          const v = ctx.params.version;
          if (!v || !/^[1-9][0-9]{0,9}$/.test(v) || Number(v) > 2147483647)
            throw new HttpFailure(400, 'invalid_input');
          return p2Project(
            await service.offer(
              handle,
              p2Id('organization', ctx.params.org),
              p2Id('partner_offer', ctx.params.offer),
              Number(v),
            ),
            ['org', 'offer', 'version', 'state', 'text', 'targets'],
          );
        }
        case 'p2ReviewEvidence': {
          const q = p2Query(ctx, reviewEvidenceInput);
          return p2Project(
            await service.evidence(
              handle,
              p2Id('organization', ctx.params.org),
              p2Id('asset', ctx.params.asset),
              q.purpose,
            ),
            ['id', 'purpose', 'text'],
          );
        }
        default:
          throw Error('Unreviewed staff read operation');
      }
    },
  }));
}
