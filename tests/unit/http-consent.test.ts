import { it, expect, vi } from 'vitest';
import { consentRoutes } from '../../packages/integrations/src/http/consent.ts';
import type { createContactServices } from '../../packages/application/src/services/contacts.ts';
import type { createDeliveryServices } from '../../packages/application/src/services/delivery.ts';
import type { createPrivacyServices } from '../../packages/application/src/services/privacy.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
import type { HttpContext } from '../../packages/integrations/src/http/core.ts';
const uuid = '11111111-1111-4111-8111-111111111111';
const context = (body: unknown = null): HttpContext => ({
  body,
  actor: { keys: [{ keyVersion: 'synthetic', digest: 'a'.repeat(64) }], csrf: 'csrf' },
  params: { sendId: uuid },
  key: 'synthetic_command_001',
  query: new URLSearchParams(),
  peer: '127.0.0.1',
  responseHeaders: new Headers(),
  request: new Request('http://127.0.0.1/api/v1/privacy/status', {
    headers: { authorization: 'Bearer synthetic-proof', 'sec-gpc': '1' },
  }),
});
function setup() {
  const contacts = {
      request: vi.fn(async () => ok({ accepted: true })),
      browser: vi.fn(async () => ok({ targeted_ads: false })),
      setBrowserChoices: vi.fn(async () => ok(null)),
    },
    delivery = {
      request: vi.fn(async () => ok(null)),
      status: vi.fn(async () => ok(null)),
      cancel: vi.fn(async () => ok(null)),
    },
    privacy = {
      requestOwner: vi.fn(async () => ok(null)),
      requestEmail: vi.fn(async () => ok({ accepted: true })),
      confirm: vi.fn(async () => ok(null)),
      status: vi.fn(async () =>
        ok({
          id: uuid,
          kind: 'delete',
          status: 'pending',
          dueAt: '2026-11-03T00:00:00.000Z',
          completedAt: null,
          error: 'private-provider-detail',
          targetId: 'private-subject',
        }),
      ),
    };
  const routes = consentRoutes({
    policy: async () =>
      ok({
        version: 'synthetic',
        notices: {
          necessary: uuid,
          report: uuid,
          offers: uuid,
          analytics: uuid,
          ads: uuid,
          targeted_ads: uuid,
        },
      }),
    contacts: contacts as unknown as ReturnType<typeof createContactServices>,
    delivery: delivery as unknown as ReturnType<typeof createDeliveryServices>,
    privacy: privacy as unknown as ReturnType<typeof createPrivacyServices>,
  });
  return {
    contacts,
    delivery,
    privacy,
    routes,
    handle: (id: string, c: HttpContext) => routes.find((r) => r.operationId === id)!.handle(c),
  };
}
it('preserves owner keys and bounded contact notices at the common service boundary', async () => {
  const s = setup(),
    c = context({
      email: 'synthetic@example.invalid',
      report: { id: uuid, version: 1 },
      offers: false,
      notices: { report: uuid },
    });
  expect(await s.handle('requestContact', c)).toMatchObject({ ok: true });
  expect(s.contacts.request.mock.calls[0]).toEqual(expect.arrayContaining([c.actor!.keys, c.key]));
});
it('lets browser GPC override a false body field and converts a valid revision without numeric precision loss', async () => {
  const s = setup(),
    c = context({
      expectedRevision: '9223372036854775807',
      allowed: ['targeted_ads'],
      gpc: false,
      notices: { necessary: uuid, analytics: uuid, ads: uuid, targeted_ads: uuid },
    });
  expect(await s.handle('setBrowserConsent', c)).toMatchObject({ ok: true });
  expect(s.contacts.setBrowserChoices).toHaveBeenCalledWith(
    c.actor!.keys,
    c.key,
    expect.objectContaining({ gpc: true, expectedRevision: 9223372036854775807n }),
    'POST',
  );
});
it('never exposes provider errors or private target metadata in a proof-authorized rights status', async () => {
  const s = setup(),
    r = await s.handle('privacyStatus', context());
  expect(r).toMatchObject({ ok: true, value: { id: uuid, status: 'pending' } });
  expect(JSON.stringify(r)).not.toContain('private-');
});
it('returns the same accepted email-request result without exposing whether a contact exists', async () => {
  const s = setup();
  for (const email of ['known@example.invalid', 'unknown@example.invalid'])
    expect(
      await s.handle(
        'requestEmailRights',
        context({ email, kind: 'delete', jurisdiction: 'synthetic' }),
      ),
    ).toEqual(ok({ accepted: true }));
});
it.each([
  'requestContact',
  'setBrowserConsent',
  'requestDelivery',
  'cancelDelivery',
  'requestOwnerRights',
  'requestEmailRights',
  'confirmPrivacyProof',
])('refuses unknown actor/MFA fields in %s before a business effect', async (operation) => {
  const s = setup();
  expect(await s.handle(operation, context({ actorId: uuid, mfa: true }))).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
});
it('binds all consent/delivery/rights operations explicitly and has no GET confirmation or deletion operation', () => {
  const s = setup();
  expect(s.routes).toHaveLength(11);
  expect(
    s.routes
      .filter((r) => r.method === 'GET')
      .map((r) => r.operationId)
      .sort(),
  ).toEqual(['getBrowserConsent', 'getConsentPolicy', 'getDelivery', 'privacyStatus']);
});
