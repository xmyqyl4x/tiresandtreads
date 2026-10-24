import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { initialize, compose } from '../dev/local.mjs';
import { environmentPlan } from '../dev/plan.mjs';

const plan = environmentPlan('test', randomBytes(8).toString('hex'));
initialize(plan);
try {
  compose(plan, ['--profile', 'verify', 'build', 'test']);
  compose(plan, ['up', '--detach', '--wait', '--wait-timeout', '120', 'postgres']);
  compose(plan, ['run', '--rm', '--no-deps', 'test', 'pnpm', 'test:schema']);
} finally {
  compose(plan, ['down', '--volumes', '--remove-orphans']);
  unlinkSync(plan.envFile);
}
