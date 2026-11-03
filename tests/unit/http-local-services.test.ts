import { it, expect, vi } from 'vitest';
import { localOperationRoutes } from '../../packages/integrations/src/http/local-services.ts';
import { ok, fail, id } from '../../packages/domain/src/values/core.ts';
import { PersistenceFailure } from '../../packages/db/src/transactions.ts';
import type { createTransactions } from '../../packages/db/src/transactions.ts';
import type { createLocalServiceHost } from '../../packages/integrations/src/service-host.ts';
import type { HttpContext } from '../../packages/integrations/src/http/core.ts';
const uuid = '11111111-1111-4111-8111-111111111111',
  staff = id('staff', uuid);
if (!staff.ok) throw Error('Test identity');
function setup() {
  const flags = { allow: true },
    query = vi.fn(async () => ({ rows: [{ allowed: flags.allow }] })),
    status = vi.fn(async () => ok({ state: 'validated' })),
    base = { authenticate: vi.fn(async () => null), quota: vi.fn(async () => ({ allowed: true })) };
  const scope = {
    query,
    abort: (_tx: unknown, error: ConstructorParameters<typeof PersistenceFailure>[0]) => {
      throw new PersistenceFailure(error);
    },
    unitOfWork: {
      run: async (fn: (tx: unknown) => Promise<unknown>) => {
        try {
          return await fn({});
        } catch (error) {
          if (error instanceof PersistenceFailure) return fail(error.failure);
          throw error;
        }
      },
    },
  } as unknown as ReturnType<typeof createTransactions>;
  const services = {
    imports: { service: { status } },
    contacts: {},
    delivery: {},
    privacy: {},
    staff: {},
    content: { services: {} },
    operations: {},
    commercial: {},
  } as unknown as Awaited<ReturnType<typeof createLocalServiceHost>>['services'];
  return {
    flags,
    query,
    status,
    base,
    deps: {
      policy: async () =>
        ok({
          version: 'synthetic',
          notices: {
            necessary: uuid,
            report: uuid,
            offers: uuid,
            analytics: uuid,
            ads: uuid,
            targeted_ads: uuid,
          },
        }),
      services,
      staffScope: scope,
      ownerSecurity: base,
      secret: new Uint8Array(32).fill(77),
      crypto: { id: () => uuid } as never,
      env: {},
    },
  };
}
const context = (body: unknown = null): HttpContext => ({
  body,
  actor: { staff: staff.value, keys: [], csrf: 'csrf' },
  params: { runId: uuid },
  query: new URLSearchParams(),
  request: new Request('http://127.0.0.1'),
  key: 'synthetic_command_001',
  peer: '127.0.0.1',
  responseHeaders: new Headers(),
});
it('defaults staff credentials to disabled and keeps owner authentication/quota delegation', async () => {
  const s = setup(),
    runtime = await localOperationRoutes(s.deps);
  expect(runtime.routes).toHaveLength(23);
  expect(await runtime.security.authenticate(new Request('http://127.0.0.1'))).toBeNull();
  expect(s.base.authenticate).toHaveBeenCalledOnce();
  await runtime.security.quota('127.0.0.1', 'read');
  expect(s.base.quota).toHaveBeenCalledOnce();
});
it('reauthorizes current PostgreSQL data-review permission before a masked import status', async () => {
  const s = setup(),
    runtime = await localOperationRoutes(s.deps),
    route = runtime.routes.find((r) => r.operationId === 'importStatus')!;
  expect(await route.handle(context())).toMatchObject({ ok: true });
  expect(s.query).toHaveBeenCalledWith(
    expect.anything(),
    'SELECT admin.authorize_operations($1,$2) AS allowed',
    [uuid, 'data.review'],
  );
  s.flags.allow = false;
  expect(await route.handle(context())).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  expect(s.status).toHaveBeenCalledOnce();
});
it('fails closed when no explicit local import-artifact directory is configured', async () => {
  const s = setup(),
    runtime = await localOperationRoutes(s.deps);
  await expect(
    runtime.routes
      .find((r) => r.operationId === 'prepareImport')!
      .handle(context({ artifactId: uuid })),
  ).rejects.toThrow('Local import artifact unavailable');
});
