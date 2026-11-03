import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { decodeCallbackKeys } from './callback-key-values.ts';
import { readPrivateLocalJson } from './local-files.ts';
export async function readLocalCallbackKeys(file: string | undefined) {
  if (file === undefined) return decodeCallbackKeys({ mail: [], workflow: [] });
  try {
    const raw = await readPrivateLocalJson(file);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error();
    const value = raw as Record<string, unknown>;
    if (
      Object.keys(value).sort().join(',') !== 'mail,mode,schemaVersion,workflow' ||
      value.schemaVersion !== 1 ||
      value.mode !== 'synthetic-local'
    )
      throw Error();
    return decodeCallbackKeys({ mail: value.mail, workflow: value.workflow });
  } catch {
    throw Error('Local callback keys unavailable');
  }
}
export async function issueLocalCallbackKeys(directory: string) {
  try {
    if (!isAbsolute(directory)) throw Error();
    const before = await lstat(directory);
    if (
      !before.isDirectory() ||
      before.isSymbolicLink() ||
      (process.platform !== 'win32' && (before.mode & 0o077) !== 0)
    )
      throw Error();
    const key = () => 'whsec_' + randomBytes(32).toString('base64'),
      values = decodeCallbackKeys({ mail: [key()], workflow: [key()] }),
      keyFile = join(directory, randomUUID() + '.callback-keys.json');
    await writeFile(
      keyFile,
      JSON.stringify({ schemaVersion: 1, mode: 'synthetic-local', ...values }) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    const after = await lstat(directory);
    if (
      !after.isDirectory() ||
      after.isSymbolicLink() ||
      after.dev !== before.dev ||
      after.ino !== before.ino
    )
      throw Error();
    return { mode: 'synthetic-local', keyFile };
  } catch {
    throw Error('Local callback keys unavailable');
  }
}
