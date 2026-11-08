import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { initialize, compose } from '../../../scripts/dev/local.mjs';
import { environmentPlan } from '../../../scripts/dev/plan.mjs';
import { assertDisposableRemoved } from '../../../scripts/verify/disposable-cleanup.mjs';
if (process.argv.length !== 2) throw Error('Disposable Phase2 security gate accepts no arguments');
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
    'tests/database/phase2-security-gate.test.ts',
    'tests/database/phase2-owner-web.test.ts',
    'tests/database/phase2-photo-web.test.ts',
    'tests/database/phase2-operations-web.test.ts',
    'tests/database/phase2-staff-web.test.ts',
    'tests/database/phase2-partner-web.test.ts',
    'tests/database/phase2-partner-http.test.ts',
    'tests/database/phase2-analysis-lifecycle.test.ts',
    'tests/database/phase2-analysis-delivery.test.ts',
    'tests/database/phase2-photo-services.test.ts',
    'tests/database/phase2-staff-csv-services.test.ts',
    'tests/database/web-shell.test.ts',
    'tests/database/web-assessment.test.ts',
    'tests/unit/phase2-evaluation.test.ts',
    'tests/unit/phase2-operations-reconciliation.test.ts',
    'tests/unit/photo-codec.test.ts',
    'tests/unit/security-renderer.test.ts',
    'tests/usecases/analysis-delivery-renderer.test.ts',
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
