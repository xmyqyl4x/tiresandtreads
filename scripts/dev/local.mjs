import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, statfsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { environmentPlan, composeArguments, validateEnvironmentFile } from './plan.mjs';
import { run } from '../lib/process.mjs';

export function initialize(plan) {
  mkdirSync('.local', { recursive: true });
  if (!existsSync(plan.envFile)) {
    const values = {
      LOCAL_ENV: plan.target,
      COMPOSE_PROJECT_NAME: plan.project,
      APP_ENV: plan.appEnv,
      APP_PORT: plan.appPort,
      DATABASE_PORT: plan.databasePort,
      POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
    };
    writeFileSync(
      plan.envFile,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
}

export function compose(plan, args, options = {}) {
  const localValues = validateEnvironmentFile(plan, readFileSync(plan.envFile, 'utf8'));
  // Explicit project values override inherited shell variables and Compose interpolation.
  return run('docker', composeArguments(plan, args), {
    ...options,
    env: { ...options.env, ...localValues },
  });
}

async function portStatus(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve({ port, available: false }));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve({ port, available: true })));
  });
}

async function main() {
  const [command, target = 'dev', flag] = process.argv.slice(2);
  if (command === 'doctor') {
    const disk = statfsSync('.');
    console.log(
      JSON.stringify(
        {
          hostNode: process.version,
          preferredNode: '24.22.1',
          docker: run('docker', ['version', '--format', '{{.Server.Version}}'], { capture: true }),
          compose: run('docker', ['compose', 'version', '--short'], { capture: true }),
          engine: run(
            'docker',
            ['info', '--format', '{{.OSType}} / CPUs={{.NCPU}} / memory={{.MemTotal}}'],
            { capture: true },
          ),
          freeDiskGiB: Math.round((Number(disk.bavail) * Number(disk.bsize)) / 2 ** 30),
          ports: await Promise.all([3100, 3200, 55432, 55433].map(portStatus)),
          targets: ['tt-dev', 'tt-stage', 'unique tt-test-*'],
          nativePostgres: 'not used or modified',
        },
        null,
        2,
      ),
    );
    return;
  }
  const plan = environmentPlan(target);
  if (!['init', 'up', 'down', 'status', 'logs'].includes(command))
    throw new Error('Usage: pnpm local <init|up|down|status|logs> <dev|stage> [--dry-run]');
  if (flag && flag !== '--dry-run') throw new Error('Unknown argument');
  if (flag === '--dry-run') {
    console.log(
      JSON.stringify(
        {
          project: plan.project,
          envFile: plan.envFile,
          appPort: plan.appPort,
          databasePort: plan.databasePort,
          appEnv: plan.appEnv,
          command,
          volumes: 'project-scoped; down preserves them',
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'init' || command === 'up') initialize(plan);
  if (!existsSync(plan.envFile)) throw new Error('Run local init for this target first');
  if (command === 'init') {
    console.log(`Initialized ${plan.project}; generated values remain in ignored ${plan.envFile}`);
    return;
  }
  if (command === 'down' && existsSync(`.local/host-${target}.prepared`))
    throw Error(
      'This target has retained host/provider state; use pnpm local:host stop to preserve the memory-only fixture provider',
    );
  const args = {
    up: ['up', '--build', '--detach', '--wait', '--wait-timeout', '120'],
    down: ['down', '--remove-orphans'],
    status: ['ps'],
    logs: ['logs', '--tail', '80'],
  }[command];
  compose(plan, args);
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/dev/local.mjs')) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
