import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../../../scripts/lib/process.mjs';
import { assertFresh } from '../routing-resource/ownership.mjs';

if (process.argv.length !== 2) throw Error('Populated fixture accepts no arguments');
if (process.env.DOCKER_HOST && !/^(unix:\/\/|npipe:\/\/)/.test(process.env.DOCKER_HOST))
  throw Error('Local Docker required');
const endpoint = JSON.parse(
  run('docker', ['context', 'inspect'], { capture: true, timeout: 10000 }),
)[0]?.Endpoints?.docker?.Host;
if (typeof endpoint !== 'string' || !/^(unix:\/\/|npipe:\/\/)/.test(endpoint))
  throw Error('Local Docker required');
mkdirSync('.local', { recursive: true });
const tooling = 'tt-test-' + randomBytes(8).toString('hex');
if (
  run(
    'docker',
    ['image', 'ls', '--quiet', '--filter', 'reference=tiresandtreads-tooling:' + tooling],
    { capture: true, timeout: 10000 },
  )
)
  throw Error('Occupied tooling tag');
run('docker', ['build', '--target', 'tooling', '-t', 'tiresandtreads-tooling:' + tooling, '.'], {
  timeout: 600000,
});
try {
  for (const profile of [
    'positive',
    'app-row',
    'cms-row',
    'missing-row',
    'app-history',
    'cms-history',
    'inventory',
    'quarantine',
    'source-row',
  ]) {
    const project = 'tt-test-' + randomBytes(8).toString('hex');
    assertFresh(project);
    const envFile = resolve('.local/' + project + '-populated.env');
    const values = {
      COMPOSE_PROJECT_NAME: project,
      POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
      FIXTURE_GENERATION: randomBytes(16).toString('hex'),
      TOOLING_TAG: tooling,
      POPULATED_PROFILE: profile,
      SOURCE_SSL: 'on',
      SOURCE_CERT: 'valid',
    };
    writeFileSync(
      envFile,
      Object.entries(values)
        .map(([k, v]) => k + '=' + v)
        .join('\n') + '\n',
      { flag: 'wx', mode: 0o600 },
    );
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
          'tests/fixtures/populated-preservation/compose.yaml',
          ...args,
        ],
        { timeout: 180000, ...options, env: values },
      );
    const identities = () =>
      ['postgres', 'recovery-postgres'].map((service) => {
        const id = call(['ps', '--quiet', service], { capture: true });
        if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Missing owned instance');
        const info = JSON.parse(
          run('docker', ['inspect', id], { capture: true, timeout: 10000 }),
        )[0];
        if (
          info.Config.Labels['com.docker.compose.project'] !== project ||
          info.Config.Labels['com.docker.compose.service'] !== service ||
          info.State.Running !== true ||
          info.RestartCount !== 0
        )
          throw Error('Owned instance changed');
        return {
          id,
          started: info.State.StartedAt,
          mounts: info.Mounts.map((m) => [m.Name, m.Destination, m.RW]).sort((a, b) =>
            String(a[1]).localeCompare(String(b[1])),
          ),
          network: Object.keys(info.NetworkSettings.Networks).sort(),
          aliases: Object.entries(info.NetworkSettings.Networks)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, n]) => [name, n.Aliases.slice().sort()]),
        };
      });
    try {
      const manifest = JSON.parse(call(['config', '--format', 'json'], { capture: true }));
      if (
        Object.keys(manifest.services).sort().join(',') !==
          'certificates,observer,postgres,recovery-postgres,setup' ||
        !manifest.networks.local.internal ||
        Object.values(manifest.volumes).some((v) => v.external || !v.name.startsWith(project + '_'))
      )
        throw Error('Manifest refused');
      for (const s of Object.values(manifest.services))
        if (s.ports?.length) throw Error('Published port refused');
      const o = manifest.services.observer;
      if (
        !o.read_only ||
        o.privileged ||
        o.cap_add?.length ||
        !o.cap_drop.includes('ALL') ||
        Object.keys(o.environment).sort().join(',') !==
          'APP_ENV,ISOLATED_TEST_PROJECT,POPULATED_PROFILE,PROVIDER_MODE' ||
        o.volumes.some(
          (v) => !v.read_only || !['/owners', '/trust', '/populated'].includes(v.target),
        )
      )
        throw Error('Observer isolation refused');
      call(['up', '--detach', '--wait', '--wait-timeout', '90', 'postgres', 'recovery-postgres']);
      const before = identities();
      if (before[0].id === before[1].id) throw Error('Separate instances required');
      call(['run', '--rm', '--no-deps', 'setup']);
      call(['run', '--rm', '--no-deps', 'observer']);
      if (JSON.stringify(before) !== JSON.stringify(identities()))
        throw Error('Instance continuity lost');
      console.log(
        'POPULATED_CONTINUITY_EVIDENCE ' +
          JSON.stringify({
            profile,
            sameOwnedInstances: true,
            sameVolumesAndAliases: true,
            separatelyHostedPostgres: true,
            independentAuthorityClaim: false,
          }),
      );
    } finally {
      call(['down', '--volumes', '--remove-orphans']);
      assertFresh(project);
      unlinkSync(envFile);
      console.log(
        'POPULATED_CLEANUP_EVIDENCE ' + JSON.stringify({ profile, ownedProjectRemoved: true }),
      );
    }
  }
} finally {
  run('docker', ['image', 'rm', 'tiresandtreads-tooling:' + tooling], {
    capture: true,
    timeout: 30000,
  });
}
