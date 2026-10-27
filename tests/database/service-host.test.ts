import pg from 'pg';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, readdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { KMSClient, CreateKeyCommand, EncryptCommand } from '@aws-sdk/client-kms';
import { contentFixture, uid, time, success } from '../fixtures/content/database.ts';
import { hostSettings } from '../fixtures/service-host/settings.ts';
import { createLocalServiceHost } from '../../packages/integrations/src/service-host.ts';
import { createServiceHostPools } from '../../packages/integrations/src/service-host-pools.ts';
import { readServiceHostSettings } from '../../packages/config/src/service-host-settings.ts';
import { createOwnerRepository } from '../../packages/db/src/repositories/owners.ts';
import { startWorker } from '../../packages/integrations/src/worker-server.ts';
import { createLocalObserver } from '../../packages/integrations/src/local-observer.ts';
import { localHttpReady } from '../../packages/integrations/src/local-probe.ts';
import { engineFixture } from '../fixtures/engine/base.ts';
import { type Result, ok } from '../../packages/domain/src/values/core.ts';
import { proveWorkflow } from '../../scripts/runtime/local-workflow-proof.ts';
import {
  localWorkflowQuery,
  type LocalWorkflowRun,
} from '../../scripts/runtime/local-workflow-history.ts';
import {
  verifyProviderState,
  digest,
  type LocalProviderState,
} from '../../scripts/runtime/local-host-state.ts';
let f: Awaited<ReturnType<typeof contentFixture>>,
  settings: ReturnType<typeof hostSettings>,
  env: Record<string, string>,
  directory: string,
  file: string,
  s3: S3Client,
  kms: KMSClient;
type Host = Awaited<ReturnType<typeof createLocalServiceHost>>;
function value<R extends Result<unknown, unknown>>(r: R): Extract<R, { ok: true }>['value'] {
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.value as Extract<R, { ok: true }>['value'];
}
async function save(input = settings) {
  await writeFile(file, JSON.stringify(input), { mode: 0o600 });
}
async function usingHost(run: (h: Host) => Promise<void>) {
  const h = await createLocalServiceHost(env);
  try {
    await run(h);
  } finally {
    await h.shutdown();
  }
}
async function connections() {
  return (
    await f.owner.query(
      "SELECT application_name,count(*)::int AS n FROM pg_stat_activity WHERE application_name LIKE 'tt-service-host:%' GROUP BY application_name",
    )
  ).rows;
}
async function noConnections() {
  await vi.waitFor(async () => expect(await connections()).toEqual([]), {
    timeout: 1000,
    interval: 20,
  });
}
beforeAll(async () => {
  f = await contentFixture();
  directory = await mkdtemp(join(tmpdir(), 'tt-service-host-'));
  file = join(directory, 'settings.json');
  settings = hostSettings(
    (r) => f.connectionUrl(r as Parameters<typeof f.connectionUrl>[0]),
    f.cmsConnectionUrl('tt_cms_runtime'),
  );
  for (const [purpose, id] of Object.entries(settings.policy.notices))
    await f.owner.query(
      "INSERT INTO privacy.notices(id,purpose,market_policy,version,content_hash,published_at,content_ref) VALUES($1,$2,'synthetic','host',$3,now(),'synthetic-local-host')",
      [id, purpose, 'a'.repeat(64)],
    );
  await f.owner.query(
    "INSERT INTO email.template_versions(id,template_key,version,locale,purpose,renderer_hash,status,reviewed_at) VALUES($1,'host-fixture','1','en-US','report',$2,'published',now())",
    [settings.policy.templateId, settings.policy.rendererHash],
  );
  for (const kind of ['delete', 'restrict', 'opt_out', 'access', 'correct', 'export'])
    await f.owner.query(
      "INSERT INTO privacy.retention_policies(data_class,jurisdiction,version,rule,reviewed_at) VALUES($1,'hostfixture','host-fixture',$2,now())",
      ['rights:' + kind, { responseDays: 14, escalationDays: 2, proofMinutes: 30, maxAttempts: 3 }],
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
  const bucket = 'host-private-' + uid('bucket'),
    publicBucket = 'host-public-' + uid('bucket');
  for (const Bucket of [bucket, publicBucket]) {
    await s3.send(new CreateBucketCommand({ Bucket }));
    await s3.send(
      new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }),
    );
  }
  const key = (await kms.send(new CreateKeyCommand({ Description: 'Synthetic local host' })))
    .KeyMetadata!.Arn!;
  env = {
    APP_ENV: 'test-local',
    PROVIDER_MODE: 'fixtures',
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
  await save();
}, 60000);
afterAll(async () => {
  s3?.destroy();
  kms?.destroy();
  await f?.cleanup();
  if (directory) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'tt-service-host-'))
      throw Error('Unexpected fixture cleanup path');
    await rm(directory, { recursive: true, force: true });
  }
});
it('executes the composed SQL quota cleanup through a real local Inngest cron callback, preserving unexpired buckets and the API hold', async () => {
  await save({ ...settings, maintenance: { enabled: ['quotas'], cycle: ['quotas'] } });
  await usingHost(async (h) => {
    const listener = await startWorker(h, 8123, 'http://test:8123');
    try {
      expect(await proveWorkflow(f.owner, 'http://127.0.0.1:8123')).toMatchObject({
        expiredRemoved: 1,
        unexpiredPreserved: 1,
        productApiStatus: 404,
        admissionPolicyEnabled: false,
      });
    } finally {
      await listener.stop();
    }
  });
  await noConnections();
}, 100000);
it('verifies retained KMS custody and every exact S3 canary version, refusing unavailable keys or missing versions without repair', async () => {
  const plain = Buffer.from('Synthetic persistent host key canary');
  const encrypted = await kms.send(
    new EncryptCommand({ KeyId: env.KMS_KEY_ID!, Plaintext: plain }),
  );
  const objects: LocalProviderState['objects'] = [];
  for (const Bucket of [env.PRIVATE_BUCKET!, env.PUBLIC_BUCKET!])
    for (let n = 0; n < 2; n++) {
      const Body = Buffer.from('Synthetic retained canary ' + n),
        Key = 'fixture/provider-canary' as const;
      const result = await s3.send(new PutObjectCommand({ Bucket, Key, Body }));
      objects.push({ bucket: Bucket, key: Key, version: result.VersionId!, sha256: digest(Body) });
    }
  const state: LocalProviderState = {
    schemaVersion: 1,
    target: 'dev',
    keyId: env.KMS_KEY_ID!,
    ciphertext: Buffer.from(encrypted.CiphertextBlob!).toString('base64'),
    plaintextHash: digest(plain),
    objects,
  };
  await verifyProviderState(state, process.env.TEST_STORAGE_ENDPOINT!);
  await expect(verifyProviderState(state, 'https://example.com')).rejects.toThrow(
    'Invalid fixture endpoint',
  );
  await expect(
    verifyProviderState(
      { ...state, keyId: state.keyId.slice(0, -36) + '00000000-0000-4000-8000-000000000000' },
      process.env.TEST_STORAGE_ENDPOINT!,
    ),
  ).rejects.toThrow('refusing automatic');
  await expect(
    verifyProviderState(
      { ...state, plaintextHash: '0'.repeat(64) },
      process.env.TEST_STORAGE_ENDPOINT!,
    ),
  ).rejects.toThrow('refusing automatic');
  await verifyProviderState(state, process.env.TEST_STORAGE_ENDPOINT!);
  const first = objects[0]!;
  await s3.send(
    new DeleteObjectCommand({ Bucket: first.bucket, Key: first.key, VersionId: first.version }),
  );
  await expect(verifyProviderState(state, process.env.TEST_STORAGE_ENDPOINT!)).rejects.toThrow(
    'refusing automatic',
  );
});
it('records a SQL lock failure as FAILED and explicitly replays it through Inngest without duplicating committed quota effects', async () => {
  await save({ ...settings, maintenance: { enabled: ['quotas'], cycle: ['quotas'] } });
  const policy = 'replay_' + uid('probe'),
    endpoint = process.env.TEST_WORKFLOW_ENDPOINT!;
  await f.owner.query(
    "INSERT INTO app.rate_limit_policies(policy_key,policy_version,window_seconds,limit_value,enabled) VALUES($1,'fixture',60,1,false)",
    [policy],
  );
  for (const hours of [-2, 0])
    await f.owner.query(
      "INSERT INTO app.rate_limit_buckets(policy_key,policy_version,key_version,principal_hmac,window_start,window_seconds,limit_value,used,expires_at) VALUES($1,'fixture',$3,decode(repeat('21',32),'hex'),date_trunc('hour',now())+($2::int*interval '1 hour'),60,1,1,date_trunc('hour',now())+($2::int*interval '1 hour')+interval '90 minutes')",
      [policy, hours, Object.keys(settings.keys.lookup)[0]],
    );
  const readCount = async () =>
    (
      await f.owner.query(
        'SELECT count(*)::int AS n FROM app.rate_limit_buckets WHERE policy_key=$1',
        [policy],
      )
    ).rows[0].n;
  try {
    await usingHost(async (h) => {
      const listener = await startWorker(h, 8123, 'http://test:8123');
      const fields = 'id status function{slug} cronSchedule triggerIDs';
      const since = new Date(Date.now() - 5000).toISOString();
      try {
        expect((await fetch('http://127.0.0.1:8123/internal/inngest', { method: 'PUT' })).ok).toBe(
          true,
        );
        await f.owner.query('BEGIN');
        await f.owner.query('LOCK TABLE app.rate_limit_buckets IN ACCESS EXCLUSIVE MODE');
        const event = await h.workflows.client.send({
          id: uid('event'),
          name: 'tt/maintenance.requested',
          data: {},
        });
        let failed: LocalWorkflowRun | undefined;
        await vi.waitFor(
          async () => {
            const data = await localWorkflowQuery(
              endpoint,
              `{runs(first:20,orderBy:[],filter:{from:${JSON.stringify(since)}}){edges{node{${fields}}}}}`,
            );
            failed = data.runs?.edges
              .map((e) => e.node)
              .find(
                (r) =>
                  r.function.slug.endsWith('-service-maintenance-v1') &&
                  r.triggerIDs?.includes(event.ids[0]!),
              );
            expect(failed?.status).toBe('FAILED');
          },
          { timeout: 20000, interval: 250 },
        );
        expect(await readCount()).toBe(2);
        await f.owner.query('COMMIT');
        const rerun = async (runID: string) => {
          if (!/^[0-9A-Z]{26}$/.test(runID)) throw Error('Invalid local run');
          const response = await localWorkflowQuery(
            endpoint,
            `mutation {rerun(runID:${JSON.stringify(runID)})}`,
          );
          if (!response.rerun) throw Error('Replay unavailable');
          await vi.waitFor(
            async () => {
              const data = await localWorkflowQuery(
                endpoint,
                `{run(runID:${JSON.stringify(response.rerun)}){${fields}}}`,
              );
              expect(data.run?.status).toBe('COMPLETED');
            },
            { timeout: 20000, interval: 250 },
          );
          return response.rerun;
        };
        const recovered = await rerun(failed!.id);
        expect(await readCount()).toBe(1);
        const repeated = await rerun(recovered);
        expect(await readCount()).toBe(1);
        expect(
          (
            await f.owner.query(
              'SELECT expires_at>now() AS live FROM app.rate_limit_buckets WHERE policy_key=$1',
              [policy],
            )
          ).rows[0].live,
        ).toBe(true);
        expect((await fetch('http://127.0.0.1:8123/api/reports')).status).toBe(404);
        console.log(
          'WORKFLOW_REPLAY_EVIDENCE',
          JSON.stringify({
            failed: failed!.id,
            recovered,
            repeated,
            failedStatus: 'FAILED',
            replayedStatus: 'COMPLETED',
            rowsAfterFailure: 2,
            rowsAfterReplay: 1,
            rowsAfterSuccessfulReplay: 1,
            productApis: false,
          }),
        );
      } finally {
        await f.owner.query('ROLLBACK');
        await listener.stop();
      }
    });
  } finally {
    await f.owner.query('ROLLBACK');
    await f.owner.query('DELETE FROM app.rate_limit_buckets WHERE policy_key=$1', [policy]);
    await f.owner.query('DELETE FROM app.rate_limit_policies WHERE policy_key=$1', [policy]);
  }
}, 70000);
it('composes accepted factories over exactly the declared role pools and both databases with provider activation false', async () => {
  await save({
    ...settings,
    plan: {
      ...settings.plan,
      urls: {
        ...settings.plan.urls,
        worker: settings.plan.urls.worker!.replace(/^postgresql:/, 'postgres:'),
      },
    },
  });
  await usingHost(async (h) => {
    expect(h.metadata).toMatchObject({
      connections: {
        ownedPools: 17,
        perReplica: { application: 16, cms: 1 },
        required: 65,
        capacity: 100,
      },
      productApis: false,
      externalMail: false,
      analyticsCollection: false,
      externalAdvertising: false,
      retentionDryRun: true,
    });
    expect(h.workflows.functions).toHaveLength(3);
    expect(Object.keys(h.services)).toEqual(
      expect.arrayContaining([
        'reports',
        'contacts',
        'delivery',
        'privacy',
        'mail',
        'actions',
        'analytics',
        'admission',
        'operations',
        'content',
        'staff',
        'commercial',
        'imports',
        'health',
        'maintenance',
      ]),
    );
    const rows = await connections();
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every((r) => r.n <= 1)).toBe(true);
    expect(
      value(
        await h.services.maintenance.cycle(['privacy', 'quotas', 'analytics', 'assets']),
      ).results.every((r) => r.status === 'disabled'),
    ).toBe(true);
    expect(JSON.stringify(h.metadata)).not.toContain(new URL(settings.plan.urls.report!).password);
    console.log(
      'SERVICE_HOST_EVIDENCE ' +
        JSON.stringify({
          ownedPools: 17,
          perReplica: { application: 16, cms: 1 },
          replicas: 1,
          external: 28,
          reserve: 20,
          required: 65,
          capacity: 100,
          observedPhysicalPools: rows.length,
          allObservedWithinMax: true,
          providers: 'local fixtures; external activation false',
        }),
    );
  });
  await noConnections();
});
it('runs CMS publication and masked operations through the composed service host', async () => {
  await save({
    ...settings,
    maintenance: {
      enabled: ['publication', 'quotas', 'analytics', 'assets'],
      cycle: ['publication', 'quotas', 'analytics', 'assets'],
    },
  });
  await usingHost(async (h) => {
    const doc = await f.document();
    value(await h.services.content.services.enqueue(f.staff, doc.ref));
    expect(
      value(
        await h.services.maintenance.cycle(['publication', 'quotas', 'analytics', 'assets']),
      ).results.every((r) => r.status === 'completed'),
    ).toBe(true);
    expect((await h.services.content.services.readPage(doc.body.path, 'en-US', 'US')).ok).toBe(
      true,
    );
    expect(
      value(
        await h.services.health.review(f.staff, {
          backlog: 100,
          lagSeconds: 30,
          capacityBasisPoints: 8000,
        }),
      ),
    ).toHaveLength(10);
    expect(
      (
        await h.services.health.review(uid('staff'), {
          backlog: 100,
          lagSeconds: 30,
          capacityBasisPoints: 8000,
        })
      ).ok,
    ).toBe(false);
  });
});
it('refuses assessment issuance without source acceptance and persists a signed privacy journal across host restart', async () => {
  await save({ ...settings, maintenance: { enabled: ['privacy'], cycle: ['privacy'] } });
  const identity = { subjectId: uid('subject'), sessionId: uid('owner_session') },
    key = { keyVersion: 'test-hmac-v1', digest: 'ab'.repeat(32) },
    scope = f.adapter('tt_private_runtime');
  await success(scope.unitOfWork, (tx) =>
    createOwnerRepository(scope).create(tx, { owner: identity, key, expiresAt: time(3600000) }),
  );
  let proof = '';
  await usingHost(async (h) => {
    expect(
      (await h.services.reports.create([key], uid('command'), engineFixture().request)).ok,
    ).toBe(false);
    const r = value(
      await h.services.privacy.requestOwner([key], 'restrict', 'hostfixture', uid('command')),
    );
    proof = r.proof;
    for (let n = 0; n < 8; n++) {
      await f.owner.query(
        "UPDATE privacy.request_work SET barrier_until=now()-interval '1 second',next_attempt_at=now()-interval '1 second' WHERE request_id=$1",
        [r.id],
      );
      value(await h.services.maintenance.cycle(['privacy']));
      if (value(await h.services.privacy.status(proof)).status === 'completed') break;
    }
    expect(value(await h.services.privacy.status(proof)).status).toBe('completed');
  });
  const files = await readdir(env.SERVICE_HOST_JOURNAL_DIRECTORY!);
  expect(files.length).toBeGreaterThan(0);
  expect(
    await readFile(join(env.SERVICE_HOST_JOURNAL_DIRECTORY!, files[0]!), 'utf8'),
  ).not.toContain(identity.subjectId);
  await usingHost(async (h) => {
    expect(value(await h.services.privacy.status(proof)).status).toBe('completed');
  });
  const rotated = structuredClone(settings);
  rotated.keys.privacy.values['local-v1'] = 'fe'.repeat(32);
  await save(rotated);
  await expect(createLocalServiceHost(env)).rejects.toThrow('Local service host unavailable');
  await noConnections();
});
it('rejects combined cluster overbooking and a failed CMS connection without leaking partially initialized pools', async () => {
  const over = structuredClone(settings);
  over.plan.max = Object.fromEntries(Object.keys(over.plan.max).map((n) => [n, 6]));
  await save(over);
  await expect(createLocalServiceHost(env)).rejects.toThrow('database unavailable');
  await noConnections();
  const bad = structuredClone(settings);
  const u = new URL(bad.plan.urls.cms!);
  u.password = 'wrong-fixture-only';
  bad.plan.urls.cms = u.toString();
  await save(bad);
  await expect(createLocalServiceHost(env)).rejects.toThrow('database unavailable');
  await noConnections();
});
it('refuses unavailable policy references and unsupported hosted configuration with redacted errors', async () => {
  const bad = structuredClone(settings);
  bad.policy.templateId = uid('template');
  await save(bad);
  await expect(createLocalServiceHost(env)).rejects.toThrow(/^Local service host unavailable$/);
  await noConnections();
  await save();
  await expect(
    createLocalServiceHost({ ...env, STORAGE_ENDPOINT: 'https://example.com' }),
  ).rejects.toThrow();
  await noConnections();
});
it('isolates aggregate saturation from reports and drains all application/CMS lanes without admitting more work', async () => {
  const pools = await createServiceHostPools(readServiceHostSettings(settings).plan);
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  let entered = false;
  try {
    const holding = pools.scopes.aggregate.unitOfWork.run(async (tx) => {
      await pools.scopes.aggregate.query(tx, 'SELECT 1');
      entered = true;
      await wait;
      return ok(null);
    });
    await vi.waitFor(() => expect(entered).toBe(true));
    expect(
      (
        await pools.scopes.report.unitOfWork.run(async (tx) => {
          await pools.scopes.report.query(tx, 'SELECT 1');
          return ok(null);
        })
      ).ok,
    ).toBe(true);
    const draining = pools.shutdown();
    release();
    expect((await holding).ok).toBe(true);
    await draining;
    expect((await pools.scopes.cms.unitOfWork.run(async () => ok(null))).ok).toBe(false);
  } finally {
    release();
    await pools.shutdown();
  }
  await noConnections();
});
it('waits for an admitted business call during shutdown and refuses new calls', async () => {
  await save();
  const h = await createLocalServiceHost(env),
    doc = await f.document();
  try {
    value(await h.services.content.services.enqueue(f.staff, doc.ref));
    value(
      await h.services.content.services.dispatch(
        value(await h.services.content.services.reconcile())[0]!,
      ),
    );
    await f.owner.query('BEGIN');
    await f.owner.query('LOCK TABLE app.public_pages IN ACCESS EXCLUSIVE MODE');
    const reading = h.services.content.services.readPage(doc.body.path, 'en-US', 'US');
    await new Promise((r) => setTimeout(r, 20));
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
  await noConnections();
});
it('withdraws readiness when the real CMS lane becomes unavailable and recovers without restarting', async () => {
  await save();
  await usingHost(async (h) => {
    const admin = new pg.Client({ connectionString: process.env.TEST_CMS_DATABASE_URL });
    await admin.connect();
    try {
      expect(await h.ready()).toBe(true);
      await admin.query('ALTER ROLE tt_cms_runtime NOLOGIN');
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='tt-service-host:cms'",
      );
      expect(await h.ready()).toBe(false);
      const listener = await startWorker(h, 8127, 'http://test:8127');
      const observer = createLocalObserver({
        review: () =>
          h.services.health.review(f.staff, {
            backlog: 100,
            lagSeconds: 300,
            capacityBasisPoints: 8000,
          }),
        checks: {
          host_readiness: () => localHttpReady('http://127.0.0.1:8127/health/ready'),
          storage_fixture: () => localHttpReady(env.STORAGE_ENDPOINT! + '/moto-api/'),
          workflow_freshness: async () => true,
        },
        now: Date.now,
      });
      try {
        const response = await fetch('http://127.0.0.1:8127/health/ready');
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ ready: false });
        expect((await observer.sample()).events).toContainEqual({
          component: 'host_readiness',
          state: 'alert',
          reasons: ['unavailable'],
        });
      } finally {
        await admin.query('ALTER ROLE tt_cms_runtime LOGIN');
        expect(await h.ready()).toBe(true);
        expect((await observer.sample()).events).toContainEqual({
          component: 'host_readiness',
          state: 'recovered',
          reasons: [],
        });
        await listener.stop();
      }
    } finally {
      await admin.query('ALTER ROLE tt_cms_runtime LOGIN');
      await admin.end();
    }
  });
  await noConnections();
});
it('serves only health/internal workflow callbacks and the bundled local process shuts down cleanly on SIGTERM', async () => {
  await save();
  await usingHost(async (h) => {
    const listener = await startWorker(h, 8125, 'http://test:8125');
    try {
      expect((await fetch('http://127.0.0.1:8125/health/ready')).status).toBe(200);
      expect((await fetch('http://127.0.0.1:8125/api/reports')).status).toBe(404);
    } finally {
      await listener.stop();
    }
  });
  execFileSync(process.execPath, ['scripts/runtime/build.mjs'], { stdio: 'pipe', timeout: 30000 });
  const bundleFile = join(directory, 'service-host.mjs');
  await copyFile('.local/service-host.mjs', bundleFile);
  const child = spawn(process.execPath, [bundleFile, 'run'], {
    cwd: directory,
    env: { ...process.env, ...env, WORKER_PORT: '8126', WORKER_ORIGIN: 'http://test:8126' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (b) => {
    output += b.toString();
  });
  child.stderr.on('data', (b) => {
    output += b.toString();
  });
  const exited = once(child, 'exit');
  try {
    let ready = false;
    for (let n = 0; n < 50; n++) {
      try {
        ready = (await fetch('http://127.0.0.1:8126/health/ready')).ok;
      } catch {
        /* Wait only for this owned fixture listener. */
      }
      if (ready || child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(ready).toBe(true);
    child.kill('SIGTERM');
    expect(await exited).toEqual([0, null]);
    expect(output).not.toContain(new URL(settings.plan.urls.report!).password);
    expect(output).not.toContain(settings.keys.contactIdentity);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
  }
  await noConnections();
}, 45000);
