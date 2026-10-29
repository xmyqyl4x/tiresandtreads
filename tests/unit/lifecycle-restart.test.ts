import { expect, it } from 'vitest';
import {
  readExecutorPlan,
  readExecutorEvent,
  interruptionPoints,
} from '../fixtures/lifecycle-restart/protocol.ts';
import { lifecycleSourceDigest } from '../fixtures/lifecycle-validation/reader.ts';

const env = {
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  ISOLATED_TEST_PROJECT: 'tt-test-0123456789abcdef',
};
const input = (target: 'app' | 'cms') => ({
  mode: 'local-lifecycle-proof',
  phase: 'migrated',
  target,
  url: `postgresql://tt_${target}_migrator:${'a'.repeat(64)}@postgres.preflight.test:5432/tt_${target}_lifecycle_probe`,
  ca: 'synthetic guard input; never connected',
});
const plan = () => ({
  version: 1,
  project: env.ISOLATED_TEST_PROJECT,
  kind: 'interrupt',
  point: 'validation-locked',
  inputs: { app: input('app'), cms: input('cms') },
  baseline: {
    project: env.ISOLATED_TEST_PROJECT,
    sourceDigest: lifecycleSourceDigest(),
    foundation: { app: '0'.repeat(64), cms: '0'.repeat(64) },
    migrated: { app: '0'.repeat(64), cms: '0'.repeat(64) },
    databaseAcls: {
      app: {
        foundation: '0'.repeat(64),
        migrated: '0'.repeat(64),
        'quarantined-recovery': '0'.repeat(64),
      },
      cms: {
        foundation: '0'.repeat(64),
        migrated: '0'.repeat(64),
        'quarantined-recovery': '0'.repeat(64),
      },
    },
  },
  identity: {
    operationId: '1'.repeat(32),
    releaseDigest: lifecycleSourceDigest(),
    credentialGeneration: '2'.repeat(32),
  },
  previousReceipt: null,
});

it('admits only the fixed checkpoints and a fresh restart through the disposable envelope', () => {
  for (const point of interruptionPoints)
    expect(readExecutorPlan({ ...plan(), point }, env).point).toBe(point);
  expect(readExecutorPlan({ ...plan(), kind: 'restart', point: 'none' }, env).kind).toBe('restart');
});

it.each(
  [
    { version: 2 },
    { project: 'tt-stage' },
    { kind: 'release' },
    { point: 'arbitrary-sql' },
    { sql: 'SELECT 1' },
    { pid: 1234 },
    { repair: true },
    { kind: 'restart', point: 'validation-locked' },
    { kind: 'interrupt', point: 'none' },
    { kind: 'restart', point: 'none', previousReceipt: 'x'.repeat(70000) },
    { kind: 'restart', point: 'none', previousReceipt: '\u{1F600}'.repeat(18000) },
    {
      identity: {
        operationId: { toString: () => 'a'.repeat(32) },
        releaseDigest: 'a'.repeat(64),
        credentialGeneration: 'a'.repeat(32),
      },
    },
  ].map((patch, caseId) => [caseId, patch] as const),
)(
  'refuses expanded, coercible or oversized envelope case %i before spawn/connect',
  (_caseId, patch) => {
    expect(() => readExecutorPlan({ ...plan(), ...patch }, env)).toThrow(
      'Invalid disposable executor plan',
    );
  },
);

it.each([
  { APP_ENV: 'stage-local' },
  { PROVIDER_MODE: 'live' },
  { ISOLATED_TEST_PROJECT: 'tt-stage' },
])('refuses a retained or live environment %j', (patch) => {
  expect(() => readExecutorPlan(plan(), { ...env, ...patch })).toThrow(
    'Invalid disposable executor plan',
  );
});

it('refuses wrong target/phase/source bindings without accepting a caller PID or alternate executable', () => {
  const p = plan();
  for (const bad of [
    { ...p, inputs: { app: input('cms'), cms: input('app') } },
    { ...p, inputs: { app: input('app'), cms: { ...input('cms'), phase: 'foundation' } } },
    {
      ...p,
      inputs: {
        app: { ...input('app'), url: 'postgresql://localhost/retained' },
        cms: input('cms'),
      },
    },
    { ...p, baseline: { ...p.baseline, sourceDigest: '0'.repeat(64) } },
    { ...p, executable: 'other' },
  ])
    expect(() => readExecutorPlan(bad, env)).toThrow('Invalid disposable executor plan');
});

const result = () => ({
  scope: 'disposable-local-restart',
  kind: 'result',
  processId: 1234,
  runtimeAdmission: false,
  hostedAccepted: false,
  productActivation: false,
  importedReceiptRejected: true,
  importReads: { app: 0, cms: 0 },
  validationStatus: 'validated',
  handoffStatus: 'observed',
  reads: { app: 2, cms: 2 },
});
it('admits only redacted result summaries without granting any runtime authority', () => {
  const p = readExecutorPlan({ ...plan(), kind: 'restart', point: 'none' }, env);
  expect(readExecutorEvent(result(), p)).toEqual(result());
});
it.each([
  { runtimeAdmission: true },
  { rawError: 'private-sentinel' },
  { processId: 0 },
  { kind: 'other' },
  { importReads: { app: 1, cms: 0 } },
  { importedReceiptRejected: false },
  { validationStatus: 'refused', handoffStatus: 'observed' },
  { reads: { app: 1000, cms: 0 } },
])('refuses unsafe, expanded or contradictory child summaries %j', (patch) => {
  const p = readExecutorPlan({ ...plan(), kind: 'restart', point: 'none' }, env);
  expect(() => readExecutorEvent({ ...result(), ...patch }, p)).toThrow(
    'Invalid disposable executor event',
  );
});
