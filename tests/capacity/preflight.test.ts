import pg from 'pg';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import {
  mkdtemp,
  writeFile,
  copyFile,
  rm,
  statfs,
  mkdir,
  readdir,
  readFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fork, spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { KMSClient, CreateKeyCommand } from '@aws-sdk/client-kms';
import { contentFixture, uid } from '../fixtures/content/database.ts';
import { hostSettings } from '../fixtures/service-host/settings.ts';
import { disposableTargets } from '../fixtures/foundation/target.ts';
import { localProviderProject } from '../../packages/config/src/provider-preflight.ts';
import { readServiceHostSettings } from '../../packages/config/src/service-host-settings.ts';
import {
  serviceHostRoles,
  validateServiceHostPlan,
} from '../../packages/config/src/service-host-plan.ts';
import { postgresCapacity } from '../../packages/config/src/postgres-capacity.ts';
import { createServiceHostPools } from '../../packages/integrations/src/service-host-pools.ts';
import { createLocalServiceHost } from '../../packages/integrations/src/service-host.ts';
import { createRuntimePool } from '../../packages/db/src/runtime-pool.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
import { createPrivacyCrypto } from '../../packages/integrations/src/privacy-crypto.ts';
import { createFilePrivacyJournal } from '../../packages/integrations/src/privacy-journal.ts';
import { requireHeadroom } from '../../scripts/capacity/headroom.ts';

const project = localProviderProject(process.env),
  target = disposableTargets(process.env);
const metrics: Record<string, unknown> = {
  project,
  scope: 'local fixture only',
  hostedAccepted: false,
  productActivation: false,
};
let f: Awaited<ReturnType<typeof contentFixture>>,
  settings: ReturnType<typeof hostSettings>,
  env: Record<string, string>;
let directory: string,
  file: string,
  admin: pg.Client,
  s3: S3Client,
  kms: KMSClient,
  peer: ChildProcess;
let peerExit: Promise<unknown[]>;
let request = 0;
const pending = new Map<number, (ok: boolean) => void>();
async function processes() {
  const ids = (await readdir('/proc')).filter((x) => /^\d+$/.test(x));
  expect(ids.length).toBeLessThan(128);
  const rows = [];
  for (const pid of ids) {
    try {
      const status = await readFile('/proc/' + pid + '/status', 'utf8');
      const field = (key: string) =>
        new RegExp('^' + key + ':\\s*(.*)$', 'm').exec(status)?.[1] ?? '';
      rows.push({
        pid: Number(pid),
        parent: Number(field('PPid')),
        name: field('Name'),
        rssKiB: Number.parseInt(field('VmRSS')) || 0,
        threads: Number(field('Threads')),
      });
    } catch (e) {
      if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) throw e;
    }
  }
  return rows;
}
function peerProbe() {
  return new Promise<boolean>((done) => {
    const id = ++request,
      timer = setTimeout(() => {
        pending.delete(id);
        done(false);
      }, 2000);
    pending.set(id, (ok) => {
      clearTimeout(timer);
      pending.delete(id);
      done(ok);
    });
    peer.send?.({ id, kind: 'probe' });
  });
}
async function active(prefix = 'tt-service-host:') {
  return (
    await admin.query(
      'SELECT application_name,count(*)::int AS n FROM pg_stat_activity WHERE application_name LIKE $1 GROUP BY application_name',
      [prefix + '%'],
    )
  ).rows;
}
async function emptyHost() {
  await vi.waitFor(async () => expect(await active()).toEqual([]), { timeout: 4000, interval: 30 });
}
async function usingHost(
  work: (h: Awaited<ReturnType<typeof createLocalServiceHost>>) => Promise<void>,
) {
  await emptyHost();
  const h = await createLocalServiceHost(env);
  try {
    await work(h);
  } finally {
    await h.shutdown();
  }
  await emptyHost();
}
beforeAll(async () => {
  f = await contentFixture();
  admin = new pg.Client({
    connectionString: target.app,
    application_name: 'tt-capacity:control',
    connectionTimeoutMillis: 1000,
    statement_timeout: 5000,
  });
  await admin.connect();
  directory = await mkdtemp(join(tmpdir(), 'tt-capacity-'));
  file = join(directory, 'settings.json');
  settings = hostSettings(
    (r) => f.connectionUrl(r as Parameters<typeof f.connectionUrl>[0]),
    f.cmsConnectionUrl('tt_cms_runtime'),
  );
  settings.plan.external.push({
    name: 'capacity-probes',
    database: 'application',
    max: 3,
    replicas: 1,
  });
  // Two peer pools (app/CMS) plus one temporary drain probe share this conservative reservation.
  settings.plan.external[settings.plan.external.length - 1]!.max = 2;
  settings.plan.external.push({ name: 'capacity-peer-cms', database: 'cms', max: 1, replicas: 1 });
  for (const [purpose, id] of Object.entries(settings.policy.notices))
    await f.owner.query(
      "INSERT INTO privacy.notices(id,purpose,market_policy,version,content_hash,published_at,content_ref) VALUES($1,$2,'synthetic','capacity',$3,now(),'synthetic-capacity')",
      [id, purpose, 'a'.repeat(64)],
    );
  await f.owner.query(
    "INSERT INTO email.template_versions(id,template_key,version,locale,purpose,renderer_hash,status,reviewed_at) VALUES($1,'capacity-fixture','1','en-US','report',$2,'published',now())",
    [settings.policy.templateId, settings.policy.rendererHash],
  );
  await f.owner.query(
    "INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code='operations_read'",
    [f.staff],
  );
  const endpoint = process.env.TEST_STORAGE_ENDPOINT!,
    credentials = { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' };
  s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials,
    maxAttempts: 1,
  });
  kms = new KMSClient({ endpoint, region: 'us-east-1', credentials, maxAttempts: 1 });
  const bucket = 'capacity-private-' + uid('bucket'),
    publicBucket = 'capacity-public-' + uid('bucket');
  for (const Bucket of [bucket, publicBucket]) {
    await s3.send(new CreateBucketCommand({ Bucket }));
    await s3.send(
      new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }),
    );
  }
  const key = (await kms.send(new CreateKeyCommand({ Description: 'Synthetic capacity fixture' })))
    .KeyMetadata!.Arn!;
  await writeFile(file, JSON.stringify(settings), { mode: 0o600, flag: 'wx' });
  const peerFile = join(directory, 'peer.json');
  await writeFile(
    peerFile,
    JSON.stringify({ project, catalog: settings.plan.urls.catalog, cms: settings.plan.urls.cms }),
    { mode: 0o600, flag: 'wx' },
  );
  env = {
    APP_ENV: 'test-local',
    PROVIDER_MODE: 'fixtures',
    ISOLATED_TEST_PROJECT: project,
    SERVICE_HOST_CONFIG_FILE: file,
    SERVICE_HOST_JOURNAL_DIRECTORY: join(directory, 'journal'),
    STORAGE_ENDPOINT: endpoint,
    WORKFLOW_ENDPOINT: process.env.TEST_WORKFLOW_ENDPOINT!,
    PRIVATE_BUCKET: bucket,
    PUBLIC_BUCKET: publicBucket,
    KMS_KEY_ID: key,
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'fixture-access',
    AWS_SECRET_ACCESS_KEY: 'fixture-secret',
  };
  peer = fork('tests/fixtures/capacity/peer.ts', [], {
    execArgv: ['--import', 'tsx'],
    env: {
      NODE_ENV: 'test',
      APP_ENV: 'test-local',
      PROVIDER_MODE: 'fixtures',
      ISOLATED_TEST_PROJECT: project,
      PEER_CONFIG_FILE: peerFile,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  peerExit = once(peer, 'exit');
  let output = '';
  for (const stream of [peer.stdout, peer.stderr])
    stream?.on('data', (b: Buffer) => {
      output = (output + b.toString()).slice(-8192);
    });
  const ready = await Promise.race([
    once(peer, 'message'),
    peerExit.then(() => {
      throw Error('Capacity peer exited');
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Error('Capacity peer startup timeout')), 5000).unref(),
    ),
  ]);
  expect(ready[0]).toMatchObject({ kind: 'ready', pools: 2 });
  expect(peer.pid).not.toBe(process.pid);
  peer.on('message', (raw: unknown) => {
    if (raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'number' && 'ok' in raw)
      pending.get(raw.id)?.(raw.ok === true);
  });
  expect(output.includes(new URL(settings.plan.urls.cms!).password)).toBe(false);
}, 60000);
afterAll(async () => {
  if (peer && peer.exitCode === null) {
    peer.kill('SIGTERM');
    await Promise.race([
      peerExit,
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          peer.kill('SIGKILL');
          reject(Error('Capacity peer failed graceful stop'));
        }, 6000).unref(),
      ),
    ]);
  }
  for (const role of ['tt_operations_runtime', 'tt_cms_runtime'])
    await admin?.query(`ALTER ROLE ${role} LOGIN`);
  await admin?.end();
  s3?.destroy();
  kms?.destroy();
  await f?.cleanup();
  if (directory) {
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
    expect(directory.split(/[\\/]/).at(-1)).toMatch(/^tt-capacity-/);
    await rm(directory, { recursive: true, force: true });
  }
  await mkdir('/capacity', { recursive: true });
  await writeFile('/capacity/metrics.json', JSON.stringify(metrics, null, 2) + '\n', {
    mode: 0o600,
  });
}, 20000);

it('accounts for the complete fixture and refuses raw-versus-usable and 45-slot overbooking before fan-out', async () => {
  const plan = readServiceHostSettings(settings).plan,
    budget = validateServiceHostPlan(plan);
  expect(Object.keys(serviceHostRoles)).toHaveLength(17);
  expect(budget.required).toBe(68);
  const c = (
    await admin.query(
      "SELECT current_setting('max_connections')::int AS raw,current_setting('superuser_reserved_connections')::int AS super,current_setting('reserved_connections')::int AS reserved",
    )
  ).rows[0];
  expect(c).toEqual({ raw: 75, super: 3, reserved: 2 });
  expect(postgresCapacity(c.raw, c.super, c.reserved, budget.required).usableCapacity).toBe(70);
  expect(() => postgresCapacity(50, 3, 2, budget.required)).toThrow();
  const over = {
    ...plan,
    external: [
      ...plan.external,
      { name: 'overbook', database: 'application' as const, max: 3, replicas: 1 },
    ],
  };
  expect(validateServiceHostPlan(over).required).toBe(71);
  await expect(createServiceHostPools(over)).rejects.toThrow(/^Service host database unavailable$/);
  await emptyHost();
  metrics.inventory = {
    runtime: { processes: 1, pools: 17, application: 16, cms: 1 },
    harness: {
      logicalControllers: 1,
      pools: 6,
      poolMax: 3,
      directClients: 5,
      allocatedApp: 20,
      allocatedCms: 6,
      setupSubprocess: {
        payloadPoolMax: 3,
        migrationLock: 1,
        phase: 'before runtime tests; within harness allocation',
      },
    },
    peers: { processes: 1, pools: 2, max: 1 },
    drainProbe: { pools: 1, max: 1 },
    dormantWeb: { slots: 2 },
    operationalReserve: 20,
    required: 68,
    raw: 75,
    serverReserved: 5,
    usable: 70,
    unallocatedUsable: 2,
    proposed45Accepted: false,
    concurrentFullHostReplicas: 1,
  };
});
it('observes all 17 physical lane maxima and bounded backpressure without blocking an independent lane', async () => {
  const p = await createServiceHostPools(readServiceHostSettings(settings).plan);
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  let entered = 0;
  const all = Object.values(p.scopes).map((s) =>
    s.unitOfWork.run(async (tx) => {
      await s.query(tx, 'SELECT 1');
      entered++;
      await hold;
      return ok(null);
    }),
  );
  try {
    await vi.waitFor(() => expect(entered).toBe(17), { interval: 10, timeout: 700 });
    const rows = await active();
    expect(rows).toHaveLength(17);
    expect(rows.every((r) => r.n === 1)).toBe(true);
    metrics.physicalLanes = 17;
  } finally {
    release();
    await Promise.all(all);
  }
  let unblock!: () => void, started!: () => void;
  const wait = new Promise<void>((r) => (unblock = r)),
    ready = new Promise<void>((r) => (started = r));
  const held = p.scopes.aggregate.unitOfWork.run(async (tx) => {
    await p.scopes.aggregate.query(tx, 'SELECT 1');
    started();
    await wait;
    return ok(null);
  });
  await ready;
  try {
    const began = performance.now();
    const work = Array.from({ length: 12 }, () =>
      p.scopes.aggregate.unitOfWork.run(async () => ok(null)),
    );
    expect(
      (
        await p.scopes.report.unitOfWork.run(async (tx) => {
          await p.scopes.report.query(tx, 'SELECT 1');
          return ok(null);
        })
      ).ok,
    ).toBe(true);
    const results = await Promise.all(work);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(performance.now() - began).toBeLessThan(1500);
    expect((await active()).every((r) => r.n <= 1)).toBe(true);
    metrics.backpressure = {
      refused: results.length,
      independentReport: true,
      elapsedMs: Math.round(performance.now() - began),
    };
  } finally {
    unblock();
    await held;
    await p.shutdown();
  }
  await emptyHost();
});
it('runs bounded mixed reads, writes, CMS and operations work alongside a separate two-pool consumer', async () => {
  await usingHost(async (h) => {
    const doc = await f.document();
    const enqueued = await h.services.content.services.enqueue(f.staff, doc.ref);
    expect(enqueued.ok).toBe(true);
    const jobs = await h.services.content.services.reconcile();
    if (!jobs.ok || !jobs.value[0]) throw Error('Capacity publication missing');
    expect((await h.services.content.services.dispatch(jobs.value[0])).ok).toBe(true);
    const work = Array.from({ length: 8 }, () => [
      () => h.services.content.services.readPage(doc.body.path, 'en-US', 'US'),
      () => h.services.admission.cleanup(50),
      () => h.services.content.services.reconcile(),
      () =>
        h.services.health.review(f.staff, {
          backlog: 100,
          lagSeconds: 300,
          capacityBasisPoints: 8000,
        }),
    ]).flat();
    const began = performance.now();
    let next = 0;
    const results: boolean[] = [];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (;;) {
          const index = next++;
          const fn = work[index];
          if (!fn) return;
          results[index] = (await fn()).ok;
        }
      }),
    );
    expect(results.every(Boolean)).toBe(true);
    expect(await peerProbe()).toBe(true);
    expect((await active('tt-capacity:peer-')).length).toBe(2);
    const clients = Number(
      (
        await admin.query(
          "SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend'",
        )
      ).rows[0].count,
    );
    expect(clients).toBeLessThanOrEqual(48);
    expect(h.metadata).toMatchObject({
      productApis: false,
      externalMail: false,
      connections: { required: 68, capacity: 75, serverReserved: 5, usableCapacity: 70 },
    });
    metrics.mixed = {
      operations: results.length,
      elapsedMs: Math.round(performance.now() - began),
      observedClients: clients,
      peerProcesses: 1,
      peerPools: 2,
      hostProcess: process.pid,
      peerProcess: peer.pid,
      processSnapshot: await processes(),
      postgresProcessTypes: (
        await admin.query(
          'SELECT backend_type,count(*)::integer AS count FROM pg_stat_activity GROUP BY backend_type ORDER BY backend_type',
        )
      ).rows,
    };
  });
});
it('checks real filesystem headroom and verifies signed journal and exact-version object I/O', async () => {
  const journalDirectory = env.SERVICE_HOST_JOURNAL_DIRECTORY!;
  await mkdir(journalDirectory, { recursive: true, mode: 0o700 });
  const space = await statfs(journalDirectory, { bigint: true });
  expect(
    requireHeadroom({
      totalBytes: space.blocks * space.bsize,
      availableBytes: space.bavail * space.bsize,
      freeInodes: space.ffree,
    }),
  ).toBe(true);
  const crypto = createPrivacyCrypto(
      settings.keys.privacy.current,
      Object.fromEntries(
        Object.entries(settings.keys.privacy.values).map(([v, b]) => [
          v,
          new Uint8Array(Buffer.from(b, 'hex')),
        ]),
      ),
    ),
    journal = createFilePrivacyJournal(journalDirectory, crypto);
  const began = performance.now();
  for (let n = 0; n < 8; n++) {
    await journal.append(
      n.toString(16).padStart(64, '0'),
      crypto.sign({
        version: 1,
        action: 'delete',
        resourceKind: 'subject',
        markers: crypto.markers('subject', 'capacity-' + n),
        tombstones: [],
        policy: 'synthetic-capacity',
      }),
    );
    const Body = randomBytes(32768),
      Key = 'capacity/' + n,
      put = await s3.send(new PutObjectCommand({ Bucket: env.PRIVATE_BUCKET!, Key, Body }));
    const got = await s3.send(
      new GetObjectCommand({ Bucket: env.PRIVATE_BUCKET!, Key, VersionId: put.VersionId! }),
    );
    const bytes = await got.Body!.transformToByteArray();
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      createHash('sha256').update(Body).digest('hex'),
    );
    expect(got.VersionId).toBe(put.VersionId);
  }
  const signed = crypto.verify(await journal.capture(new Date().toISOString())) as {
    entries: unknown[];
  };
  expect(signed.entries).toHaveLength(8);
  metrics.io = {
    journalEntries: 8,
    versionedObjects: 8,
    objectBytes: 32768,
    elapsedMs: Math.round(performance.now() - began),
    availableBytes: (space.bavail * space.bsize).toString(),
    freeInodes: space.ffree.toString(),
    scope:
      'same local filesystem; ephemeral Moto object I/O; not off-host durability or a throughput SLO',
  };
});
it('withdraws readiness and peer work during both runtime database-lane failures and reconnects without host restart', async () => {
  await usingHost(async (h) => {
    expect(await h.ready()).toBe(true);
    try {
      for (const role of ['tt_operations_runtime', 'tt_cms_runtime'])
        await admin.query(`ALTER ROLE ${role} NOLOGIN`);
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name IN ('tt-service-host:operations','tt-service-host:cms','tt-capacity:peer-cms')",
      );
      expect(await h.ready()).toBe(false);
      expect(await peerProbe()).toBe(false);
    } finally {
      for (const role of ['tt_operations_runtime', 'tt_cms_runtime'])
        await admin.query(`ALTER ROLE ${role} LOGIN`);
    }
    await vi.waitFor(async () => expect(await h.ready()).toBe(true), { timeout: 3000 });
    expect(await peerProbe()).toBe(true);
    metrics.reconnect = {
      readinessRefused: true,
      peerRefused: true,
      recovered: true,
      scope: 'two runtime roles NOLOGIN and exact client termination; postmaster not restarted',
    };
  });
});
it('drains admitted business work, refuses new work and bounds forced client close with eventual server quiescence', async () => {
  await emptyHost();
  const h = await createLocalServiceHost(env),
    doc = await f.document();
  try {
    expect((await h.services.content.services.enqueue(f.staff, doc.ref)).ok).toBe(true);
    const jobs = await h.services.content.services.reconcile();
    if (!jobs.ok || !jobs.value[0]) throw Error();
    await h.services.content.services.dispatch(jobs.value[0]);
    await f.owner.query('BEGIN');
    await f.owner.query('LOCK TABLE app.public_pages IN ACCESS EXCLUSIVE MODE');
    const reading = h.services.content.services.readPage(doc.body.path, 'en-US', 'US');
    await vi.waitFor(
      async () =>
        expect(
          Number(
            (
              await admin.query(
                "SELECT count(*) FROM pg_stat_activity WHERE application_name='tt-service-host:public' AND wait_event_type='Lock'",
              )
            ).rows[0].count,
          ),
        ).toBe(1),
      { timeout: 200, interval: 10 },
    );
    const stopping = h.shutdown();
    expect(() => h.services.content.services.readPage('/', 'en-US', 'US')).toThrow('stopping');
    await f.owner.query('COMMIT');
    expect((await reading).ok).toBe(true);
    await stopping;
    await h.shutdown();
  } finally {
    await f.owner.query('ROLLBACK');
    await h.shutdown();
  }
  await emptyHost();
  const p = createRuntimePool(settings.plan.urls.catalog!, 1, 1, 'tt-capacity:drain'),
    c = await p.pool.connect();
  const query = c.query('SELECT pg_sleep(2)').then(
    () => true,
    () => false,
  );
  const began = performance.now();
  await p.drain(50);
  expect(await query).toBe(false);
  await p.drain(50);
  expect(performance.now() - began).toBeLessThan(1500);
  await expect(p.pool.connect()).rejects.toThrow(/^Database unavailable$/);
  const clientCloseMs = Math.round(performance.now() - began);
  await vi.waitFor(async () => expect(await active('tt-capacity:drain')).toEqual([]), {
    timeout: 4000,
    interval: 30,
  });
  metrics.drain = {
    newWorkRefused: true,
    admittedBusinessCallCompleted: true,
    forcedClientCloseMs: clientCloseMs,
    serverQuiescenceMs: Math.round(performance.now() - began),
  };
});
it('runs the bundled service host in a separate process with product routes held and graceful SIGTERM returning every owned slot', async () => {
  await emptyHost();
  execFileSync(process.execPath, ['scripts/runtime/build.mjs'], { stdio: 'pipe', timeout: 30000 });
  const bundle = join(directory, 'service-host.mjs');
  await copyFile('.local/service-host.mjs', bundle);
  const child = spawn(process.execPath, [bundle, 'run'], {
    cwd: directory,
    env: {
      NODE_ENV: 'test',
      ...env,
      WORKER_PORT: '8136',
      WORKER_ORIGIN: 'http://127.0.0.1:8136',
      SOURCE_REVISION: process.env.SOURCE_REVISION ?? 'working',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (b: Buffer) => {
      output = (output + b.toString()).slice(-8192);
    });
  const exited = once(child, 'exit');
  try {
    await vi.waitFor(
      async () =>
        expect(
          (await fetch('http://127.0.0.1:8136/health/ready', { signal: AbortSignal.timeout(1000) }))
            .status,
        ).toBe(200),
      { timeout: 6000, interval: 100 },
    );
    expect((await fetch('http://127.0.0.1:8136/api/reports')).status).toBe(404);
    expect(await peerProbe()).toBe(true);
    expect(child.pid).not.toBe(process.pid);
    expect(child.pid).not.toBe(peer.pid);
    const processSnapshot = await processes();
    expect(processSnapshot.some((p) => p.pid === child.pid)).toBe(true);
    expect(processSnapshot.some((p) => p.pid === peer.pid)).toBe(true);
    const began = performance.now();
    child.kill('SIGTERM');
    expect(
      await Promise.race([
        exited,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(Error('Bundled capacity host failed graceful shutdown')),
            8000,
          ).unref(),
        ),
      ]),
    ).toEqual([0, null]);
    await emptyHost();
    expect(output.includes(new URL(settings.plan.urls.report!).password)).toBe(false);
    expect(output.includes(settings.keys.contactIdentity)).toBe(false);
    metrics.processShutdown = {
      bundled: true,
      exitCode: 0,
      sigkillRequired: false,
      elapsedMs: Math.round(performance.now() - began),
      productRouteStatus: 404,
      processSnapshot,
      scope: 'standalone bundle in test tooling container; not production host capacity',
    };
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
  }
}, 45000);
