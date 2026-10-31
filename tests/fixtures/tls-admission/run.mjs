import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/process.mjs';
import { assertDisposableRemoved } from '../../../scripts/verify/disposable-cleanup.mjs';

// No retained target, URI, callback, SQL, program or caller transport mode.
if (process.argv.length !== 2) throw Error('Disposable TLS runner accepts no arguments');
if (process.env.DOCKER_HOST && !/^(unix:\/\/|npipe:\/\/)/.test(process.env.DOCKER_HOST))
  throw Error('Local Docker required');
const context = run('docker', ['context', 'inspect'], { capture: true, timeout: 10000 });
const endpoint = JSON.parse(context)[0]?.Endpoints?.docker?.Host;
if (typeof endpoint !== 'string' || !/^(unix:\/\/|npipe:\/\/)/.test(endpoint))
  throw Error('Local Docker context required');
mkdirSync('.local', { recursive: true });
const tooling = 'tt-test-' + randomBytes(8).toString('hex');
run('docker', ['build', '--target', 'tooling', '-t', 'tiresandtreads-tooling:' + tooling, '.'], {
  timeout: 600000,
});
try {
  for (const phase of ['valid', 'expired', 'future', 'plaintext', 'material', 'credential']) {
    const variant = ['material', 'credential'].includes(phase) ? 'valid' : phase;
    const project = 'tt-test-' + randomBytes(8).toString('hex'),
      generation = randomBytes(16).toString('hex');
    const envFile = resolve('.local/' + project + '-tls.env'),
      bindingFile = resolve('.local/' + project + '-binding.json');
    const values = {
      COMPOSE_PROJECT_NAME: project,
      POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
      FIXTURE_GENERATION: generation,
      TOOLING_TAG: tooling,
      BINDING_FILE: bindingFile.replaceAll('\\', '/'),
      SOURCE_SSL: variant === 'plaintext' ? 'off' : 'on',
      SOURCE_CERT: ['expired', 'future'].includes(variant) ? variant : 'valid',
      TLS_ADMISSION_PHASE: phase === 'valid' ? 'standard' : phase,
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
          'tests/fixtures/tls-admission/compose.yaml',
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
              variant,
              containers: ids.map(inspect),
            }),
          },
        ),
      );
    const observer = (phase) =>
      call(['run', '--rm', '--no-deps', '--env', 'TLS_ADMISSION_PHASE=' + phase, 'observer']);
    try {
      const manifest = JSON.parse(call(['config', '--format', 'json'], { capture: true }));
      const services = Object.keys(manifest.services).sort();
      if (
        JSON.stringify(services) !==
          JSON.stringify([
            'certificates',
            'observer',
            'postgres',
            'recovery-postgres',
            'setup',
            'supervisor',
          ]) ||
        manifest.networks.local.internal !== true
      )
        throw Error('Fixture manifest refused');
      for (const [name, s] of Object.entries(manifest.services)) {
        if (s.ports?.length) throw Error('Published fixture ports refused');
        if (
          name === 'observer' &&
          (!s.read_only ||
            Object.keys(s.environment).sort().join(',') !==
              'APP_ENV,ISOLATED_TEST_PROJECT,PROVIDER_MODE,TLS_ADMISSION_PHASE' ||
            s.volumes.some(
              (v) => !v.read_only || !['/owners', '/trust', '/control'].includes(v.target),
            ))
        )
          throw Error('Observer isolation refused');
      }
      if (
        Object.values(manifest.volumes).some((v) => v.external || !v.name.startsWith(project + '_'))
      )
        throw Error('Foreign fixture volumes refused');
      call(['up', '--detach', '--wait', '--wait-timeout', '90', 'postgres', 'recovery-postgres']);
      call(['run', '--rm', '--no-deps', 'setup']);
      const ids = ['postgres', 'recovery-postgres'].map((s) =>
        call(['ps', '--quiet', s], { capture: true }),
      );
      const b = seal(ids),
        domains = b.domains;
      writeFileSync(bindingFile, JSON.stringify(b));
      call(['up', '--detach', 'supervisor']);
      // Fixed readiness check, no admission receipt or cached map substitutes for live IPC.
      call([
        'exec',
        '-T',
        'supervisor',
        'node',
        '-e',
        "const fs=require('fs');let n=0;const t=setInterval(()=>{if(fs.existsSync('/control/admission.sock')){clearInterval(t);process.exit(0)}if(++n>100)process.exit(1)},50)",
      ]);
      if (['material', 'credential'].includes(phase)) {
        call([
          'run',
          '--rm',
          '--no-deps',
          '--env',
          'TLS_MATERIAL_FAULT=' + phase,
          'setup',
          'node',
          'tests/fixtures/tls-admission/material-fault.ts',
        ]);
      }
      observer(phase === 'valid' ? 'standard' : phase);
      if (phase === 'valid') {
        run('docker', ['restart', ids[1]], { capture: true });
        let healthy = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const c = inspect(ids[1]);
          if (c.State.Health?.Status === 'healthy') {
            healthy = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        const after = seal(ids).domains[1];
        if (
          !healthy ||
          after.id !== domains[1].id ||
          after.startedAt === domains[1].startedAt ||
          JSON.stringify(after.mounts) !== JSON.stringify(domains[1].mounts)
        )
          throw Error('Restart control not observed');
        observer('restart');
        call(['stop', 'supervisor']);
        observer('supervisor-loss');
        console.log(
          'TLS_RESTART_EVIDENCE ' +
            JSON.stringify({
              sameContainerId: true,
              sameOwnedVolumes: true,
              changedIncarnation: true,
              staleReceiptAdopted: false,
            }),
        );
      }
    } finally {
      try {
        call(['down', '--volumes', '--remove-orphans']);
        assertDisposableRemoved({ target: 'test', project });
      } finally {
        unlinkSync(envFile);
        unlinkSync(bindingFile);
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
      'tests/unit/tls-admission.test.ts',
    ],
    { timeout: 120000 },
  );
} finally {
  run('docker', ['image', 'rm', 'tiresandtreads-tooling:' + tooling], {
    timeout: 30000,
    capture: true,
  });
}
