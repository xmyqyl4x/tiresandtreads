import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const command = (args: string[]) =>
  spawnSync(process.execPath, ['scripts/review/restore-readiness.mjs', ...args], {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 131072,
  });
const paths = [
  's3-service-register.json',
  'p1-pr-027-staging-decision.json',
  'p1-pr-027-restore-handoff-local.json',
  'p1-pr-027-io-inspection-local.json',
  'p1-pr-027-restore-readiness-baseline.json',
];
const hashes = () =>
  paths.map((name) =>
    createHash('sha256')
      .update(readFileSync('docs/implementation/evidence/P1/' + name))
      .digest('hex'),
  );
it('integrates recorded restore evidence with missing inputs while preserving historical uncertainty and all holds', () => {
  const before = hashes(),
    first = command([]),
    second = command([]);
  expect(first.error).toBeUndefined();
  expect(first.status, first.stderr).toBe(0);
  expect(second.status).toBe(0);
  expect(first.stdout).toBe(second.stdout);
  const report = JSON.parse(first.stdout);
  expect(report).toMatchObject({
    status: 'consistent-restore-evidence',
    historicalUnknownAdmissionReceipts: 2,
    fixtureExecutions: 0,
    gitHistoryVerifiedNow: false,
    ciReexecutedNow: false,
    accepted: false,
    endpointImplementationAllowed: false,
    publicActivation: false,
    casesClosed: 0,
    gatesClosed: 0,
  });
  expect(report.recordedHandoff).toMatchObject({
    nativeProfiles: 16,
    artifactRefusals: 3,
    actualRestoreReplayProfiles: 13,
    repeatedExistingCustodyExecutions: 26,
    newUniqueCustodyTests: 0,
    focusedControls: 45,
    modeledOnly: ['RH17'],
  });
  expect(report.fileReview.issues).toEqual([]);
  expect(report.fileReview.filesChecked).toBeGreaterThan(427);
  expect(report.acceptanceInputReview.missingInputs).toHaveLength(51);
  expect(first.stderr).toBe('');
  expect(hashes()).toEqual(before);
}, 30000);
it('returns strict pending exit 2 after consistent local checks without accepting the project', () => {
  const result = command(['--require-inputs']);
  expect(result.status, result.stderr).toBe(2);
  expect(JSON.parse(result.stdout).accepted).toBe(false);
  expect(result.stderr).toBe('');
}, 20000);
it('refuses arbitrary roots, output paths, fixture execution and acceptance arguments with masked diagnostics', () => {
  const before = hashes();
  for (const arg of [
    '--root=SYNTHETIC_SECRET',
    '--output=SYNTHETIC_SECRET',
    '--run-fixtures',
    '--accept',
  ]) {
    const result = command([arg]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(
      'Restore readiness refused; inspect repository state locally.',
    );
    expect(result.stderr).not.toContain('SYNTHETIC_SECRET');
  }
  expect(hashes()).toEqual(before);
});
