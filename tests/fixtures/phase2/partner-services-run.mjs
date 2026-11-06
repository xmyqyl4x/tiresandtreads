import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { initialize, compose } from '../../../scripts/dev/local.mjs';
import { environmentPlan } from '../../../scripts/dev/plan.mjs';
import { assertDisposableRemoved } from '../../../scripts/verify/disposable-cleanup.mjs';

if (process.argv.length !== 2) throw new Error('Data-access validation proof accepts no arguments');
const plan = environmentPlan('test', randomBytes(8).toString('hex'));
initialize(plan);
try {
  compose(plan, ['--profile', 'verify', 'build', 'test']);
  compose(plan, ['up', '--detach', '--wait', '--wait-timeout', '120', 'postgres']);
  compose(plan, ['run', '--rm', '--no-deps', 'test', 'pnpm', 'typecheck']);

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
    '--project',
    'unit',
    '--project',
    'usecases',
    'tests/database/phase2-partner-services.test.ts',
    'tests/unit/partner-policy.test.ts',
    'tests/unit/p2-data-access-audit.test.ts',
    'tests/unit/partner-code-adapters.test.ts',
    'tests/usecases/partner-services.test.ts',
  ]);
} finally {
  try {
    compose(plan, ['down', '--volumes', '--remove-orphans']);
    assertDisposableRemoved(plan);
  } finally {
    unlinkSync(plan.envFile);
  }
}
