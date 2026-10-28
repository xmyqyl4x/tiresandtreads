import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { initialize, compose } from '../dev/local.mjs';
import { environmentPlan } from '../dev/plan.mjs';
import { run } from '../lib/process.mjs';
import { assertDisposableRemoved } from './disposable-cleanup.mjs';
import { requireHeadroom } from '../capacity/headroom.ts';

export function verifyCapacity() {
  const plan = environmentPlan('test', randomBytes(8).toString('hex'));
  initialize(plan);
  const name = plan.project + '-capacity',
    started = Date.now();
  const call = (args, options) =>
    compose(plan, ['-f', 'infra/local/compose.capacity.yaml', ...args], {
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
    const id = (service) => call(['ps', '--all', '--quiet', service], { capture: true });
    const database = JSON.parse(
      run(
        'docker',
        [
          'exec',
          id('postgres'),
          'stat',
          '-f',
          '-c',
          '{"blocks":%b,"available":%a,"blockSize":%S,"inodes":%c,"freeInodes":%d}',
          '/var/lib/postgresql',
        ],
        { capture: true },
      ),
    );
    const object = JSON.parse(
      run(
        'docker',
        [
          'exec',
          id('moto'),
          'python',
          '-c',
          "import os,json;s=os.statvfs('/');print(json.dumps(dict(blocks=s.f_blocks,available=s.f_bavail,blockSize=s.f_frsize,freeInodes=s.f_favail)))",
        ],
        { capture: true },
      ),
    );
    for (const sample of [database, object])
      requireHeadroom({
        totalBytes: BigInt(sample.blocks) * BigInt(sample.blockSize),
        availableBytes: BigInt(sample.available) * BigInt(sample.blockSize),
        freeInodes: BigInt(sample.freeInodes),
      });
    call([
      'run',
      '--name',
      name,
      '--no-deps',
      'test',
      'pnpm',
      'exec',
      'vitest',
      'run',
      '--project',
      'capacity',
      '--reporter=default',
      '--reporter=json',
      '--outputFile.json=/capacity/results.json',
    ]);
    mkdirSync('.local/capacity-evidence', { recursive: true });
    const file = '.local/capacity-evidence/' + plan.project;
    for (const part of ['results', 'metrics'])
      run('docker', ['cp', `${name}:/capacity/${part}.json`, `${file}-${part}.json`]);
    const result = JSON.parse(readFileSync(file + '-results.json', 'utf8'));
    assert.equal(result.success, true);
    assert.equal(result.numTotalTests, 7);
    assert.equal(result.numPassedTests, 7);
    assert.equal(result.numFailedTests, 0);
    assert.equal(result.numPendingTests, 0);
    const providers = {};
    for (const service of ['postgres', 'moto', 'inngest']) {
      const container = id(service);
      assert.match(container, /^[a-f0-9]{12,64}$/);
      providers[service] = {
        processes: run('docker', ['top', container, '-eo', 'pid,ppid,comm'], { capture: true }),
        sample: JSON.parse(
          run('docker', ['stats', '--no-stream', '--format', '{{json .}}', container], {
            capture: true,
          }),
        ),
      };
    }
    const evidence = {
      ...JSON.parse(readFileSync(file + '-metrics.json', 'utf8')),
      elapsedMs: Date.now() - started,
      disks: { database, object },
      providers,
    };
    assert.equal(evidence.project, plan.project);
    assert.equal(evidence.hostedAccepted, false);
    assert.equal(evidence.productActivation, false);
    console.log('Local capacity preflight evidence: ' + JSON.stringify(evidence));
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
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/verify/capacity-preflight.mjs')) {
  if (process.argv.length !== 2) throw Error('Local capacity preflight takes no arguments');
  verifyCapacity();
}
