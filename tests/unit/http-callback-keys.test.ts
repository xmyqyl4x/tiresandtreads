import { it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { decodeCallbackKeys } from '../../packages/integrations/src/http/callback-key-values.ts';
import {
  readLocalCallbackKeys,
  issueLocalCallbackKeys,
} from '../../packages/integrations/src/http/callback-keys.ts';
const mail = 'whsec_' + Buffer.alloc(32, 31).toString('base64'),
  workflow = 'whsec_' + Buffer.alloc(32, 32).toString('base64');
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tt-http-callback-'));
});
afterEach(async () => {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep + 'tt-http-callback-'))
    throw Error('Unexpected cleanup');
  await rm(root, { recursive: true, force: true });
});
it('copies and freezes separate bounded signing authorities', () => {
  const raw = { mail: [mail], workflow: [workflow] },
    keys = decodeCallbackKeys(raw);
  raw.mail.push(workflow);
  expect(keys.mail).toEqual([mail]);
  expect(Object.isFrozen(keys)).toBe(true);
  expect(Object.isFrozen(keys.mail)).toBe(true);
});
it.each([
  { mail: [mail], workflow: [mail] },
  { mail: [mail, mail], workflow: [] },
  { mail: Array.from({ length: 5 }, () => mail), workflow: [] },
  { mail: ['whsec_invalid'], workflow: [] },
  { mail: ['whsec_' + Buffer.alloc(8).toString('base64')], workflow: [] },
  { mail: [mail], workflow: [], operator: 'caller' },
])('refuses invalid, duplicate, unbounded or shared-purpose keys', (raw) => {
  expect(() => decodeCallbackKeys(raw)).toThrow('Invalid local callback keys');
});
it('keeps both callback authorities disabled without an explicit private file', async () => {
  expect(await readLocalCallbackKeys(undefined)).toEqual({ mail: [], workflow: [] });
});
it('writes distinct private synthetic keys without returning their values or replacing an existing file', async () => {
  const first = await issueLocalCallbackKeys(root),
    second = await issueLocalCallbackKeys(root);
  expect(first.keyFile).not.toBe(second.keyFile);
  expect(JSON.stringify(first)).not.toContain('whsec_');
  const keys = await readLocalCallbackKeys(first.keyFile);
  expect(keys.mail).toHaveLength(1);
  expect(keys.workflow).toHaveLength(1);
  expect(keys.mail[0]).not.toBe(keys.workflow[0]);
  const stored = JSON.parse(await readFile(first.keyFile, 'utf8'));
  expect(stored.mode).toBe('synthetic-local');
});
it.each([
  { schemaVersion: 1, mode: 'production', mail: [mail], workflow: [workflow] },
  { schemaVersion: 2, mode: 'synthetic-local', mail: [mail], workflow: [workflow] },
  { schemaVersion: 1, mode: 'synthetic-local', mail: [mail], workflow: [workflow], extra: true },
])('refuses another file mode/version/authority', async (value) => {
  const file = join(root, 'keys.json');
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
  await expect(readLocalCallbackKeys(file)).rejects.toThrow('Local callback keys unavailable');
});
it('masks missing, oversized and malformed key files without including their paths', async () => {
  await expect(readLocalCallbackKeys(join(root, 'missing.json'))).rejects.toThrow(
    'Local callback keys unavailable',
  );
  const file = join(root, 'keys.json');
  for (const value of ['{', ' '.repeat(16385)]) {
    await writeFile(file, value, { mode: 0o600 });
    await expect(readLocalCallbackKeys(file)).rejects.toThrow('Local callback keys unavailable');
  }
});
it.skipIf(process.platform === 'win32')(
  'refuses keys readable by other users and a non-private issuer directory',
  async () => {
    const issued = await issueLocalCallbackKeys(root);
    await chmod(issued.keyFile, 0o644);
    await expect(readLocalCallbackKeys(issued.keyFile)).rejects.toThrow();
    await chmod(root, 0o755);
    await expect(issueLocalCallbackKeys(root)).rejects.toThrow('Local callback keys unavailable');
  },
);
