import { constants, openSync, closeSync, fstatSync, lstatSync, readSync } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { admitCurrent, HandoffRefusal, type Seal } from './contract.ts';

// Trusted fixture paths only at the actor call sites. No CLI/env path is accepted.
// This bounded reader does not authenticate a hostile mutable filesystem.
export function readBounded(file: string, limit: number, category: 'checkpoint' | 'metadata') {
  let fd: number | undefined;
  try {
    if (!path.isAbsolute(file) || !Number.isSafeInteger(limit) || limit < 1 || limit > 65536)
      throw new HandoffRefusal('file-refused');
    const resolved = path.resolve(file),
      root = path.parse(resolved).root;
    let current = root;
    for (const part of path.relative(root, resolved).split(path.sep)) {
      current = path.join(current, part);
      if (lstatSync(current).isSymbolicLink()) throw new HandoffRefusal('file-refused');
    }
    const before = lstatSync(file);
    if (!before.isFile() || before.size < 1 || before.size > limit)
      throw new HandoffRefusal('file-refused');
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = fstatSync(fd);
    if (
      !info.isFile() ||
      info.size !== before.size ||
      info.ino !== before.ino ||
      info.dev !== before.dev
    )
      throw new HandoffRefusal('file-refused');
    const bytes = Buffer.alloc(info.size + 1);
    let size = 0,
      count;
    try {
      do {
        count = readSync(fd, bytes, size, bytes.length - size, null);
        size += count;
      } while (count && size < bytes.length);
      if (size !== info.size) throw new HandoffRefusal('file-refused');
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
    } finally {
      bytes.fill(0);
    }
  } catch (error) {
    if (error instanceof HandoffRefusal) throw error;
    const code = (error as NodeJS.ErrnoException)?.code;
    throw new HandoffRefusal(
      category === 'checkpoint'
        ? code === 'ENOENT'
          ? 'checkpoint-missing'
          : code === 'EACCES'
            ? 'checkpoint-unavailable'
            : 'file-refused'
        : 'metadata-unavailable',
    );
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export const readCurrentFile = (file: string, seal: Seal, now: number) =>
  admitCurrent(readBounded(file, 16384, 'checkpoint'), seal, now);
