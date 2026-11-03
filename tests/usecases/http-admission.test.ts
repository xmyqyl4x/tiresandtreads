import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
it('refuses request 33 with the private contract, drains admitted requests and supports repeated shutdown', () => {
  // Separate process avoids the parent suite's mock-network interceptors; listener is hard-bound to127.0.0.1.
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'tests/fixtures/http/admission.ts'],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 16384 },
  );
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout.trim())).toEqual({
    admitted: 32,
    refused: 1,
    drained: 32,
    loopbackOnly: true,
  });
}, 20000);
