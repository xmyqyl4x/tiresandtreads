import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/process.mjs';
import { assertDisposableRemoved } from '../../../scripts/verify/disposable-cleanup.mjs';

// No retained target, URI, callback, SQL, program or caller transport mode.
if (process.argv.length !== 2) throw Error('Disposable trust/material runner accepts no arguments');
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
    'positive',
    'root-expired',
    'root-future',
    'root-nonca',
    'missing-root',
    'missing-leaf',
    'extra-file',
    'mixed-leaf',
    'wrong-key-pair',
  ]) {
    const project = 'tt-test-' + randomBytes(8).toString('hex'),
      generation = randomBytes(16).toString('hex');
    // Refuse any existing labeled resource before entering owned teardown scope.
    assertDisposableRemoved({ target: 'test', project });
    const envFile = resolve('.local/' + project + '-trust-material.env'),
      bindingFile = resolve('.local/' + project + '-binding.json');
    const values = {
      COMPOSE_PROJECT_NAME: project,
      POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
      FIXTURE_GENERATION: generation,
      TOOLING_TAG: tooling,
      BINDING_FILE: bindingFile.replaceAll('\\', '/'),
      SOURCE_SSL: 'on',
      SOURCE_CERT: 'valid',
      LR01_PROFILE: phase,
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
          'tests/fixtures/trust-material/compose.yaml',
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
      const services = Object.keys(manifest.services).sort();
      if (
        JSON.stringify(services) !==
          JSON.stringify([
            'certificates',
            'material-fault',
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
              'APP_ENV,ISOLATED_TEST_PROJECT,LR01_PROFILE,PROVIDER_MODE' ||
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
      const original = seal(ids);
      writeFileSync(bindingFile, JSON.stringify(original));
      call(['up', '--detach', 'supervisor']);
      call([
        'exec',
        '-T',
        'supervisor',
        'node',
        '-e',
        "const fs=require('fs');let n=0;const t=setInterval(()=>{if(fs.existsSync('/control/admission.sock')){clearInterval(t);process.exit(0)}if(++n>100)process.exit(1)},50)",
      ]);
      const observer = (profile) =>
        call(['run', '--rm', '--no-deps', '--env', 'LR01_PROFILE=' + profile, 'observer']);
      const fault = [
        'missing-root',
        'missing-leaf',
        'extra-file',
        'mixed-leaf',
        'wrong-key-pair',
      ].includes(phase);
      // Every material fault first proves the very same project's untouched baseline.
      if (fault) {
        observer('positive');
        const raw = call(['run', '--rm', '--no-deps', 'material-fault'], { capture: true });
        const witness = JSON.parse(raw);
        if (
          witness.profile !== phase ||
          witness.fixedSyntheticFileChanges !== 1 ||
          witness.sqlDispatches !== 0 ||
          witness.providerDispatches !== 0
        )
          throw Error('Synthetic fault witness refused');
        console.log('LR01_MATERIAL_EVIDENCE ' + JSON.stringify(witness));
      }
      observer(phase);
      // Root controls are sealed with their actual bytes and matching owner CA digest.
      // A refused root is not explained by an intentionally stale custody seal.
      if (!fault && JSON.stringify(seal(ids)) !== JSON.stringify(original))
        throw Error('Unexpected fixture drift');
      console.log(
        'LR01_PROFILE_EVIDENCE ' +
          JSON.stringify({ profile: phase, casesClosed: 0, gatesClosed: 0 }),
      );
    } finally {
      let cleaned = false;
      try {
        call(['down', '--volumes', '--remove-orphans']);
        assertDisposableRemoved({ target: 'test', project });
        cleaned = true;
        console.log(
          'LR01_CLEANUP_EVIDENCE ' +
            JSON.stringify({ profile: phase, ownedProjectRemoved: true, unknown: false }),
        );
      } finally {
        // Keep synthetic custody available for recovery if cleanup is unknown.
        if (cleaned) {
          unlinkSync(envFile);
          unlinkSync(bindingFile);
        } else {
          console.log(
            'LR01_CLEANUP_EVIDENCE ' +
              JSON.stringify({ profile: phase, ownedProjectRemoved: false, unknown: true }),
          );
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
