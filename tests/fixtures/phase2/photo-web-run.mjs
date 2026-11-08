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
    'tests/database/phase2-owner-web.test.ts',
    'tests/database/phase2-photo-web.test.ts',
    'tests/database/web-shell.test.ts',
    'tests/database/web-assessment.test.ts',
    'tests/unit/phase2-photo-forms.test.ts',
    'tests/unit/phase2-owner-assessment.test.ts',
    'tests/unit/phase2-photo-presentation.test.ts',
    'tests/unit/phase2-photo-recovery.test.ts',
    'tests/unit/phase2-photo-proxy.test.ts',
    'tests/database/phase2-partner-http.test.ts',
    'tests/unit/phase2-assisted-forms.test.ts',
    'tests/unit/phase2-analysis-presentation.test.ts',
    'tests/unit/phase2-owner-proxy.test.ts',
    'tests/unit/phase2-api-client.test.ts',
    'tests/unit/phase2-portal-render.test.ts',
    'tests/usecases/phase2-web-csp.test.ts',
    'tests/usecases/analysis-delivery-renderer.test.ts',
  ]);
} finally {
  try {
    compose(plan, ['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
    assertDisposableRemoved(plan);
  } finally {
    unlinkSync(plan.envFile);
  }
}
