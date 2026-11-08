import { sessionContracts } from '../../../contracts/src/http.ts';
import { consentInputSchemas } from '../../../contracts/src/consent-inputs.ts';
import { p2Id, p2Query } from './phase2-common.ts';
import { z } from '../../../contracts/src/phase2-wire.ts';
import { ok } from '../../../domain/src/values/core.ts';
import type { createDeliveryServices } from '../../../application/src/services/delivery.ts';
import type { ContactPolicy } from '../../../application/src/ports/contact-services.ts';
import { HttpFailure, type HttpRoute } from './core.ts';
// Reuses the existing owner session, consent and delivery contracts in explicit local composition.
// It neither creates identity nor installs a production listener.
export function ownerReportWebRoutes(d: {
  delivery: Pick<ReturnType<typeof createDeliveryServices>, 'status' | 'cancel'>;
  policy: ContactPolicy;
}): readonly HttpRoute[] {
  const empty = z.strictObject({});
  return [
    {
      ...sessionContracts[1],
      handle: async (c) => {
        p2Query(c, empty);
        return ok({ csrf: c.actor!.csrf });
      },
    },
    {
      operationId: 'getConsentPolicy',
      method: 'GET',
      path: '/api/v1/consent/policy',
      access: 'public',
      handle: async (c) => {
        p2Query(c, empty);
        return ok(d.policy);
      },
    },
    {
      operationId: 'getDelivery',
      method: 'GET',
      path: '/api/v1/deliveries/:sendId',
      access: 'owner',
      handle: (c) => {
        p2Query(c, empty);
        return d.delivery.status(c.actor!.keys, p2Id('send', c.params.sendId));
      },
    },
    {
      operationId: 'cancelDelivery',
      method: 'POST',
      path: '/api/v1/deliveries/:sendId/cancel',
      access: 'owner',
      command: true,
      handle: (c) => {
        p2Query(c, empty);
        const parsed = consentInputSchemas.cancelDelivery.safeParse(c.body);
        if (!parsed.success) throw new HttpFailure(400, 'invalid_input');
        const v = parsed.data;
        return d.delivery.cancel(
          c.actor!.keys,
          p2Id('send', c.params.sendId),
          v.expectedRevision,
          v.reason,
        );
      },
    },
  ];
}
