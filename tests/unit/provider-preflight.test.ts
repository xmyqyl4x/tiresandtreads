import { afterEach, expect, it, vi } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { readLocalProviderPreflight } from '../../packages/config/src/provider-preflight.ts';
import { createPreflightNoSend } from '../../packages/integrations/src/provider-preflight.ts';
import { createLocalSignaturePreflight } from '../../packages/integrations/src/provider-preflight-workflow.ts';
import { preflightEnv, providerInput } from '../fixtures/provider-preflight/input.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('binds only project-scoped fixture resources with explicit owner, region and no-send mode', () => {
  expect(readLocalProviderPreflight(providerInput(), preflightEnv)).toMatchObject({
    region: 'us-east-1',
    account: '123456789012',
    mailMode: 'no-send',
    context: {
      app: 'tiresandtreads',
      purpose: 'provider-preflight',
      project: preflightEnv.ISOLATED_TEST_PROJECT,
    },
  });
});
it.each([
  { storageEndpoint: 'https://s3.us-east-1.amazonaws.com' },
  { storageEndpoint: 'http://127.0.0.1:55000' },
  { storageEndpoint: 'http://moto:5000/?redirect=other' },
  { workflowEndpoint: 'https://api.inngest.com' },
  { workflowEndpoint: 'http://user:secret@inngest:8288/' },
  { region: 'us-west-2' },
  { account: '999999999999' },
  { keyArn: providerInput().keyArn.replace('123456789012', '999999999999') },
  { keyArn: providerInput().keyArn.replace('us-east-1', 'us-west-2') },
  { keyArn: 'alias/staging' },
  { privateBucket: 'tt-stage-private' },
  { publicBucket: providerInput().privateBucket },
  { mailMode: 'live' },
  { enabled: true },
  { credentials: { accessKeyId: 'unexpected' } },
  { objectVersion: '' },
  { kmsCiphertext: 'bad' },
])('refuses unsafe or foreign fixture settings before any client exists (%#)', (patch) => {
  expect(() => readLocalProviderPreflight({ ...providerInput(), ...patch }, preflightEnv)).toThrow(
    /^Invalid local provider preflight$/,
  );
});
it('refuses retained/hosted/implicit scope without echoing input', () => {
  for (const env of [
    {},
    { ...preflightEnv, APP_ENV: 'stage-local' },
    { ...preflightEnv, PROVIDER_MODE: 'hosted' },
    { ...preflightEnv, ISOLATED_TEST_PROJECT: 'tt-stage' },
  ])
    expect(() => readLocalProviderPreflight(providerInput(), env)).toThrow(
      /^Invalid local provider preflight$/,
    );
});
it('provides an explicit mail port that cannot accept or send any payload', async () => {
  const p = createPreflightNoSend();
  expect(p).toMatchObject({ fixture: true, name: 'fixture' });
  await expect(p.send('arbitrary', {} as never)).rejects.toThrow(/^Local preflight mail disabled$/);
});

const origin = 'http://test:8124/internal/preflight-inngest?probe=trust';
const body = '{"fixture":"only"}';
function signature(key: string, data = body, stamp = Math.floor(Date.now() / 1000)) {
  return `t=${stamp}&s=${createHmac('sha256', key.replace('signkey-test-', '')).update(data).update(String(stamp)).digest('hex')}`;
}
function request(sig?: string, data = body, url = origin, method = 'POST') {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...(sig ? { 'x-inngest-signature': sig } : {}) },
    ...(method === 'POST' ? { body: data } : {}),
  });
}
it('uses actual pinned SDK signature verification offline even when dev mode is inherited', async () => {
  vi.stubEnv('INNGEST_DEV', '1');
  const network = vi.spyOn(globalThis, 'fetch');
  const key = 'signkey-test-' + randomBytes(32).toString('hex');
  const inherited = 'signkey-test-' + randomBytes(32).toString('hex');
  vi.stubEnv('INNGEST_SIGNING_KEY_FALLBACK', inherited);
  const probe = createLocalSignaturePreflight(preflightEnv, key);
  const good = await probe(request(signature(key)));
  expect(good.status).toBe(200);
  expect(await good.json()).toEqual({ scope: 'local-fixture', verified: true });
  expect((await probe(request())).status).toBe(401);
  expect((await probe(request(signature(inherited)))).status).toBe(401);
  expect(network).not.toHaveBeenCalled();
});
it.each(['missing', 'wrong key', 'tampered body', 'stale'])(
  'refuses a %s signed-callback probe',
  async (kind) => {
    const key = 'signkey-test-' + randomBytes(32).toString('hex');
    const sig =
      kind === 'missing'
        ? undefined
        : kind === 'wrong key'
          ? signature('signkey-test-' + randomBytes(32).toString('hex'))
          : signature(
              key,
              body,
              kind === 'stale' ? Math.floor(Date.now() / 1000) - 600 : undefined,
            );
    const r = await createLocalSignaturePreflight(
      preflightEnv,
      key,
    )(request(sig, kind === 'tampered body' ? '{"fixture":"changed"}' : body));
    expect(r.status).toBe(401);
    expect(await r.text()).not.toContain(key);
  },
);
it('refuses remote/alternate/sync/product routes, oversized bodies and invalid signing authority', async () => {
  const key = 'signkey-test-' + randomBytes(32).toString('hex'),
    p = createLocalSignaturePreflight(preflightEnv, key);
  for (const [url, method] of [
    [origin.replace('test:8124', 'example.com'), 'POST'],
    [origin.replace('probe=trust', 'fnId=product'), 'POST'],
    [origin, 'PUT'],
    [origin, 'GET'],
  ])
    expect((await p(request(undefined, body, url, method))).status).toBe(404);
  expect((await p(request(undefined, 'x'.repeat(8193)))).status).toBe(413);
  expect(() =>
    createLocalSignaturePreflight(preflightEnv, 'signkey-prod-' + 'a'.repeat(64)),
  ).toThrow(/^Invalid local signature preflight$/);
  expect(() =>
    createLocalSignaturePreflight({ ...preflightEnv, APP_ENV: 'stage-local' }, key),
  ).toThrow();
});
