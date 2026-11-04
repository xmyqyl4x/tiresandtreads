import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
it('P1-PR-038 proves native Payload history, role refusals, atomic revisions, public publication and rollback using disposable PostgreSQL', () => {
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'tests/fixtures/editorial/proof.ts'],
    { env: process.env, encoding: 'utf8', timeout: 90000, maxBuffer: 1048576 },
  );
  expect(
    child.status,
    child.stdout +
      '\n' +
      child.stderr +
      '\n' +
      JSON.stringify({ error: child.error?.message, signal: child.signal }),
  ).toBe(0);
  expect(child.stdout).toContain('EDITORIAL_NATIVE_EVIDENCE');
  console.log(child.stdout.trim());
}, 100000);
