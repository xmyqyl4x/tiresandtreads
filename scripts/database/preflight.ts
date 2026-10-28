import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { preflightLocalDatabase } from '../../packages/db/src/database-preflight.ts';
import { readLocalDatabasePreflight } from '../../packages/config/src/database-preflight.ts';
import { loadSources } from './manifest.ts';
import versions from '../../infra/local/versions.json' with { type: 'json' };

try {
  const file = process.argv[2];
  if (process.argv.length !== 3 || !file || !isAbsolute(file)) throw Error();
  const stat = await lstat(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 131072 ||
    (process.platform !== 'win32' && stat.mode & 0o077)
  )
    throw Error();
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let raw: string;
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.size > 131072 ||
      opened.dev !== stat.dev ||
      opened.ino !== stat.ino ||
      (process.platform !== 'win32' && opened.mode & 0o077)
    )
      throw Error();
    raw = await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
  if (Buffer.byteLength(raw) > 131072) throw Error();
  const input: unknown = JSON.parse(raw);
  const settings = readLocalDatabasePreflight(input, process.env);
  const history = loadSources(settings.target).map(({ id, sha256 }) => ({ id, sha256 }));
  const [major, minor] = versions.postgres.split('.').map(Number);
  if (
    !major ||
    minor === undefined ||
    settings.expectedVersion !== major * 10000 + minor ||
    JSON.stringify(settings.expectedHistory) !== JSON.stringify(history)
  )
    throw Error();
  const report = await preflightLocalDatabase(input, process.env);
  console.log(JSON.stringify(report));
  process.exitCode = report.compatible ? 0 : report.status === 'incompatible' ? 2 : 1;
} catch {
  console.error('Local database preflight refused; no remote authority or acceptance granted');
  process.exitCode = 1;
}
