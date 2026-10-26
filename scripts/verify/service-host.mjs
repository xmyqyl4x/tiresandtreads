import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { initialize, compose } from '../dev/local.mjs';
import { environmentPlan } from '../dev/plan.mjs';

const plan = environmentPlan('test', randomBytes(8).toString('hex'));
initialize(plan);
try {
  compose(plan, ['--profile', 'verify', 'build', 'test']);
  compose(plan, [
    '--profile',
    'verify',
    'up',
    '--detach',
    '--wait',
    '--wait-timeout',
    '120',
    'postgres',
    'moto',
    'inngest',
  ]);
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
    'database',
    'tests/database/service-host.test.ts',
  ]);
} finally {
  compose(plan, ['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
  unlinkSync(plan.envFile);
}
