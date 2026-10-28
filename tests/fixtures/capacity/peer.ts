import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { localProviderProject } from '../../../packages/config/src/provider-preflight.ts';
import { createRuntimePool } from '../../../packages/db/src/runtime-pool.ts';
function configuration() {
  try {
    const project = localProviderProject(process.env),
      file = process.env.PEER_CONFIG_FILE;
    if (!file || !isAbsolute(file)) throw Error();
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 4096)
      throw Error();
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (Object.keys(data).sort().join(',') !== 'catalog,cms,project' || data.project !== project)
      throw Error();
    for (const [lane, role, database] of [
      ['catalog', 'tt_catalog_runtime', 'tt_app_catalog'],
      ['cms', 'tt_cms_runtime', 'tt_cms_content'],
    ]) {
      const u = new URL(data[lane!]);
      if (
        u.protocol !== 'postgresql:' ||
        u.hostname !== 'postgres' ||
        u.port !== '5432' ||
        u.username !== role ||
        !u.password ||
        u.pathname !== '/' + database ||
        u.search ||
        u.hash
      )
        throw Error();
    }
    return data as { catalog: string; cms: string };
  } catch {
    throw Error('Capacity peer configuration unavailable');
  }
}
const settings = configuration();
const pools = [
  createRuntimePool(settings.catalog, 1, 2, 'tt-capacity:peer-catalog'),
  createRuntimePool(settings.cms, 1, 2, 'tt-capacity:peer-cms'),
];
async function probe() {
  try {
    for (const p of pools) {
      const c = await p.pool.connect();
      try {
        await c.query('SELECT current_user');
      } finally {
        c.release();
      }
    }
    return true;
  } catch {
    return false;
  }
}
let stopping: Promise<void> | undefined;
const stop = () =>
  (stopping ??= Promise.all(pools.map((p) => p.drain())).then(() => {
    process.disconnect?.();
  }));
process.on('message', (raw: unknown) => {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('id' in raw) ||
    !Number.isSafeInteger(raw.id) ||
    !('kind' in raw) ||
    raw.kind !== 'probe'
  )
    return;
  void probe().then((ok) => process.send?.({ id: raw.id, ok }));
});
process.once('SIGTERM', () => {
  void stop().catch(() => {
    process.exitCode = 1;
    process.disconnect?.();
  });
});
if (!(await probe())) throw Error('Capacity peer unavailable');
process.send?.({ kind: 'ready', pid: process.pid, pools: 2 });
