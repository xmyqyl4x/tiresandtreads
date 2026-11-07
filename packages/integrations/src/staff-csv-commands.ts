import { constants } from 'node:fs';
import { lstat, realpath, open } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import type { createStaffCsvServices } from '../../application/src/imports/staff-csv.ts';
// Explicit local adapter over the same application services. The host must choose a managed
// directory; no default CLI registration, remote fetch, arbitrary handler or program execution.
export async function runStaffCsvCommand(
  args: readonly string[],
  service: ReturnType<typeof createStaffCsvServices>,
  directory: string,
) {
  if (!isAbsolute(directory)) throw Error('Absolute managed import directory required');
  const [command, ...rest] = args,
    allowed = [
      'template',
      'schema',
      'retire',
      'upload',
      'validate',
      'preview',
      'review',
      'publish',
      'cancel',
      'errors',
    ];
  if (!command || !allowed.includes(command) || rest.length !== (command === 'upload' ? 4 : 2))
    throw Error('Invalid CSV command');
  const options: Record<string, string> = {};
  for (let n = 0; n < rest.length; n += 2) {
    const key = rest[n],
      v = rest[n + 1];
    if (
      !['--plan', ...(command === 'upload' ? ['--file'] : [])].includes(key!) ||
      !v ||
      Object.hasOwn(options, key!)
    )
      throw Error('Invalid CSV options');
    options[key!] = v;
  }
  const root = await realpath(directory);
  async function read(name: string | undefined, max: number) {
    if (!name || isAbsolute(name) || name.includes('\0')) throw Error('Managed CSV file required');
    const file = await realpath(resolve(root, name)),
      inside = relative(root, file);
    if (
      !inside ||
      inside === '..' ||
      inside.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) ||
      isAbsolute(inside)
    )
      throw Error('Managed CSV file required');
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > max)
      throw Error('Bounded regular CSV file required');
    const handle = await open(
      file,
      constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const before = await handle.stat();
      if (
        !before.isFile() ||
        before.size !== stat.size ||
        before.ino !== stat.ino ||
        before.dev !== stat.dev
      )
        throw Error('CSV file changed');
      const parts: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const chunk = Buffer.alloc(Math.min(65536, max + 1 - total)),
          read = await handle.read(chunk, 0, chunk.length, null);
        if (!read.bytesRead) break;
        total += read.bytesRead;
        if (total > max) throw Error('CSV file size changed');
        parts.push(chunk.subarray(0, read.bytesRead));
      }
      const bytes = Buffer.concat(parts);
      const after = await handle.stat();
      if (
        bytes.length > max ||
        bytes.length !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        (await realpath(resolve(root, name))) !== file
      )
        throw Error('CSV file changed');
      return bytes;
    } finally {
      await handle.close();
    }
  }
  const raw: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(await read(options['--plan'], 16384)),
  );
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).sort().join(',') !== 'actorId,input'
  )
    throw Error('Invalid CSV plan');
  const p = raw as Record<string, unknown>;
  if (command === 'upload')
    return service.upload(p.actorId, p.input, await read(options['--file'], 16777216));
  if (command === 'template') return service.createTemplate(p.actorId, p.input);
  if (command === 'schema') return service.template(p.actorId, p.input);
  if (command === 'retire') return service.retire(p.actorId, p.input);
  if (command === 'validate') return service.validate(p.actorId, p.input);
  if (command === 'preview') return service.preview(p.actorId, p.input);
  if (command === 'review') return service.review(p.actorId, p.input);
  if (command === 'publish') return service.publish(p.actorId, p.input);
  if (command === 'cancel') return service.cancel(p.actorId, p.input);
  return service.errors(p.actorId, p.input);
}
