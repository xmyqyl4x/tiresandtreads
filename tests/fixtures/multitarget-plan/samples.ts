// Fixed synthetic labels only; no real container, volume, TLS, credential or target lookup.
export const environment = () => ({
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  ISOLATED_TEST_PROJECT: process.env.ISOLATED_TEST_PROJECT ?? 'tt-test-aaaaaaaaaaaaaaaa',
});
export const plan = () => ({
  version: 1,
  scope: 'disposable-readonly-multitarget-plan',
  project: environment().ISOLATED_TEST_PROJECT,
  fixtureGeneration: 'a'.repeat(32),
  domains: [
    { slot: 0, purpose: 'source' },
    { slot: 1, purpose: 'target' },
  ],
});
export const bindings = () => ({
  version: 1,
  scope: 'synthetic-multitarget-bindings',
  project: environment().ISOLATED_TEST_PROJECT,
  fixtureGeneration: 'a'.repeat(32),
  domains: [0, 1].map((slot) => ({
    slot,
    service: slot === 0 ? 'postgres' : 'recovery-postgres',
    containerRef: 'synthetic-container:' + String(slot + 1).repeat(64),
    volumeRef: 'synthetic-volume:' + String(slot + 1).repeat(32),
    credentialGeneration: String(slot + 1).repeat(32),
    tlsGeneration: String(slot + 3).repeat(32),
  })),
});
export const json = (value: unknown) => JSON.stringify(value);
export const allocationOrder = [
  'common:0',
  'common:1',
  'inner:0:app',
  'inner:0:cms',
  'inner:1:app',
  'inner:1:cms',
] as const;
export const readOrder = ['0/app', '0/cms', '1/app', '1/cms'] as const;
