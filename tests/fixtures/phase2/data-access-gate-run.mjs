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
  compose(plan, ['run', '--rm', '--no-deps', 'test', 'node', 'scripts/review/p2-data-access.mjs']);
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
    'tests/database/phase2-partner-repositories.test.ts',
    'tests/database/phase2-analysis-repositories.test.ts',
    'tests/database/phase2-data-access-gate.test.ts',
    'tests/unit/partner-mappers.test.ts',
    'tests/unit/partner-allocation-input.test.ts',
    'tests/unit/p2-data-access-audit.test.ts',
    'tests/unit/analysis-mappers.test.ts',
    'tests/unit/analysis-input.test.ts',
  ]);
} finally {
  try {
    compose(plan, ['down', '--volumes', '--remove-orphans']);
    assertDisposableRemoved(plan);
  } finally {
    unlinkSync(plan.envFile);
  }
}
