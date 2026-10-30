import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { environmentPlan } from '../../../scripts/dev/plan.mjs';
import { initialize, compose } from '../../../scripts/dev/local.mjs';
import { assertDisposableRemoved } from '../../../scripts/verify/disposable-cleanup.mjs';

if (process.argv.length !== 2)
  throw Error('Read-only coordination proof accepts no arguments or retained targets');
const plan = environmentPlan('test', randomBytes(8).toString('hex'));
initialize(plan);
try {
  compose(plan, ['--profile', 'verify', 'build', 'test']);
  compose(plan, ['up', '--detach', '--wait', '--wait-timeout', '120', 'postgres']);
  compose(plan, [
    'run',
    '--rm',
    '--no-deps',
    '--use-aliases',
    'test',
    'pnpm',
    'exec',
    'vitest',
    'run',
    '--project',
    'unit',
    '--project',
    'database',
    'tests/unit/readonly-coordination.test.ts',
    'tests/database/readonly-coordination.test.ts',
    '--reporter',
    'verbose',
  ]);
} finally {
  try {
    compose(plan, ['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
    assertDisposableRemoved(plan);
  } finally {
    unlinkSync(plan.envFile);
  }
}
