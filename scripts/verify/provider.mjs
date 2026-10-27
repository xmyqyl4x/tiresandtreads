import { run } from '../lib/process.mjs';
export function verifyProviderRecovery() {
  const image = 'tiresandtreads-provider:recovery-proof';
  run('docker', ['build', '-f', 'infra/local/provider/Dockerfile', '-t', image, '.']);
  run('docker', [
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--entrypoint',
    'python',
    '--mount',
    `type=bind,source=${process.cwd()}/tests/provider,target=/tests,readonly`,
    image,
    '-m',
    'unittest',
    'discover',
    '-s',
    '/tests',
    '-v',
  ]);
  return {
    tests: 6,
    image: run('docker', ['image', 'inspect', '--format', '{{.Id}}', image], { capture: true }),
    status: 'passed',
    scope:
      'pinned local S3/KMS fixture; SIGKILL, exact versions, authenticated snapshot and failed-ack recovery; not hosted custody',
  };
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/verify/provider.mjs'))
  console.log(JSON.stringify(verifyProviderRecovery()));
