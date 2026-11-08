import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { initialize, compose } from '../../../scripts/dev/local.mjs';
import { environmentPlan } from '../../../scripts/dev/plan.mjs';
import { assertDisposableRemoved } from '../../../scripts/verify/disposable-cleanup.mjs';

if (process.argv.length !== 2)
  throw new Error('Local Phase2 service gate proof accepts no arguments');
const plan = environmentPlan('test', randomBytes(8).toString('hex'));
initialize(plan);
try {
  compose(plan, ['--profile', 'verify', 'build', 'test']);
  compose(plan, ['up', '--detach', '--wait', '--wait-timeout', '120', 'postgres', 'moto']);
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
    'tests/database/phase2-partner-http.test.ts',
    'tests/database/phase2-partner-insights.test.ts',
    'tests/database/phase2-analysis-http.test.ts',
    'tests/unit/phase2-api-client.test.ts',
    'tests/unit/phase2-response-contracts.test.ts',
    'tests/unit/phase2-dispute-authorization.test.ts',
    'tests/unit/phase2-analysis-http.test.ts',
    'tests/unit/phase2-contract-pins.test.ts',
    'tests/unit/photo-dependency-pins.test.ts',
    'tests/unit/product-source-pins.test.ts',
    'tests/usecases/evidence-readiness.test.ts',
    'tests/usecases/restore-readiness.test.ts',
  ]);
} finally {
  try {
    compose(plan, ['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
    assertDisposableRemoved(plan);
  } finally {
    unlinkSync(plan.envFile);
  }
}
