import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
it('binds the built private editorial UI/API to signed sessions, current application roles and native CMS mappings', () => {
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'tests/fixtures/editorial/clerk-proof.ts'],
    { env: process.env, encoding: 'utf8', timeout: 240000, maxBuffer: 1048576 },
  );
  expect(
    child.status,
    child.stdout +
      '\n' +
      child.stderr +
      '\n' +
      JSON.stringify({ error: child.error?.message, signal: child.signal }),
  ).toBe(0);
  expect(child.stdout).toContain('EDITORIAL_VERIFIED_SESSION_EVIDENCE');
  console.log(child.stdout.trim());
}, 250000);
