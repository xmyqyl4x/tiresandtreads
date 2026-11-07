import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { initialize, compose } from '../../../scripts/dev/local.mjs';
import { environmentPlan } from '../../../scripts/dev/plan.mjs';
import { assertDisposableRemoved } from '../../../scripts/verify/disposable-cleanup.mjs';

if (process.argv.length !== 2)
  throw new Error('Local analysis execution proof accepts no arguments');
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
    'tests/database/phase2-report-analysis.test.ts',
    'tests/database/phase2-analysis-execution.test.ts',
    'tests/database/phase2-generic-analysis.test.ts',
    'tests/unit/analysis-reuse-policy.test.ts',
    'tests/unit/generic-analysis-provider.test.ts',
    'tests/unit/grounded-analysis.test.ts',
    'tests/unit/analysis-provider.test.ts',
    'tests/usecases/report-analysis.test.ts',
  ]);
} finally {
  try {
    compose(plan, ['down', '--volumes', '--remove-orphans']);
    assertDisposableRemoved(plan);
  } finally {
    unlinkSync(plan.envFile);
  }
}
