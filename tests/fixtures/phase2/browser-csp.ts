import assert from 'node:assert/strict';
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
  const { createP2PartnerClient } =
    await import('../../../packages/contracts/src/phase2-partner-client.ts');
  const client = createP2PartnerClient('http://127.0.0.1:8380', async () =>
    Response.json({
      requestId: '11111111-1111-4111-8111-111111111111',
      data: { schemaVersion: 1, csrf: 'a'.repeat(64), kind: 'partner-session' },
    }),
  );
  assert.equal((await client.p2PartnerSession({})).data.kind, 'partner-session');
} finally {
  globalThis.Function = original;
  Reflect.deleteProperty(globalThis, 'window');
}
assert.equal(probes, 0);
console.log(
  JSON.stringify({ simulatedBrowserRealm: true, evalProbes: probes, actualBrowserCsp: false }),
);
