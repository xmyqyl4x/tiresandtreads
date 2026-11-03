import { beforeEach, afterEach, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import {
  readLocalStaffGrants,
  registeredImportArtifact,
} from '../../packages/integrations/src/http/local-files.ts';
let directory: string;
const uuid = '11111111-1111-4111-8111-111111111111';
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tt-local-http-files-'));
});
afterEach(async () => {
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'tt-local-http-files-'))
    throw Error('Unexpected cleanup path');
  await rm(directory, { recursive: true, force: true });
});
const manifest = () => ({
  id: uuid,
  providerId: uuid,
  licenseId: uuid,
  kind: 'catalog',
  externalVersion: '1',
  checksum: createHash('sha256').update('').digest('hex'),
  effectiveAt: '2026-11-03T00:00:00.000Z',
  fetchedAt: '2026-11-03T00:00:00.000Z',
  upstreamRunKey: '1',
  schemaVersion: '1',
  mappingVersion: '1',
  semantics: 'complete_snapshot',
  expectedRows: 0,
  expectedBytes: 0,
});
async function artifact() {
  await writeFile(join(directory, uuid + '.manifest.json'), JSON.stringify(manifest()), {
    mode: 0o600,
  });
  await writeFile(join(directory, uuid + '.ndjson'), '', { mode: 0o600 });
}
it('leaves staff disabled when no private fixture grant file is configured', async () => {
  expect(await readLocalStaffGrants(undefined)).toEqual([]);
});
it('reads only the explicit bounded synthetic-local grant record shape', async () => {
  const file = join(directory, 'staff.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 1, mode: 'synthetic-local', grants: [] }), {
    mode: 0o600,
  });
  expect(await readLocalStaffGrants(file)).toEqual([]);
});
it.each([
  { schemaVersion: 1, mode: 'production', grants: [] },
  { schemaVersion: 2, mode: 'synthetic-local', grants: [] },
  { schemaVersion: 1, mode: 'synthetic-local', grants: [], extra: true },
  { schemaVersion: 1, mode: 'synthetic-local', grants: Array.from({ length: 17 }, () => ({})) },
])('refuses unsupported grant-file authority or fields', async (value) => {
  const file = join(directory, 'staff.json');
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
  await expect(readLocalStaffGrants(file)).rejects.toThrow('Local HTTP files unavailable');
});
it('refuses directories, relative paths, oversized files and malformed private JSON without disclosing their paths', async () => {
  await expect(readLocalStaffGrants(directory)).rejects.toThrow('Local HTTP files unavailable');
  await expect(readLocalStaffGrants('relative.json')).rejects.toThrow(
    'Local HTTP files unavailable',
  );
  const file = join(directory, 'staff.json');
  for (const text of ['{', ' '.repeat(16385)]) {
    await writeFile(file, text, { mode: 0o600 });
    await expect(readLocalStaffGrants(file)).rejects.toThrow('Local HTTP files unavailable');
  }
});
it.skipIf(process.platform === 'win32')(
  'refuses a readable-by-others grant file and a symlink',
  async () => {
    const file = join(directory, 'staff.json');
    await writeFile(file, '{}', { mode: 0o644 });
    await expect(readLocalStaffGrants(file)).rejects.toThrow();
    await chmod(file, 0o600);
    const alias = join(directory, 'alias.json');
    await symlink(file, alias);
    await expect(readLocalStaffGrants(alias)).rejects.toThrow();
  },
);
it('selects only a fixed registered artifact pair and checks the existing snapshot end/checksum', async () => {
  await artifact();
  const snapshot = await registeredImportArtifact(directory, uuid);
  const frames = [];
  for await (const frame of snapshot.frames()) frames.push(frame);
  expect(frames).toEqual([{ end: true }]);
});
it.each([
  '../private',
  'https://remote.invalid/a',
  'not-a-uuid',
  '00000000-0000-0000-0000-000000000000',
])('refuses an unregistered/caller-selected target %s', async (value) => {
  await expect(registeredImportArtifact(directory, value)).rejects.toThrow(
    'Local HTTP files unavailable',
  );
});
it('refuses missing artifact pairs and detects source changes before a complete frame can be accepted', async () => {
  await expect(registeredImportArtifact(directory, uuid)).rejects.toThrow();
  await artifact();
  const snapshot = await registeredImportArtifact(directory, uuid);
  await writeFile(join(directory, uuid + '.ndjson'), '{}\n');
  await expect(
    (async () => {
      for await (const frame of snapshot.frames()) void frame;
    })(),
  ).rejects.toThrow();
});
it.skipIf(process.platform === 'win32')('refuses symlinked registered artifact data', async () => {
  await writeFile(join(directory, uuid + '.manifest.json'), JSON.stringify(manifest()), {
    mode: 0o600,
  });
  const actual = join(directory, 'actual.ndjson');
  await writeFile(actual, '', { mode: 0o600 });
  await symlink(actual, join(directory, uuid + '.ndjson'));
  await expect(registeredImportArtifact(directory, uuid)).rejects.toThrow();
});
