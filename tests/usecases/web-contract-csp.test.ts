import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
it('parses canonical browser consent contracts without even probing eval in a simulated strict-CSP realm', () => {
  const child = spawnSync(process.execPath, ['tests/fixtures/http/browser-contract-csp.ts'], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 16384,
  });
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout.trim())).toEqual({
    simulatedBrowserRealm: true,
    evalProbes: 0,
    actualBrowserCsp: false,
  });
}, 15000);
