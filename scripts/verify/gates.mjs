import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

const cli = process.env.npm_execpath;
assert(cli && /pnpm/i.test(cli), 'Run through pnpm test:gates');
const failingTest = spawnSync(
  process.execPath,
  [cli, 'exec', 'vitest', 'run', '--project', 'probe'],
  { encoding: 'utf8' },
);
assert.equal(failingTest.status, 1, 'The intentional test must exit with failure');
assert.match(failingTest.stdout + failingTest.stderr, /INTENTIONAL_GATE_PROBE/);
const probe = 'packages/domain/src/__boundary_probe.ts';
writeFileSync(probe, "import '../../config/src/runtime.ts';\n", { flag: 'wx' });
try {
  const failingBoundary = spawnSync(process.execPath, [cli, 'boundaries'], { encoding: 'utf8' });
  assert(
    failingBoundary.status !== null && failingBoundary.status > 0,
    'A domain-to-config import must fail',
  );
  assert.match(failingBoundary.stdout + failingBoundary.stderr, /pure-domain/);
} finally {
  unlinkSync(probe);
}
console.log(
  'Failure propagation proved: an intentional failing test and a forbidden layer import both block verification',
);

const clientProbe = 'apps/web/app/__client_probe.ts';
writeFileSync(clientProbe, "'use client';\nimport '@tt/config/runtime';\n", { flag: 'wx' });
try {
  const result = spawnSync(process.execPath, [cli, 'exec', 'eslint', clientProbe], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, 'A client import of server configuration must fail');
  assert.match(result.stdout + result.stderr, /architecture\/client-boundary/);
} finally {
  unlinkSync(clientProbe);
}
console.log('Client/server import rejection proved');

const bridgeProbe = 'apps/web/app/__server_probe.ts';
writeFileSync(bridgeProbe, "export { readRuntimeConfig } from '@tt/config/runtime';\n", {
  flag: 'wx',
});
writeFileSync(clientProbe, "'use client';\nimport './__server_probe';\n", { flag: 'wx' });
try {
  const result = spawnSync(process.execPath, [cli, 'boundaries'], { encoding: 'utf8' });
  assert.equal(result.status, 1, 'Indirect client imports must fail too');
  assert.match(result.stdout + result.stderr, /client-server-transitive/);
} finally {
  unlinkSync(clientProbe);
  unlinkSync(bridgeProbe);
}
console.log('Transitive client/server rejection proved');
