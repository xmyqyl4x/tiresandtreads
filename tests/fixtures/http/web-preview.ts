import { request as httpRequest } from 'node:http';
import { cp } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { composedApiFixture } from './composed-host.ts';
import { createLocalPublicApi } from '../../../packages/integrations/src/http/local-runtime.ts';
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
// A disposable local product preview. It never uses retained dev/stage databases or live providers.
export async function startWebPreview(
  webOrigin = 'http://127.0.0.1:3000',
  mode: 'dev' | 'stage' = 'dev',
) {
  const url = new URL(webOrigin);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !['3000', '8380', '8480'].includes(url.port) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw Error('Local preview origin refused');
  const fixture = await composedApiFixture();
  let api: Awaited<ReturnType<typeof createLocalPublicApi>> | undefined,
    child: ChildProcess | undefined;
  try {
    api = await createLocalPublicApi(fixture.env);
    const env = {
      ...process.env,
      APP_ENV: mode + '-local',
      PROVIDER_MODE: 'fixtures',
      LOCAL_WEB_PREVIEW: 'enabled',
      LOCAL_WEB_ORIGIN: url.origin,
      LOCAL_API_ORIGIN: api.origin,
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: '--max-old-space-size=1024',
    };
    const assets = spawnSync(process.execPath, ['scripts/build/web-assets.mjs'], {
      env,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1048576,
    });
    if (assets.status !== 0) throw Error('Preview asset build failed: ' + assets.stderr);
    const cli = 'apps/web/node_modules/next/dist/bin/next';
    const build = spawnSync(process.execPath, [cli, 'build', 'apps/web'], {
      env,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 1048576,
    });
    if (build.status !== 0)
      throw Error('Local preview build failed: ' + (build.stderr || build.stdout).slice(-3000));
    const source = resolve('apps/web/.next/static'),
      destination = resolve('apps/web/.next/standalone/apps/web/.next/static');
    if (
      !source.startsWith(resolve('apps/web/.next') + sep) ||
      !destination.startsWith(resolve('apps/web/.next/standalone') + sep)
    )
      throw Error('Preview static copy refused');
    await cp(source, destination, { recursive: true });
    child = spawn(process.execPath, ['apps/web/.next/standalone/apps/web/server.js'], {
      env: { ...env, HOSTNAME: '0.0.0.0', PORT: '3000' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [child.stdout, child.stderr])
      stream?.on('data', (b) => {
        output = (output + b.toString()).slice(-4000);
      });
    const origin = 'http://127.0.0.1:3000',
      headers = { host: url.host };
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw Error('Local preview exited before readiness: ' + output);
      try {
        const status = await new Promise<number>((resolve, reject) => {
          const probe = httpRequest(
            origin,
            { headers, agent: false, timeout: 1000 },
            (response) => {
              response.resume();
              resolve(response.statusCode ?? 0);
            },
          );
          probe.on('error', reject);
          probe.on('timeout', () => probe.destroy(Error('Owned readiness timeout')));
          probe.end();
        });
        if (status === 200) {
          ready = true;
          break;
        }
      } catch {
        /* owned listener still starting */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw Error('Local preview readiness failed: ' + output);
    const listener = child,
      host = api;
    return {
      fixture,
      api: host,
      origin,
      webOrigin: url.origin,
      headers,
      request: (path: string, options: RequestInit = {}) =>
        fetch(origin + path, {
          ...options,
          headers: { ...headers, ...Object.fromEntries(new Headers(options.headers)) },
          signal: AbortSignal.timeout(15000),
        }),
      async cleanup() {
        await stop(listener);
        try {
          await host.shutdown();
        } finally {
          await fixture.cleanup();
        }
      },
    };
  } catch (error) {
    if (child) await stop(child);
    try {
      await api?.shutdown();
    } finally {
      await fixture.cleanup();
    }
    throw error;
  }
}
