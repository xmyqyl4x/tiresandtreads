import { open, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type {
  PrivacyCrypto,
  PrivacyJournal,
  SignedPrivacyRecord,
} from '../../application/src/ports/privacy-services.ts';
import { canonical } from '../../application/src/services/service-records.ts';
// Mount this directory on a separate durable encrypted volume with restricted ACLs. A path
// inside the database's backup/restore volume cannot satisfy the journal contract.
export function createFilePrivacyJournal(
  directory: string,
  crypto: PrivacyCrypto,
): PrivacyJournal & {
  capture(now: string): Promise<SignedPrivacyRecord>;
} {
  if (!isAbsolute(directory)) throw Error('Absolute privacy journal directory required');
  return {
    async append(key, record) {
      if (!/^[a-f0-9]{64}$/.test(key) || !crypto.verify(record))
        throw Error('Invalid privacy journal record');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, key + '.json'),
        contents = canonical(record, 2097152);
      let handle;
      try {
        handle = await open(path, 'wx', 0o600);
      } catch (e) {
        if (!e || typeof e !== 'object' || !('code' in e) || e.code !== 'EEXIST') throw e;
        if (canonical(JSON.parse(await readFile(path, 'utf8')), 2097152) !== contents)
          throw Error('Conflicting privacy journal record', { cause: e });
        return;
      }
      try {
        await handle.writeFile(contents, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Directory fsync is supported on POSIX. Windows filesystem durability must be
      // supplied by the encrypted volume; an unsupported directory fsync is not emulated.
      if (process.platform !== 'win32') {
        const dir = await open(directory, 'r');
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      }
    },
    async capture(now) {
      const files = (await readdir(directory)).filter((x) => /^[a-f0-9]{64}\.json$/.test(x)).sort();
      if (files.length > 1000)
        throw Error('Privacy journal snapshot capacity requires paged storage');
      const entries: unknown[] = [];
      for (const file of files) {
        if ((await stat(join(directory, file))).size > 2097152)
          throw Error('Invalid privacy journal size');
        const bytes = await readFile(join(directory, file));
        if (bytes.length > 2097152) throw Error('Invalid privacy journal size');
        const document = crypto.verify(JSON.parse(bytes.toString('utf8')));
        if (!document) throw Error('Invalid privacy journal signature');
        entries.push(document);
      }
      return crypto.sign({ version: 1, capturedAt: now, entries });
    },
  };
}
