import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/process.mjs';
import { assertDisposableRemoved } from '../../../scripts/verify/disposable-cleanup.mjs';

// No retained target, URI, callback, SQL, program or caller transport mode.
if (process.argv.length !== 2) throw Error('Disposable coordination runner accepts no arguments');
if (process.env.DOCKER_HOST && !/^(unix:\/\/|npipe:\/\/)/.test(process.env.DOCKER_HOST))
  throw Error('Local Docker required');
const context = run('docker', ['context', 'inspect'], { capture: true, timeout: 10000 });
const endpoint = JSON.parse(context)[0]?.Endpoints?.docker?.Host;
if (typeof endpoint !== 'string' || !/^(unix:\/\/|npipe:\/\/)/.test(endpoint))
  throw Error('Local Docker context required');
mkdirSync('.local', { recursive: true });
const tooling = 'tt-test-' + randomBytes(8).toString('hex');
if (
  run(
    'docker',
    ['image', 'ls', '--quiet', '--filter', 'reference=tiresandtreads-tooling:' + tooling],
    { capture: true, timeout: 10000 },
  )
)
  throw Error('Pre-existing tooling tag refused');
run('docker', ['build', '--target', 'tooling', '-t', 'tiresandtreads-tooling:' + tooling, '.'], {
  timeout: 600000,
});
try {
  for (const phase of [
    'standard',
    'loss-source',
    'loss-target',
    'unknown-ack',
    'deadline',
    'map-loss',
    'inspection-loss',
    'context-drift',
  ]) {
    const project = 'tt-test-' + randomBytes(8).toString('hex'),
      generation = randomBytes(16).toString('hex');
    // Refuse any existing labeled resource before entering owned teardown scope.
    assertDisposableRemoved({ target: 'test', project });
    const envFile = resolve('.local/' + project + '-coordination.env'),
      bindingFile = resolve('.local/' + project + '-binding.json');
    const values = {
      COMPOSE_PROJECT_NAME: project,
      POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
      FIXTURE_GENERATION: generation,
      TOOLING_TAG: tooling,
      BINDING_FILE: bindingFile.replaceAll('\\', '/'),
      SOURCE_SSL: 'on',
      SOURCE_CERT: 'valid',
      MC_PROFILE: phase,
    };
    writeFileSync(
      envFile,
      Object.entries(values)
        .map(([k, v]) => k + '=' + v)
        .join('\n') + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    writeFileSync(bindingFile, '{}', { flag: 'wx', mode: 0o600 });
    const call = (args, options = {}) =>
      run(
        'docker',
        [
          'compose',
          '--project-name',
          project,
          '--env-file',
          envFile,
          '-f',
          'tests/fixtures/multitarget-coordination/compose.yaml',
          ...args,
        ],
        { timeout: 120000, ...options, env: values },
      );
    const inspect = (id) =>
      JSON.parse(run('docker', ['inspect', id], { capture: true, timeout: 10000 }))[0];
    const seal = (ids) =>
      JSON.parse(
        run(
          'docker',
          [
            'run',
            '--rm',
            '--interactive',
            '--network',
            'none',
            '--read-only',
            '--memory',
            '128m',
            '--cpus',
            '1',
            '--cap-drop',
            'ALL',
            '--cap-add',
            'DAC_OVERRIDE',
            '--security-opt',
            'no-new-privileges',
            ...[
              ['owners', '/owners'],
              ['trust', '/trust'],
              ['source-tls', '/custody/source'],
              ['target-tls', '/custody/target'],
            ].flatMap(([volume, target]) => [
              '--mount',
              `type=volume,src=${project}_${volume},dst=${target},readonly`,
            ]),
            'tiresandtreads-tooling:' + tooling,
            'node',
            'tests/fixtures/tls-admission/seal.ts',
          ],
          {
            capture: true,
            timeout: 10000,
            input: JSON.stringify({
              project,
              fixtureGeneration: generation,
              variant: 'valid',
              containers: ids.map(inspect),
            }),
          },
        ),
      );
    try {
      const manifest = JSON.parse(call(['config', '--format', 'json'], { capture: true }));
      if (
        Object.keys(manifest.services).sort().join(',') !==
          'certificates,fault-controller,inspector,observer,postgres,recovery-postgres,setup,supervisor' ||
        manifest.networks.local.internal !== true
      )
        throw Error('Manifest refused');
      for (const [name, s] of Object.entries(manifest.services)) {
        if (s.ports?.length) throw Error('Published ports refused');
        if (
          name === 'observer' &&
          (!s.read_only ||
            Object.keys(s.environment).sort().join(',') !==
              'APP_ENV,ISOLATED_TEST_PROJECT,MC_PROFILE,PROVIDER_MODE' ||
            s.volumes.some(
              (v) => !v.read_only || !['/owners', '/trust', '/control'].includes(v.target),
            ))
        )
          throw Error('Observer isolation refused');
      }
      if (
        Object.values(manifest.volumes).some((v) => v.external || !v.name.startsWith(project + '_'))
      )
        throw Error('Foreign volumes refused');
      call(['up', '--detach', '--wait', '--wait-timeout', '90', 'postgres', 'recovery-postgres']);
      call(['run', '--rm', '--no-deps', 'setup']);
      const ids = ['postgres', 'recovery-postgres'].map((s) =>
        call(['ps', '--quiet', s], { capture: true }),
      );
      const original = seal(ids);
      writeFileSync(bindingFile, JSON.stringify(original));
      call(['up', '--detach', 'supervisor']);
      const ready = (service, path) =>
        call([
          'exec',
          '-T',
          service,
          'node',
          '-e',
          "const fs=require('fs');let n=0;const t=setInterval(()=>{if(fs.existsSync('" +
            path +
            "')){clearInterval(t);process.exit(0)}if(++n>100)process.exit(1)},50)",
        ]);
      ready('supervisor', '/control/admission.sock');
      call(['up', '--detach', 'inspector']);
      ready('inspector', '/control/sql.sock');
      if (
        ['loss-source', 'loss-target', 'unknown-ack', 'map-loss', 'inspection-loss'].includes(phase)
      ) {
        const id = call(['run', '--detach', '--no-deps', 'observer'], { capture: true });
        if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Owned observer ID refused');
        const owned = inspect(id);
        if (
          owned.Config?.Labels?.['com.docker.compose.project'] !== project ||
          owned.Config.Labels['com.docker.compose.service'] !== 'observer'
        )
          throw Error('Owned observer identity refused');
        try {
          const stopProfile = ['map-loss', 'inspection-loss'].includes(phase);
          // The read-only stop cue needs no new container/root connection.
          // Avoid container creation/removal consuming the candidate budget.
          call(
            stopProfile
              ? [
                  'exec',
                  '-T',
                  'inspector',
                  'node',
                  'tests/fixtures/multitarget-coordination/fault-controller.ts',
                ]
              : ['run', '--rm', '--no-deps', 'fault-controller'],
            { timeout: 20000 },
          );
          if (phase === 'map-loss') call(['stop', '--timeout', '1', 'supervisor']);
          if (phase === 'inspection-loss') call(['stop', '--timeout', '1', 'inspector']);
          if (['map-loss', 'inspection-loss'].includes(phase))
            run(
              'docker',
              [
                'exec',
                id,
                'node',
                '-e',
                "require('fs').writeFileSync('/tmp/mc-parent-stopped','synthetic')",
              ],
              { timeout: 5000 },
            );
          const status = run('docker', ['wait', id], { capture: true, timeout: 20000 });
          if (status !== '0') throw Error('Coordination observer failed');
        } finally {
          run('docker', ['logs', id], { timeout: 10000 });
        }
      } else call(['run', '--rm', '--no-deps', 'observer']);
      if (JSON.stringify(seal(ids)) !== JSON.stringify(original))
        throw Error('Owned foundation changed');
      call([
        'run',
        '--rm',
        '--no-deps',
        'setup',
        'node',
        'tests/fixtures/multitarget-coordination/preservation.ts',
      ]);
      if (JSON.stringify(seal(ids)) !== JSON.stringify(original))
        throw Error('Owned foundation changed');
      console.log(
        'MC_PROFILE_EVIDENCE ' +
          JSON.stringify({ profile: phase, foundationOnly: true, casesClosed: 0, gatesClosed: 0 }),
      );
    } finally {
      let cleaned = false;
      try {
        call(['down', '--volumes', '--remove-orphans']);
        assertDisposableRemoved({ target: 'test', project });
        cleaned = true;
      } finally {
        // Keep synthetic custody available for recovery if cleanup is unknown.
        if (cleaned) {
          unlinkSync(envFile);
          unlinkSync(bindingFile);
        }
      }
    }
  }
  // A separate network-none unit run exercises parser/time/fact refusal cases.
  run(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      '--tmpfs',
      '/workspace/node_modules/.vite-temp:rw,size=32m',
      '--tmpfs',
      '/workspace/node_modules/.vite:rw,size=16m',
      '--tmpfs',
      '/workspace/node_modules/.vitest:rw,size=1m',
      '--tmpfs',
      '/workspace/node_modules/.vitest-cache:rw,size=64m',
      '--memory',
      '1536m',
      '--cpus',
      '2',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      'tiresandtreads-tooling:' + tooling,
      'pnpm',
      'exec',
      'vitest',
      'run',
      '--project',
      'unit',
      'tests/unit/multitarget-coordination.test.ts',
    ],
    { timeout: 120000 },
  );
} finally {
  run('docker', ['image', 'rm', 'tiresandtreads-tooling:' + tooling], {
    timeout: 30000,
    capture: true,
  });
}
