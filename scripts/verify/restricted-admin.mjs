import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { environmentPlan } from '../dev/plan.mjs';
import { initialize, compose } from '../dev/local.mjs';
import { assertDisposableRemoved } from './disposable-cleanup.mjs';

// No target, connection string, retained secret or provider account input is accepted.
if (process.argv.length !== 2)
  throw Error('Restricted-admin investigation accepts no arguments or retained target');
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
    'database',
    'tests/database/restricted-admin.test.ts',
    '--reporter',
    'verbose',
  ]);
  console.log('Restricted-admin local investigation passed; no hosted acceptance or authority');
} finally {
  compose(plan, ['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
  assertDisposableRemoved(plan);
  unlinkSync(plan.envFile);
}
