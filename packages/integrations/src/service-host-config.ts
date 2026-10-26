import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { readRuntimeConfig } from '../../config/src/runtime.ts';
import { readServiceHostSettings } from '../../config/src/service-host-settings.ts';
export function loadServiceHostSettings(env: Readonly<Record<string, string | undefined>>) {
  try {
    readRuntimeConfig(env);
    const file = env.SERVICE_HOST_CONFIG_FILE;
    if (!file || !isAbsolute(file)) throw Error();
    const info = lstatSync(file);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > 65536 ||
      (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
    )
      throw Error();
    const bytes = readFileSync(file);
    if (bytes.length > 65536) throw Error();
    return readServiceHostSettings(JSON.parse(bytes.toString('utf8')));
  } catch {
    throw Error('Local service host configuration unavailable');
  }
}
