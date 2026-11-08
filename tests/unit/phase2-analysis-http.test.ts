import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  analysisApiInputs,
  photoApiInputs,
  analysisApiContracts,
  analysisStatusView,
  analysisAttachmentView,
} from '../../packages/contracts/src/phase2-analysis.ts';
import { privateAnalysisView } from '../../packages/integrations/src/http/phase2-analysis-views.ts';
import { analysisPhotoRoutes } from '../../packages/integrations/src/http/phase2-analysis.ts';
import { createHttpApi } from '../../packages/integrations/src/http/core.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
it('projects current owner processing permission without exposing scope ownership internals', () => {
  const request = randomUUID(),
    scopeId = randomUUID(),
    reportId = randomUUID();
  const view = analysisStatusView.parse({
    id: request,
    reportId,
    version: 1,
    state: 'pending',
    output: null,
    processing: {
      scopeId,
      permissionRevision: '2',
      allowed: false,
      ownerId: 'PRIVATE',
      manifest: { hidden: true },
    },
  });
  expect(view).toHaveProperty('processing', { scopeId, permissionRevision: '2', allowed: false });
  expect(JSON.stringify(view)).not.toContain('PRIVATE');
});
it('accepts only an explicit analysis action and bounded processing notice', () => {
  const input = { policyId: randomUUID(), allowed: true, noticeVersion: 'ai-processing-v1' };
  expect(analysisApiInputs.request.safeParse(input).success).toBe(true);
  for (const extra of [
    { allowed: undefined },
    { noticeVersion: '' },
    { prompt: 'injected' },
    { ownerId: randomUUID() },
    { key: 'caller-command' },
  ])
    expect(analysisApiInputs.request.safeParse({ ...input, ...extra }).success).toBe(false);
});
it('declares every analysis/photo operation as owner-only and asynchronous deletion explicitly', () => {
  expect(analysisApiContracts).toHaveLength(12);
  expect(analysisApiContracts.every((x) => x.access === 'owner')).toBe(true);
  expect(new Set(analysisApiContracts.map((x) => x.operationId)).size).toBe(12);
  expect(
    analysisApiContracts.find((x) => x.operationId === 'p2PhotoDelete')?.successStatuses,
  ).toEqual([202]);
  expect(analysisApiContracts.find((x) => x.operationId === 'p2PhotoFinalize')?.maxBodyBytes).toBe(
    10485760,
  );
});
it.each(['not_requested', 'pending', 'unavailable', 'expired'])(
  'does not expose a model output for %s',
  (state) => {
    const value = { id: null, state, reportId: randomUUID(), version: 1, output: null };
    expect(analysisStatusView.safeParse(value).success).toBe(true);
    expect(analysisStatusView.safeParse({ ...value, output: { prompt: 'private' } }).success).toBe(
      false,
    );
  },
);
it('never declares an absent attachment or output available and hides malformed private service values', () => {
  expect(
    analysisAttachmentView.safeParse({
      state: 'available',
      reportId: randomUUID(),
      version: 1,
      attachment: null,
    }).success,
  ).toBe(false);
  expect(
    analysisStatusView.safeParse({
      state: 'available',
      id: randomUUID(),
      reportId: randomUUID(),
      version: 1,
      output: null,
    }).success,
  ).toBe(false);
  expect(() => privateAnalysisView(analysisAttachmentView, ok({ prompt: 'private' }))).toThrow(
    'unavailable',
  );
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() => privateAnalysisView(analysisAttachmentView, ok(cyclic))).toThrow('unavailable');
  expect(() =>
    privateAnalysisView(analysisAttachmentView, ok({ private: 'x'.repeat(65537) })),
  ).toThrow('unavailable');
});
it('projects nested private photo fields explicitly instead of forwarding future service metadata', async () => {
  const id = randomUUID(),
    candidate = randomUUID(),
    origin = 'http://127.0.0.1',
    routes = analysisPhotoRoutes({
      analysis: {} as never,
      photos: {
        get: async () =>
          ok({
            id,
            state: 'ready',
            expiresAt: new Date().toISOString(),
            dotStatus: 'not_visible',
            limitations: [],
            candidates: [
              {
                id: candidate,
                uploadId: id,
                field: 'tire_size',
                ordinal: 1,
                rawText: '225/65R17',
                value: '225/65R17',
                unknownReason: null,
                quality: 'clear',
                region: null,
                providerSecret: 'provider-secret',
              },
            ],
            confirmations: [],
          }),
      } as never,
      privacy: {} as never,
      admission: { claim: async () => true },
      secret: new Uint8Array(32).fill(8),
    });
  const api = createHttpApi({
      origin,
      routes,
      security: {
        authenticate: async () => ({ keys: [], csrf: 'local' }),
        quota: async () => ({ allowed: true }),
      },
    }),
    response = await api(new Request(origin + '/api/v1/photos/' + id)),
    body = await response.text();
  expect(response.status).toBe(200);
  expect(body).not.toContain('provider-secret');
  expect(JSON.parse(body).data.candidates[0].id).toBe(candidate);
});
it('admits owner photo intents with reviewed metadata rather than caller paths or URLs', () => {
  const input = {
    allowed: true,
    batchId: randomUUID(),
    mime: 'image/jpeg',
    noticeVersion: 'photo-processing-v1',
    policyId: randomUUID(),
    sha256: 'a'.repeat(64),
    size: 100,
  };
  expect(photoApiInputs.intent.safeParse(input).success).toBe(true);
  for (const extra of [
    { size: 10485761 },
    { size: 0 },
    { mime: 'image/svg+xml' },
    { url: 'https://example.com/photo' },
    { file: 'C:/private.jpg' },
    { ownerId: randomUUID() },
  ])
    expect(photoApiInputs.intent.safeParse({ ...input, ...extra }).success).toBe(false);
});
it('requires an explicit confirmation value and expected revision for a supported field', () => {
  const input = { candidateId: null, field: 'tire_size', revision: '1', value: '225/65R17' };
  expect(photoApiInputs.confirm.safeParse(input).success).toBe(true);
  for (const extra of [
    { field: 'safe_to_drive' },
    { revision: '0' },
    { value: null },
    { confirmed: true },
    { reportId: randomUUID() },
  ])
    expect(photoApiInputs.confirm.safeParse({ ...input, ...extra }).success).toBe(false);
});
