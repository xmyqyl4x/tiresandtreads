import { it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readLocalCallbackKeys } from '../../packages/integrations/src/http/callback-keys.ts';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tt-callback-cli-'));
});
afterEach(async () => {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep + 'tt-callback-cli-'))
    throw Error('Unexpected cleanup');
  await rm(root, { recursive: true, force: true });
});
function run(overrides: Record<string, string | undefined>) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/runtime/local-callback-keys.ts', root],
    {
      env: {
        ...process.env,
        LOCAL_PRODUCT_API: 'enabled',
        APP_ENV: 'test-local',
        PROVIDER_MODE: 'fixtures',
        ...overrides,
      },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
}
it.each([{ APP_ENV: 'production' }, { PROVIDER_MODE: 'live' }, { LOCAL_PRODUCT_API: undefined }])(
  'refuses non-fixture/local CLI activation before writing a key file',
  async (env) => {
    const child = run(env);
    expect(child.status).toBe(1);
    expect(child.stdout).toBe('');
    expect(child.stderr).toContain('Synthetic local callback keys refused');
    expect(await readdir(root)).toEqual([]);
  },
);
it('prints only the private file location and mode for the explicit synthetic local issuer', async () => {
  const child = run({});
  expect(child.status).toBe(0);
  expect(child.stdout).not.toContain('whsec_');
  const result = JSON.parse(child.stdout);
  expect(result.mode).toBe('synthetic-local');
  expect((await readLocalCallbackKeys(result.keyFile)).mail).toHaveLength(1);
});
