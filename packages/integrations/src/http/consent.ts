import type { createConsentPolicyQuery } from '../../../application/src/queries/consent-policy.ts';
import { operationQuerySchemas } from '../../../contracts/src/operation-queries.ts';
import type { createContactServices } from '../../../application/src/services/contacts.ts';
import type { createDeliveryServices } from '../../../application/src/services/delivery.ts';
import type { createPrivacyServices } from '../../../application/src/services/privacy.ts';
import { consentInputSchemas } from '../../../contracts/src/consent-inputs.ts';
import { id, revision, ok, fail } from '../../../domain/src/values/core.ts';
import { failure } from '../../../application/src/ports/transactions.ts';
import type { HttpContext, HttpRoute } from './core.ts';

export function consentRoutes(d: {
  readonly policy: ReturnType<typeof createConsentPolicyQuery>;
  readonly contacts: ReturnType<typeof createContactServices>;
  readonly delivery: ReturnType<typeof createDeliveryServices>;
  readonly privacy: ReturnType<typeof createPrivacyServices>;
}): readonly HttpRoute[] {
  const proof = (c: HttpContext) => {
    const raw = c.request.headers.get('authorization');
    return raw?.startsWith('Bearer ') && raw.length <= 512 ? raw.slice(7) : '';
  };
  const parsedId = <K extends string>(kind: K, value: unknown) => {
    const result = id(kind, value);
    if (!result.ok) throw Error('Invalid path');
    return result.value;
  };
  return [
    {
      operationId: 'getConsentPolicy',
      method: 'GET',
      path: '/api/v1/consent/policy',
      access: 'public',
      handle: () => d.policy(),
    },
    {
      operationId: 'requestContact',
      method: 'POST',
      path: '/api/v1/contacts',
      access: 'owner',
      command: true,
      handle: async (c) => {
        const parsed = consentInputSchemas.requestContact.safeParse(c.body);
        if (!parsed.success) return fail(failure('invalid_input'));
        const input = parsed.data;
        const report = input.report
          ? { id: parsedId('report', input.report.id), version: input.report.version }
          : null;
        const notices = Object.fromEntries(
          Object.entries(input.notices).map(([k, v]) => [k, parsedId('notice', v)]),
        );
        return d.contacts.request(c.actor!.keys, c.key, { ...input, report, notices });
      },
    },
    {
      operationId: 'getBrowserConsent',
      method: 'GET',
      path: '/api/v1/consent/browser',
      access: 'owner',
      handle: (c) => {
        const parsed = operationQuerySchemas.getBrowserConsent.safeParse(
          Object.fromEntries(c.query),
        );
        return parsed.success && new Set(c.query.keys()).size === [...c.query].length
          ? d.contacts.browser(c.actor!.keys, {
              gpc: c.request.headers.get('sec-gpc') === '1',
              cmpAvailable: parsed.data.cmpAvailable === 'true',
            })
          : Promise.resolve(fail(failure('invalid_input')));
      },
    },
    {
      operationId: 'setBrowserConsent',
      method: 'POST',
      path: '/api/v1/consent/browser',
      access: 'owner',
      command: true,
      handle: async (c) => {
        const parsed = consentInputSchemas.setBrowserConsent.safeParse(c.body);
        if (!parsed.success) return fail(failure('invalid_input'));
        const expected = revision(parsed.data.expectedRevision);
        if (!expected.ok) return fail(failure('invalid_input'));
        const raw = parsed.data.notices,
          notices = {
            necessary: parsedId('notice', raw.necessary),
            analytics: parsedId('notice', raw.analytics),
            ads: parsedId('notice', raw.ads),
            targeted_ads: parsedId('notice', raw.targeted_ads),
          };
        return d.contacts.setBrowserChoices(
          c.actor!.keys,
          c.key,
          {
            ...parsed.data,
            gpc: parsed.data.gpc || c.request.headers.get('sec-gpc') === '1',
            expectedRevision: expected.value,
            notices,
          },
          'POST',
        );
      },
    },
    {
      operationId: 'requestDelivery',
      method: 'POST',
      path: '/api/v1/deliveries',
      access: 'owner',
      command: true,
      handle: async (c) => {
        const parsed = consentInputSchemas.requestDelivery.safeParse(c.body);
        if (!parsed.success || !parsed.data.report) return fail(failure('invalid_input'));
        const input = parsed.data,
          report = { id: parsedId('report', input.report!.id), version: input.report!.version },
          notices = Object.fromEntries(
            Object.entries(input.notices).map(([k, v]) => [k, parsedId('notice', v)]),
          );
        return d.delivery.request(c.actor!.keys, c.key, {
          email: input.email,
          offers: input.offers,
          report,
          notices,
          ...(input.comparisonRevision === undefined
            ? {}
            : { comparisonRevision: input.comparisonRevision }),
        });
      },
    },
    {
      operationId: 'getDelivery',
      method: 'GET',
      path: '/api/v1/deliveries/:sendId',
      access: 'owner',
      handle: async (c) => {
        const value = id('send', c.params.sendId);
        return value.ok
          ? d.delivery.status(c.actor!.keys, value.value)
          : fail(failure('invalid_input'));
      },
    },
    {
      operationId: 'cancelDelivery',
      method: 'POST',
      path: '/api/v1/deliveries/:sendId/cancel',
      access: 'owner',
      command: true,
      handle: async (c) => {
        const parsed = consentInputSchemas.cancelDelivery.safeParse(c.body),
          value = id('send', c.params.sendId);
        return parsed.success && value.ok
          ? d.delivery.cancel(
              c.actor!.keys,
              value.value,
              parsed.data.expectedRevision,
              parsed.data.reason,
            )
          : fail(failure('invalid_input'));
      },
    },
    {
      operationId: 'requestOwnerRights',
      method: 'POST',
      path: '/api/v1/privacy/owner-requests',
      access: 'owner',
      command: true,
      handle: async (c) => {
        const parsed = consentInputSchemas.requestOwnerRights.safeParse(c.body);
        return parsed.success
          ? d.privacy.requestOwner(c.actor!.keys, parsed.data.kind, parsed.data.jurisdiction, c.key)
          : fail(failure('invalid_input'));
      },
    },
    {
      operationId: 'requestEmailRights',
      method: 'POST',
      path: '/api/v1/privacy/email-requests',
      access: 'public',
      handle: async (c) => {
        const parsed = consentInputSchemas.requestEmailRights.safeParse(c.body);
        return parsed.success
          ? d.privacy.requestEmail(parsed.data.email, parsed.data.kind, parsed.data.jurisdiction)
          : fail(failure('invalid_input'));
      },
    },
    {
      operationId: 'privacyStatus',
      method: 'GET',
      path: '/api/v1/privacy/status',
      access: 'capability',
      handle: async (c) => {
        const value = await d.privacy.status(proof(c));
        if (!value.ok) return value;
        const x = value.value;
        return ok({
          id: x.id,
          kind: x.kind,
          status: x.status,
          dueAt: x.dueAt,
          completedAt: x.completedAt,
        });
      },
    },
    {
      operationId: 'confirmPrivacyProof',
      method: 'POST',
      path: '/api/v1/privacy/confirm',
      access: 'capability',
      handle: async (c) =>
        consentInputSchemas.confirmPrivacyProof.safeParse(c.body).success
          ? d.privacy.confirm(proof(c))
          : fail(failure('invalid_input')),
    },
  ];
}
