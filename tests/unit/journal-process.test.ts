import { expect, it } from 'vitest';
import {
  checkpointAt,
  exportedAt,
  points,
  readPlan,
  readEvent,
  flags,
} from '../fixtures/journal-process/contract.ts';
import { temporaryJournal, inspectJournal } from '../fixtures/journal-process/storage.ts';
import { writeFileSync, readFileSync, existsSync, symlinkSync, linkSync } from 'node:fs';
import { join } from 'node:path';

const env = {
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  ISOLATED_TEST_PROJECT: 'tt-test-0123456789abcdef',
  JOURNAL_PROOF_RUN: '1'.repeat(32),
};
const plan = () => ({
  version: 1,
  scope: 'disposable-journal-process',
  project: env.ISOLATED_TEST_PROJECT,
  runId: env.JOURNAL_PROOF_RUN,
  mode: 'write',
  point: 'intent-ack',
  checkpoint: checkpointAt(0),
  exportedReceipt: exportedAt(0),
});

it('admits only fixed synthetic plans and parent-checkpoint-bound receipt exports', () => {
  for (const point of points) expect(readPlan({ ...plan(), point }, env).point).toBe(point);
  expect(
    readPlan(
      {
        ...plan(),
        mode: 'read',
        point: 'none',
        checkpoint: checkpointAt(3),
        exportedReceipt: exportedAt(3),
      },
      env,
    ).checkpoint.count,
  ).toBe(3);
});

it.each([
  { project: 'tt-stage' },
  { runId: '2'.repeat(32) },
  { version: 2 },
  { scope: 'hosted' },
  { mode: 'execute' },
  { point: 'sql-commit' },
  { path: '/retained/journal' },
  { url: 'https://invalid.example' },
  { sql: 'SELECT private' },
  { checkpoint: null },
  { checkpoint: { count: 10, head: '0'.repeat(64) } },
  { checkpoint: { count: 3, head: '0'.repeat(64) } },
  { exportedReceipt: 'x'.repeat(17000) },
  { mode: 'read', point: 'intent-ack' },
  { checkpoint: checkpointAt(3), exportedReceipt: exportedAt(3) },
])('refuses malformed or expanded plan %# before spawn with a fixed diagnostic', (patch) => {
  expect(() => readPlan({ ...plan(), ...patch }, env)).toThrow(/^Journal process refused$/);
});

it.each([
  { APP_ENV: 'stage-local' },
  { PROVIDER_MODE: 'live' },
  { ISOLATED_TEST_PROJECT: 'tt-stage' },
])('refuses environment mismatch %#', (patch) => {
  expect(() => readPlan(plan(), { ...env, ...patch })).toThrow(/^Journal process refused$/);
});

it.each([
  { processId: 124 },
  { runId: '2'.repeat(32) },
  { runtimeAdmission: true },
  { authenticated: true },
  { independentDurability: true },
  { targetFencing: true },
  { providerDispatches: 1 },
  { sql: 'repair' },
])('refuses forged or expanded child event %#', (patch) => {
  const p = readPlan(plan(), env);
  expect(() =>
    readEvent(
      {
        scope: p.scope,
        processId: 123,
        runId: p.runId,
        kind: 'ack',
        point: 'intent-ack',
        checkpoint: checkpointAt(3),
        ...flags,
        ...patch,
      },
      p,
      123,
    ),
  ).toThrow(/^Journal process refused$/);
});

it('refuses a pause at another point and an acknowledgement with an impossible checkpoint', () => {
  const p = readPlan(plan(), env);
  for (const extra of [
    { kind: 'paused', point: 'partial-outcome', checkpoint: checkpointAt(4) },
    { kind: 'ack', point: 'intent-ack', checkpoint: checkpointAt(5) },
  ])
    expect(() =>
      readEvent({ scope: p.scope, processId: 123, runId: p.runId, ...flags, ...extra }, p, 123),
    ).toThrow();
});

it('admits a correctly bound child event before negative mutation checks', () => {
  const p = readPlan(plan(), env);
  expect(
    readEvent(
      {
        scope: p.scope,
        processId: 123,
        runId: p.runId,
        kind: 'ack',
        point: 'intent-ack',
        checkpoint: checkpointAt(3),
        ...flags,
      },
      p,
      123,
    ).kind,
  ).toBe('ack');
});

it('bounds temporary file reads and never repairs missing, oversized or partial bytes', () => {
  const f = temporaryJournal();
  try {
    expect(() => inspectJournal(f.root, f.runId, checkpointAt(3))).toThrow();
    expect(existsSync(join(f.root, 'journal.ndjson'))).toBe(false);
    for (const bytes of [Buffer.from('partial'), Buffer.alloc(65537, 120)]) {
      writeFileSync(join(f.root, 'journal.ndjson'), bytes);
      expect(() => inspectJournal(f.root, f.runId, checkpointAt(3))).toThrow();
      expect(readFileSync(join(f.root, 'journal.ndjson'))).toEqual(bytes);
    }
  } finally {
    f.cleanup();
  }
  expect(existsSync(f.root)).toBe(false);
});

it.each(['symlink', 'hardlink'] as const)(
  'refuses a %s journal without touching its owned sentinel',
  (kind) => {
    const f = temporaryJournal();
    try {
      const target = join(f.root, 'sentinel');
      writeFileSync(target, 'preserve');
      if (kind === 'symlink') symlinkSync(target, join(f.root, 'journal.ndjson'));
      else linkSync(target, join(f.root, 'journal.ndjson'));
      expect(() => inspectJournal(f.root, f.runId, checkpointAt(0))).toThrow();
      expect(readFileSync(target, 'utf8')).toBe('preserve');
    } finally {
      f.cleanup();
    }
  },
);

it('refuses changed ownership markers for reading and cleanup until the fixture marker is restored', () => {
  const f = temporaryJournal();
  try {
    writeFileSync(join(f.root, '.fixture-owner'), '2'.repeat(32));
    expect(() => inspectJournal(f.root, f.runId, checkpointAt(0))).toThrow();
    expect(() => f.cleanup()).toThrow();
    expect(existsSync(f.root)).toBe(true);
  } finally {
    writeFileSync(join(f.root, '.fixture-owner'), f.runId);
    f.cleanup();
  }
});
