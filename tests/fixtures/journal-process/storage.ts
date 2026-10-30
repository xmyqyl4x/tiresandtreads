import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  chmodSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { must, refuse, fixedRecords } from './contract.ts';
import { memoryJournal, type Checkpoint } from '../lifecycle-journal/model.ts';

export const maxBytes = 65536;
const marker = '.fixture-owner';
export function owned(root: string, runId: string) {
  must(/^[a-f0-9]{32}$/.test(runId) && resolve(root) === root);
  must(
    /^tt-journal-process-[A-Za-z0-9]{6}$/.test(basename(root)) &&
      realpathSync(dirname(root)) === realpathSync(tmpdir()),
  );
  const info = lstatSync(root);
  must(info.isDirectory() && !info.isSymbolicLink() && realpathSync(root) === root);
  const fd = openSync(
    join(root, marker),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const meta = fstatSync(fd),
      bytes = Buffer.alloc(33);
    must(meta.isFile() && meta.nlink === 1 && meta.size === 32);
    must(readSync(fd, bytes, 0, 33, 0) === 32 && bytes.subarray(0, 32).toString('ascii') === runId);
  } finally {
    closeSync(fd);
  }
}
export function readBytes(root: string, runId: string) {
  try {
    owned(root, runId);
    let fd: number;
    try {
      fd = openSync(
        join(root, 'journal.ndjson'),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.alloc(0);
      throw error;
    }
    try {
      const before = fstatSync(fd);
      must(before.isFile() && before.nlink === 1 && before.size <= maxBytes);
      const bytes = Buffer.alloc(maxBytes + 1),
        length = readSync(fd, bytes, 0, maxBytes + 1, 0),
        after = fstatSync(fd);
      must(
        length <= maxBytes &&
          length === before.size &&
          before.size === after.size &&
          before.ino === after.ino &&
          before.mtimeMs === after.mtimeMs &&
          before.ctimeMs === after.ctimeMs,
      );
      return bytes.subarray(0, length);
    } finally {
      closeSync(fd);
    }
  } catch {
    return refuse();
  }
}
export function inspectJournal(root: string, runId: string, checkpoint: Checkpoint) {
  try {
    const bytes = readBytes(root, runId),
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    must(text === '' || text.endsWith('\n'));
    const lines = text === '' ? [] : text.slice(0, -1).split('\n');
    must(lines.length <= 9 && lines.every((line, n) => line === fixedRecords[n]));
    return { bytes, journal: memoryJournal(lines, checkpoint) };
  } catch {
    return refuse();
  }
}
export function openJournal(root: string, runId: string) {
  try {
    owned(root, runId);
    return openSync(
      join(root, 'journal.ndjson'),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    return refuse();
  }
}
export function writeChunk(fd: number, bytes: Buffer) {
  must(fstatSync(fd).size + bytes.length <= maxBytes);
  for (let offset = 0; offset < bytes.length;) {
    const n = writeSync(fd, bytes, offset, bytes.length - offset);
    must(n > 0);
    offset += n;
  }
}
export function temporaryJournal() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'tt-journal-process-')),
    runId = randomBytes(16).toString('hex');
  chmodSync(root, 0o700);
  writeFileSync(join(root, marker), runId, { flag: 'wx', mode: 0o600 });
  return Object.freeze({
    root,
    runId,
    bytes: () => readBytes(root, runId),
    cleanup() {
      try {
        owned(root, runId);
        rmSync(root, { recursive: true });
      } catch {
        return refuse();
      }
    },
  });
}
