import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { environmentPlan } from '../dev/plan.mjs';
import { initialize, compose } from '../dev/local.mjs';
import { run } from '../lib/process.mjs';
export function verifyDeployment() {
  const plan = environmentPlan('test', randomBytes(8).toString('hex'));
  initialize(plan);
  const started = Date.now(),
    root = resolve('.local'),
    context = resolve(root, plan.project + '-previous-source'),
    archive = context + '.tar';
  const previousRevision = JSON.parse(
    readFileSync('infra/local/deployment-baseline.json', 'utf8'),
  ).revision;
  assert.match(previousRevision, /^[a-f0-9]{40}$/);
  const candidateRevision = process.env.SOURCE_REVISION ?? 'working';
  assert.match(candidateRevision, /^(working|[a-f0-9]{40})$/);
  const old = {
    current: process.env.DEPLOYMENT_CURRENT_IMAGE,
    previous: process.env.DEPLOYMENT_PREVIOUS_IMAGE,
  };
  const call = (args, options) =>
    compose(plan, ['-f', 'infra/local/compose.deployment.yaml', ...args], {
      timeout: 600000,
      ...options,
    });
  const fixture = (file, ...args) =>
    call([
      'run',
      '--rm',
      '--no-deps',
      'test',
      'pnpm',
      'exec',
      'tsx',
      `tests/fixtures/deployment/${file}.ts`,
      ...args,
    ]);
  const tests = (phase) => {
    call([
      'run',
      '--rm',
      '--no-deps',
      'test',
      'pnpm',
      'exec',
      'vitest',
      'run',
      '--project',
      'deployment',
      '--testNamePattern',
      `^${phase}:`,
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=/deployment/results-${phase}.json`,
    ]);
    fixture('results', phase);
  };
  let contextCreated = false,
    overlay = false;
  try {
    assert.equal(dirname(context), root);
    assert.match(basename(context), /^tt-test-[a-f0-9]{16}-previous-source$/);
    assert(!existsSync(context) && !existsSync(archive));
    mkdirSync(context);
    contextCreated = true;
    // The only archive source is the owner-approved immutable repository baseline. No retained files.
    run('git', ['archive', '--format=tar', `--output=${archive}`, previousRevision]);
    const archiveSha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
    run('tar', ['-xf', archive, '-C', context]);
    compose(plan, ['--profile', 'verify', 'build', 'app', 'test'], { timeout: 600000 });
    const previousTag = `tiresandtreads-local:${plan.project}-previous`;
    run(
      'docker',
      [
        'build',
        '--target',
        'runner',
        '--build-arg',
        `SOURCE_REVISION=${previousRevision}`,
        '--tag',
        previousTag,
        context,
      ],
      { timeout: 600000 },
    );
    const inspect = (tag) =>
      JSON.parse(run('docker', ['image', 'inspect', tag], { capture: true }))[0];
    const image = (tag, revision) => {
      const i = inspect(tag);
      assert.equal(i.Config.Labels['org.opencontainers.image.revision'], revision);
      return { id: i.Id, revision, user: i.Config.User, command: i.Config.Cmd.join(' ') };
    };
    const current = image(`tiresandtreads-local:${plan.project}`, candidateRevision),
      previous = image(previousTag, previousRevision);
    process.env.DEPLOYMENT_CURRENT_IMAGE = current.id;
    process.env.DEPLOYMENT_PREVIOUS_IMAGE = previous.id;
    overlay = true;
    call(['up', '--detach', '--wait', '--wait-timeout', '120', 'postgres']);
    call(['run', '--rm', '--no-deps', 'deployment-tls']);
    fixture('prepare');
    mkdirSync('.local/deployment-evidence', { recursive: true });
    const manifest = {
      version: 1,
      project: plan.project,
      current,
      previous,
      origin: 'https://ingress.preflight.test:9443',
      access: 'fixture-mtls',
      callback: 'sdk-trust-probe-only',
      productRoutes: 'deny',
      migrationMode: 'expand-only',
      rollbackMode: 'image-only',
      hostedAccepted: false,
      productActivation: false,
    };
    const file = `.local/deployment-evidence/${plan.project}.json`;
    writeFileSync(file, JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
    call(['create', 'test']);
    call(['cp', file, 'test:/deployment/release.json']);
    call(['rm', '--force', 'test']);
    call([
      'up',
      '--detach',
      '--wait',
      '--wait-timeout',
      '120',
      'app',
      'previous',
      'ingress',
      'expired-ingress',
    ]);
    const container = (service) =>
      JSON.parse(
        run('docker', ['inspect', call(['ps', '--quiet', service], { capture: true })], {
          capture: true,
        }),
      )[0];
    for (const [name, expected] of [
      ['app', current],
      ['previous', previous],
    ]) {
      const c = container(name);
      assert.equal(c.Image, expected.id);
      assert.equal(c.Config.User, 'node');
      assert(
        !c.Config.Env.some((v) =>
          /^(DATABASE_URL|CMS_DATABASE_URL|TEST_DATABASE_URL|TEST_CMS_DATABASE_URL|TT_DB_ADMIN_URL)=/.test(
            v,
          ),
        ),
      );
      assert(c.HostConfig.ReadonlyRootfs && !c.HostConfig.Privileged);
      assert(c.HostConfig.CapDrop.includes('ALL'));
      assert(Object.values(c.NetworkSettings.Ports).every((v) => v === null));
    }
    assert(
      !container('ingress').Config.Env.some((v) =>
        /^(DATABASE_URL|CMS_DATABASE_URL|TEST_DATABASE_URL|TEST_CMS_DATABASE_URL|TT_DB_ADMIN_URL)=/.test(
          v,
        ),
      ),
    );
    tests('access');
    call(['stop', '--timeout', '10', 'postgres']);
    tests('database-outage');
    call(['up', '--detach', '--wait', '--wait-timeout', '120', 'postgres']);
    call(['stop', '--timeout', '10', 'app']);
    tests('candidate-loss');
    fixture('select', 'previous');
    tests('rollback');
    assert.equal(container('previous').Image, previous.id);
    const evidence = {
      project: plan.project,
      elapsedMs: Date.now() - started,
      previousRevision,
      candidateRevision,
      archiveSha256,
      currentImage: current.id,
      previousImage: previous.id,
      immutableImageRollback: true,
      fixtureTlsAccess: true,
      serializedExpansion: true,
      runtimeScopedReadiness: true,
      migrationDriftRefused: true,
      sameCaOperatorRefused: true,
      productActivation: false,
      hostedAccepted: false,
      registryProvenanceProved: false,
    };
    writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
    console.log('Local deployment preflight evidence: ' + JSON.stringify(evidence));
    return evidence;
  } finally {
    try {
      if (overlay) call(['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
      else compose(plan, ['--profile', 'verify', 'down', '--volumes', '--remove-orphans']);
    } finally {
      for (const [key, value] of [
        ['DEPLOYMENT_CURRENT_IMAGE', old.current],
        ['DEPLOYMENT_PREVIOUS_IMAGE', old.previous],
      ]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      // Validate the exact generated workspace child before any recursive removal on Windows/Linux.
      if (contextCreated) {
        assert.equal(dirname(context), resolve('.local'));
        assert.equal(basename(context), plan.project + '-previous-source');
        rmSync(context, { recursive: true, force: true });
      }
      if (existsSync(archive)) unlinkSync(archive);
      unlinkSync(plan.envFile);
    }
  }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/verify/deployment-preflight.mjs')) {
  if (process.argv.length !== 2) throw Error('Local deployment preflight takes no arguments');
  verifyDeployment();
}
