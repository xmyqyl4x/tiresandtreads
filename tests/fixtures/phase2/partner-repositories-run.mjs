import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { initialize, compose } from '../../../scripts/dev/local.mjs';
import { environmentPlan } from '../../../scripts/dev/plan.mjs';
import { assertDisposableRemoved } from '../../../scripts/verify/disposable-cleanup.mjs';

if (process.argv.length !== 2) throw new Error('Partner repository proof accepts no arguments');
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
    'tests/database/phase2-partner-repositories.test.ts',
    'tests/unit/partner-mappers.test.ts',
    'tests/unit/partner-allocation-input.test.ts',
  ]);
} finally {
  try {
    compose(plan, ['down', '--volumes', '--remove-orphans']);
    assertDisposableRemoved(plan);
  } finally {
    unlinkSync(plan.envFile);
  }
}
