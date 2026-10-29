import { expect, it } from 'vitest';
import { readLifecycleRequest } from '../fixtures/lifecycle-validation/reader.ts';

const env = {
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  ISOLATED_TEST_PROJECT: 'tt-test-0123456789abcdef',
};
const input = {
  mode: 'local-lifecycle-proof',
  phase: 'foundation',
  target: 'app',
  url:
    'postgresql://tt_app_migrator:' +
    'a'.repeat(64) +
    '@postgres.preflight.test:5432/tt_app_lifecycle_probe',
  ca: 'provided only by the disposable TLS fixture',
};

it('admits only the three explicit phases and exact owner identities without accepting caller SQL or expected state', () => {
  for (const phase of ['foundation', 'migrated', 'quarantined-recovery']) {
    const settings = readLifecycleRequest({ ...input, phase }, env);
    expect(settings.phase).toBe(phase);
    expect(settings.connection.ssl.rejectUnauthorized).toBe(true);
    expect(settings.connection.options).toContain('default_transaction_read_only=on');
  }
});

it.each([
  { APP_ENV: 'stage-local' },
  { PROVIDER_MODE: 'live' },
  { ISOLATED_TEST_PROJECT: 'tt-stage' },
  { ISOLATED_TEST_PROJECT: '' },
])('refuses non-disposable environment %j before connection', (patch) => {
  expect(() => readLifecycleRequest(input, { ...env, ...patch })).toThrow(
    'Invalid disposable lifecycle request',
  );
});

it.each([
  { mode: 'hosted' },
  { phase: 'ready' },
  { target: 'other' },
  { sql: 'CREATE TABLE private_data(id int)' },
  { expectedHistory: [] },
  { repair: true },
  { url: input.url.replace('postgres.preflight.test', 'localhost') },
  { url: input.url.replace('postgres.preflight.test', 'hosted.example.invalid') },
  { url: input.url.replace('5432', '55433') },
  { url: input.url.replace('tt_app_migrator', 'local_harness') },
  { url: input.url.replace('tt_app_migrator', 'tt_app_runtime') },
  { url: input.url.replace('tt_app_lifecycle_probe', 'tt_app') },
  { url: input.url.replace('tt_app_lifecycle_probe', 'tt_cms_lifecycle_probe') },
  { url: input.url + '?sslmode=disable' },
  { url: input.url + '#redirect' },
  { url: input.url.replace('a'.repeat(64), 'retained-password') },
  { ca: '' },
])('refuses malformed, redirected or authority-bearing input %j', (patch) => {
  expect(() => readLifecycleRequest({ ...input, ...patch }, env)).toThrow(
    'Invalid disposable lifecycle request',
  );
});
