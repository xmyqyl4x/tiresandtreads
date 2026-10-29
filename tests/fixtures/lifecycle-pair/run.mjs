import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { environmentPlan } from '../../../scripts/dev/plan.mjs';
import { initialize, compose } from '../../../scripts/dev/local.mjs';
import { assertDisposableRemoved } from '../../../scripts/verify/disposable-cleanup.mjs';

if (process.argv.length !== 2)
  throw Error('Paired lifecycle proof accepts no arguments or retained targets');
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
    'usecases',
    '--project',
    'database',
    'tests/unit/lifecycle-pair.test.ts',
    'tests/usecases/lifecycle-pair.test.ts',
    'tests/database/lifecycle-pair.test.ts',
    '--reporter',
    'verbose',
  ]);
  console.log(
    'PAIRED_LIFECYCLE_EVIDENCE ' +
      JSON.stringify({
        scope: 'disposable-local-pair',
        profiles: 3,
        oneSidedMigrationCommits: ['app', 'cms'],
        readOnly: true,
        cooperativeLock: true,
        freshHandoffReads: true,
        singleUseReceipts: true,
        runtimeAdmission: false,
        hostedAccepted: false,
        productActivation: false,
        productionPolicyChanged: false,
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
