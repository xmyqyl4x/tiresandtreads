import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { initialize, compose } from '../dev/local.mjs';
import { environmentPlan } from '../dev/plan.mjs';
import { run } from '../lib/process.mjs';
import { assertDisposableRemoved } from './disposable-cleanup.mjs';

export function verifyObservation() {
  const plan = environmentPlan('test', randomBytes(8).toString('hex'));
  initialize(plan);
  const name = plan.project + '-observation',
    started = Date.now();
  const call = (args, options) =>
    compose(plan, ['-f', 'infra/local/compose.observation.yaml', ...args], {
      timeout: 600000,
      ...options,
    });
  try {
    call(['--profile', 'verify', 'build', 'test']);
    call([
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
    call([
      'run',
      '--name',
      name,
      '--no-deps',
      '--use-aliases',
      'test',
      'pnpm',
      'exec',
      'vitest',
      'run',
      '--project',
      'observation',
      '--reporter=default',
      '--reporter=json',
      '--outputFile.json=/observation/results.json',
    ]);
    mkdirSync('.local/observation-evidence', { recursive: true });
    const file = '.local/observation-evidence/' + plan.project;
    for (const part of ['results', 'metrics'])
      run('docker', ['cp', `${name}:/observation/${part}.json`, `${file}-${part}.json`]);
    const result = JSON.parse(readFileSync(file + '-results.json', 'utf8'));
    assert.equal(result.success, true);
    assert.equal(result.numTotalTests, 8);
    assert.equal(result.numPassedTests, 8);
    assert.equal(result.numFailedTests, 0);
    assert.equal(result.numPendingTests, 0);
    const evidence = {
      ...JSON.parse(readFileSync(file + '-metrics.json', 'utf8')),
      elapsedMs: Date.now() - started,
    };
    assert.equal(evidence.project, plan.project);
    assert.equal(evidence.hostedAccepted, false);
    assert.equal(evidence.productActivation, false);
    assert.equal(evidence.actualRecipientNotifications, 0);
    assert.equal(evidence.schedule.actualCompletedCron, true);
    assert.equal(evidence.schedule.admissionPolicyEnabled, false);
    assert.equal(evidence.interruptedIntent.automaticFourthSendRefused, true);
    console.log('Local observation preflight evidence: ' + JSON.stringify(evidence));
    return evidence;
  } finally {
    try {
      // Only this generated, labeled one-off test container can be explicitly removed.
      const found = run(
        'docker',
        [
          'ps',
          '--all',
          '--quiet',
          '--filter',
          `name=^/${name}$`,
          '--filter',
          `label=com.docker.compose.project=${plan.project}`,
        ],
        { capture: true },
      );
      if (found) {
        assert.match(found, /^[a-f0-9]{12,64}$/);
        run('docker', ['rm', '--force', found]);
      }
      call(['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
      assertDisposableRemoved(plan);
    } finally {
      unlinkSync(plan.envFile);
    }
  }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/verify/observation-preflight.mjs')) {
  if (process.argv.length !== 2) throw Error('Local observation preflight takes no arguments');
  verifyObservation();
}
