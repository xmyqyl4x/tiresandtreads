import pg from 'pg';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, mkdir, rm, lstat, unlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { S3Client, CreateBucketCommand, PutBucketVersioningCommand } from '@aws-sdk/client-s3';
import { KMSClient, CreateKeyCommand } from '@aws-sdk/client-kms';
import { contentFixture, uid } from '../fixtures/content/database.ts';
import { hostSettings } from '../fixtures/service-host/settings.ts';
import { disposableTargets } from '../fixtures/foundation/target.ts';
import { localProviderProject } from '../../packages/config/src/provider-preflight.ts';
import { alertSchema, type FixtureAlert } from '../../packages/config/src/observation-preflight.ts';
import { createLocalServiceHost } from '../../packages/integrations/src/service-host.ts';
import { startWorker } from '../../packages/integrations/src/worker-server.ts';
import { localHttpReady } from '../../packages/integrations/src/local-probe.ts';
import { proveWorkflow } from '../../scripts/runtime/local-workflow-proof.ts';
import { completedMaintenance } from '../../scripts/runtime/local-workflow-history.ts';
import { observationDatabase } from '../../scripts/observability/postgres.ts';
import { createFreshObserver } from '../../scripts/observability/observer.ts';
import { localResponse } from '../../scripts/observability/response.ts';
import { fixtureAlertTransport } from '../../scripts/observability/transport.ts';

const project = localProviderProject(process.env),
  target = disposableTargets(process.env),
  directories: string[] = [],
  metrics: Record<string, unknown> = {
    project,
    scope: 'disposable local fixture only',
    hostedAccepted: false,
    productActivation: false,
    actualRecipientNotifications: 0,
  };
let f: Awaited<ReturnType<typeof contentFixture>>,
  settings: ReturnType<typeof hostSettings>,
  host: Awaited<ReturnType<typeof createLocalServiceHost>>,
  worker: Awaited<ReturnType<typeof startWorker>>,
  source: ReturnType<typeof observationDatabase>,
  admin: pg.Client,
  s3: S3Client,
  kms: KMSClient,
  token: string,
  receiver: ReturnType<typeof createServer>,
  origin: string;
let mode = 'ok',
  storageHealthy = true,
  scheduleFrom: number | undefined,
  requests = 0;
const effects = new Set<string>(),
  attempts = new Map<string, number>();
let send: ReturnType<typeof fixtureAlertTransport>;
async function directory() {
  const d = await mkdtemp(join(tmpdir(), 'tt-observation-'));
  directories.push(d);
  return d;
}
const stamp = () => new Date().toISOString();
function checks() {
  return {
    host_readiness: async () => ({
      healthy: await localHttpReady('http://127.0.0.1:8123/health/ready'),
      sampledAt: stamp(),
    }),
    storage_fixture: async () => ({
      healthy: await localHttpReady(origin + '/moto-api/'),
      sampledAt: stamp(),
    }),
    workflow_freshness: async () => {
      const r = await completedMaintenance(
        'http://inngest:8288',
        scheduleFrom ?? Date.now() - 180000,
      );
      return {
        healthy: r?.function.slug === 'tiresandtreads-test-local-service-maintenance-v1',
        sampledAt: stamp(),
      };
    },
  };
}
function observer(threshold = 8000) {
  return createFreshObserver({
    review: source.review,
    readCapacity: source.readCapacity,
    checks: checks(),
    now: Date.now,
    capacityThreshold: threshold,
  });
}
async function response() {
  let now = Date.now();
  const file = join(await directory(), 'response.json');
  const options = { file, env: process.env, now: () => now, send };
  let value = await localResponse(options);
  return {
    file,
    get value() {
      return value;
    },
    advance: (ms: number) => {
      now += ms;
    },
    restart: async () => {
      await value.close();
      value = await localResponse(options);
    },
  };
}
const brokenSample = {
  healthy: false,
  fresh: true,
  activeAlerts: ['callbacks'],
  events: [{ component: 'callbacks', state: 'alert', reasons: ['backlog'] }],
};
const clearSample = { healthy: true, fresh: true, activeAlerts: [], events: [] };

beforeAll(async () => {
  f = await contentFixture();
  admin = new pg.Client({
    connectionString: target.app,
    application_name: 'tt-observation:control',
    statement_timeout: 5000,
  });
  await admin.connect();
  settings = hostSettings(
    (r) => f.connectionUrl(r as Parameters<typeof f.connectionUrl>[0]),
    f.cmsConnectionUrl('tt_cms_runtime'),
  );
  settings.plan.external.push(
    { name: 'observer', database: 'application', max: 1, replicas: 1 },
    { name: 'pressure', database: 'application', max: 3, replicas: 1 },
  );
  settings.maintenance.enabled.push('quotas');
  for (const [purpose, id] of Object.entries(settings.policy.notices))
    await f.owner.query(
      "INSERT INTO privacy.notices(id,purpose,market_policy,version,content_hash,published_at,content_ref) VALUES($1,$2,'synthetic','observation',$3,now(),'synthetic-observation')",
      [id, purpose, 'a'.repeat(64)],
    );
  await f.owner.query(
    "INSERT INTO email.template_versions(id,template_key,version,locale,purpose,renderer_hash,status,reviewed_at) VALUES($1,'observation-fixture','1','en-US','report',$2,'published',now())",
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
    credentials,
    forcePathStyle: true,
    maxAttempts: 1,
  });
  kms = new KMSClient({ endpoint, region: 'us-east-1', credentials, maxAttempts: 1 });
  const bucket = 'observation-private-' + uid('bucket'),
    publicBucket = 'observation-public-' + uid('bucket');
  for (const Bucket of [bucket, publicBucket]) {
    await s3.send(new CreateBucketCommand({ Bucket }));
    await s3.send(
      new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }),
    );
  }
  const key = (
    await kms.send(new CreateKeyCommand({ Description: 'Synthetic observation fixture' }))
  ).KeyMetadata!.Arn!;
  const d = await directory(),
    file = join(d, 'settings.json');
  await writeFile(file, JSON.stringify(settings), { mode: 0o600, flag: 'wx' });
  host = await createLocalServiceHost({
    APP_ENV: 'test-local',
    PROVIDER_MODE: 'fixtures',
    ISOLATED_TEST_PROJECT: project,
    SERVICE_HOST_CONFIG_FILE: file,
    SERVICE_HOST_JOURNAL_DIRECTORY: join(d, 'journal'),
    STORAGE_ENDPOINT: endpoint,
    WORKFLOW_ENDPOINT: process.env.TEST_WORKFLOW_ENDPOINT!,
    PRIVATE_BUCKET: bucket,
    PUBLIC_BUCKET: publicBucket,
    KMS_KEY_ID: key,
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'fixture-access',
    AWS_SECRET_ACCESS_KEY: 'fixture-secret',
  });
  expect(host.metadata.connections).toMatchObject({
    required: 69,
    capacity: 75,
    serverReserved: 5,
    usableCapacity: 70,
  });
  source = observationDatabase(process.env, f.connectionUrl('tt_operations_runtime'), f.staff, 69);
  token = randomBytes(32).toString('hex');
  receiver = createServer(async (req, res) => {
    if (req.url === '/moto-api/' && req.method === 'GET') {
      res
        .writeHead(
          storageHealthy && (await localHttpReady('http://moto:5000/moto-api/')) ? 200 : 503,
        )
        .end();
      return;
    }
    if (
      req.url !== '/internal/fixture-alerts' ||
      req.method !== 'POST' ||
      req.headers['x-fixture-token'] !== token
    ) {
      res.writeHead(403).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const b of req) {
        size += b.length;
        if (size > 4096) throw Error();
        chunks.push(b);
      }
      const message = alertSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (message.project !== project) throw Error();
      requests++;
      expect(requests).toBeLessThan(100);
      attempts.set(message.id, (attempts.get(message.id) ?? 0) + 1);
      if (mode === 'reject') {
        res.writeHead(503).end('synthetic private error');
        return;
      }
      if (mode === 'redirect') {
        res.writeHead(302, { location: 'https://example.invalid/never-follow' }).end();
        return;
      }
      if (mode === 'stall') return;
      if (mode === 'large') {
        res.writeHead(200).end('x'.repeat(2049));
        return;
      }
      if (mode === 'malformed') {
        res.writeHead(200).end('synthetic sensitive body');
        return;
      }
      effects.add(message.id);
      if (mode === 'lost') {
        res.destroy();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          project,
          id: mode === 'wrong' ? randomUUID() : message.id,
          accepted: true,
        }),
      );
    } catch {
      res.writeHead(400).end();
    }
  });
  receiver.listen(0, '127.0.0.1');
  await once(receiver, 'listening');
  const address = receiver.address();
  if (!address || typeof address === 'string') throw Error();
  origin = 'http://127.0.0.1:' + address.port;
  send = fixtureAlertTransport(origin + '/internal/fixture-alerts', project, token);
  worker = await startWorker(host, 8123, 'http://test:8123');
  console.log(
    'Waiting for actual isolated maintenance cron; no admission policy or recipient enabled',
  );
  const workflow = await proveWorkflow(f.owner, 'http://test:8123', 85000);
  metrics.schedule = {
    actualCompletedCron: true,
    expiredRemoved: workflow.expiredRemoved,
    unexpiredPreserved: workflow.unexpiredPreserved,
    admissionPolicyEnabled: workflow.admissionPolicyEnabled,
    productApiStatus: workflow.productApiStatus,
    elapsedMs: workflow.elapsedMs,
  };
  expect((await observer().sample()).healthy).toBe(true);
}, 120000);

afterAll(async () => {
  await admin?.query('ALTER ROLE tt_cms_runtime LOGIN');
  await source?.close();
  await worker?.stop();
  if (!worker) await host?.shutdown();
  if (receiver) {
    receiver.closeAllConnections();
    await new Promise<void>((r) => receiver.close(() => r()));
  }
  await admin?.end();
  s3?.destroy();
  kms?.destroy();
  await f?.cleanup();
  for (const d of directories) {
    expect(dirname(resolve(d))).toBe(resolve(tmpdir()));
    expect(d.split(/[\\/]/).at(-1)).toMatch(/^tt-observation-/);
    await rm(d, { recursive: true, force: true });
  }
  await mkdir('/observation', { recursive: true });
  await writeFile('/observation/metrics.json', JSON.stringify(metrics, null, 2) + '\n', {
    mode: 0o600,
  });
}, 30000);

it('observes actual queue backlog, denied/stale evidence, synthetic acknowledgement/escalation and fresh recovery', async () => {
  const monitor = observer(),
    r = await response(),
    prefix = 'synthetic-observation-' + randomUUID(),
    ids = Array.from({ length: 101 }, () => randomUUID()),
    began = performance.now();
  try {
    expect((await monitor.sample()).healthy).toBe(true);
    await f.owner.query(
      "INSERT INTO app.webhook_inbox(id,provider,provider_event_id,payload_digest,received_at,signature_verified_at) SELECT x,'resend',$2||':'||x,decode(repeat('ab',32),'hex'),now()-interval '1 hour',now() FROM unnest($1::uuid[])x",
      [ids, prefix],
    );
    const alarm = await monitor.sample();
    expect(alarm.events).toContainEqual({
      component: 'callbacks',
      state: 'alert',
      reasons: ['backlog', 'lag'],
    });
    await r.value.accept(alarm);
    await r.value.flush();
    expect((await monitor.sample()).events).toEqual([]);
    await f.owner.query(
      'UPDATE admin.staff_role_assignments SET revoked_at=clock_timestamp() WHERE staff_id=$1',
      [f.staff],
    );
    const denied = await monitor.sample();
    expect(denied.queues).toBeNull();
    expect(denied.capacity).toBeNull();
    expect(denied.activeAlerts).toContain('callbacks');
    r.advance(16000);
    await r.value.accept(denied);
    const incident = r.value.status().incidents.find((i) => i.component === 'callbacks')!;
    expect(incident.escalatedAt).not.toBeNull();
    await r.value.acknowledge(incident.id);
    expect(r.value.status().incidents.find((i) => i.id === incident.id)!.open).toBe(true);
    await f.owner.query(
      'DELETE FROM app.webhook_inbox WHERE id=ANY($1::uuid[]) AND provider_event_id LIKE $2',
      [ids, prefix + ':%'],
    );
    expect((await monitor.sample()).activeAlerts).toContain('callbacks');
    await f.owner.query(
      'UPDATE admin.staff_role_assignments SET revoked_at=NULL WHERE staff_id=$1',
      [f.staff],
    );
    const recovered = await monitor.sample();
    expect(recovered.healthy).toBe(true);
    await r.value.accept(recovered);
    for (let n = 0; n < 4; n++) await r.value.flush();
    expect(r.value.status().incidents.every((i) => !i.open)).toBe(true);
    expect(r.value.status().deliveryUncertain).toBe(false);
    const saved = await readFile(r.file, 'utf8');
    expect(saved).not.toContain(prefix);
    expect(saved).not.toContain(f.staff);
    expect(saved).not.toContain(new URL(f.connectionUrl('tt_operations_runtime')).password);
    metrics.response = {
      callbacks: 101,
      unchangedAlertSuppressed: true,
      deniedSnapshotWithheld: true,
      capacityWithheldOnRevocation: true,
      syntheticEscalationAfterMs: 15000,
      acknowledgmentDidNotResolve: true,
      freshRecovery: true,
      elapsedMs: Math.round(performance.now() - began),
    };
  } finally {
    await f.owner.query(
      'UPDATE admin.staff_role_assignments SET revoked_at=NULL WHERE staff_id=$1',
      [f.staff],
    );
    await f.owner.query(
      'DELETE FROM app.webhook_inbox WHERE id=ANY($1::uuid[]) AND provider_event_id LIKE $2',
      [ids, prefix + ':%'],
    );
    await r.value.close();
  }
});
it('measures real usable connection capacity under three controlled clients without confusing quota rows', async () => {
  await new Promise((r) => setTimeout(r, 1300));
  await observer().sample();
  const initial = await source.readCapacity(),
    baseline = Number(initial.backends),
    threshold = Math.floor(((baseline + 1) * 10000) / 70),
    monitor = observer(threshold),
    clients: pg.Client[] = [];
  try {
    expect((await monitor.sample()).activeAlerts).not.toContain('database_capacity');
    for (let n = 0; n < 3; n++) {
      const c = new pg.Client({
        connectionString: f.connectionUrl(n === 0 ? 'tt_operations_runtime' : 'tt_catalog_runtime'),
        application_name: 'tt-observation:pressure',
        connectionTimeoutMillis: 1000,
      });
      await c.connect();
      await c.query('SELECT 1');
      clients.push(c);
    }
    const visibility = (
      await clients[0]!.query(
        "SELECT count(*) FILTER(WHERE backend_type IS NULL)::int AS hidden,pg_has_role(current_user,'pg_read_all_stats','MEMBER') AS privileged FROM pg_stat_activity",
      )
    ).rows[0];
    expect(visibility.hidden).toBeGreaterThan(0);
    expect(visibility.privileged).toBe(false);
    const raised = await monitor.sample();
    expect(raised.capacity).toMatchObject({ raw: 75, serverReserved: 5, usable: 70, required: 69 });
    expect(raised.activeAlerts).toContain('database_capacity');
    const c = raised.capacity!;
    expect(c.usedBasisPoints).toBe(Math.floor((c.observedDatabaseBackends * 10000) / 70));
    expect(c.usedBasisPoints).toBeGreaterThan(
      Math.floor((c.observedDatabaseBackends * 10000) / 75),
    );
    expect(raised.queues!.find((q) => q.code === 'quota_capacity')!.queued).toBe(0);
    await Promise.all(clients.map((c) => c.end()));
    clients.length = 0;
    expect((await monitor.sample()).activeAlerts).not.toContain('database_capacity');
    metrics.capacity = {
      required: 69,
      raw: 75,
      serverReserved: 5,
      usable: 70,
      controlledClients: 3,
      baselineDatabaseBackends: baseline,
      observedDatabaseBackends: c.observedDatabaseBackends,
      fixtureThresholdBasisPoints: threshold,
      quotaRows: 0,
      readOnlyRuntimeRole: true,
      hiddenBackendDetails: true,
      counter: 'pg_stat_database.numbackends (conservative database backends)',
    };
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
});
it('detects real CMS-role readiness loss over HTTP and recovers only after runtime access returns', async () => {
  const monitor = observer();
  expect((await monitor.sample()).healthy).toBe(true);
  try {
    await admin.query('ALTER ROLE tt_cms_runtime NOLOGIN');
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='tt-service-host:cms'",
    );
    expect((await fetch('http://127.0.0.1:8123/health/ready')).status).toBe(503);
    expect((await monitor.sample()).activeAlerts).toContain('host_readiness');
  } finally {
    await admin.query('ALTER ROLE tt_cms_runtime LOGIN');
  }
  await vi.waitFor(async () => expect((await monitor.sample()).healthy).toBe(true), {
    timeout: 5000,
  });
  expect((await fetch('http://127.0.0.1:8123/api/reports')).status).toBe(404);
  metrics.readiness = {
    actualCmsLaneFailure: true,
    http503: true,
    recovered: true,
    productRouteStatus: 404,
  };
});
it('requires recent actual cron history and fresh dependency success, and reports a local storage-probe fault', async () => {
  const monitor = observer();
  expect((await monitor.sample()).healthy).toBe(true);
  try {
    scheduleFrom = Date.now() + 180000;
    expect((await monitor.sample()).activeAlerts).toContain('workflow_freshness');
  } finally {
    scheduleFrom = undefined;
  }
  expect((await monitor.sample()).healthy).toBe(true);
  try {
    storageHealthy = false;
    expect((await monitor.sample()).activeAlerts).toContain('storage_fixture');
  } finally {
    storageHealthy = true;
  }
  const stale = createFreshObserver({
    review: source.review,
    readCapacity: source.readCapacity,
    checks: {
      ...checks(),
      storage_fixture: async () => ({
        healthy: true,
        sampledAt: new Date(Date.now() - 11000).toISOString(),
      }),
    },
    now: Date.now,
    capacityThreshold: 8000,
  });
  expect((await stale.sample()).dependencyStatus.storage_fixture).toBe('stale');
  expect((await monitor.sample()).healthy).toBe(true);
  metrics.dependencies = {
    actualHistoryQueried: true,
    absentRecentRunRefused: true,
    stalePositiveRefused: true,
    localProxyFaultRefused: true,
    motoCustodyClaimed: false,
  };
});
it('persists uncertain delivery across journal-controller reopen, deduplicates lost acknowledgments and requires operator retry after exhaustion', async () => {
  const r = await response();
  try {
    await r.value.accept(brokenSample);
    const first = JSON.parse(await readFile(r.file, 'utf8')).events[0].message.id as string;
    mode = 'lost';
    expect((await r.value.flush()).deliveryUncertain).toBe(true);
    await r.restart();
    r.advance(1000);
    mode = 'ok';
    expect((await r.value.flush()).deliveryUncertain).toBe(false);
    expect(attempts.get(first)).toBe(2);
    expect(effects.has(first)).toBe(true);
    const bad = await response();
    try {
      await bad.value.accept(brokenSample);
      mode = 'reject';
      for (let n = 0; n < 3; n++) {
        await bad.value.flush();
        bad.advance(1000);
      }
      expect(bad.value.status().failed).toBe(1);
      const before = requests;
      await bad.value.flush();
      expect(requests).toBe(before);
      bad.advance(16000);
      await bad.value.accept(brokenSample);
      const incident = bad.value.status().incidents[0]!;
      expect(incident.escalatedAt).not.toBeNull();
      await bad.value.acknowledge(incident.id);
      expect(bad.value.status().failed).toBe(1);
      const failed = JSON.parse(await readFile(bad.file, 'utf8')).events[0].message.id as string;
      await bad.value.retry(failed);
      mode = 'ok';
      expect((await bad.value.flush()).failed).toBe(0);
      expect(bad.value.status().incidents[0]!.open).toBe(true);
      await bad.value.accept(clearSample);
      await bad.value.flush();
      expect(bad.value.status().incidents[0]!.open).toBe(false);
    } finally {
      await bad.value.close();
    }
    metrics.delivery = {
      lostAckAttempts: 2,
      sinkEffectsPerEvent: 1,
      componentReopenRetainedEventId: true,
      maxAutomaticAttempts: 3,
      exhaustedFailureVisible: true,
      manualRetryRequired: true,
      operatorAckDistinctFromDeliveryAck: true,
      actualRecipients: 0,
    };
  } finally {
    mode = 'ok';
    await r.value.close();
  }
});
it('enforces private exclusive journal ownership, bounded retention, malformed/foreign/symlink refusal and serialized response work', async () => {
  const r = await response();
  try {
    expect((await lstat(r.file)).mode & 0o777).toBe(0o600);
    await expect(
      localResponse({ file: r.file, env: process.env, now: Date.now, send }),
    ).rejects.toThrow();
    await r.value.accept(brokenSample);
    mode = 'stall';
    const flushing = r.value.flush();
    await new Promise((r) => setTimeout(r, 20));
    await expect(r.value.accept(clearSample)).rejects.toThrow(
      /^Local response evidence unavailable$/,
    );
    await flushing;
    mode = 'ok';
    r.advance(1000);
    await r.value.flush();
    r.advance(300001);
    await r.value.accept(brokenSample);
    expect(r.value.status().retainedEvents).toBe(0);
    expect(r.value.status().incidents[0]!.open).toBe(true);
    await r.value.close();
    const saved = await readFile(r.file, 'utf8');
    for (const body of [
      'x'.repeat(131073),
      JSON.stringify({ ...JSON.parse(saved), project: 'tt-test-0000000000000000' }),
      JSON.stringify({ ...JSON.parse(saved), secret: 'must refuse' }),
    ]) {
      await writeFile(r.file, body, { mode: 0o600 });
      await expect(
        localResponse({ file: r.file, env: process.env, now: Date.now, send }),
      ).rejects.toThrow(/^Local response evidence unavailable$/);
    }
    const target = join(dirname(r.file), 'unchanged.json');
    await writeFile(target, saved, { mode: 0o600 });
    await unlink(r.file);
    await symlink(target, r.file);
    await expect(
      localResponse({ file: r.file, env: process.env, now: Date.now, send }),
    ).rejects.toThrow(/^Local response evidence unavailable$/);
    expect(await readFile(target, 'utf8')).toBe(saved);
    metrics.journal = {
      mode: '0600',
      exclusive: true,
      serialized: true,
      maxBytes: 131072,
      pendingLimit: 32,
      deliveredHistoryLimit: 64,
      retentionMs: 300000,
      unresolvedIncidentRetained: true,
      malformedAndForeignRefused: true,
      symlinkRefused: true,
    };
  } finally {
    mode = 'ok';
    await r.value.close();
  }
});
it('refuses bad or stalled loopback acknowledgments, redirects and unapproved payloads without external delivery', async () => {
  const began = performance.now();
  try {
    for (const value of ['reject', 'wrong', 'redirect', 'large', 'malformed', 'stall']) {
      mode = value;
      const message: FixtureAlert = {
        schemaVersion: 1,
        project,
        id: randomUUID(),
        component: 'callbacks',
        state: 'alert',
        reasons: ['backlog'],
        at: stamp(),
      };
      await expect(send(message)).rejects.toThrow(/^Fixture alert delivery unavailable$/);
    }
    mode = 'ok';
    const before = requests,
      message = {
        schemaVersion: 1,
        project,
        id: randomUUID(),
        component: 'callbacks',
        state: 'alert',
        reasons: ['backlog'],
        at: stamp(),
        recipient: 'synthetic@example.invalid',
      };
    await expect(send(message as FixtureAlert)).rejects.toThrow(
      /^Fixture alert delivery unavailable$/,
    );
    expect(requests).toBe(before);
    expect((await observer().sample()).healthy).toBe(true);
    expect(host.metadata).toMatchObject({
      externalMail: false,
      productApis: false,
      reportIssuanceApproved: false,
      analyticsCollection: false,
      externalAdvertising: false,
    });
    metrics.transport = {
      badAcknowledgmentCases: 6,
      deadlineMs: 1000,
      boundedAckBytes: 2048,
      redirectsRefused: true,
      unknownRecipientFieldRefused: true,
      elapsedMs: Math.round(performance.now() - began),
    };
  } finally {
    mode = 'ok';
  }
}, 15000);
it('refuses a fourth automatic send after an injected interrupted final-attempt journal state', async () => {
  const r = await response();
  let resumed: Awaited<ReturnType<typeof localResponse>> | undefined;
  try {
    await r.value.accept(brokenSample);
    mode = 'lost';
    for (let n = 0; n < 3; n++) {
      await r.value.flush();
      r.advance(1000);
    }
    expect(r.value.status().failed).toBe(1);
    await r.value.close();
    const saved = JSON.parse(await readFile(r.file, 'utf8')),
      id = saved.events[0].message.id as string;
    expect(attempts.get(id)).toBe(3);
    saved.events[0].status = 'pending';
    saved.events[0].nextAttemptAt = 0;
    // Exact local failpoint state after persisting the final intent, before recording its outcome.
    await writeFile(r.file, JSON.stringify(saved), { mode: 0o600 });
    resumed = await localResponse({
      file: r.file,
      env: process.env,
      now: () => Date.now() + 5000,
      send,
    });
    mode = 'ok';
    expect((await resumed.flush()).failed).toBe(1);
    expect(attempts.get(id)).toBe(3);
    await resumed.retry(id);
    await resumed.flush();
    expect(attempts.get(id)).toBe(4);
    expect(effects.has(id)).toBe(true);
    metrics.interruptedIntent = {
      injectedFinalIntentState: true,
      actualOsCrash: false,
      automaticFourthSendRefused: true,
      explicitRetryRetainedId: true,
      receiverEffects: 1,
    };
  } finally {
    mode = 'ok';
    await resumed?.close();
    await r.value.close();
  }
});
