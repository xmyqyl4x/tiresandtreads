import { beforeAll, afterAll, it, expect } from 'vitest';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  ListObjectVersionsCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { KMSClient, CreateKeyCommand } from '@aws-sdk/client-kms';
import { privateFixture, uid, time, key, success } from '../fixtures/private/database.ts';
import { createRuntime, type SqlJobHandler } from '../../packages/integrations/src/runtime.ts';
import { createRuntimePool } from '../../packages/db/src/runtime-pool.ts';
import { createAssetRepository } from '../../packages/db/src/repositories/assets.ts';
import { createAssetService } from '../../packages/application/src/services/assets.ts';
import { createPrivateObjects } from '../../packages/integrations/src/storage.ts';
import { startWorker } from '../../packages/integrations/src/worker-server.ts';
import { ok, id } from '../../packages/domain/src/values/core.ts';
import { createJobRepository } from '../../packages/db/src/repositories/jobs.ts';
let f: Awaited<ReturnType<typeof privateFixture>>,
  s3: S3Client,
  kms: KMSClient,
  env: Record<string, string>,
  runtime: Awaited<ReturnType<typeof createRuntime>>,
  bucket: string,
  keyId: string;
const objectBytes = Buffer.from('%PDF-1.7\nSynthetic private fixture');
beforeAll(async () => {
  f = await privateFixture();
  const endpoint = process.env.TEST_STORAGE_ENDPOINT;
  if (!endpoint || !process.env.TEST_WORKFLOW_ENDPOINT)
    throw Error('Use isolated runtime provider fixtures');
  const credentials = { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' };
  s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials,
    maxAttempts: 1,
  });
  kms = new KMSClient({ endpoint, region: 'us-east-1', credentials, maxAttempts: 1 });
  bucket = 'private-' + uid('bucket');
  const publicBucket = 'public-' + uid('bucket');
  for (const name of [bucket, publicBucket]) {
    await s3.send(new CreateBucketCommand({ Bucket: name }));
    await s3.send(
      new PutBucketVersioningCommand({
        Bucket: name,
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    );
  }
  keyId = (await kms.send(new CreateKeyCommand({ Description: 'Synthetic runtime fixture' })))
    .KeyMetadata!.Arn!;
  env = {
    APP_ENV: 'test-local',
    PROVIDER_MODE: 'fixtures',
    PRIVATE_DATABASE_URL: f.connectionUrl('tt_private_runtime'),
    ASSET_DATABASE_URL: f.connectionUrl('tt_asset_runtime'),
    STORAGE_ENDPOINT: endpoint,
    WORKFLOW_ENDPOINT: process.env.TEST_WORKFLOW_ENDPOINT,
    PRIVATE_BUCKET: bucket,
    PUBLIC_BUCKET: publicBucket,
    KMS_KEY_ID: keyId,
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'fixture-access',
    AWS_SECRET_ACCESS_KEY: 'fixture-secret',
  };
  runtime = await createRuntime(env, () => ({}));
}, 30000);
afterAll(async () => {
  await runtime?.shutdown();
  s3?.destroy();
  kms?.destroy();
  await f?.cleanup();
});
function assetInput() {
  return {
    id: uid('asset'),
    purpose: 'report_pdf' as const,
    mime: 'application/pdf' as const,
    sha256: createHash('sha256').update(objectBytes).digest('hex'),
    size: objectBytes.length,
  };
}
it('DB15 stores immutable versioned SSE-KMS bytes and recovers a PUT before its metadata commit', async () => {
  const input = assetInput(),
    scope = f.adapter('tt_asset_runtime'),
    repo = createAssetRepository(scope, bucket, keyId),
    objects = createPrivateObjects(s3, bucket, keyId);
  const pending = await success(scope.unitOfWork, (tx) => repo.register(tx, input));
  const first = await objects.put(pending, objectBytes);
  expect(await runtime.assets.upload(input, objectBytes)).toBe(input.id);
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: pending.key }));
  expect(head.VersionId).toBe(first);
  expect(head.ServerSideEncryption).toBe('aws:kms');
  expect(
    await objects.get((await success(scope.unitOfWork, (tx) => repo.get(tx, input.id)))!),
  ).toEqual(new Uint8Array(objectBytes));
  await expect(
    runtime.assets.upload({ ...input, sha256: 'b'.repeat(64) }, objectBytes),
  ).rejects.toThrow('Asset unavailable');
  await runtime.assets.erase(input.id);
  expect(
    (await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: pending.key })))
      .Versions ?? [],
  ).toHaveLength(0);
  await expect(runtime.assets.upload(input, objectBytes)).rejects.toThrow('Asset unavailable');
});
it('DB15 rechecks revocation during byte retrieval and deletes every version and marker', async () => {
  const input = assetInput();
  await runtime.assets.upload(input, objectBytes);
  const owner = await f.owner(),
    report = await f.report(owner.identity),
    token = key();
  await success(f.scope.unitOfWork, (tx) =>
    f.caps.asset(tx, owner.identity, {
      assetId: input.id,
      reportId: report.head.id,
      version: 1,
      comparisonRevision: null,
      rendererVersion: 'fixture',
      locale: 'en-US',
      scope: 'owner',
      renderKey: key().digest,
    }),
  );
  await success(f.scope.unitOfWork, (tx) =>
    f.caps.grant(
      tx,
      { owner: owner.identity },
      {
        id: uid('download_grant'),
        assetId: input.id,
        reportId: report.head.id,
        version: 1,
        scope: 'owner',
        key: token,
        expiresAt: time(600000),
      },
    ),
  );
  expect((await runtime.assets.download([token])).bytes).toEqual(new Uint8Array(objectBytes));
  const scope = f.adapter('tt_asset_runtime'),
    objects = createPrivateObjects(s3, bucket, keyId);
  const revoked = createAssetService({
    uow: scope.unitOfWork,
    assets: createAssetRepository(scope, bucket, keyId),
    authority: f.scope.unitOfWork,
    capabilities: f.caps,
    objects: {
      ...objects,
      async get(a) {
        const b = await objects.get(a);
        await f.admin.query(
          'UPDATE app.owner_sessions SET revoked_at=clock_timestamp() WHERE id=$1',
          [owner.identity.sessionId],
        );
        return b;
      },
    },
  });
  await expect(revoked.download([token])).rejects.toThrow('Asset unavailable');
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: 'assets/' + input.id, Body: objectBytes }),
  );
  await runtime.assets.erase(input.id);
  await runtime.assets.erase(input.id);
  expect(
    (await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: 'assets/' + input.id })))
      .Versions ?? [],
  ).toHaveLength(0);
});
it('DB15 late upload cannot resurrect SQL authorization; cleanup reconciles its orphan version', async () => {
  const scope = f.adapter('tt_asset_runtime'),
    repo = createAssetRepository(scope, bucket, keyId),
    objects = createPrivateObjects(s3, bucket, keyId),
    input = assetInput();
  const pending = await success(scope.unitOfWork, (tx) => repo.register(tx, input));
  await runtime.assets.erase(input.id);
  const version = await objects.put(pending, objectBytes);
  const finished = await scope.unitOfWork.run(async (tx) => {
    await repo.ready(tx, pending, version);
    return ok(null);
  });
  expect(finished.ok).toBe(false);
  expect(await runtime.assets.reconcile()).toContain(input.id);
  await runtime.assets.erase(input.id);
  expect(
    (await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: pending.key })))
      .Versions ?? [],
  ).toHaveLength(0);
});
it('DB15 KMS ciphertext is bound to its purpose/resource and public storage cannot read a private key', async () => {
  const resource = uid('resource'),
    plain = Buffer.from('synthetic@example.invalid'),
    cipher = await runtime.encryption.encrypt(plain, 'contact', resource);
  expect(cipher.hex).not.toContain(plain.toString('hex'));
  expect(await runtime.encryption.decrypt(cipher, 'contact', resource)).toEqual(
    new Uint8Array(plain),
  );
  const large = Buffer.alloc(60000, 42),
    envelope = await runtime.encryption.encrypt(large, 'report_private', resource);
  expect(await runtime.encryption.decrypt(envelope, 'report_private', resource)).toEqual(
    new Uint8Array(large),
  );
  const tampered = {
    ...cipher,
    hex: cipher.hex.slice(0, -2) + (cipher.hex.endsWith('00') ? '01' : '00'),
  };
  await expect(runtime.encryption.decrypt(tampered, 'contact', resource)).rejects.toThrow(
    'Provider unavailable',
  );
  await expect(runtime.encryption.decrypt(cipher, 'report_private', resource)).rejects.toThrow(
    'Provider unavailable',
  );
  await expect(
    runtime.publicObjects.get('assets/' + resource, {
      maxBytes: 100,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow('Invalid public object');
  await s3.send(
    new PutObjectCommand({ Bucket: env.PUBLIC_BUCKET!, Key: 'public-config/1.json', Body: '{}' }),
  );
  expect(
    await runtime.publicObjects.get('public-config/1.json', {
      maxBytes: 4096,
      signal: new AbortController().signal,
    }),
  ).toEqual(new Uint8Array(Buffer.from('{}')));
});
it('DB08 real Inngest dev-server callback commits one SQL effect and replay remains a no-op', async () => {
  const resource = uid('resource'),
    telemetry: string[] = [];
  const worker = await createRuntime(
    env,
    ({ outbox }) => {
      const apply: SqlJobHandler = async (tx, input) => {
        const effectId = id('event', input.resourceId);
        if (!effectId.ok) throw Error('fixture');
        await outbox.append(tx, {
          eventId: effectId.value,
          aggregateId: uid('aggregate'),
          aggregateKind: 'fixture',
          type: 'fixture/completed',
          version: 1,
          payload: { resource_id: resource, resource_kind: 'fixture' },
        });
        return ok(undefined);
      };
      return { 'fixture.sql': apply, 'inbox.process': apply };
    },
    { record: (e) => telemetry.push(e) },
  );
  const listener = await startWorker(worker, 8123, 'http://test:8123');
  try {
    expect((await fetch('http://127.0.0.1:8123/health/ready')).status).toBe(200);
    expect((await fetch('http://127.0.0.1:8123/product')).status).toBe(404);
    expect(
      (
        await fetch('http://127.0.0.1:8123/internal/inngest', {
          method: 'POST',
          body: 'x'.repeat(65537),
        })
      ).status,
    ).toBe(413);
    const sync = await fetch('http://127.0.0.1:8123/internal/inngest', { method: 'PUT' });
    expect(sync.ok).toBe(true);
    const queued = await worker.enqueue({
      type: 'fixture.sql',
      businessKey: uid('business'),
      resourceId: resource,
      version: 1,
    });
    expect(queued.ok).toBe(true);
    if (!queued.ok) throw Error('enqueue failed');
    for (let n = 0; n < 20; n++) {
      await worker.tick();
      const row = (
        await f.admin.query('SELECT state FROM app.job_runs WHERE id=$1', [queued.value])
      ).rows[0];
      if (row.state === 'completed') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(
      (await f.admin.query('SELECT state FROM app.job_runs WHERE id=$1', [queued.value])).rows[0]
        .state,
    ).toBe('completed');
    await worker.workflows.dispatch(queued.value);
    expect(
      (
        await f.admin.query('SELECT count(*)::integer AS n FROM app.outbox WHERE event_id=$1', [
          resource,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(telemetry).toContain('job_completed');
    const jobs = createJobRepository(f.scope),
      recovered = await success(f.scope.unitOfWork, (tx) =>
        jobs.register(tx, {
          type: 'fixture.sql',
          businessKey: uid('business'),
          resourceId: uid('resource'),
          version: 1,
        }),
      );
    await worker.workflows.client.send({ name: 'tt/reconciliation.requested', data: {} });
    for (let n = 0; n < 40; n++) {
      if (
        (await f.admin.query('SELECT state FROM app.job_runs WHERE id=$1', [recovered])).rows[0]
          .state === 'completed'
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(
      (await f.admin.query('SELECT state FROM app.job_runs WHERE id=$1', [recovered])).rows[0]
        .state,
    ).toBe('completed');
    const received = await worker.receiveVerified({
      provider: 'fixture',
      eventId: uid('provider_event'),
      digest: key().digest,
      assetId: null,
      receivedAt: time(-1000),
      verifiedAt: time(),
    });
    expect(received.ok).toBe(true);
    if (!received.ok || !received.value.jobId) throw Error('fixture');
    await worker.tick();
    for (let n = 0; n < 40; n++) {
      await worker.tick();
      if (
        (await f.admin.query('SELECT state FROM app.job_runs WHERE id=$1', [received.value.jobId]))
          .rows[0].state === 'completed'
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(
      (await success(f.scope.unitOfWork, (tx) =>
        f.reliability.current(tx, received.value.receipt.id),
      ))!.state,
    ).toBe('processed');
  } finally {
    await listener.stop();
    await listener.stop();
    await expect(worker.tick()).rejects.toThrow('Runtime stopping');
    await expect(
      worker.enqueue({
        type: 'fixture.sql',
        businessKey: uid('business'),
        resourceId: resource,
        version: 1,
      }),
    ).rejects.toThrow('Runtime stopping');
  }
}, 30000);
it('bundled worker handles SIGTERM, drains pools and redacts startup errors', async () => {
  execFileSync(process.execPath, ['scripts/runtime/build.mjs'], { stdio: 'pipe', timeout: 30000 });
  const child = spawn(process.execPath, ['.local/worker.mjs'], {
    env: { ...process.env, ...env, WORKER_PORT: '8124', WORKER_ORIGIN: 'http://test:8124' },
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
    for (let n = 0; n < 30; n++) {
      try {
        ready = (await fetch('http://127.0.0.1:8124/health/ready')).ok;
      } catch {
        /* Wait only for this owned worker's readiness. */
      }
      if (ready) break;
      if (child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(ready).toBe(true);
    child.kill('SIGTERM');
    expect(await exited).toEqual([0, null]);
    expect(output).not.toContain(new URL(env.PRIVATE_DATABASE_URL!).password);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
  }
}, 30000);
it('bounded runtime pools reject overflow, drain active clients and refuse new admission', async () => {
  const pool = createRuntimePool(f.connectionUrl('tt_private_runtime'), 1, 1),
    first = await pool.pool.connect(),
    waiting = pool.pool.connect();
  await expect(pool.pool.connect()).rejects.toThrow('Database unavailable');
  first.release();
  const second = await waiting;
  await pool.drain(20);
  second.release();
  await pool.drain(20);
  await expect(pool.pool.connect()).rejects.toThrow('Database unavailable');
  await expect(createRuntime({ ...env, APP_REPLICAS: '100' }, () => ({}))).rejects.toThrow(
    'Runtime unavailable',
  );
  const graceful = createRuntimePool(f.connectionUrl('tt_private_runtime'), 1, 1),
    connection = await graceful.pool.connect();
  const query = connection.query('SELECT pg_sleep(0.05)').finally(() => connection.release());
  await graceful.drain(1000);
  await expect(query).resolves.toMatchObject({ command: 'SELECT' });
});
