import { expect, it } from 'vitest';
import {
  admitLocalRelease,
  localReleaseReady,
  previousRevision,
  expansionDigest,
  admitExpansion,
  expansionSQL,
} from '../../scripts/deployment/preflight.ts';
const env = {
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  ISOLATED_TEST_PROJECT: 'tt-test-1234abcd',
};
const image = (value: string, revision: string) => ({
  id: 'sha256:' + value.repeat(64),
  revision,
  user: 'node',
  command: 'node start.mjs',
});
const plan = () => ({
  version: 1,
  project: env.ISOLATED_TEST_PROJECT,
  current: image('a', 'working'),
  previous: image('b', previousRevision),
  origin: 'https://ingress.preflight.test:9443',
  access: 'fixture-mtls',
  callback: 'sdk-trust-probe-only',
  productRoutes: 'deny',
  migrationMode: 'expand-only',
  rollbackMode: 'image-only',
  hostedAccepted: false,
  productActivation: false,
});
it('admits only a complete disposable immutable-image release pair', () =>
  expect(admitLocalRelease(plan(), env)).toEqual(plan()));
it.each([
  { project: 'tt-stage' },
  { current: image('a', 'bad') },
  { previous: image('b', '0'.repeat(40)) },
  { current: { ...image('a', 'working'), id: 'registry.example/app:latest' } },
  { current: image('b', 'working') },
  { current: { ...image('a', 'working'), user: 'root' } },
  { previous: { ...image('b', previousRevision), command: 'pnpm db:push' } },
  { origin: 'https://example.com' },
  { origin: 'http://ingress.preflight.test:9443' },
  { access: 'public' },
  { callback: 'sync' },
  { productRoutes: 'allow' },
  { migrationMode: 'contract' },
  { rollbackMode: 'down-migration' },
  { hostedAccepted: true },
  { productActivation: true },
  { account: 'unexpected' },
])('refuses foreign, mutable, privileged or activating release metadata %j', (patch) =>
  expect(() => admitLocalRelease({ ...plan(), ...patch }, env)).toThrow(
    /^Local deployment admission refused$/,
  ),
);
it.each([
  { ...env, APP_ENV: 'stage-local' },
  { ...env, PROVIDER_MODE: 'hosted' },
  { ...env, ISOLATED_TEST_PROJECT: 'tt-dev' },
])('refuses retained/hosted scope', (e) => expect(() => admitLocalRelease(plan(), e)).toThrow());
const gates = { app: true, cms: true, backend: true, stopping: false };
it('admits only the exact reviewed additive fixture and refuses altered/destructive SQL', () => {
  expect(admitExpansion(expansionSQL)).toBe(expansionSQL);
  for (const sql of [
    'DROP SCHEMA app CASCADE',
    expansionSQL + '; DROP TABLE app.subjects',
    expansionSQL + ' ',
  ])
    expect(() => admitExpansion(sql)).toThrow();
});
const state = () => ({
  version: 1,
  project: env.ISOLATED_TEST_PROJECT,
  slot: 'current',
  expansionDigest,
});
it('requires all current readiness evidence and an exact approved migration receipt', () => {
  const p = admitLocalRelease(plan(), env);
  expect(localReleaseReady(state(), p, gates)).toBe(true);
  for (const s of [
    null,
    {},
    { ...state(), project: 'tt-stage' },
    { ...state(), slot: 'remote' },
    { ...state(), expansionDigest: '0'.repeat(64) },
    { ...state(), extra: true },
  ])
    expect(localReleaseReady(s, p, gates)).toBe(false);
  for (const g of [
    { ...gates, app: false },
    { ...gates, cms: false },
    { ...gates, backend: false },
    { ...gates, stopping: true },
  ])
    expect(localReleaseReady(state(), p, g)).toBe(false);
  expect(localReleaseReady({ ...state(), slot: 'previous' }, p, gates)).toBe(true);
});
