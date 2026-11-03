import { it, expect, vi } from 'vitest';
import { publicOwnerRoutes } from '../../packages/integrations/src/http/public-owner.ts';
import type { createReportServices } from '../../packages/application/src/services/reports.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
import { engineFixture } from '../fixtures/engine/base.ts';
const names = [
  'create',
  'readOwner',
  'saveDraft',
  'refine',
  'compare',
  'saveQuote',
  'readQuote',
  'readComparison',
  'share',
  'revoke',
  'readShared',
  'fork',
  'ownerDownload',
  'sharedDownload',
] as const;
function setup() {
  const methods = Object.fromEntries(names.map((name) => [name, vi.fn(async () => ok({ name }))]));
  const lookup = vi.fn(async () => ok(null)),
    content = vi.fn(async () => ok(null)),
    shareKeys = vi.fn(() => []);
  const routes = publicOwnerRoutes({
    reports: methods as unknown as ReturnType<typeof createReportServices>,
    shareKeys,
    lookup,
    content,
    download: async () => ok({ bytes: new Uint8Array(), mime: 'application/pdf' }),
  });
  return { methods, routes, lookup, content, shareKeys };
}
it.each(names)(
  'binds %s to its existing business service, using only trusted actor keys',
  async (name) => {
    const s = setup(),
      route = s.routes.find(
        (r) =>
          r.operationId ===
          {
            create: 'createReport',
            readOwner: 'readReport',
            saveDraft: 'saveDraft',
            refine: 'refineReport',
            compare: 'compareReport',
            saveQuote: 'saveQuote',
            readQuote: 'readQuote',
            readComparison: 'readComparison',
            share: 'shareReport',
            revoke: 'revokeShare',
            readShared: 'readSharedReport',
            fork: 'forkReport',
            ownerDownload: 'ownerPdf',
            sharedDownload: 'sharedPdf',
          }[name],
      )!;
    await route.handle({
      actor: { keys: [], csrf: 'csrf' },
      key: 'synthetic_command_001',
      body:
        (
          {
            create: engineFixture().request,
            fork: engineFixture().request,
            saveDraft: { baseVersion: 1, expectedRevision: null, input: engineFixture().request },
            refine: { baseVersion: 1, draftRevision: '1', expectedRevision: '1' },
            compare: {
              version: 1,
              expectedRevision: null,
              items: [{ kind: 'quote', key: '11111111-1111-4111-8111-111111111111' }],
            },
            saveQuote: {
              id: null,
              expectedRevision: null,
              skuId: null,
              productText: 'Synthetic',
              shopName: 'Synthetic',
              currency: 'USD',
              totalMinor: '1000',
              quantity: 4,
              basis: 'installed_set',
              observedOn: '2026-11-03',
              taxContextConfirmed: false,
              taxIncluded: false,
              components: [],
            },
            share: { version: 1, comparisonRevision: null },
            revoke: {},
            ownerDownload: { assetId: '11111111-1111-4111-8111-111111111111', version: 1 },
            sharedDownload: { assetId: '11111111-1111-4111-8111-111111111111' },
          } as Partial<Record<(typeof names)[number], unknown>>
        )[name] ?? null,
      params: { reportId: 'report', quoteId: 'quote', revision: '1', capabilityId: 'cap' },
      query: new URLSearchParams('version=1'),
      request: new Request('http://127.0.0.1/api/v1/shared', {
        headers: { authorization: 'Bearer token', 'x-share-token': 'share' },
      }),
      peer: '127.0.0.1',
      responseHeaders: new Headers(),
    });
    expect(s.methods[name]).toHaveBeenCalledOnce();
    expect(s.methods[name]!.mock.calls[0]).toEqual(expect.arrayContaining([[]]));
  },
);
it('exposes reusable public tools with invalid input refusal', async () => {
  const s = setup();
  for (const path of ['size', 'checklist', 'scorecard']) {
    const route = s.routes.find((r) => r.path.endsWith('/tools/' + path))!;
    const context = {
      actor: null,
      key: '',
      body: {},
      params: {},
      query: new URLSearchParams(),
      request: new Request('http://127.0.0.1'),
      peer: '127.0.0.1',
      responseHeaders: new Headers(),
    };
    expect(await route.handle(context)).toMatchObject({ ok: false });
    expect(await route.handle({ ...context, body: { input: null } })).toMatchObject({
      ok: path === 'size',
    });
  }
  const route = s.routes.find((r) => r.operationId === 'toolsize')!;
  expect(
    await route.handle({
      actor: null,
      key: '',
      body: { input: '225/65R17' },
      params: {},
      query: new URLSearchParams(),
      request: new Request('http://127.0.0.1'),
      peer: '127.0.0.1',
      responseHeaders: new Headers(),
    }),
  ).toMatchObject({ ok: true });
});
it('delegates published lookup/content reads without owner identity or arbitrary service dispatch', async () => {
  const s = setup();
  for (const path of ['/reference', '/content'])
    await s.routes
      .find((r) => r.path.endsWith(path))!
      .handle({
        actor: null,
        key: '',
        body: null,
        params: {},
        query: new URLSearchParams(),
        request: new Request('http://127.0.0.1'),
        peer: '127.0.0.1',
        responseHeaders: new Headers(),
      });
  expect(s.lookup).toHaveBeenCalledOnce();
  expect(s.content).toHaveBeenCalledOnce();
  expect(s.routes).toHaveLength(20);
});
