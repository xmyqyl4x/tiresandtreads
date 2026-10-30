import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { environmentPlan } from '../../../scripts/dev/plan.mjs';
import { initialize, compose } from '../../../scripts/dev/local.mjs';
import { assertDisposableRemoved } from '../../../scripts/verify/disposable-cleanup.mjs';

if (process.argv.length !== 2)
  throw Error('Catalog adverse proof accepts no arguments or retained targets');
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
    'tests/database/lifecycle-catalog.test.ts',
    '--reporter',
    'verbose',
  ]);
  console.log('Disposable catalog adverse controls passed; no case or gate accepted');
} finally {
  try {
    compose(plan, ['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
    assertDisposableRemoved(plan);
  } finally {
    unlinkSync(plan.envFile);
  }
}
