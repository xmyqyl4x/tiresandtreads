import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { run } from '../../../scripts/lib/process.mjs';
import { assertFresh } from '../routing-resource/ownership.mjs';

const profiles = [
  'positive',
  'bundle-corrupt',
  'bundle-project',
  'bundle-manifest',
  'checkpoint-missing',
  'checkpoint-stale',
  'checkpoint-changed',
  'image-binding',
  'config-binding',
  'app-history',
  'cms-history',
  'target-row',
  'source-row',
  'quarantine',
  'observer-loss',
  'inspection-loss',
];
const pgImage =
  'postgres:18.6-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c';
const certificateImage =
  'motoserver/moto:5.2.0@sha256:d8d063e3e704d256cbe8165072fa273c17698be91311e49fc602b7716f459bea';
const error = (message) => {
  throw Error(message);
};
const need = (condition, message) => {
  if (!condition) error(message);
};
const marker = (raw, name) => {
  const rows = raw.split(/\r?\n/).filter((s) => s.startsWith(name + ' '));
  need(rows.length === 1, 'Missing/duplicate fixed observation');
  return JSON.parse(rows[0].slice(name.length + 1));
};
const inspect = (id) =>
  JSON.parse(run('docker', ['inspect', id], { capture: true, timeout: 10000 }))[0];
function cleanupAbsent(project, start) {
  for (const [args, filters] of [
    [
      ['ps', '--all', '--quiet'],
      ['label=com.docker.compose.project=' + project, 'name=' + project],
    ],
    [
      ['volume', 'ls', '--quiet'],
      ['label=com.docker.compose.project=' + project, 'name=' + project],
    ],
    [
      ['network', 'ls', '--quiet'],
      ['label=com.docker.compose.project=' + project, 'name=' + project],
    ],
  ])
    for (const filter of filters) {
      const remaining = 60000 - (Date.now() - start);
      need(remaining > 0, 'Owned cleanup observation budget exhausted');
      const raw = run('docker', [...args, '--filter', filter], {
        capture: true,
        timeout: Math.min(10000, remaining),
      });
      need(!raw && Date.now() - start < 60000, 'Owned cleanup unavailable');
    }
}
function localDocker() {
  need(process.argv.length === 2, 'Restore handoff takes no arguments');
  need(
    !process.env.DOCKER_HOST || /^(unix:\/\/|npipe:\/\/)/.test(process.env.DOCKER_HOST),
    'Local Docker required',
  );
  const endpoint = JSON.parse(
    run('docker', ['context', 'inspect'], { capture: true, timeout: 10000 }),
  )[0]?.Endpoints?.docker?.Host;
  need(
    typeof endpoint === 'string' && /^(unix:\/\/|npipe:\/\/)/.test(endpoint),
    'Local Docker required',
  );
}
function publicManifest(m, project, tag) {
  const names = [
    'audit',
    'certificates',
    'observer',
    'observer-loss',
    'postgres',
    'recovery-postgres',
    'setup',
    'write-probe',
  ];
  need(Object.keys(m.services).sort().join(',') === names.join(','), 'Service shape refused');
  need(
    Object.keys(m.networks).join(',') === 'local' &&
      m.networks.local.internal === true &&
      !m.networks.local.external,
    'Network shape refused',
  );
  need(
    Object.keys(m.volumes).length === 12 &&
      Object.values(m.volumes).every((v) => !v.external && v.name.startsWith(project + '_')),
    'Volume shape refused',
  );
  for (const [name, s] of Object.entries(m.services)) {
    need(
      !s.ports?.length && !s.privileged && !s.cap_add?.length,
      'Published/privileged service refused',
    );
    if (name === 'postgres' || name === 'recovery-postgres') {
      need(s.image === pgImage, 'PostgreSQL pin refused');
      need(
        s.volumes.length === 3 && s.volumes.some((v) => v.target === '/tls' && v.read_only),
        'Server mounts refused',
      );
      need(
        !s.volumes.some(
          (v) =>
            v.type !== 'volume' ||
            ['/custody-keys', '/custody-backup', '/custody-journal'].includes(v.target),
        ),
        'Server custody mount refused',
      );
    } else if (name === 'certificates') {
      need(s.image === certificateImage && s.network_mode === 'none', 'Certificate actor refused');
      need(
        s.volumes.filter((v) => v.type === 'bind').length === 1 &&
          s.volumes.some(
            (v) =>
              v.type === 'bind' &&
              resolve(v.source) === resolve('tests/fixtures/tls-admission/certificates.py') &&
              v.target === '/fixture/certificates.py' &&
              v.read_only,
          ),
        'Certificate source refused',
      );
    } else {
      need(
        s.image === 'tiresandtreads-tooling:' + tag &&
          s.read_only &&
          s.cap_drop.includes('ALL') &&
          s.security_opt.includes('no-new-privileges:true'),
        'Tooling isolation refused',
      );
      if (name !== 'setup') {
        const expected = [
          'APP_ENV',
          'HANDOFF_CONFIG',
          'HANDOFF_IMAGE',
          'ISOLATED_TEST_PROJECT',
          'PROVIDER_MODE',
          ...(name === 'observer-loss' ? ['HANDOFF_OBSERVER_MODE'] : []),
        ].sort();
        need(
          Object.keys(s.environment).sort().join(',') === expected.join(','),
          'Observer environment refused',
        );
        need(
          s.environment.APP_ENV === 'test-local' &&
            s.environment.PROVIDER_MODE === 'fixtures' &&
            s.environment.ISOLATED_TEST_PROJECT === project,
          'Observer mode refused',
        );
        need(
          s.volumes.length === 4 &&
            s.volumes.every(
              (v) =>
                v.type === 'volume' &&
                v.read_only &&
                ['/owners', '/trust', '/handoff-meta', '/handoff-current'].includes(v.target),
            ),
          'Observer mounts refused',
        );
      }
    }
  }
  // Public shape only: no values from root URLs/passwords, no digest self-reference.
  return {
    networks: m.networks,
    volumes: Object.keys(m.volumes).sort(),
    services: names.map((name) => {
      const s = m.services[name];
      return {
        name,
        image: s.image,
        command: s.command,
        readOnly: !!s.read_only,
        environmentKeys: Object.keys(s.environment ?? {}).sort(),
        volumes: s.volumes.map((v) => ({
          type: v.type,
          source: v.source,
          target: v.target,
          readOnly: !!v.read_only,
        })),
        networks: s.networks ?? null,
      };
    }),
  };
}
async function main() {
  localDocker();
  mkdirSync('.local', { recursive: true });
  const local = realpathSync('.local'),
    tag = 'tt-test-' + randomBytes(8).toString('hex');
  need(local === join(realpathSync('.'), '.local'), 'Local custody directory changed');
  const imageTag = 'tiresandtreads-tooling:' + tag;
  need(
    !run('docker', ['image', 'ls', '--quiet', '--filter', 'reference=' + imageTag], {
      capture: true,
      timeout: 10000,
    }),
    'Occupied tooling tag',
  );
  let imageId,
    allClean = true;
  const receipts = [];
  try {
    run('docker', ['build', '--target', 'tooling', '-t', imageTag, '.'], { timeout: 600000 });
    imageId = run('docker', ['image', 'inspect', imageTag, '--format', '{{.Id}}'], {
      capture: true,
      timeout: 10000,
    });
    need(/^sha256:[a-f0-9]{64}$/.test(imageId), 'Owned tooling image unavailable');
    for (const profile of profiles) {
      const project = 'tt-test-' + randomBytes(8).toString('hex');
      assertFresh(project);
      const envFile = join(local, project + '-restore-handoff.env');
      const values = {
        COMPOSE_PROJECT_NAME: project,
        POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
        FIXTURE_GENERATION: randomBytes(16).toString('hex'),
        TOOLING_TAG: tag,
        HANDOFF_PROFILE: profile,
        HANDOFF_IMAGE: imageId,
        HANDOFF_CONFIG: '0'.repeat(64),
      };
      const serialize = () =>
        Object.entries(values)
          .map(([k, v]) => k + '=' + v)
          .join('\n') + '\n';
      writeFileSync(envFile, serialize(), { mode: 0o600, flag: 'wx' });
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
            'tests/fixtures/restore-handoff/compose.yaml',
            ...args,
          ],
          { capture: true, timeout: 180000, ...options, env: values },
        );
      const fixed = (file) =>
        call([
          'run',
          '--rm',
          '--no-deps',
          'setup',
          'node',
          '--import',
          'tsx',
          'tests/fixtures/' + file + '.ts',
        ]);
      const identities = () =>
        ['postgres', 'recovery-postgres'].map((service) => {
          const id = call(['ps', '--quiet', service]);
          need(/^[a-f0-9]{64}$/.test(id), 'Owned server unavailable');
          const i = inspect(id);
          need(
            i.Config.Labels['com.docker.compose.project'] === project &&
              i.Config.Labels['com.docker.compose.service'] === service &&
              i.State.Running === true &&
              i.RestartCount === 0,
            'Owned server changed',
          );
          return {
            id,
            image: i.Image,
            started: i.State.StartedAt,
            mounts: i.Mounts.map((v) => [v.Name, v.Destination, v.RW]).sort((a, b) =>
              String(a[1]).localeCompare(String(b[1])),
            ),
            networks: Object.entries(i.NetworkSettings.Networks)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([n, v]) => [n, v.Aliases.slice().sort()]),
          };
        });
      let knownClean = false;
      try {
        const manifest = JSON.parse(call(['config', '--format', 'json']));
        values.HANDOFF_CONFIG = createHash('sha256')
          .update(JSON.stringify(publicManifest(manifest, project, tag)))
          .digest('hex');
        writeFileSync(envFile, serialize(), { mode: 0o600 });
        need(
          JSON.stringify(
            publicManifest(JSON.parse(call(['config', '--format', 'json'])), project, tag),
          ) === JSON.stringify(publicManifest(manifest, project, tag)),
          'Public configuration changed',
        );
        call(['up', '--detach', '--wait', '--wait-timeout', '90', 'postgres', 'recovery-postgres']);
        const before = identities();
        need(before[0].id !== before[1].id, 'Separate server instances required');
        fixed('restore-handoff/prepare');
        fixed('recovery/custody-seed');
        for (const kind of ['app', 'cms'])
          call([
            'exec',
            '-T',
            'postgres',
            'pg_dump',
            '-U',
            'local_harness',
            '--role=tt_' + kind + '_migrator',
            '--format=custom',
            '--no-tablespaces',
            '--file=/recovery/' + kind + '.dump',
            'tt_' + kind + '_recovery',
          ]);
        fixed('recovery/custody-seal');
        const admission = marker(fixed('restore-handoff/admit'), 'RESTORE_HANDOFF_ADMISSION');
        need(
          admission.profile === profile && admission.restoreExecuted === false,
          'Admission record refused',
        );
        let receipt;
        if (profile.startsWith('bundle-')) {
          need(
            admission.admitted === false &&
              admission.targetEmpty &&
              admission.targetProductConnectClosed,
            'Artifact refusal not observed',
          );
          receipt = {
            profile,
            native: true,
            stage: 'artifact-admission',
            status: 'refused',
            restoreExecuted: false,
            privacyReplayExecuted: false,
            targetEmpty: true,
            targetProductConnectClosed: true,
          };
        } else {
          need(
            admission.admitted === true && admission.existingAdmissionRefusals === 7,
            'Positive admission missing',
          );
          for (const kind of ['app', 'cms'])
            call([
              'exec',
              '-T',
              'recovery-postgres',
              'pg_restore',
              '-U',
              'local_harness',
              '--role=tt_' + kind + '_migrator',
              '--no-owner',
              '--no-tablespaces',
              '--exit-on-error',
              '--single-transaction',
              '--dbname=tt_' + kind + '_recovery',
              '/recovery/' + kind + '.dump',
            ]);
          const replay = stripVTControlCharacters(
            call([
              'run',
              '--rm',
              '--no-deps',
              'setup',
              'pnpm',
              'exec',
              'vitest',
              'run',
              '--project',
              'custody',
            ]),
          );
          need(
            /Tests\s+2 passed/.test(replay) && /Test Files\s+1 passed/.test(replay),
            'Existing actual custody replay tests did not pass',
          );
          console.log(
            'RESTORE_HANDOFF_REPLAY ' +
              JSON.stringify({
                profile,
                existingCustodyTests: 2,
                actualReplay: true,
                notNewUniqueCoverage: true,
              }),
          );
          const seal = marker(fixed('restore-handoff/seal'), 'RESTORE_HANDOFF_SEAL');
          need(
            seal.restoreExecuted &&
              seal.privacyReplayExecuted &&
              seal.maintenanceClosed &&
              seal.closedEndpoints === 4 &&
              seal.rejectedSourcePasswords === 2,
            'Closed phase seal missing',
          );
          marker(fixed('restore-handoff/fault'), 'RESTORE_HANDOFF_FAULT');
          let observation;
          if (profile === 'observer-loss') {
            const id = call([
              'run',
              '--detach',
              '--no-deps',
              '--name',
              project + '-loss-observer',
              'observer-loss',
            ]);
            need(/^[a-f0-9]{64}$/.test(id), 'Owned observer unavailable');
            const check = () => {
              const i = inspect(id);
              need(
                i.Config.Labels['com.docker.compose.project'] === project &&
                  i.Config.Labels['com.docker.compose.service'] === 'observer-loss' &&
                  i.Image === imageId &&
                  i.State.Running === true &&
                  i.State.Pid > 0,
                'Owned observer identity changed',
              );
              return i.State.StartedAt;
            };
            const started = check(),
              deadline = Date.now() + 10000;
            let output = '';
            while (Date.now() < deadline) {
              output = run('docker', ['logs', id], { capture: true, timeout: 1000 });
              if (output.includes('RESTORE_HANDOFF_STARTED ')) break;
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            const start = marker(output, 'RESTORE_HANDOFF_STARTED');
            need(
              start.firstEndpointObserved &&
                start.firstDriverEndObserved &&
                !start.wholeBatchComplete,
              'Observer checkpoint missing',
            );
            need(check() === started, 'Owned observer incarnation changed');
            run('docker', ['kill', '--signal=KILL', id], { capture: true, timeout: 10000 });
            need(
              run('docker', ['wait', id], { capture: true, timeout: 10000 }) === '137',
              'Observer process loss not established',
            );
            need(
              !run('docker', ['logs', id], { capture: true, timeout: 1000 }).includes(
                'RESTORE_HANDOFF_OBSERVATION ',
              ),
              'Lost observer returned a final receipt',
            );
            const stopped = inspect(id);
            need(
              stopped.Config.Labels['com.docker.compose.project'] === project &&
                stopped.Image === imageId &&
                !stopped.State.Running,
              'Stopped observer identity changed',
            );
            run('docker', ['rm', id], { capture: true, timeout: 10000 });
            observation = {
              status: 'unavailable',
              code: 'observer-loss',
              complete: false,
              freshAttemptBlocked: true,
              firstDriverEndObserved: true,
              wholeBatchComplete: false,
              actualOwnedProcessLoss: true,
              noPendingSqlKillClaim: true,
            };
          } else {
            observation = marker(
              call(['run', '--rm', '--no-deps', 'observer']),
              'RESTORE_HANDOFF_OBSERVATION',
            );
            const expected = {
              positive: ['success', 'compatible'],
              'checkpoint-missing': ['refused', 'checkpoint-missing'],
              'checkpoint-stale': ['refused', 'checkpoint-stale'],
              'checkpoint-changed': ['refused', 'checkpoint-changed'],
              'image-binding': ['refused', 'image'],
              'config-binding': ['refused', 'config'],
              'inspection-loss': ['unavailable', 'checkpoint-unavailable'],
            };
            const wanted = expected[profile] ?? ['refused', 'catalog-drift'];
            need(
              observation.status === wanted[0] && observation.code === wanted[1],
              'Wrong native observation outcome',
            );
            const field = {
              'app-history': '1/app:history',
              'cms-history': '1/cms:history',
              'target-row': '1/app:rows',
              'source-row': '0/app:rows',
              quarantine: '1/app:quarantined',
            }[profile];
            if (field)
              need(
                observation.findings.includes(field) &&
                  observation.completedEndpointObservations === 4 &&
                  observation.verifiedTlsEndpoints === 4 &&
                  observation.nativeEndsObserved === 4,
                'Expected native fault finding missing',
              );
            if (profile === 'positive') {
              const repeated = marker(
                call(['run', '--rm', '--no-deps', 'observer']),
                'RESTORE_HANDOFF_OBSERVATION',
              );
              need(
                JSON.stringify(observation) === JSON.stringify(repeated) &&
                  observation.complete &&
                  observation.completedEndpointObservations === 4 &&
                  observation.nativeEndsObserved === 4,
                'Repeated positive read changed',
              );
              const probe = marker(
                call(['run', '--rm', '--no-deps', 'write-probe']),
                'RESTORE_HANDOFF_WRITE_DENIAL',
              );
              need(
                probe.attemptedPermanentTableStatements === 4 &&
                  probe.rejected25006 === 4 &&
                  probe.acceptedMutationStatements === 0,
                'Native permanent-write refusal missing',
              );
            }
            for (const key of [
              'actualAcceptance',
              'runtimeAdmission',
              'hostedAccepted',
              'productActivation',
              'independentDurability',
              'authenticated',
              'targetFencing',
              'observerMutationStatements',
              'providerDispatches',
              'actualRecipientNotifications',
              'casesClosed',
              'gatesClosed',
            ])
              need(
                observation[key] === false || observation[key] === 0,
                'Forbidden observation authority/effect claim',
              );
          }
          const audit = marker(
            call(['run', '--rm', '--no-deps', 'audit']),
            'RESTORE_HANDOFF_PRESERVATION',
          );
          need(
            audit.fourEndpointParity &&
              audit.postFaultBaseline &&
              audit.readOnlyTransactions === 4 &&
              audit.verifiedTlsEndpoints === 4,
            'Post-fault preservation missing',
          );
          receipt = {
            profile,
            native: true,
            stage: 'post-replay-readonly',
            restoreExecuted: true,
            privacyReplayExecuted: true,
            maintenanceClosed: true,
            observation,
            postFaultFourEndpointParity: true,
          };
        }
        need(
          JSON.stringify(before) === JSON.stringify(identities()),
          'Owned server continuity lost',
        );
        receipts.push({
          ...receipt,
          actualAcceptance: false,
          runtimeAdmission: false,
          hostedAccepted: false,
          productActivation: false,
          independentDurability: false,
          authenticated: false,
          targetFencing: false,
          providerDispatches: 0,
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        });
        console.log('RESTORE_HANDOFF_PROFILE ' + JSON.stringify(receipts.at(-1)));
      } finally {
        const cleanupStart = Date.now();
        try {
          call(['down', '--volumes', '--remove-orphans'], { timeout: 60000 });
          cleanupAbsent(project, cleanupStart);
          knownClean = true;
        } finally {
          if (knownClean) {
            unlinkSync(envFile);
            console.log(
              'RESTORE_HANDOFF_CLEANUP ' +
                JSON.stringify({
                  profile,
                  ownedProjectRemoved: true,
                  earlierReceiptUnchanged: true,
                }),
            );
          } else {
            allClean = false;
            console.error(
              'Owned cleanup unavailable; private local custody retained and fresh attempt blocked',
            );
          }
        }
      }
    }
    need(receipts.length === 16, 'Native matrix incomplete');
    console.log(
      'RESTORE_HANDOFF_EVIDENCE ' +
        JSON.stringify({
          nativeProfiles: receipts.length,
          artifactRefusals: 3,
          actualRestoreReplayProfiles: 13,
          reusedCustodyTestExecutions: 26,
          newUniqueCustodyTests: 0,
          pureReceiptRow: 'RH17 separately in unit suite',
          allOwnedProjectsRemoved: true,
          actualAcceptance: false,
          runtimeAdmission: false,
          hostedAccepted: false,
          productActivation: false,
          independentDurability: false,
          authenticated: false,
          targetFencing: false,
          providerDispatches: 0,
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
  } finally {
    if (imageId && allClean) {
      need(
        run('docker', ['image', 'inspect', imageTag, '--format', '{{.Id}}'], {
          capture: true,
          timeout: 10000,
        }) === imageId,
        'Owned tooling image changed',
      );
      run('docker', ['image', 'rm', imageTag], { capture: true, timeout: 30000 });
      need(
        !run('docker', ['image', 'ls', '--quiet', '--filter', 'reference=' + imageTag], {
          capture: true,
          timeout: 10000,
        }),
        'Owned tooling tag remains',
      );
      console.log(
        'RESTORE_HANDOFF_TOOLING_CLEANUP ' +
          JSON.stringify({ ownedTagRemoved: true, checkedImageId: true }),
      );
    }
  }
}
await main();
