import { spawnSync } from 'node:child_process';

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    ...options,
    env: { ...process.env, ...options.env },
  });
  if (result.error) throw new Error(`Cannot execute ${command}: ${result.error.code}`);
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
  return result.stdout?.trim() ?? '';
}

export function pnpm(args, options = {}) {
  const cli = process.env.npm_execpath;
  if (!cli || !/pnpm/i.test(cli))
    throw new Error('Run this command through the pinned pnpm package script');
  return run(process.execPath, [cli, ...args], options);
}
