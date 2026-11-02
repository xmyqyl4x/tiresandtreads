import {
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  readSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

// Local repository review only. These checks do not authenticate a mutable filesystem.
export function readReviewBytes(root, relative, limit = 524288) {
  if (
    typeof relative !== 'string' ||
    relative.length > 240 ||
    !/^[a-zA-Z0-9_.@\-/]+$/.test(relative) ||
    path.isAbsolute(relative) ||
    relative.split('/').some((part) => !part || part === '.' || part === '..') ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 2_000_000
  )
    throw Error('Repository review input refused');
  const base = realpathSync(root);
  let current = base;
  for (const part of relative.split('/')) {
    if (!readdirSync(current).includes(part)) throw Error('Repository review input refused');
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw Error('Repository review input refused');
  }
  if (!lstatSync(current).isFile()) throw Error('Repository review input refused');
  const descriptor = openSync(current, 'r');
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > limit) throw Error('Repository review input refused');
    const buffer = Buffer.alloc(info.size + 1);
    let length = 0,
      count;
    do {
      count = readSync(descriptor, buffer, length, buffer.length - length, null);
      length += count;
    } while (count && length < buffer.length);
    if (length > info.size || length > limit) throw Error('Repository review input refused');
    return buffer.subarray(0, length);
  } finally {
    closeSync(descriptor);
  }
}
export function readReviewFile(root, relative, limit = 524288) {
  return new TextDecoder('utf-8', { fatal: true }).decode(readReviewBytes(root, relative, limit));
}
export function readReviewJson(root, relative) {
  return JSON.parse(readReviewFile(root, relative));
}
