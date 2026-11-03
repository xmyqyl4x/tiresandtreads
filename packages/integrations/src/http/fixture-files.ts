import { randomUUID } from 'node:crypto';
import { lstat, writeFile, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { localStaffFixture } from './local-fixtures.ts';
export async function issueLocalStaffFiles(o: {
  readonly directory: string;
  readonly staffId: string;
  readonly secret: Uint8Array;
  readonly at?: string;
}) {
  const created: string[] = [];
  try {
    if (!isAbsolute(o.directory)) throw Error();
    const before = await lstat(o.directory);
    if (
      !before.isDirectory() ||
      before.isSymbolicLink() ||
      (process.platform !== 'win32' && (before.mode & 0o077) !== 0)
    )
      throw Error();
    const sameDirectory = async () => {
      const now = await lstat(o.directory);
      return (
        now.isDirectory() &&
        !now.isSymbolicLink() &&
        now.dev === before.dev &&
        now.ino === before.ino
      );
    };
    const issued = localStaffFixture(o.secret, o.staffId, o.at),
      name = randomUUID(),
      grantsFile = join(o.directory, name + '.grants.json'),
      clientFile = join(o.directory, name + '.client.json');
    try {
      for (const [file, value] of [
        [grantsFile, { schemaVersion: 1, mode: 'synthetic-local', grants: [issued.grant] }],
        [
          clientFile,
          {
            kind: 'synthetic-local-staff-client',
            bearer: issued.bearer,
            csrf: issued.csrf,
            expiresAt: issued.grant.expiresAt,
          },
        ],
      ] as const) {
        if (!(await sameDirectory())) throw Error();
        await writeFile(file, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
        created.push(file);
      }
      if (!(await sameDirectory())) throw Error();
      return { mode: 'synthetic-local', grantsFile, clientFile, expiresAt: issued.grant.expiresAt };
    } catch (error) {
      if (await sameDirectory()) for (const file of created) await unlink(file);
      throw error;
    }
  } catch {
    throw Error('Local staff fixture unavailable');
  }
}
