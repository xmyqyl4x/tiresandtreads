import { expect, it } from 'vitest';
import { readLocalDatabasePreflight } from '../../packages/config/src/database-preflight.ts';
const env = {
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  ISOLATED_TEST_PROJECT: 'tt-test-1234abcd',
};
const settings = () => ({
  mode: 'local-preflight',
  target: 'app',
  url: `postgresql://tt_app_migrator:${'a'.repeat(64)}@postgres.preflight.test:5432/tt_app_catalog`,
  peerDatabase: 'tt_cms_content',
  ca: 'synthetic CA input',
  expectedVersion: 180006,
  expectedMigrations: 1,
  expectedHistory: [{ id: '0001_fixture', sha256: 'b'.repeat(64) }],
});
it('constructs explicit verified TLS options without URL-based SSL overrides', () => {
  const r = readLocalDatabasePreflight(settings(), env);
  expect(r.connection).toMatchObject({
    host: 'postgres.preflight.test',
    port: 5432,
    user: 'tt_app_migrator',
    database: 'tt_app_catalog',
    ssl: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
  });
  expect(r.connection).not.toHaveProperty('connectionString');
  expect(r.connection.options).toContain('search_path=pg_catalog');
});
it('requires a complete ordered unique migration manifest with bounded digests', () => {
  const s = settings();
  for (const patch of [
    { expectedHistory: [] },
    { expectedMigrations: 2 },
    { expectedHistory: [{ id: '0001_fixture', sha256: 'wrong' }] },
    { expectedMigrations: 2, expectedHistory: [...s.expectedHistory, ...s.expectedHistory] },
  ])
    expect(() => readLocalDatabasePreflight({ ...s, ...patch }, env)).toThrow();
});
it('refuses remote, native, credential-free, query-bearing and cross-target endpoints before I/O', () => {
  const s = settings();
  for (const url of [
    s.url.replace('postgres.preflight.test', 'example.com'),
    s.url.replace('postgres.preflight.test', '127.0.0.1'),
    s.url.replace(':5432', ':55433'),
    s.url + '?sslmode=no-verify',
    s.url + '#secret',
    s.url.replace('tt_app_migrator', 'local_harness'),
    s.url.replace('tt_app_catalog', 'tt_cms_content'),
    s.url.replace('a'.repeat(64), ''),
  ]) {
    expect(() => readLocalDatabasePreflight({ ...s, url }, env)).toThrow(
      'Invalid local database preflight',
    );
  }
});
it('requires explicit disposable fixture scope and rejects insecure or unknown options', () => {
  const s = settings();
  for (const badEnv of [
    { ...env, APP_ENV: 'stage-local' },
    { ...env, PROVIDER_MODE: 'hosted' },
    { ...env, ISOLATED_TEST_PROJECT: 'tt-stage' },
  ])
    expect(() => readLocalDatabasePreflight(s, badEnv)).toThrow();
  for (const patch of [
    { mode: 'hosted' },
    { ssl: false },
    { rejectUnauthorized: false },
    { ca: '' },
    { ca: 'x'.repeat(65537) },
    { peerDatabase: 'tt_app_catalog' },
    { expectedVersion: 0 },
    { expectedMigrations: 0 },
  ])
    expect(() => readLocalDatabasePreflight({ ...s, ...patch }, env)).toThrow();
});
it('redacts configuration failures and preserves the original local-host restrictions', async () => {
  const s = settings();
  let error;
  try {
    readLocalDatabasePreflight({ ...s, url: s.url + '?sslmode=disable' }, env);
  } catch (e) {
    error = String(e);
  }
  expect(error).not.toContain('a'.repeat(64));
  expect(error).not.toContain('postgresql:');
  const { validateServiceHostPlan, serviceHostRoles } =
    await import('../../packages/config/src/service-host-plan.ts');
  const names = Object.keys(serviceHostRoles) as (keyof typeof serviceHostRoles)[];
  const urls = Object.fromEntries(
    names.map((n) => [
      n,
      `postgresql://${serviceHostRoles[n]}:fixture@cloud.example.test:5432/${n === 'cms' ? 'cms' : 'app'}`,
    ]),
  ) as Parameters<typeof validateServiceHostPlan>[0]['urls'];
  const max = Object.fromEntries(names.map((n) => [n, 1])) as Parameters<
    typeof validateServiceHostPlan
  >[0]['max'];
  expect(() =>
    validateServiceHostPlan({ urls, max, replicas: 1, reserve: 20, external: [] }),
  ).toThrow('Invalid service host plan');
});
