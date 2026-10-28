import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { environmentPlan } from '../dev/plan.mjs';
import { initialize, compose } from '../dev/local.mjs';

// No target/credential arguments: only this randomly scoped internal fixture project.
if (process.argv.length !== 2) throw Error('Local provider preflight takes no arguments');
const plan = environmentPlan('test', randomBytes(8).toString('hex'));
initialize(plan);
try {
  compose(plan, ['--profile', 'verify', 'build', 'test']);
  compose(plan, [
    '--profile',
    'verify',
    'up',
    '--detach',
    '--wait',
    '--wait-timeout',
    '120',
    'moto',
    'inngest',
  ]);
  compose(plan, [
    'run',
    '--rm',
    '--no-deps',
    'test',
    'pnpm',
    'exec',
    'vitest',
    'run',
    '--project',
    'unit',
    '--project',
    'database',
    'tests/unit/provider-preflight.test.ts',
    'tests/unit/provider-preflight-transport.test.ts',
    'tests/database/provider-preflight.test.ts',
    '--reporter',
    'verbose',
  ]);
  console.log(
    'Local provider preflight passed; no hosted acceptance or external effects authorized',
  );
} finally {
  compose(plan, ['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
  unlinkSync(plan.envFile);
}
