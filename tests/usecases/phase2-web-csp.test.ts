import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
it('parses reseller contracts without probing eval in an isolated strict-CSP browser realm', () => {
  const child = spawnSync(process.execPath, ['tests/fixtures/phase2/browser-csp.ts'], {
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
