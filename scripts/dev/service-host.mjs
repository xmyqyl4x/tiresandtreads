import { existsSync, writeFileSync } from 'node:fs';
import { environmentPlan } from './plan.mjs';
import { compose } from './local.mjs';

export function persistentHostPlan(target) {
  const plan = environmentPlan(target);
  if (!['dev', 'stage'].includes(plan.target)) throw Error('Use retained dev or stage');
  return { ...plan, hostPort: target === 'dev' ? 8123 : 8223 };
}
export function hostCompose(plan, args, options = {}) {
  return compose(plan, ['-f', 'infra/local/compose.service-host.yaml', ...args], {
    ...options,
    env: { ...options.env, SERVICE_HOST_PORT: String(plan.hostPort) },
  });
}
async function main() {
  const [action, target] = process.argv.slice(2);
  const plan = persistentHostPlan(target);
  if (process.argv.length !== 4 || !['prepare', 'up', 'stop', 'status', 'prove'].includes(action))
    throw Error('Usage: pnpm local:host <prepare|up|stop|status|prove> <dev|stage>');
  if (!existsSync(plan.envFile) || !existsSync(`.local/db-${target}.env`))
    throw Error('Initialize and explicitly bootstrap/migrate this database target first');
  if (action === 'prepare') {
    // Build outputs only; this command never bootstraps, migrates, resets, or seeds existing fixtures.
    compose(plan, ['--profile', 'database', 'build', 'database']);
    hostCompose(plan, ['build', 'service-host']);
    hostCompose(plan, ['--profile', 'providers', 'up', '-d', '--wait', 'postgres', 'moto']);
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
    hostCompose(plan, [
      '--profile',
      'providers',
      'up',
      '-d',
      '--wait',
      'postgres',
      'moto',
      'inngest',
    ]);
    // A read-only repeat preflight refuses lost fixture KMS/object state before host admission.
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
  } else if (action === 'stop') {
    // Moto is memory-only. Keep its container alive; preserve every named volume and object version.
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
      'Local host command failed; inspect target readiness, migration status and private fixture state. No automatic reset is performed.',
    );
    process.exitCode = 1;
  });
