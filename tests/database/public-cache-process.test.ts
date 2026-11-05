import { it, expect } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { commercialFixture } from '../fixtures/http/commercial.ts';
function peer(env: NodeJS.ProcessEnv) {
  const child = fork('tests/fixtures/http/cache-peer.ts', [], {
    execArgv: ['--import', 'tsx'],
    env,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let seq = 0;
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Peer readiness timeout')), 5000);
    child.once('message', (m) => {
      clearTimeout(timer);
      if (!(m as { ready?: boolean }).ready) reject(Error('Peer not ready'));
      else resolve();
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(Error('Peer exited'));
    });
  });
  async function read() {
    await ready;
    const id = ++seq;
    return new Promise<{ pid: number; revision: number | null; rules: unknown }>(
      (resolve, reject) => {
        const onExit = () => finish(Error('Peer exited'));
        const onMessage = (raw: unknown) => {
          const m = raw as {
            id: number;
            pid: number;
            revision: number | null;
            rules: unknown;
            error?: string;
          };
          if (m.id === id) finish(m.error ? Error('Peer read unavailable') : null, m);
        };
        const timer = setTimeout(() => finish(Error('Peer read timeout')), 5000);
        function finish(
          error: Error | null,
          value?: { pid: number; revision: number | null; rules: unknown },
        ) {
          clearTimeout(timer);
          child.off('exit', onExit);
          child.off('message', onMessage);
          if (error) reject(error);
          else resolve(value!);
        }
        child.on('exit', onExit);
        child.on('message', onMessage);
        child.send({ id, kind: 'read' });
      },
    );
  }
  return { child, read };
}
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
it('propagates an actual SQL/S3 redirect revision across two warmed child-process caches after the existing 30-second TTL without a shared-memory invalidation', async () => {
  const f = await commercialFixture();
  const peers: ReturnType<typeof peer>[] = [];
  try {
    const publish = async (revision: number, removed = false) => {
      const r = await f.api.services.content.services.publishRedirects(f.db.staff, f.db.staff, {
        revision,
        issuedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        rules: [
          {
            source: '/learn/tire-basics',
            target: removed ? null : '/guides/trust',
            code: removed ? (410 as const) : (301 as const),
          },
        ],
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
    };
    await publish(1);
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      PATH: process.env.PATH,
      APP_ENV: 'test-local',
      ISOLATED_TEST_PROJECT: process.env.ISOLATED_TEST_PROJECT,
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
      TEST_CMS_DATABASE_URL: process.env.TEST_CMS_DATABASE_URL,
      TEST_STORAGE_ENDPOINT: process.env.TEST_STORAGE_ENDPOINT,
      STORAGE_ENDPOINT: f.f.env.STORAGE_ENDPOINT,
      PUBLIC_BUCKET: f.f.env.PUBLIC_BUCKET,
      TT_CACHE_PUBLIC_URL: f.db.connectionUrl('tt_public_runtime'),
    };
    for (let i = 0; i < 2; i++) peers.push(peer(env));
    const warm = await Promise.all(peers.map((p) => p.read()));
    expect(new Set(warm.map((x) => x.pid)).size).toBe(2);
    expect(warm.map((x) => x.revision)).toEqual([1, 1]);
    await publish(2, true);
    const during = await Promise.all(peers.map((p) => p.read()));
    expect(during.map((x) => x.revision)).toEqual([1, 1]);
    const began = performance.now();
    await delay(30100);
    const refreshed = await Promise.all(peers.map((p) => p.read()));
    expect(refreshed.map((x) => x.revision)).toEqual([2, 2]);
    for (const r of refreshed)
      expect(r.rules).toEqual([
        { source: '/learn/tire-basics', target: null, code: 410, mode: 'exact' },
      ]);
    console.log(
      'LOCAL_CACHE_PROCESS_EVIDENCE ' +
        JSON.stringify({
          processes: 2,
          actualPostgreSQL: true,
          actualFixtureObjectStore: true,
          warmedRevision: 1,
          publishedRevision: 2,
          observedRevision: 2,
          configuredTtlMs: 30000,
          waitAndRefreshMs: performance.now() - began,
          immediateInvalidationClaimed: false,
          productionActivation: false,
          actualRecipientNotifications: 0,
          casesClosed: 0,
          gatesClosed: 0,
        }),
    );
  } finally {
    await Promise.all(peers.map((p) => stop(p.child)));
    await f.cleanup();
  }
}, 80000);
