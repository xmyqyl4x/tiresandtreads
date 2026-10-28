import { constants, openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { createPrivacyCrypto } from '../../../packages/integrations/src/privacy-crypto.ts';
import { context } from './context.ts';
export const custodySubject = '88888888-8888-4888-8888-000000000095';
export function custodyContext() {
  if (process.env.APP_ENV !== 'test-local' || process.env.PROVIDER_MODE !== 'fixtures')
    throw Error('Local custody boundary refused');
  return context('postgres');
}
// Fixed local paths only; reject symlinks, devices, oversized inputs and unsafe permissions before parsing.
export function privateRead(path: string, max: number) {
  if (!/^\/custody-(keys|backup|journal)\/[a-z-]+\.json$/.test(path))
    throw Error('Local custody path refused');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > max || stat.mode & 0o077)
      throw Error('Local custody file refused');
    const bytes = Buffer.alloc(stat.size + 1);
    let count = 0,
      size = 0;
    do {
      count = readSync(fd, bytes, size, bytes.length - size, null);
      size += count;
    } while (count && size < bytes.length);
    if (size !== stat.size) throw Error('Local custody file refused');
    try {
      return JSON.parse(bytes.subarray(0, size).toString());
    } finally {
      bytes.fill(0);
    }
  } finally {
    closeSync(fd);
  }
}
export function custodyKeys() {
  custodyContext();
  const raw = privateRead('/custody-keys/versions.json', 8192) as Record<string, string>;
  if (
    Object.keys(raw).sort().join(',') !== 'backup-new,backup-old,lookup,privacy-new,privacy-old' ||
    Object.values(raw).some((v) => !/^[a-f0-9]{64}$/.test(v))
  )
    throw Error('Local custody keys refused');
  const key = (name: string) => Buffer.from(raw[name]!, 'hex');
  return {
    keys: { 'backup-old': key('backup-old'), 'backup-new': key('backup-new') },
    privacy: { old: key('privacy-old'), current: key('privacy-new') },
    lookup: key('lookup'),
  };
}
export function custodyCrypto() {
  return createPrivacyCrypto('current', custodyKeys().privacy);
}
