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
    'tests/database/phase2-staff-web.test.ts',
    'tests/database/phase2-partner-http.test.ts',
    'tests/unit/phase2-staff-forms.test.ts',
    'tests/unit/phase2-review-services.test.ts',
    'tests/unit/phase2-staff-proxy.test.ts',
    'tests/usecases/phase2-web-csp.test.ts',
  ]);
} finally {
  try {
    compose(plan, ['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
    assertDisposableRemoved(plan);
  } finally {
    unlinkSync(plan.envFile);
  }
}
