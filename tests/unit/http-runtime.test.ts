import { beforeEach, it, expect, vi } from 'vitest';
import { http, passthrough } from 'msw';
import { fixtureServer } from '../setup.ts';
const mocked = vi.hoisted(() => ({
  host: vi.fn(),
  drain: vi.fn(async () => {}),
  read: vi.fn(async () => ({ ok: true, value: { title: 'Synthetic' } })),
  settings: vi.fn(),
  redirect: vi.fn<
    (path: string) => Promise<{ code: 301 | 302 | 410; target: string | null } | null>
  >(async () => null),
}));
vi.mock('../../packages/integrations/src/service-host-config.ts', () => ({
  loadServiceHostSettings: mocked.settings,
}));
vi.mock('../../packages/integrations/src/service-host.ts', () => ({
  createLocalServiceHost: mocked.host,
}));
vi.mock('../../packages/db/src/runtime-pool.ts', () => ({
  createRuntimePool: () => ({ pool: {}, drain: mocked.drain }),
}));
vi.mock('../../packages/db/src/transactions.ts', () => ({
  createTransactions: () => ({
    query: async () => ({ rows: [] }),
    unitOfWork: { run: async (fn: (tx: unknown) => unknown) => fn({}) },
  }),
}));
vi.mock('../../packages/integrations/src/http/security.ts', () => ({
  createLocalHttpSecurity: () => ({
    sessions: [],
    security: { authenticate: async () => null, quota: async () => ({ allowed: true }) },
  }),
}));
import { createLocalPublicApi } from '../../packages/integrations/src/http/local-runtime.ts';
const env = {
  LOCAL_PRODUCT_API: 'enabled',
  APP_ENV: 'test-local',
  PROVIDER_MODE: 'fixtures',
  STORAGE_ENDPOINT: 'http://127.0.0.1:5000',
  AWS_REGION: 'us-east-1',
  PRIVATE_BUCKET: 'synthetic',
  KMS_KEY_ID: 'synthetic',
};
const lanes = ['report', 'catalog', 'limiter', 'asset', 'staff'];
function settings() {
  return {
    plan: {
      urls: Object.fromEntries(
        lanes.map((l) => [l, 'postgresql://synthetic:synthetic@127.0.0.1/fixture']),
      ),
      external: lanes.map((l) => ({
        name: 'local_http_' + l,
        database: 'application',
        max: 1,
        replicas: 1,
      })),
    },
    keys: {
      report: { current: 'test-v1', values: { 'test-v1': '99'.repeat(32) } },
      lookup: { synthetic: '77'.repeat(32) },
      token: { current: 'test-v1', values: { 'test-v1': '99'.repeat(32) } },
      contactIdentity: '66'.repeat(32),
      reportIdentity: '88'.repeat(32),
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocked.redirect.mockResolvedValue(null);
  mocked.settings.mockReturnValue(settings());
  mocked.host.mockResolvedValue({
    services: {
      reports: {},
      content: { services: { readPage: mocked.read }, routing: { redirect: mocked.redirect } },
    },
    shutdown: vi.fn(async () => {}),
  });
});
it.each([
  { ...env, LOCAL_PRODUCT_API: undefined },
  { ...env, APP_ENV: 'production' },
  { ...env, PROVIDER_MODE: 'live' },
])('refuses activation outside explicit fixture-local mode', async (input) => {
  await expect(createLocalPublicApi(input)).rejects.toThrow('activation refused');
  expect(mocked.host).not.toHaveBeenCalled();
});
it('refuses omitted HTTP connection reservations before composing the service host', async () => {
  const value = settings();
  value.plan.external = [];
  mocked.settings.mockReturnValue(value);
  await expect(createLocalPublicApi(env)).rejects.toThrow('budget');
  expect(mocked.host).not.toHaveBeenCalled();
});
it('composes the real loopback transport over supplied local services and drains all five HTTP pools', async () => {
  const api = await createLocalPublicApi(env);
  fixtureServer.use(http.all(api.origin + '/*', () => passthrough()));
  try {
    expect(api.metadata).toMatchObject({
      mode: 'local-only',
      publicActivation: false,
      S3Accepted: false,
    });
    const r = await fetch(api.origin + '/api/v1/content?path=/learn/tire-basics');
    expect(r.status).toBe(200);
    expect(mocked.read).toHaveBeenCalledWith('/learn/tire-basics', 'en-US', 'US');
    expect((await fetch(api.origin + '/api/v1/content?unknown=true')).status).toBe(400);
    expect((await fetch(api.origin + '/api/v1/content?path=/learn/a&path=/learn/b')).status).toBe(
      400,
    );
    expect((await fetch(api.origin + '/api/v1/content?path=/learn/a&locale=fr-FR')).status).toBe(
      400,
    );
    expect(
      (
        await fetch(api.origin + '/api/v1/download', {
          headers: { authorization: 'Bearer malformed' },
        })
      ).status,
    ).toBe(404);
  } finally {
    await api.shutdown();
  }
  expect(mocked.drain).toHaveBeenCalledTimes(5);
});
it('drains composed resources if cryptographic configuration fails before listener admission', async () => {
  const value = settings();
  value.keys.report.values['test-v1'] = '';
  mocked.settings.mockReturnValue(value);
  await expect(createLocalPublicApi(env)).rejects.toThrow('Local API unavailable');
  expect(mocked.drain).toHaveBeenCalledTimes(5);
});
it.each([
  { LOCAL_HTTP_OBSERVATIONS: 'verbose' },
  { LOCAL_CALLBACK_KEYS_FILE: 'C:/missing-local-fixture-callback-keys.json' },
])('refuses malformed local callback/log settings before composing any services', async (extra) => {
  let admitted: Awaited<ReturnType<typeof createLocalPublicApi>> | undefined;
  try {
    await expect(
      createLocalPublicApi({ ...env, ...extra }).then((value) => {
        admitted = value;
        return value;
      }),
    ).rejects.toThrow();
  } finally {
    await admitted?.shutdown();
  }
  expect(mocked.host).not.toHaveBeenCalled();
});

it.each([
  { code: 301 as const, target: '/guides/new' },
  { code: 302 as const, target: '/learn/tire-basics' },
  { code: 410 as const, target: null },
])(
  'resolves published $code routing before a page read through the actual local HTTP composition',
  async (redirect) => {
    mocked.redirect.mockResolvedValue(redirect);
    const api = await createLocalPublicApi(env);
    fixtureServer.use(http.all(api.origin + '/*', () => passthrough()));
    try {
      const response = await fetch(api.origin + '/api/v1/content?path=/learn/old');
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({ redirect });
      expect(mocked.redirect).toHaveBeenCalledWith('/learn/old');
      expect(mocked.read).not.toHaveBeenCalled();
    } finally {
      await api.shutdown();
    }
  },
);
