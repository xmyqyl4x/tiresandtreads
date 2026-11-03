import { it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { issueLocalStaffFiles } from '../../packages/integrations/src/http/fixture-files.ts';
import { readLocalStaffGrants } from '../../packages/integrations/src/http/local-files.ts';
let root: string;
const staffId = '11111111-1111-4111-8111-111111111111',
  secret = new Uint8Array(32).fill(77);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tt-http-staff-'));
});
afterEach(async () => {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep + 'tt-http-staff-'))
    throw Error('Unexpected cleanup');
  await rm(root, { recursive: true, force: true });
});
it('writes separate bounded private synthetic grant/client files and returns no bearer secret', async () => {
  const result = await issueLocalStaffFiles({ directory: root, staffId, secret });
  expect(JSON.stringify(result)).not.toContain('bearer');
  const grants = await readLocalStaffGrants(result.grantsFile);
  expect(grants).toHaveLength(1);
  const client = JSON.parse(await readFile(result.clientFile, 'utf8'));
  expect(client.bearer).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(client.kind).toBe('synthetic-local-staff-client');
  expect(await readFile(result.grantsFile, 'utf8')).not.toContain(client.bearer);
  if (process.platform !== 'win32')
    for (const path of [result.grantsFile, result.clientFile])
      expect((await lstat(path)).mode & 0o077).toBe(0);
});
it('issues distinct one-hour files without overwriting a previous grant', async () => {
  const first = await issueLocalStaffFiles({ directory: root, staffId, secret }),
    second = await issueLocalStaffFiles({ directory: root, staffId, secret });
  expect(second.grantsFile).not.toBe(first.grantsFile);
  const grants = await readLocalStaffGrants(first.grantsFile);
  expect(Date.parse(grants[0]!.expiresAt) - Date.parse(grants[0]!.mfaAt)).toBe(3600000);
});
it.each(['relative', 'https://remote.invalid/', 'C:/not-existing-local-staff-fixture-root'])(
  'refuses a missing/nonabsolute fixture directory %s',
  async (directory) => {
    await expect(issueLocalStaffFiles({ directory, staffId, secret })).rejects.toThrow(
      'Local staff fixture unavailable',
    );
  },
);
