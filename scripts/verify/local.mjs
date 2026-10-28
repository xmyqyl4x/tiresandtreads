import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { initialize, compose } from '../dev/local.mjs';
import { environmentPlan } from '../dev/plan.mjs';
import { run } from '../lib/process.mjs';
import { verifyLifecycle } from './lifecycle.mjs';
import { verifyRecovery } from './recovery.mjs';
import { verifyProviderRecovery } from './provider.mjs';
import { verifyDeployment } from './deployment-preflight.mjs';

// This function creates and deletes only its own randomly named test environment.
export function verifyLocal() {
  const plan = environmentPlan('test', randomBytes(8).toString('hex'));
  initialize(plan);
  try {
    compose(plan, ['--profile', 'verify', 'build']);
    // Advisory lookup gets network access; application/test fixtures stay on an internal network.
    run('docker', [
      'run',
      '--rm',
      `tiresandtreads-tooling:${plan.project}`,
      'pnpm',
      'audit',
      '--audit-level',
      'high',
    ]);
    compose(plan, [
      '--profile',
      'verify',
      'up',
      '--detach',
      '--wait',
      '--wait-timeout',
      '120',
      'postgres',
      'app',
      'moto',
      'inngest',
    ]);
    compose(plan, ['run', '--rm', '--no-deps', 'test', 'pnpm', 'quality']);
    compose(plan, ['run', '--rm', '--no-deps', '--use-aliases', 'test', 'pnpm', 'test:coverage']);
    compose(plan, ['run', '--rm', '--no-deps', 'test', 'pnpm', 'test:gates']);
    compose(plan, ['run', '--rm', '--no-deps', 'test', 'pnpm', 'test:foundation']);
    compose(plan, ['run', '--rm', '--no-deps', 'test', 'pnpm', 'test:schema']);
    compose(plan, ['run', '--rm', '--no-deps', 'test', 'pnpm', 'test:http']);
    const lifecycle = verifyLifecycle(plan);
    compose(plan, ['up', '--detach', '--wait', '--wait-timeout', '120', 'app']);
    compose(plan, ['run', '--rm', '--no-deps', 'test', 'pnpm', 'test:http']);
    return {
      project: plan.project,
      lifecycle,
      appImageId: compose(plan, ['images', '--quiet', 'app'], { capture: true }),
      recovery: verifyRecovery(),
      custodyRecovery: verifyRecovery({ custody: true }),
      deploymentPreflight: verifyDeployment(),
      providerRecovery: verifyProviderRecovery(),
    };
  } finally {
    compose(plan, ['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
    unlinkSync(plan.envFile);
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/verify/local.mjs')) {
  try {
    console.log(JSON.stringify(verifyLocal(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
