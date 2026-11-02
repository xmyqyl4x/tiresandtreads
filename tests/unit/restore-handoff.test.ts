import { expect, it } from 'vitest';
import {
  admitSeal,
  compareObservations,
  preservationFindings,
  admitCurrent,
  terminal,
  profiles,
} from '../fixtures/restore-handoff/contract.ts';
import { sample } from '../fixtures/restore-handoff/samples.ts';
import { readFileSync } from 'node:fs';

it('admits the closed-maintenance local phase without making a release/authority claim', () => {
  const s = sample();
  expect(admitSeal(JSON.stringify(s.seal), s.bindings, s.now)).toEqual(s.seal);
  expect(admitCurrent(JSON.stringify(s.current), s.seal, s.now)).toEqual(s.current);
  const r = terminal('success', 'compatible', 4, 4);
  expect(r).toMatchObject({
    status: 'success',
    complete: true,
    actualAcceptance: false,
    runtimeAdmission: false,
    hostedAccepted: false,
    productActivation: false,
    independentDurability: false,
    authenticated: false,
    targetFencing: false,
    observerMutationStatements: 0,
    providerDispatches: 0,
    actualRecipientNotifications: 0,
    casesClosed: 0,
    gatesClosed: 0,
  });
});
it('uses the finite sixteen native profiles; the end control is separately modeled', () => {
  expect(profiles).toHaveLength(16);
  expect(new Set(profiles).size).toBe(16);
  expect(profiles).not.toContain('end-unobserved');
});
it('matches every planned native profile in the frozen contract without importing the pure row', () => {
  const plan = JSON.parse(
    readFileSync('docs/implementation/evidence/P1/p1-pr-027-restore-handoff-contract.json', 'utf8'),
  );
  expect([...profiles]).toEqual(plan.cases.slice(0, 16).map((c: { profile: string }) => c.profile));
  expect(plan.cases[16].id).toBe('RH17');
});
for (const field of ['project', 'generation', 'image', 'config', 'sourceDigest'] as const)
  it(`refuses a changed ${field} binding rather than trusting the restored envelope`, () => {
    const s = sample();
    s.seal[field] =
      field === 'project'
        ? 'tt-test-' + 'f'.repeat(16)
        : field === 'generation'
          ? 'f'.repeat(32)
          : field === 'image'
            ? 'sha256:' + 'f'.repeat(64)
            : 'f'.repeat(64);
    expect(() => admitSeal(JSON.stringify(s.seal), s.bindings, s.now)).toThrow();
  });
for (const phase of [
  'artifact-admitted',
  'restored-quarantined',
  'privacy-replayed-quarantined',
  'readonly-observed',
  'released',
  null,
])
  it(`refuses an envelope not at the maintenance-closed boundary: ${phase}`, () => {
    const s = sample();
    expect(() => admitSeal(JSON.stringify({ ...s.seal, phase }), s.bindings, s.now)).toThrow();
  });
for (const field of ['appRestored', 'cmsRestored', 'privacyReplayed', 'maintenanceClosed'] as const)
  it(`requires actual setup fact ${field} without filling it from observer success`, () => {
    const s = sample();
    s.seal.setup[field] = false;
    expect(() => admitSeal(JSON.stringify(s.seal), s.bindings, s.now)).toThrow();
  });
it('rejects extra fields, missing/reordered/duplicate endpoints and excessive metadata', () => {
  const s = sample();
  for (const value of [
    { ...s.seal, released: true },
    { ...s.seal, observations: s.seal.observations.slice(1) },
    { ...s.seal, observations: s.seal.observations.toReversed() },
    { ...s.seal, observations: [s.seal.observations[0], ...s.seal.observations.slice(0, 3)] },
  ])
    expect(() => admitSeal(JSON.stringify(value), s.bindings, s.now)).toThrow();
  expect(() => admitSeal(' '.repeat(65537), s.bindings, s.now)).toThrow();
});
for (const flag of ['populated', 'historiesValid', 'quarantined'] as const)
  it(`does not seal a baseline that already lacks ${flag}`, () => {
    const s = sample();
    s.seal.observations[2]![flag] = false;
    expect(() => admitSeal(JSON.stringify(s.seal), s.bindings, s.now)).toThrow();
  });
for (const value of [0, -1, 201, 1.5])
  it(`refuses an invalid table budget ${value}`, () => {
    const s = sample();
    s.seal.observations[0]!.tables = value;
    expect(() => admitSeal(JSON.stringify(s.seal), s.bindings, s.now)).toThrow();
  });
it('detects target and source row/history/security drift with precise endpoint findings', () => {
  const s = sample();
  const actual = structuredClone(s.seal.observations);
  actual[0]!.rows = 'f'.repeat(64);
  actual[2]!.history = 'e'.repeat(64);
  actual[2]!.historiesValid = false;
  actual[3]!.quarantined = false;
  expect(compareObservations(s.seal.observations, actual)).toEqual([
    '0/app:rows',
    '1/app:history',
    '1/app:historiesValid',
    '1/cms:quarantined',
  ]);
  expect(compareObservations(s.seal.observations, s.seal.observations)).toEqual([]);
});
it('compares every opaque observation component without turning duplicate endpoints into parity', () => {
  const s = sample();
  for (const key of ['catalog', 'rows', 'sequences', 'security', 'history'] as const) {
    const current = structuredClone(s.seal.observations);
    current[1]![key] = 'f'.repeat(64);
    expect(compareObservations(s.seal.observations, current)).toEqual([`0/cms:${key}`]);
  }
  expect(() =>
    compareObservations(s.seal.observations, [...s.seal.observations, s.seal.observations[0]!]),
  ).toThrow();
});
for (const key of ['project', 'generation', 'digest', 'observedAt', 'backupFinishedAt'] as const)
  it(`does not accept a changed current checkpoint ${key}`, () => {
    const s = sample();
    const current = {
      ...s.current,
      [key]: key.endsWith('At') ? new Date(s.now - 120000).toISOString() : 'f'.repeat(64),
    };
    expect(() => admitCurrent(JSON.stringify(current), s.seal, s.now)).toThrow();
  });
it('requires a fresh checkpoint captured after maintenance closure and backup', () => {
  const s = sample();
  for (const at of [s.now - 400000, s.now + 10000, s.seal.maintenanceClosedAt - 1]) {
    const changed = {
      ...s.seal,
      checkpoint: { ...s.current, observedAt: new Date(at).toISOString() },
    };
    expect(() => admitSeal(JSON.stringify(changed), s.bindings, s.now)).toThrow();
  }
  expect(() => admitCurrent(' '.repeat(16385), s.seal, s.now)).toThrow();
});
it('returns defensive copies and masks failures rather than exposing submitted values', () => {
  const s = sample();
  const result = admitSeal(JSON.stringify(s.seal), s.bindings, s.now);
  result.observations[0]!.rows = 'e'.repeat(64);
  expect(s.seal.observations[0]!.rows).not.toBe(result.observations[0]!.rows);
  expect(() => admitSeal('SYNTHETIC_SECRET', s.bindings, s.now)).toThrow('Restore handoff refused');
});
it('RH17 models unobserved end as unknown and blocks a fresh attempt without a cancellation claim', () => {
  const r = terminal('unknown', 'end-unobserved', 4, 3);
  expect(r).toMatchObject({
    status: 'unknown',
    complete: false,
    cleanupUnknown: true,
    freshAttemptBlocked: true,
    independentDurability: false,
    targetFencing: false,
    casesClosed: 0,
    gatesClosed: 0,
  });
  expect(() => terminal('success', 'compatible', 4, 3)).toThrow();
  expect(() => terminal('success', 'compatible', 3, 3)).toThrow();
});
it('retains incomplete/unavailable observations without upgrading known physical cleanup into success', () => {
  expect(terminal('unavailable', 'observer-loss', 1, 1)).toMatchObject({
    status: 'unavailable',
    complete: false,
    cleanupUnknown: false,
    freshAttemptBlocked: true,
  });
  expect(terminal('refused', 'checkpoint-missing', 0, 0)).toMatchObject({
    status: 'refused',
    complete: false,
    freshAttemptBlocked: true,
  });
});
it('preserves an adverse post-fault baseline without admitting it as a positive phase', () => {
  const s = sample();
  s.seal.observations[2]!.quarantined = false;
  s.seal.observations[2]!.historiesValid = false;
  expect(preservationFindings(s.seal.observations, structuredClone(s.seal.observations))).toEqual(
    [],
  );
  expect(() => admitSeal(JSON.stringify(s.seal), s.bindings, s.now)).toThrow();
  expect(() => compareObservations(s.seal.observations, s.seal.observations)).toThrow();
});
it('detects repair or removal of a deliberate fault during observation', () => {
  const s = sample();
  const before = structuredClone(s.seal.observations);
  before[2]!.quarantined = false;
  expect(preservationFindings(before, s.seal.observations)).toEqual(['1/app:quarantined']);
});
