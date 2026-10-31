import { randomBytes } from 'node:crypto';
import { run } from '../../../scripts/lib/process.mjs';

if (process.argv.length !== 2) throw Error('Dependency proof accepts no arguments');
if (process.env.DOCKER_HOST && !/^(unix:\/\/|npipe:\/\/)/.test(process.env.DOCKER_HOST))
  throw Error('Local Docker required');
const endpoint = JSON.parse(
  run('docker', ['context', 'inspect'], { capture: true, timeout: 10000 }),
)[0]?.Endpoints?.docker?.Host;
if (typeof endpoint !== 'string' || !/^(unix:\/\/|npipe:\/\/)/.test(endpoint))
  throw Error('Local Docker required');
const token = randomBytes(8).toString('hex');
const image = 'tiresandtreads-tooling:tt-test-' + token;
const imageIds = () =>
  run('docker', ['image', 'ls', '--quiet', '--filter', 'reference=' + image], {
    capture: true,
    timeout: 10000,
  });
if (imageIds()) throw Error('Occupied proof image');
let imageId;
const actors = (name) =>
  run('docker', ['ps', '--all', '--quiet', '--no-trunc', '--filter', 'name=^/' + name + '$'], {
    capture: true,
    timeout: 10000,
  });
function removeActor(name, purpose) {
  const id = actors(name);
  let forced = false;
  if (id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Unexpected actor identities');
    const actor = JSON.parse(run('docker', ['inspect', id], { capture: true, timeout: 10000 }))[0];
    if (
      actor.Id !== id ||
      actor.Name !== '/' + name ||
      actor.Image !== imageId ||
      actor.Config.Labels['com.tiresandtreads.dependency-proof'] !== token
    )
      throw Error('Foreign actor refused');
    run('docker', ['rm', '--force', id], { capture: true, timeout: 10000 });
    forced = true;
  }
  if (actors(name)) throw Error('Owned actor cleanup incomplete');
  console.log(
    'DEPENDENCY_ACTOR_CLEANUP ' +
      JSON.stringify({ purpose, verifiedAbsent: true, forcedOwnedRemoval: forced }),
  );
}
function owned(purpose, args, options) {
  const name = 'tt-test-' + token + '-' + purpose;
  if (actors(name)) throw Error('Occupied proof actor');
  try {
    return run(
      'docker',
      [
        'run',
        '--rm',
        '--name',
        name,
        '--label',
        'com.tiresandtreads.dependency-proof=' + token,
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        ...args,
      ],
      options,
    );
  } finally {
    removeActor(name, purpose);
  }
}
function audit(level) {
  // Registry lookup is the only actor with network. Internal child timeout is
  // shorter than the parent's CLI timeout, and the parent also checks owned cleanup.
  const raw = owned(
    'audit-' + level,
    [
      '--memory',
      '512m',
      '--cpus',
      '2',
      image,
      'node',
      '-e',
      "const{spawnSync}=require('node:child_process');const r=spawnSync('pnpm',['audit','--json','--audit-level',process.argv[1]],{encoding:'utf8',timeout:45000,maxBuffer:1000000});if(r.error||![0,1].includes(r.status))process.exit(2);const v=JSON.parse(r.stdout);console.log(JSON.stringify({exit:r.status,...v}));",
      level,
    ],
    { capture: true, timeout: 60000 },
  );
  if (Buffer.byteLength(raw) > 1_000_000) throw Error('Oversized audit response');
  return JSON.parse(raw);
}
function removeImage() {
  if (imageIds()) {
    const actual = run('docker', ['image', 'inspect', '--format', '{{.Id}}', image], {
      capture: true,
      timeout: 10000,
    });
    if (!imageId || actual !== imageId) throw Error('Foreign image refused');
    run('docker', ['image', 'rm', image], { capture: true, timeout: 30000 });
  }
  if (imageIds()) throw Error('Owned image cleanup incomplete');
  console.log(
    'DEPENDENCY_CLEANUP_EVIDENCE ' +
      JSON.stringify({
        ownedImageAbsent: true,
        imageCreated: Boolean(imageId),
        retainedResourcesChanged: false,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}
try {
  run('docker', ['build', '--target', 'tooling', '-t', image, '.'], { timeout: 600000 });
  imageId = run('docker', ['image', 'inspect', '--format', '{{.Id}}', image], {
    capture: true,
    timeout: 10000,
  });
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw Error('Owned image identity unavailable');
  const high = audit('high'),
    observed = audit('low');
  if (
    high.exit !== 0 ||
    high.metadata.vulnerabilities.high ||
    high.metadata.vulnerabilities.critical
  )
    throw Error('High-severity audit gate failed');
  const advisories = Object.values(observed.advisories ?? {}).map((a) => ({
    name: a.module_name,
    severity: a.severity,
    url: a.url,
    patched: a.patched_versions,
  }));
  if (
    advisories.some(
      (a) => a.url.endsWith('GHSA-g3hv-75wg-m249') || a.url.endsWith('GHSA-3g3m-2fjr-6pw4'),
    )
  )
    throw Error('Targeted advisories remain');
  console.log(
    'DEPENDENCY_AUDIT_EVIDENCE ' +
      JSON.stringify({
        highAuditExit: high.exit,
        allSeverityAuditExit: observed.exit,
        vulnerabilities: observed.metadata.vulnerabilities,
        advisories,
        auditIgnored: false,
        auditThresholdChanged: false,
        upstreamDeepmergeFixClaimed: false,
        productActivation: false,
      }),
  );
  owned(
    'contracts',
    [
      '--network',
      'none',
      '--memory',
      '1024m',
      '--cpus',
      '2',
      ...[
        '/tmp:rw,noexec,nosuid,size=64m',
        '/workspace/node_modules/.vite-temp:rw,size=32m',
        '/workspace/node_modules/.vite:rw,size=16m',
        '/workspace/node_modules/.vitest:rw,size=1m',
        '/workspace/node_modules/.vitest-cache:rw,size=64m',
      ].flatMap((x) => ['--tmpfs', x]),
      image,
      'pnpm',
      'exec',
      'vitest',
      'run',
      '--project',
      'unit',
      '--maxWorkers',
      '1',
      'tests/unit/dependency-compatibility.test.ts',
    ],
    { timeout: 120000 },
  );
} finally {
  removeImage();
}
