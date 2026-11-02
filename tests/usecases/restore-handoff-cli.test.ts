import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
function localFiles() {
  try {
    return readdirSync('.local').sort();
  } catch {
    return [];
  }
}
function command(args: string[], host = '') {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !['PATH', 'DOCKER_HOST', 'DOCKER_CONTEXT'].includes(key.toUpperCase()),
    ),
  );
  return spawnSync(process.execPath, ['tests/fixtures/restore-handoff/run.mjs', ...args], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 65536,
    env: { ...env, NODE_ENV: process.env.NODE_ENV, PATH: '', DOCKER_HOST: host },
  });
}
it('refuses caller target, SQL and output flags before Docker discovery or local setup', () => {
  const before = localFiles();
  for (const arg of [
    '--target=SYNTHETIC_SECRET',
    '--sql=SYNTHETIC_SECRET',
    '--output=SYNTHETIC_SECRET',
  ]) {
    const r = command([arg]);
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Restore handoff takes no arguments');
    expect(r.stderr).not.toContain('SYNTHETIC_SECRET');
  }
  expect(localFiles()).toEqual(before);
});
it('refuses a remote Docker host without trying to discover Docker or exposing the host', () => {
  const before = localFiles(),
    r = command([], 'tcp://SYNTHETIC_SECRET.invalid:2376');
  expect(r.error).toBeUndefined();
  expect(r.status).toBe(1);
  expect(r.stdout).toBe('');
  expect(r.stderr).toContain('Local Docker required');
  expect(r.stderr).not.toContain('SYNTHETIC_SECRET');
  expect(localFiles()).toEqual(before);
});
it('stops before creating fixture resources when local Docker discovery cannot execute', () => {
  const before = localFiles(),
    r = command([]);
  expect(r.error).toBeUndefined();
  expect(r.status).toBe(1);
  expect(r.stdout).toBe('');
  expect(r.stderr).toContain('Cannot execute docker');
  expect(localFiles()).toEqual(before);
});
