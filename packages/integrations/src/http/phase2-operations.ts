import type { createPartnerInsightsServices } from '../../../application/src/partners/partner-insights.ts';
import {
  operationsContracts,
  operationsDayQuery,
  operationsP2Definitions,
} from '../../../contracts/src/phase2-operations-client.ts';
import { z } from '../../../contracts/src/phase2-wire.ts';
import { ok } from '../../../domain/src/values/core.ts';
import type { createAnalysisOperationsService } from '../../../application/src/analysis/analysis-operations.ts';
import { p2Commands, p2Id, p2Parse, p2Query, type P2HttpAdmission } from './phase2-common.ts';
import { HttpFailure, type HttpRoute } from './core.ts';
import type { createStaffServices } from '../../../application/src/services/staff.ts';
import type { createOperationsServices } from '../../../application/src/services/analytics.ts';
export function analysisOperationsRoutes(d: {
  service: ReturnType<typeof createAnalysisOperationsService>;
  admission: P2HttpAdmission;
  secret: Uint8Array;
  staff: Pick<ReturnType<typeof createStaffServices>, 'queue'>;
  operations: Pick<ReturnType<typeof createOperationsServices>, 'dashboard'>;
  pilot: Pick<ReturnType<typeof createPartnerInsightsServices>, 'health'>;
}): readonly HttpRoute[] {
  const commands = p2Commands(d.admission, d.secret);
  return operationsContracts.map((c) => ({
    ...c,
    handle: async (ctx) => {
      const handle = ctx.actor?.partner?.handle;
      if (!handle) throw new HttpFailure(401, 'unauthorized');
      if (c.operationId === 'p2OperationsPurpose') {
        const q = p2Query(ctx, operationsP2Definitions.p2OperationsPurpose.query);
        const before = await d.service.session(handle);
        if (!before.ok) return before;
        if (q.kind === 'pilot') {
          if (!q.week) throw new HttpFailure(400, 'invalid_input');
          const h = await d.pilot.health(handle, q.week);
          if (!h.ok) return h;
          const current = await d.service.session(handle);
          return current.ok
            ? ok({ kind: q.kind, queue: null, visitors: null, pilot: h.value })
            : current;
        }
        const value =
          q.kind === 'visitors'
            ? await d.operations.dashboard(ctx.actor!.staff!, q.day)
            : await d.staff.queue(ctx.actor!.staff!, q.kind, q.after ?? null, 25);
        if (!value.ok) return value;
        const after = await d.service.session(handle);
        if (!after.ok) return after;
        return ok({
          kind: q.kind,
          pilot: null,
          queue: q.kind === 'visitors' ? null : value.value,
          visitors: q.kind === 'visitors' ? value.value : null,
        });
      }
      if (c.operationId === 'p2OperationsDashboard') {
        const q = p2Query(ctx, operationsDayQuery);
        return d.service.read(handle, q.day);
      }
      p2Query(ctx, z.strictObject({}));
      if (c.operationId === 'p2OperationsSession') {
        const r = await d.service.session(handle);
        return r.ok ? ok({ ...r.value, csrf: ctx.actor!.csrf }) : r;
      }
      if (c.operationId === 'p2OperationsReceipt')
        return d.service.receipt(handle, p2Id('ai_operation', ctx.params.command));
      const id = p2Id('ai_operation', ctx.key);
      if (c.operationId === 'p2OperationsDisable') {
        const body = p2Parse(operationsP2Definitions.p2OperationsDisable.input, ctx.body),
          policy = p2Id('ai_policy', ctx.params.policy);
        return commands.execute(ctx, c.operationId, body, () =>
          d.service.disable(handle, { id, policy, ...body }),
        );
      }
      p2Parse(z.strictObject({}), ctx.body);
      const request = p2Id('ai_request', ctx.params.request);
      return commands.execute(ctx, c.operationId, {}, () =>
        d.service.resume(handle, { id, request }),
      );
    },
  }));
}
