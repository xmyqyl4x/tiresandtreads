import { it, expect, vi } from 'vitest';
import { readWorkerConfig } from '../../packages/config/src/worker.ts';
import { boundedIO } from '../../packages/integrations/src/bounded-io.ts';
import { createWorkflows } from '../../packages/integrations/src/workflows.ts';
import { createRuntimePool } from '../../packages/db/src/runtime-pool.ts';
import { http, HttpResponse } from 'msw';
import { fixtureServer } from '../setup.ts';
import { id } from '../../packages/domain/src/values/core.ts';
const env = {
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  PRIVATE_DATABASE_URL: 'postgresql://tt_private_runtime:canary@postgres/tt_app',
  ASSET_DATABASE_URL: 'postgresql://tt_asset_runtime:canary@postgres/tt_app',
  STORAGE_ENDPOINT: 'http://moto:5000',
  WORKFLOW_ENDPOINT: 'http://inngest:8288',
  PRIVATE_BUCKET: 'fixture-private',
  PUBLIC_BUCKET: 'fixture-public',
  KMS_KEY_ID: 'fixture-key',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'fixture-access',
  AWS_SECRET_ACCESS_KEY: 'fixture-secret',
};
it('uses explicit local provider endpoints, narrow roles, finite pools and host-neutral revision metadata', () => {
  const result = readWorkerConfig(env);
  expect(result.poolMax).toBe(2);
  expect(result.reserve).toBe(20);
  expect(result.revision).toBe('working');
  expect(Object.isFrozen(result)).toBe(true);
});
it.each([
  { PRIVATE_DATABASE_URL: 'postgresql://postgres:canary@postgres/tt_app' },
  { PRIVATE_DATABASE_URL: 'postgresql://tt_private_runtime:canary@remote.invalid/tt_app' },
  { ASSET_DATABASE_URL: 'postgresql://tt_asset_runtime:canary@postgres/tt_app?sslmode=disable' },
  { STORAGE_ENDPOINT: 'https://s3.amazonaws.com' },
  { WORKFLOW_ENDPOINT: 'http://canary@inngest:8288/' },
  { PRIVATE_BUCKET: 'fixture-public' },
  { DB_POOL_MAX: '0' },
  { AWS_ACCESS_KEY_ID: 'canary' },
  { SOURCE_REVISION: 'canary' },
])('fails closed without echoing invalid credentials or endpoints', (patch) => {
  expect(() => readWorkerConfig({ ...env, ...patch })).toThrow(/^Invalid worker configuration$/);
});
it('bounds provider calls and aborts a stalled transport without leaking its error', async () => {
  expect(await boundedIO(async () => 42)).toBe(42);
  await expect(
    boundedIO(async () => {
      throw Error('canary secret');
    }),
  ).rejects.toThrow(/^Provider unavailable$/);
  vi.useFakeTimers();
  try {
    let signal: AbortSignal | undefined;
    const pending = boundedIO((s) => {
      signal = s;
      return new Promise(() => {});
    }, 20);
    const checked = expect(pending).rejects.toThrow(/^Provider unavailable$/);
    await vi.advanceTimersByTimeAsync(21);
    await checked;
    expect(signal!.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it('rejects malformed durable job references before dispatch', async () => {
  const run = vi.fn(),
    w = createWorkflows({
      appId: 'fixture',
      baseUrl: 'http://inngest:8288',
      run,
      reconcile: async () => [],
    });
  await expect(w.dispatch('canary')).rejects.toThrow('Invalid job reference');
  expect(run).not.toHaveBeenCalled();
  expect(w.functions).toHaveLength(2);
});
it('rejects unbounded pools and shutdown limits before opening a socket', () => {
  expect(() => createRuntimePool('canary', 0)).toThrow('Invalid pool bounds');
  expect(() => createRuntimePool('canary', 1, 0)).toThrow('Invalid pool bounds');
  const pool = createRuntimePool('postgresql://tt_private_runtime:fixture@localhost/tt_app');
  expect(() => pool.drain(0)).toThrow('Invalid drain deadline');
  return pool.drain();
});
it('retains frozen resource version/revision separately from the event schema version on the actual SDK wire', async () => {
  let sent: unknown;
  fixtureServer.use(
    http.post('http://inngest:8288/e/:key', async ({ request }) => {
      sent = await request.json();
      return HttpResponse.json({ status: 200, ids: ['01HZZZZZZZZZZZZZZZZZZZZZZZ'] });
    }),
  );
  const event = id('event', '11111111-1111-4111-8111-111111111111'),
    aggregate = id('aggregate', '22222222-2222-4222-8222-222222222222');
  if (!event.ok || !aggregate.ok) throw Error('fixture');
  const workflow = createWorkflows({
    appId: 'fixture',
    baseUrl: 'http://inngest:8288',
    run: async () => {},
    reconcile: async () => [],
  });
  await workflow.publisher.publish({
    eventId: event.value,
    aggregateId: aggregate.value,
    aggregateKind: 'report',
    type: 'report/frozen',
    version: 1,
    payload: {
      resource_id: aggregate.value,
      resource_kind: 'report',
      version: 7,
      revision: '9007199254740993',
    },
  });
  expect(sent).toMatchObject([
    {
      id: event.value,
      name: 'report/frozen',
      data: {
        resource_id: aggregate.value,
        resource_kind: 'report',
        version: 7,
        revision: '9007199254740993',
        schema_version: 1,
      },
    },
  ]);
});
