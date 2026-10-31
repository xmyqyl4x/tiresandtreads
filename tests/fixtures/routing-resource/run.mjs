import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/process.mjs';
import { assertFresh } from './ownership.mjs';
import { namespaceProof } from './namespace-proof.mjs';
import { sentinel } from './sentinel.mjs';

// No retained target, URI, callback, SQL, program or caller transport mode.
if (process.argv.length !== 2)
  throw Error('Disposable routing/resource runner accepts no arguments');
if (process.env.DOCKER_HOST && !/^(unix:\/\/|npipe:\/\/)/.test(process.env.DOCKER_HOST))
  throw Error('Local Docker required');
const context = run('docker', ['context', 'inspect'], { capture: true, timeout: 10000 });
const endpoint = JSON.parse(context)[0]?.Endpoints?.docker?.Host;
if (typeof endpoint !== 'string' || !/^(unix:\/\/|npipe:\/\/)/.test(endpoint))
  throw Error('Local Docker context required');
namespaceProof();
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
    'alias-collision',
    'cross-source',
    'cross-target',
    'container',
    'tls-volume',
    'shared-tls',
  ]) {
    const project = 'tt-test-' + randomBytes(8).toString('hex'),
      generation = randomBytes(16).toString('hex');
    // Refuse any existing labeled resource before entering owned teardown scope.
    assertFresh(project);
    const envFile = resolve('.local/' + project + '-routing-resource.env'),
      bindingFile = resolve('.local/' + project + '-binding.json');
    const values = {
      COMPOSE_PROJECT_NAME: project,
      POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
      FIXTURE_GENERATION: generation,
      TOOLING_TAG: tooling,
      BINDING_FILE: bindingFile.replaceAll('\\', '/'),
      SOURCE_SSL: 'on',
      SOURCE_CERT: 'valid',
      LR02_PROFILE: phase,
      LR02_SOURCE_ADDRESS: '127.0.0.1',
      LR02_TARGET_ADDRESS: '127.0.0.2',
      SOURCE_ROUTE_ADDRESS: '127.0.0.1',
      TARGET_ROUTE_ADDRESS: '127.0.0.2',
      SOURCE_TLS_VOLUME: 'source-tls',
      TARGET_TLS_VOLUME: 'target-tls',
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
          'tests/fixtures/routing-resource/compose.yaml',
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
    let separate;
    let primaryRemovalObserved = false;
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
            'volume-copy',
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
              'APP_ENV,ISOLATED_TEST_PROJECT,LR02_PROFILE,LR02_SOURCE_ADDRESS,LR02_TARGET_ADDRESS,PROVIDER_MODE' ||
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
      values.LR02_SOURCE_ADDRESS = original.domains[0].address;
      values.LR02_TARGET_ADDRESS = original.domains[1].address;
      values.SOURCE_ROUTE_ADDRESS = values.LR02_SOURCE_ADDRESS;
      values.TARGET_ROUTE_ADDRESS = values.LR02_TARGET_ADDRESS;
      const observer = (profile) =>
        call(['run', '--rm', '--no-deps', '--env', 'LR02_PROFILE=' + profile, 'observer']);
      const witness = (mode) => {
        const args = [
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
          ].flatMap(([v, p]) => ['--mount', `type=volume,src=${project}_${v},dst=${p},readonly`]),
          'tiresandtreads-tooling:' + tooling,
          'node',
          'tests/fixtures/routing-resource/witness.ts',
        ];
        const result = JSON.parse(
          run('docker', args, {
            capture: true,
            timeout: 10000,
            input: JSON.stringify({
              mode,
              expected: original,
              containers: ['postgres', 'recovery-postgres'].map((x) =>
                inspect(call(['ps', '--quiet', x], { capture: true })),
              ),
            }),
          }),
        );
        if (
          result.mode !== mode ||
          !result.currentOwnedResourceFactsChecked ||
          !result.materialDigestUnchanged
        )
          throw Error('Fixed resource witness unavailable');
        console.log('RR_RESOURCE_EVIDENCE ' + JSON.stringify(result));
      };
      observer('positive');
      witness('before');
      if (phase === 'alias-collision') {
        separate = sentinel(project, tooling);
        separate.create();
        separate.attach();
      }
      if (phase === 'cross-source') values.SOURCE_ROUTE_ADDRESS = values.LR02_TARGET_ADDRESS;
      if (phase === 'cross-target') values.TARGET_ROUTE_ADDRESS = values.LR02_SOURCE_ADDRESS;
      if (['container', 'tls-volume', 'shared-tls'].includes(phase)) {
        // Corroborate exact owned resources immediately before fixed effects.
        witness('before');
        if (phase === 'tls-volume') {
          call(['run', '--rm', '--no-deps', 'volume-copy']);
          values.SOURCE_TLS_VOLUME = 'source-tls-replacement';
        }
        if (phase === 'shared-tls') values.TARGET_TLS_VOLUME = 'source-tls';
        call([
          'up',
          '--detach',
          '--no-deps',
          '--force-recreate',
          '--wait',
          '--wait-timeout',
          '90',
          phase === 'shared-tls' ? 'recovery-postgres' : 'postgres',
        ]);
        witness(phase);
      }
      if (phase !== 'positive') observer(phase);
      if (
        ['positive', 'cross-source', 'cross-target'].includes(phase) &&
        JSON.stringify(seal(ids)) !== JSON.stringify(original)
      )
        throw Error('Unexpected database resource/material drift');
      console.log(
        'RR_PROFILE_EVIDENCE ' + JSON.stringify({ profile: phase, casesClosed: 0, gatesClosed: 0 }),
      );
    } finally {
      let cleaned = false;
      try {
        if (separate) separate.detach();
        call(['down', '--volumes', '--remove-orphans']);
        assertFresh(project);
        primaryRemovalObserved = true;
        if (separate) {
          separate.preserved();
          separate.remove();
        }
        cleaned = true;
        console.log(
          'RR_CLEANUP_EVIDENCE ' +
            JSON.stringify({ profile: phase, ownedProjectRemoved: true, unknown: false }),
        );
      } finally {
        // Keep synthetic custody available for recovery if cleanup is unknown.
        if (cleaned) {
          unlinkSync(envFile);
          unlinkSync(bindingFile);
        } else {
          console.log(
            'RR_CLEANUP_EVIDENCE ' +
              JSON.stringify({
                profile: phase,
                ownedProjectRemoved: primaryRemovalObserved,
                unknown: true,
              }),
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
