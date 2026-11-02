import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const command = (args: string[]) =>
  spawnSync(process.execPath, ['scripts/review/evidence-readiness.mjs', ...args], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 65536,
  });
const paths = [
  's3-service-register.json',
  'p1-pr-027-staging-decision.json',
  'p1-pr-027-evidence-review-baseline.json',
  'p1-pr-027-io-inspection-local.json',
];
const hashes = () =>
  paths.map((name) =>
    createHash('sha256')
      .update(readFileSync('docs/implementation/evidence/P1/' + name))
      .digest('hex'),
  );
it('reconciles pinned bytes and missing inputs without laundering historical uncertainty into acceptance', () => {
  const before = hashes(),
    first = command([]),
    second = command([]);
  expect(first.error).toBeUndefined();
  expect(first.status, first.stderr).toBe(0);
  expect(second.status, second.stderr).toBe(0);
  expect(first.stdout).toBe(second.stdout);
  const report = JSON.parse(first.stdout);
  expect(report).toMatchObject({
    status: 'consistent-local-evidence',
    pinScope: { sources: 180, historical: 160, inputs: 4, sp08: 23, localReferences: 264 },
    priorExceptions: 5,
    localToolExceptions: 2,
    historicalUnknownAdmissionReceipts: 2,
    historicalExecutionOnly: true,
    fixtureExecutions: 0,
    accepted: false,
    endpointImplementationAllowed: false,
    publicActivation: false,
    casesClosed: 0,
    gatesClosed: 0,
  });
  expect(report.fileReview.issues).toEqual([]);
  expect(report.fileReview.filesChecked).toBeGreaterThan(400);
  expect(report.acceptanceInputReview.missingInputs).toHaveLength(51);
  expect(first.stderr).toBe('');
  expect(hashes()).toEqual(before);
}, 20000);
it('returns a strict pending status after successful local reconciliation, never readiness', () => {
  const result = command(['--require-inputs']);
  expect(result.status, result.stderr).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({
    status: 'consistent-local-evidence',
    accepted: false,
  });
  expect(result.stderr).toBe('');
}, 15000);
it('refuses effects, arbitrary roots and output destinations without exposing supplied values', () => {
  const before = hashes();
  for (const arg of [
    '--accept',
    '--root=SYNTHETIC_SECRET',
    '--output=SYNTHETIC_SECRET',
    'https://SYNTHETIC_SECRET',
  ]) {
    const result = command([arg]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(
      'Evidence readiness review refused; inspect repository state locally.',
    );
    expect(result.stderr).not.toContain('SYNTHETIC_SECRET');
  }
  expect(hashes()).toEqual(before);
});
