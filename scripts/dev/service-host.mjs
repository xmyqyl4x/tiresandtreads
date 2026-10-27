import { existsSync, writeFileSync, readFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { environmentPlan } from './plan.mjs';
import { compose } from './local.mjs';

export function persistentHostPlan(target) {
  const plan = environmentPlan(target);
  if (!['dev', 'stage'].includes(plan.target)) throw Error('Use retained dev or stage');
  return { ...plan, hostPort: target === 'dev' ? 8123 : 8223 };
}
export function hostCompose(plan, args, options = {}) {
  const files = ['-f', 'infra/local/compose.service-host.yaml'];
  if (durableProvider(plan)) files.push('-f', 'infra/local/compose.provider-durable.yaml');
  return compose(plan, [...files, ...args], {
    ...options,
    env: { ...options.env, SERVICE_HOST_PORT: String(plan.hostPort) },
  });
}
function durableProvider(plan) {
  const file = `.local/provider-${plan.target}.durable`;
  if (!existsSync(file)) return false;
  if (readFileSync(file, 'utf8') !== 'retained-fixture-provider-v2\n')
    throw Error('Invalid provider selection');
  return true;
}
async function startHost(plan) {
  hostCompose(plan, [
    '--profile',
    'providers',
    'up',
    '-d',
    '--wait',
    'postgres',
    durableProvider(plan) ? 'moto-durable' : 'moto',
    'inngest',
  ]);
  hostCompose(plan, [
    'run',
    '--rm',
    '--no-deps',
    'service-setup',
    'pnpm',
    'exec',
    'tsx',
    'scripts/runtime/prepare-local-host.ts',
    'check',
  ]);
  hostCompose(plan, ['up', '-d', '--wait', 'service-host']);
  const r = await fetch(`http://127.0.0.1:${plan.hostPort}/internal/inngest`, {
    method: 'PUT',
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error('Local workflow registration unavailable');
  console.log(`${plan.project}: private host ready; local workflow functions registered`);
}
async function main() {
  const [action, target] = process.argv.slice(2);
  const plan = persistentHostPlan(target);
  if (
    (action === 'observe' ? ![5, 6].includes(process.argv.length) : process.argv.length !== 4) ||
    ![
      'prepare',
      'up',
      'stop',
      'status',
      'prove',
      'provider-upgrade',
      'cold-restart',
      'observe',
      'prove-observability',
    ].includes(action)
  )
    throw Error(
      'Usage: pnpm local:host <prepare|up|stop|status|prove|provider-upgrade|cold-restart|prove-observability> <dev|stage>; observe <dev|stage> <staff UUID> [samples 1..12]',
    );
  if (!existsSync(plan.envFile) || !existsSync(`.local/db-${target}.env`))
    throw Error('Initialize and explicitly bootstrap/migrate this database target first');
  if (action === 'observe' || action === 'prove-observability') {
    const lock = `.local/observer-${target}.lock`;
    const handle = openSync(lock, 'wx', 0o600);
    try {
      hostCompose(plan, [
        'run',
        '--rm',
        '--no-deps',
        'service-setup',
        'pnpm',
        'exec',
        'tsx',
        action === 'observe'
          ? 'scripts/runtime/observe-local-host.ts'
          : 'scripts/runtime/prove-local-observability.ts',
        ...process.argv.slice(4),
      ]);
    } finally {
      closeSync(handle);
      unlinkSync(lock);
    }
  } else if (action === 'prepare') {
    // Build outputs only; this command never bootstraps, migrates, resets, or seeds existing fixtures.
    compose(plan, ['--profile', 'database', 'build', 'database']);
    hostCompose(plan, ['build', 'service-host']);
    hostCompose(plan, [
      '--profile',
      'providers',
      'up',
      '-d',
      '--wait',
      'postgres',
      durableProvider(plan) ? 'moto-durable' : 'moto',
    ]);
    compose(plan, [
      'run',
      '--rm',
      '--no-deps',
      'database',
      'pnpm',
      'exec',
      'tsx',
      'scripts/database/cli.ts',
      'status',
    ]);
    hostCompose(plan, ['run', '--rm', '--no-deps', 'service-setup']);
    const marker = `.local/host-${target}.prepared`;
    if (!existsSync(marker))
      writeFileSync(marker, 'retained-local-host-v1\n', { flag: 'wx', mode: 0o600 });
  } else if (action === 'up') {
    await startHost(plan);
  } else if (action === 'provider-upgrade') {
    hostCompose(plan, ['stop', 'service-host', 'inngest']);
    compose(plan, ['--profile', 'database', 'build', 'database']);
    hostCompose(plan, ['build', 'moto-durable', 'service-host']);
    hostCompose(plan, ['up', '-d', '--wait', 'moto-durable']);
    hostCompose(plan, [
      'run',
      '--rm',
      '--no-deps',
      'service-setup',
      'pnpm',
      'exec',
      'tsx',
      'scripts/runtime/upgrade-local-provider.ts',
    ]);
    const marker = `.local/provider-${target}.durable`;
    if (!existsSync(marker))
      writeFileSync(marker, 'retained-fixture-provider-v2\n', { flag: 'wx', mode: 0o600 });
    await startHost(plan);
  } else if (action === 'cold-restart') {
    if (!durableProvider(plan))
      throw Error('Explicit fixture-only provider upgrade required first');
    hostCompose(plan, ['stop', 'service-host', 'inngest']);
    hostCompose(plan, ['kill', '-s', 'SIGKILL', 'moto-durable']);
    hostCompose(plan, ['up', '-d', '--force-recreate', '--wait', 'moto-durable']);
    await startHost(plan);
  } else if (action === 'stop') {
    // Preserve both fixture generations and every named volume during a normal host stop.
    hostCompose(plan, ['stop', 'service-host', 'inngest']);
    console.log(
      `${plan.project}: host/workflows stopped; database, fixture provider and volumes retained`,
    );
  } else if (action === 'status') {
    hostCompose(plan, ['ps']);
  } else {
    hostCompose(plan, [
      'run',
      '--rm',
      '--no-deps',
      'service-setup',
      'pnpm',
      'exec',
      'tsx',
      'scripts/runtime/prove-local-host.ts',
    ]);
  }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/dev/service-host.mjs'))
  main().catch(() => {
    console.error(
      process.argv[2] === 'observe'
        ? 'Local observer did not complete healthy; inspect masked output and local configuration.'
        : 'Local host command failed; inspect target readiness, migration status and private fixture state. No automatic reset is performed.',
    );
    process.exitCode = 1;
  });
