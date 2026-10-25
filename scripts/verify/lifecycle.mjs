import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { compose } from '../dev/local.mjs';
import { run } from '../lib/process.mjs';

export function verifyLifecycle(plan) {
  assert.match(plan.project, /^tt-test-[a-f0-9]{8,32}$/);
  const appId = compose(plan, ['ps', '--quiet', 'app'], { capture: true });
  const postgresId = compose(plan, ['ps', '--quiet', 'postgres'], { capture: true });
  assert.match(appId, /^[a-f0-9]{12,64}$/);
  assert.match(postgresId, /^[a-f0-9]{12,64}$/);
  const resources = JSON.parse(
    run('docker', ['stats', '--no-stream', '--format', '{{json .}}', appId], { capture: true }),
  );
  const databaseResources = JSON.parse(
    run('docker', ['stats', '--no-stream', '--format', '{{json .}}', postgresId], {
      capture: true,
    }),
  );
  const started = performance.now();
  compose(plan, ['stop', '--timeout', '10', 'app']);
  const stopMs = Math.round(performance.now() - started);
  const state = JSON.parse(
    run('docker', ['inspect', '--format', '{{json .State}}', appId], { capture: true }),
  );
  assert.equal(state.Running, false);
  assert.equal(state.OOMKilled, false);
  assert.equal(state.ExitCode, 143, 'Next must handle SIGTERM without forced SIGKILL');
  assert(stopMs < 10000, 'App must terminate within its 10-second proof budget');
  const refusalId = run(
    'docker',
    [
      'create',
      '--name',
      `${plan.project}-config-refusal`,
      '--network',
      'none',
      '--memory',
      '768m',
      '--cpus',
      '2',
      '--read-only',
      '-e',
      'APP_ENV=production',
      '-e',
      'PROVIDER_MODE=fixtures',
      `tiresandtreads-local:${plan.project}`,
    ],
    { capture: true },
  );
  assert.match(refusalId, /^[a-f0-9]{12,64}$/);
  try {
    const rejected = spawnSync('docker', ['start', '--attach', refusalId], {
      encoding: 'utf8',
      timeout: 15000,
    });
    assert(
      !rejected.error && rejected.status !== null && rejected.status !== 0,
      'Hosted fixture configuration must fail startup',
    );
    assert.match(rejected.stdout + rejected.stderr, /Invalid bootstrap runtime configuration/);
  } finally {
    // Remove exactly the container created above, including a failed startup timeout.
    run('docker', ['rm', '--force', refusalId], { capture: true });
  }
  // The runner has no workspace node_modules. Validate the actual bundled worker entry point.
  const workerId = run(
    'docker',
    [
      'create',
      '--name',
      `${plan.project}-worker-config-refusal`,
      '--network',
      'none',
      '--memory',
      '768m',
      '--cpus',
      '2',
      '--read-only',
      '-e',
      'APP_ENV=production',
      '-e',
      'PROVIDER_MODE=fixtures',
      `tiresandtreads-local:${plan.project}`,
      'node',
      'worker.mjs',
    ],
    { capture: true },
  );
  assert.match(workerId, /^[a-f0-9]{12,64}$/);
  try {
    const rejected = spawnSync('docker', ['start', '--attach', workerId], {
      encoding: 'utf8',
      timeout: 15000,
    });
    assert(!rejected.error && rejected.status !== null && rejected.status !== 0);
    assert.equal(
      (rejected.stdout + rejected.stderr).trim(),
      'Worker unavailable',
      'Bundled worker imports must load without workspace dependencies and reject unsafe configuration safely',
    );
  } finally {
    run('docker', ['rm', '--force', workerId], { capture: true });
  }
  const evidence = {
    stopMs,
    exitCode: state.ExitCode,
    appMemory: resources.MemUsage,
    appCpu: resources.CPUPerc,
    postgresMemory: databaseResources.MemUsage,
    postgresCpu: databaseResources.CPUPerc,
    invalidHostedConfig: 'rejected',
    workerBundleStartup: 'validated in production image without workspace dependencies',
    scope: 'idle headless host; DB pool drain measured separately',
  };
  console.log('Container lifecycle measurements:', JSON.stringify(evidence));
  return evidence;
}
