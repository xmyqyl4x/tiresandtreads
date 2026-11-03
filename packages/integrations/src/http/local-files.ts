import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { id } from '../../../domain/src/values/core.ts';
import { openImportSnapshot } from '../import-files.ts';
import { decodeLocalStaffGrants } from './staff-security.ts';
const unavailable = () => Error('Local HTTP files unavailable');
export async function readPrivateLocalJson(file: string) {
  if (!isAbsolute(file)) throw unavailable();
  const before = await lstat(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > 16384 ||
    (process.platform !== 'win32' && (before.mode & 0o077) !== 0)
  )
    throw unavailable();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size > 16384
    )
      throw unavailable();
    const bytes = Buffer.alloc(16385);
    let total = 0;
    while (total < bytes.length) {
      const part = await handle.read(bytes, total, bytes.length - total, total);
      if (part.bytesRead === 0) break;
      total += part.bytesRead;
    }
    const read = { bytesRead: total },
      after = await handle.stat();
    if (
      read.bytesRead !== opened.size ||
      read.bytesRead > 16384 ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    )
      throw unavailable();
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, read.bytesRead)),
    ) as unknown;
  } finally {
    await handle.close();
  }
}
export async function readLocalStaffGrants(file: string | undefined) {
  if (file === undefined) return [];
  try {
    const raw = await readPrivateLocalJson(file);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw unavailable();
    const value = raw as Record<string, unknown>;
    if (
      Object.keys(value).sort().join(',') !== 'grants,mode,schemaVersion' ||
      value.schemaVersion !== 1 ||
      value.mode !== 'synthetic-local'
    )
      throw unavailable();
    return decodeLocalStaffGrants(value.grants);
  } catch {
    throw unavailable();
  }
}
export async function registeredImportArtifact(directory: string, artifact: string) {
  try {
    const identifier = id('artifact', artifact);
    if (!identifier.ok || !isAbsolute(directory)) throw unavailable();
    const root = await lstat(directory);
    if (
      !root.isDirectory() ||
      root.isSymbolicLink() ||
      (process.platform !== 'win32' && (root.mode & 0o077) !== 0)
    )
      throw unavailable();
    const manifest = join(directory, identifier.value + '.manifest.json'),
      data = join(directory, identifier.value + '.ndjson');
    const value = await readPrivateLocalJson(manifest),
      file = await lstat(data);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      file.size > 20 * 1024 * 1024 ||
      (process.platform !== 'win32' && (file.mode & 0o077) !== 0)
    )
      throw unavailable();
    const snapshot = await openImportSnapshot(manifest, data);
    if (JSON.stringify(snapshot.registration) !== JSON.stringify(value)) throw unavailable();
    return snapshot;
  } catch {
    throw unavailable();
  }
}
