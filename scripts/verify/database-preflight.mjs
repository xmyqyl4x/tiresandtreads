import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { environmentPlan } from '../dev/plan.mjs';
import { initialize, compose } from '../dev/local.mjs';

// Explicit local diagnostic. Never accepts a retained target, credentials or cloud endpoint.
const plan = environmentPlan('test', randomBytes(8).toString('hex'));
initialize(plan);
try {
  compose(plan, ['--profile', 'verify', 'build', 'test']);
  compose(plan, ['up', '--detach', '--wait', '--wait-timeout', '120', 'postgres']);
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
    'tests/unit/database-preflight.test.ts',
    'tests/database/database-preflight.test.ts',
    '--reporter',
    'verbose',
  ]);
  console.log(
    'Local database preflight scenarios passed; no hosted acceptance or authority granted',
  );
} finally {
  compose(plan, ['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
  unlinkSync(plan.envFile);
}
