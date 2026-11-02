import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = [
  's3-service-register.json',
  'p1-pr-027-staging-decision.json',
  'p1-pr-027-staging-operations-budget.json',
  'p1-pr-017-golden-review.json',
].map((name) => 'docs/implementation/evidence/P1/' + name);
const hashes = () =>
  files.map((file) => createHash('sha256').update(readFileSync(file)).digest('hex'));
const command = (args: string[]) =>
  spawnSync(process.execPath, ['scripts/review/acceptance-inputs.mjs', ...args], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 65536,
  });
it('produces a deterministic masked review without changing any acceptance input', () => {
  const before = hashes();
  const first = command([]),
    second = command([]);
  expect(first.error).toBeUndefined();
  expect(first.status, first.stderr).toBe(0);
  expect(second.status, second.stderr).toBe(0);
  expect(first.stdout).toBe(second.stdout);
  const report = JSON.parse(first.stdout);
  expect(report.status).toBe('pending-external-inputs');
  expect(report.gates).toHaveLength(6);
  expect(report.accepted).toBe(false);
  expect(first.stderr).toBe('');
  expect(hashes()).toEqual(before);
});
it('returns a distinct incomplete status for a strict input check without granting acceptance', () => {
  const result = command(['--require-inputs']);
  expect(result.status).toBe(2);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toMatchObject({ accepted: false, gatesClosed: 0 });
});
it('refuses effects, arbitrary targets and output destinations without exposing arguments', () => {
  const before = hashes();
  for (const arg of [
    '--accept',
    '--output=SYNTHETIC_SECRET',
    'https://SYNTHETIC_SECRET',
    '../SYNTHETIC_SECRET',
  ]) {
    const result = command([arg]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(
      'Acceptance input review refused; inspect repository state locally.',
    );
    expect(result.stderr).not.toContain('SYNTHETIC_SECRET');
  }
  expect(hashes()).toEqual(before);
});
