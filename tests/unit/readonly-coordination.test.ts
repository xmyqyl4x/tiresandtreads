import { expect, it } from 'vitest';
import { readCoordinationPlan } from '../fixtures/readonly-coordination/contract.ts';

const env = {
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  ISOLATED_TEST_PROJECT: 'tt-test-0123456789abcdef',
};
const input = (target: 'app' | 'cms') => ({
  mode: 'local-lifecycle-proof',
  phase: 'foundation',
  target,
  url: `postgresql://tt_${target}_migrator:${'a'.repeat(64)}@postgres.preflight.test:5432/tt_${target}_lifecycle_probe`,
  ca: 'synthetic admission input; never connected',
});
const plan = () => ({
  version: 1,
  scope: 'disposable-readonly-coordination',
  project: env.ISOLATED_TEST_PROJECT,
  origin: 'app',
  mode: 'common',
  inputs: { app: input('app'), cms: input('cms') },
});

it('admits fixed app/CMS origins and the explicitly labeled per-database control', () => {
  for (const origin of ['app', 'cms'])
    for (const mode of ['common', 'per-database-control'])
      expect(readCoordinationPlan({ ...plan(), origin, mode }, env)).toMatchObject({
        origin,
        mode,
        project: env.ISOLATED_TEST_PROJECT,
      });
});

it.each([
  { version: 2 },
  { scope: 'hosted' },
  { project: 'tt-stage' },
  { origin: 'postgres' },
  { mode: 'execute' },
  { sql: 'SELECT private' },
  { key: [1, 2] },
  { pid: 123 },
  { timeout: 0 },
  { role: 'local_harness' },
  { program: 'other.ts' },
  { repair: true },
  { inputs: null },
  { inputs: { app: input('app') } },
  { inputs: { app: input('app'), cms: input('cms'), other: input('app') } },
  { inputs: { app: input('cms'), cms: input('app') } },
  { inputs: { app: input('app'), cms: { ...input('cms'), phase: 'migrated' } } },
  { inputs: { app: { ...input('app'), sql: 'repair' }, cms: input('cms') } },
  { inputs: { app: { ...input('app'), ca: 'x'.repeat(70000) }, cms: input('cms') } },
])('refuses expanded or unsupported plan %# with a fixed diagnostic', (patch) => {
  expect(() => readCoordinationPlan({ ...plan(), ...patch }, env)).toThrow(
    /^Read-only coordination proof refused$/,
  );
});

it.each([
  { APP_ENV: 'stage-local' },
  { PROVIDER_MODE: 'live' },
  { ISOLATED_TEST_PROJECT: 'tt-stage' },
])('refuses a retained or live environment %#', (patch) => {
  expect(() => readCoordinationPlan(plan(), { ...env, ...patch })).toThrow(
    /^Read-only coordination proof refused$/,
  );
});

it.each([
  'postgresql://localhost:5432/retained',
  `postgresql://tt_app_migrator:${'a'.repeat(64)}@postgres.mismatch.preflight.test:5432/tt_app_lifecycle_probe`,
  `postgresql://tt_app_migrator:${'a'.repeat(64)}@postgres.preflight.test:5432/tt_app_lifecycle_probe?sslmode=disable`,
  `postgresql://tt_app_migrator:${'a'.repeat(64)}@postgres.preflight.test:5432/tt_cms_lifecycle_probe`,
  `postgresql://local_harness:${'a'.repeat(64)}@postgres.preflight.test:5432/tt_app_lifecycle_probe`,
  `postgresql://tt_app_migrator:${'a'.repeat(64)}@postgres.preflight.test:5433/tt_app_lifecycle_probe`,
])('refuses an alternate connection binding %# before opening sessions', (url) => {
  expect(() =>
    readCoordinationPlan(
      { ...plan(), inputs: { app: { ...input('app'), url }, cms: input('cms') } },
      env,
    ),
  ).toThrow(/^Read-only coordination proof refused$/);
});

it('detaches and freezes admitted fixture inputs rather than retaining mutable caller authority', () => {
  const raw = plan();
  const admitted = readCoordinationPlan(raw, env);
  raw.inputs.app.url = 'postgresql://localhost/retained';
  expect(admitted.inputs.app.url).not.toBe(raw.inputs.app.url);
  expect(Object.isFrozen(admitted)).toBe(true);
  expect(Object.isFrozen(admitted.inputs.app)).toBe(true);
});
