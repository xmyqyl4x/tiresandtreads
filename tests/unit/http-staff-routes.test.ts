import { it, expect, vi } from 'vitest';
import { staffRoutes } from '../../packages/integrations/src/http/staff.ts';
import type { createLocalServiceHost } from '../../packages/integrations/src/service-host.ts';
import type { HttpContext } from '../../packages/integrations/src/http/core.ts';
import { ok, fail, id } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
const uuid = '11111111-1111-4111-8111-111111111111',
  staff = id('staff', uuid);
if (!staff.ok) throw Error('Invalid test identity');
const actor = staff.value;
function context(body: unknown = {}): HttpContext {
  return {
    body,
    actor: { staff: actor, keys: [], csrf: 'csrf', mfaAt: 1 },
    params: { runId: uuid, kind: 'imports' },
    query: new URLSearchParams(),
    request: new Request('http://127.0.0.1'),
    key: 'synthetic_command_001',
    peer: '127.0.0.1',
    responseHeaders: new Headers(),
  };
}
function setup() {
  const method = () => vi.fn(async () => ok(null));
  const imports = {
      prepare: method(),
      status: method(),
      diff: method(),
      publish: method(),
      rollback: method(),
    },
    staff = { queue: method(), recover: method() },
    content = { enqueue: method(), audit: method(), searchMetrics: method() },
    commercial = { revenue: method() },
    operations = { dashboard: method() };
  const services = {
    imports: { service: imports },
    staff,
    content: { services: content },
    commercial,
    operations,
  } as unknown as Awaited<ReturnType<typeof createLocalServiceHost>>['services'];
  const authorize = vi.fn(async () => ok(null)),
    artifact = vi.fn(async () => ({
      registration: {},
      frames: async function* () {
        yield { end: true };
      },
    })),
    commandId = vi.fn(() => uuid);
  const routes = staffRoutes({ services, authorize, artifact: artifact as never, commandId });
  return {
    imports,
    staff,
    content,
    commercial,
    operations,
    authorize,
    artifact,
    commandId,
    routes,
    handle: (operation: string, c: HttpContext) =>
      routes.find((r) => r.operationId === operation)!.handle(c),
  };
}
it('derives the publication actor and required source members on the server while preserving a full revision string', async () => {
  const s = setup(),
    c = context({
      bundleId: uuid,
      market: 'US',
      approvalId: uuid,
      expectedHead: { bundleId: uuid, revision: '9223372036854775807' },
      members: [{ key: 'catalog', kind: 'catalog', datasetId: uuid }],
    });
  expect(await s.handle('publishImport', c)).toMatchObject({ ok: true });
  expect(s.imports.publish).toHaveBeenCalledWith(
    expect.objectContaining({
      actorId: actor,
      required: [{ key: 'catalog', kind: 'catalog' }],
      expectedHead: { bundleId: uuid, revision: 9223372036854775807n },
    }),
  );
});
it.each(['prepareImport', 'importStatus', 'importDiff', 'publishImport', 'rollbackImport'])(
  'checks current data-review permission before %s or opening any local artifact',
  async (operation) => {
    const s = setup();
    s.authorize.mockResolvedValue(fail(failure('forbidden')) as never);
    expect(await s.handle(operation, context())).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    for (const method of Object.values(s.imports)) expect(method).not.toHaveBeenCalled();
    expect(s.artifact).not.toHaveBeenCalled();
  },
);
it.each([
  { path: 'C:/private/file' },
  { url: 'https://remote.invalid/data' },
  { artifactId: uuid, actorId: uuid },
])(
  'accepts only a registered artifact ID instead of caller-selected file/URL/function/actor inputs',
  async (body) => {
    const s = setup();
    expect(await s.handle('prepareImport', context(body))).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(s.artifact).not.toHaveBeenCalled();
  },
);
it('selects a registered artifact and delegates validation instead of accepting an upload function', async () => {
  const s = setup();
  expect(await s.handle('prepareImport', context({ artifactId: uuid }))).toMatchObject({
    ok: true,
  });
  expect(s.artifact).toHaveBeenCalledWith(uuid);
  expect(s.imports.prepare).toHaveBeenCalledOnce();
});
it('derives a stable recovery command ID from trusted staff identity and the idempotency key', async () => {
  const s = setup(),
    c = context({ kind: 'privacy_retry', target: uuid, evidence: 'a'.repeat(64) });
  expect(await s.handle('recoverOperation', c)).toMatchObject({ ok: true });
  expect(s.commandId).toHaveBeenCalledWith(actor, c.key);
  expect(s.staff.recover).toHaveBeenCalledWith(actor, uuid, 'privacy_retry', uuid, 'a'.repeat(64));
});
it('does not accept caller actor IDs on a publication command', async () => {
  const s = setup();
  expect(await s.handle('publishImport', context({ actorId: uuid }))).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  });
  expect(s.imports.publish).not.toHaveBeenCalled();
});
it('declares staff-only transport policy for the entire masked operations interface', () => {
  const s = setup();
  expect(s.routes).toHaveLength(12);
  expect(s.routes.every((r) => r.access === 'staff')).toBe(true);
});
