import { randomBytes } from 'node:crypto';
import { environmentPlan } from '../../../scripts/dev/plan.mjs';
import { initialize, compose } from '../../../scripts/dev/local.mjs';
import { assertDisposableRemoved } from '../../../scripts/verify/disposable-cleanup.mjs';
import { run } from '../../../scripts/lib/process.mjs';
import { unlinkSync } from 'node:fs';

if (process.argv.length !== 2)
  throw Error('Journal process proof accepts no arguments or retained targets');
const plan = environmentPlan('test', randomBytes(8).toString('hex'));
initialize(plan);
try {
  compose(plan, ['--profile', 'verify', 'build', 'test']);
  run('docker', [
    'run',
    '--rm',
    '--env',
    'ISOLATED_TEST_PROJECT=' + plan.project,
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '--tmpfs',
    '/workspace/node_modules/.vite-temp:rw,noexec,nosuid,size=32m',
    '--tmpfs',
    '/workspace/node_modules/.vite:rw,noexec,nosuid,size=16m',
    '--tmpfs',
    '/workspace/node_modules/.vitest:rw,noexec,nosuid,size=1m',
    '--tmpfs',
    '/workspace/node_modules/.vitest-cache:rw,noexec,nosuid,size=64m',
    '--memory',
    '1536m',
    '--cpus',
    '2',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    `tiresandtreads-tooling:${plan.project}`,
    'pnpm',
    'exec',
    'vitest',
    'run',
    '--project',
    'unit',
    '--project',
    'usecases',
    'tests/unit/journal-process.test.ts',
    'tests/usecases/journal-process.test.ts',
    '--reporter',
    'verbose',
  ]);
} finally {
  try {
    compose(plan, ['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
    assertDisposableRemoved(plan);
  } finally {
    unlinkSync(plan.envFile);
  }
}
