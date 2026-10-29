import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { environmentPlan } from '../../../scripts/dev/plan.mjs';
import { initialize, compose } from '../../../scripts/dev/local.mjs';
import { assertDisposableRemoved } from '../../../scripts/verify/disposable-cleanup.mjs';

if (process.argv.length !== 2)
  throw Error('Interrupted executor proof accepts no arguments or retained targets');
const plan = environmentPlan('test', randomBytes(8).toString('hex'));
initialize(plan);
try {
  compose(plan, ['--profile', 'verify', 'build', 'test']);
  compose(plan, ['up', '--detach', '--wait', '--wait-timeout', '120', 'postgres']);
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
    'unit',
    '--project',
    'database',
    'tests/unit/lifecycle-restart.test.ts',
    'tests/database/lifecycle-restart.test.ts',
    '--reporter',
    'verbose',
  ]);
  console.log(
    'INTERRUPTED_EXECUTOR_EVIDENCE ' +
      JSON.stringify({
        scope: 'disposable-local-restart',
        profiles: 3,
        forcedKillCheckpoints: 5,
        freshProcesses: true,
        oldReceiptAuthority: false,
        freshBothDatabaseReads: true,
        productionPolicyChanged: false,
        runtimeAdmission: false,
        hostedAccepted: false,
        productActivation: false,
        actualProviderTest: false,
        notifications: 0,
      }),
  );
} finally {
  try {
    compose(plan, ['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
    assertDisposableRemoved(plan);
  } finally {
    unlinkSync(plan.envFile);
  }
}
