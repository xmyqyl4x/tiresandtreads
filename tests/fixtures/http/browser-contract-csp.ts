import assert from 'node:assert/strict';
// Initialize Node's host implementation before denying script compilation in this disposable child.
Response.json({ ready: true });
const original = globalThis.Function;
let probes = 0;
Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
globalThis.Function = new Proxy(original, {
  apply() {
    probes++;
    throw Error('Synthetic CSP denies eval');
  },
  construct() {
    probes++;
    throw Error('Synthetic CSP denies eval');
  },
});
try {
  const { createBrowserConsentClient } =
    await import('../../../packages/contracts/src/browser-consent-client.ts');
  const uuid = '11111111-1111-4111-8111-111111111111',
    notices = {
      necessary: uuid,
      report: uuid,
      offers: uuid,
      analytics: uuid,
      ads: uuid,
      targeted_ads: uuid,
    };
  const send: typeof fetch = async (url, options) =>
    Response.json({
      requestId: uuid,
      data:
        options?.method === 'POST'
          ? { schema_version: 1, resource_id: uuid, status: 'accepted', result_revision: '2' }
          : String(url).endsWith('/policy')
            ? { version: 'synthetic', notices }
            : {
                necessary: true,
                analytics: false,
                ads: false,
                targeted_ads: false,
                identity_sharing: false,
                revision: '1',
              },
    });
  const client = createBrowserConsentClient('http://127.0.0.1:8380', send);
  assert.equal((await client.policy()).data.version, 'synthetic');
  assert.equal((await client.browser()).data.analytics, false);
  await client.choices(
    {
      expectedRevision: '1',
      allowed: [],
      gpc: false,
      notices: { necessary: uuid, analytics: uuid, ads: uuid, targeted_ads: uuid },
    },
    { csrf: 'a'.repeat(64), key: 'csp_command_000001' },
  );
  const { createDeliveryPrivacyClient } =
    await import('../../../packages/contracts/src/delivery-privacy-client.ts');
  const delivery = createDeliveryPrivacyClient('http://127.0.0.1:8380', async () =>
    Response.json({
      requestId: uuid,
      data: {
        id: uuid,
        revision: '1',
        state: 'scheduled',
        sendAfter: '2026-11-03T12:01:00.000Z',
        cancelDeadline: '2026-11-03T12:01:00.000Z',
      },
    }),
  );
  assert.equal(
    (
      await delivery.deliver(
        {
          email: 'csp@example.invalid',
          report: { id: uuid, version: 1 },
          offers: false,
          notices: { report: uuid },
        },
        'a'.repeat(64),
        'csp_delivery_000001',
      )
    ).state,
    'scheduled',
  );
} finally {
  globalThis.Function = original;
  Reflect.deleteProperty(globalThis, 'window');
}
assert.equal(probes, 0);
console.log(
  JSON.stringify({ simulatedBrowserRealm: true, evalProbes: probes, actualBrowserCsp: false }),
);
