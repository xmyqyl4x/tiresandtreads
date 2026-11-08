import { z, pilotApiContracts, pilotRequestInput } from '../../../contracts/src/phase2-partners.ts';
import type { createPilotDeliveryServices } from '../../../application/src/partners/pilot-delivery.ts';
import {
  p2Commands,
  p2Parse,
  p2Query,
  p2Project,
  p2Id,
  type P2HttpAdmission,
} from './phase2-common.ts';
import type { HttpRoute } from './core.ts';
// Registration/cancellation only. No route dispatches mail, consumes a code or accepts provider effects.
export function pilotRoutes(
  d: Readonly<{
    service: ReturnType<typeof createPilotDeliveryServices>;
    admission: P2HttpAdmission;
    secret: Uint8Array;
  }>,
): readonly HttpRoute[] {
  const command = p2Commands(d.admission, d.secret);
  return pilotApiContracts.map((contract) => ({
    ...contract,
    handle: async (c) => {
      p2Query(c, z.strictObject({}));
      const send = p2Id('send', c.params.send);
      if (contract.operationId === 'p2PilotRequest') {
        const v = p2Parse(pilotRequestInput, c.body);
        return command.execute(c, contract.operationId, v, async () =>
          p2Project(await d.service.request(c.actor!.keys, send, v), [
            'sendId',
            'state',
            'includeOffers',
            'policyVersion',
          ]),
        );
      }
      p2Parse(z.strictObject({}), c.body);
      return command.execute(c, contract.operationId, {}, async () =>
        p2Project(await d.service.cancel(c.actor!.keys, send), ['state']),
      );
    },
  }));
}
