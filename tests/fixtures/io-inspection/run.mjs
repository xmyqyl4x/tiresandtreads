import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/process.mjs';
import { assertFresh } from '../routing-resource/ownership.mjs';

// No retained target, URI, callback, SQL, program or caller transport mode.
if (process.argv.length !== 2) throw Error('Disposable I/O runner accepts no arguments');
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
    'end-hang',
    'inspection-loss',
    'map-loss',
    'preconnect-map-loss',
  ]) {
    const project = 'tt-test-' + randomBytes(8).toString('hex'),
      generation = randomBytes(16).toString('hex');
    // Refuse any existing labelled or name-colliding resource before entering owned teardown scope.
    assertFresh(project);
    const envFile = resolve('.local/' + project + '-io-inspection.env'),
      bindingFile = resolve('.local/' + project + '-binding.json');
    const values = {
      COMPOSE_PROJECT_NAME: project,
      POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
      FIXTURE_GENERATION: generation,
      TOOLING_TAG: tooling,
      BINDING_FILE: bindingFile.replaceAll('\\', '/'),
      SOURCE_SSL: 'on',
      SOURCE_CERT: 'valid',
      MC_PROFILE: 'standard',
      IO_PROFILE: phase,
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
          'tests/fixtures/io-inspection/compose.yaml',
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
          'certificates,inspector,observer,postgres,recovery-postgres,setup,supervisor' ||
        manifest.networks.local.internal !== true
      )
        throw Error('Manifest refused');
      for (const [name, s] of Object.entries(manifest.services)) {
        if (s.ports?.length) throw Error('Published ports refused');
        if (
          name === 'observer' &&
          (!s.read_only ||
            Object.keys(s.environment).sort().join(',') !==
              'APP_ENV,IO_PROFILE,ISOLATED_TEST_PROJECT,MC_PROFILE,PROVIDER_MODE' ||
            s.volumes.some(
              (v) =>
                !v.read_only ||
                !['/owners', '/trust', '/control', '/binding.json'].includes(v.target),
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
      if (['inspection-loss', 'map-loss', 'preconnect-map-loss'].includes(phase)) {
        const id = call(['run', '--detach', '--no-deps', 'observer'], { capture: true });
        const check = (ownedId, service) => {
          if (!/^[a-f0-9]{64}$/.test(ownedId)) throw Error('Owned I/O ID required');
          const c = inspect(ownedId);
          if (
            c.Id !== ownedId ||
            !c.State.Running ||
            c.Config.Image !== 'tiresandtreads-tooling:' + tooling ||
            c.Config.Labels?.['com.docker.compose.project'] !== project ||
            c.Config.Labels['com.docker.compose.service'] !== service
          )
            throw Error('Owned I/O identity unavailable');
        };
        check(id, 'observer');
        try {
          const until = performance.now() + 20000;
          let signaled = false;
          while (performance.now() < until) {
            const log = run('docker', ['logs', '--tail', '40', id], {
              capture: true,
              timeout: 10000,
            });
            if (log.length > 65536) throw Error('I/O cue output exceeded');
            if (log.includes('IO_PARENT_READY ' + phase)) {
              signaled = true;
              break;
            }
            check(id, 'observer');
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          if (!signaled) throw Error('I/O parent cue unavailable');
          const service = phase === 'inspection-loss' ? 'inspector' : 'supervisor';
          const target = call(['ps', '--quiet', service], { capture: true });
          check(target, service);
          call(['stop', '--timeout', '1', service]);
          if (inspect(target).State.Running) throw Error('Owned I/O stop unobserved');
          check(id, 'observer');
          run(
            'docker',
            [
              'exec',
              id,
              'node',
              '-e',
              "require('fs').writeFileSync('/tmp/io-parent-stopped','synthetic',{flag:'wx'})",
            ],
            { timeout: 5000 },
          );
          console.log(
            'IO_PARENT_EVIDENCE ' +
              JSON.stringify({
                profile: phase,
                service,
                exactOwnedIdentityChecked: true,
                stopped: true,
                databaseStopCalls: 0,
                backendTerminationCalls: 0,
                casesClosed: 0,
                gatesClosed: 0,
              }),
          );
          const status = run('docker', ['wait', id], { capture: true, timeout: 20000 });
          if (status !== '0') throw Error('I/O observer failed');
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
        'IO_PROFILE_EVIDENCE ' +
          JSON.stringify({ profile: phase, foundationOnly: true, casesClosed: 0, gatesClosed: 0 }),
      );
    } finally {
      let cleaned = false;
      try {
        call(['down', '--volumes', '--remove-orphans']);
        assertFresh(project);
        cleaned = true;
        console.log(
          'IO_CLEANUP_EVIDENCE ' +
            JSON.stringify({
              profile: phase,
              ownedProjectRemoved: true,
              unknown: false,
              casesClosed: 0,
              gatesClosed: 0,
            }),
        );
      } finally {
        // Keep synthetic custody available for recovery if cleanup is unknown.
        if (cleaned) {
          unlinkSync(envFile);
          unlinkSync(bindingFile);
        }
      }
    }
  }
} finally {
  run('docker', ['image', 'rm', 'tiresandtreads-tooling:' + tooling], {
    timeout: 30000,
    capture: true,
  });
}
