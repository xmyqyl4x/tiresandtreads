import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
it('P1-PR-038 renders all synthetic glossary/guides through Next, Payload and PostgreSQL with no-script tools, safe redirects and withdrawal', () => {
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'tests/fixtures/editorial/web-proof.ts'],
    { env: process.env, encoding: 'utf8', timeout: 180000, maxBuffer: 1048576 },
  );
  expect(
    child.status,
    child.stdout +
      '\n' +
      child.stderr +
      '\n' +
      JSON.stringify({ error: child.error?.message, signal: child.signal }),
  ).toBe(0);
  expect(child.stdout).toContain('EDITORIAL_WEB_EVIDENCE');
  console.log(child.stdout.trim());
}, 190000);
