import { it, expect, vi } from 'vitest';
import { createP2OwnerClient } from '../../packages/contracts/src/phase2-owner-client.ts';
import { createP2PartnerClient } from '../../packages/contracts/src/phase2-partner-client.ts';
import { createP2StaffClient } from '../../packages/contracts/src/phase2-staff-client.ts';
import { phase2OpenApi } from '../../scripts/contracts/phase2-openapi.ts';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createHttpApi } from '../../packages/integrations/src/http/core.ts';
const id = 'b378bf40-18ab-454f-8eb3-71da7d81d81f';
const requestId = '96298e66-c11c-4108-bbaa-1ec04efdb881';
const cmd = { key: 'client-command', csrf: 'csrf' };
const reply = (data: unknown) => new Response(JSON.stringify({ data, requestId }), { status: 200 });
it('round-trips existing deterministic database identities without rewriting them and rejects the nil ID', async () => {
  const stableId = 'aabbccdd-1111-2aaa-0bbb-123456789abc';
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(reply({ id: stableId, status: 'pending', revision: '1' }));
  expect(
    (
      await createP2PartnerClient('http://localhost:3000', transport).p2Register({
        body: { legalName: 'Example', market: 'US' },
        command: cmd,
      })
    ).data.id,
  ).toBe(stableId);
  await expect(
    createP2OwnerClient('http://localhost:3000', transport).p2PhotoStatus({
      path: { upload: '00000000-0000-0000-0000-000000000000' },
    }),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});
it('keeps ambient owner cookies off partner and staff bearer transports', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(reply({ schemaVersion: 1, csrf: 'csrf', kind: 'partner-session' }));
  await createP2PartnerClient('http://localhost:3000', transport).p2PartnerSession({});
  expect(transport.mock.calls[0]![1]?.credentials).toBe('omit');
  transport.mockResolvedValueOnce(reply({ id, publicationBundleId: id }));
  await createP2StaffClient('http://localhost:3000', transport).p2CsvReceipt({
    path: { intake: id },
  });
  expect(transport.mock.calls[1]![1]?.credentials).toBe('omit');
});
it('retains the manual photo fallback with no upload or grant', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(reply({ state: 'manual', id: null, grant: null, grantUntil: null }));
  const result = await createP2OwnerClient('http://localhost:3000', transport).p2PhotoIntent({
    body: {
      allowed: false,
      batchId: id,
      mime: 'image/jpeg',
      noticeVersion: 'v1',
      policyId: id,
      sha256: 'a'.repeat(64),
      size: 1,
    },
    command: cmd,
  });
  expect(result.data.state).toBe('manual');
  expect(result.data.id).toBeNull();
});
it('returns structured invalid CSV admission with its bounded safe error file', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      reply({ id: null, phase: 'invalid', errors: 'row,reason\n1,invalid_header\n' }),
    );
  const result = await createP2StaffClient('http://localhost:3000', transport).p2CsvUpload({
    query: {
      templateId: id,
      providerId: id,
      licenseId: id,
      market: 'US',
      effectiveAt: new Date().toISOString(),
      externalVersion: 'synthetic',
    },
    bytes: new Uint8Array([1]),
    command: cmd,
  });
  expect(result.data.id).toBeNull();
  expect(result.data.phase).toBe('invalid');
});
it('validates closed input and canonical paths before any request', async () => {
  const transport = vi.fn<typeof fetch>();
  const client = createP2OwnerClient('http://localhost:3000', transport);
  await expect(
    client.p2AnalysisRequest({
      path: { report: id, version: '01' },
      body: { policyId: id, allowed: true, noticeVersion: 'v1' },
      command: cmd,
    }),
  ).rejects.toThrow();
  await expect(
    client.p2AnalysisRequest({
      path: { report: id, version: '1' },
      body: { policyId: id, allowed: true, noticeVersion: 'v1', provider: 'other' } as never,
      command: cmd,
    }),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
it('sends exact bytes and grant headers without grant in the URL', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    reply({
      id,
      state: 'ready',
      expiresAt: new Date().toISOString(),
      dotStatus: 'not_visible',
      candidates: [],
      confirmations: [],
      limitations: [],
    }),
  );
  const bytes = new Uint8Array([1, 2]);
  await createP2OwnerClient('http://localhost:3000', transport).p2PhotoFinalize({
    path: { upload: id },
    bytes,
    grant: 'a'.repeat(64),
    command: cmd,
  });
  const [url, init] = transport.mock.calls[0]!;
  expect(String(url)).not.toContain('grant');
  expect(new Headers(init?.headers).get('x-upload-grant')).toBe('a'.repeat(64));
  expect(new Headers(init?.headers).get('content-type')).toBe('application/octet-stream');
  expect(init?.redirect).toBe('error');
});
it('rejects invalid private response states rather than accepting arbitrary provider output', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(reply({ id, reportId: id, version: 1, state: 'available', output: null }));
  await expect(
    createP2OwnerClient('http://localhost:3000', transport).p2AnalysisStatus({
      path: { request: id },
    }),
  ).rejects.toThrow();
});
it('does not retry ambiguous conflicts or invent command credentials', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        code: 'conflict',
        messageKey: 'errors.conflict',
        fieldErrors: {},
        retryable: false,
        requestId,
      }),
      { status: 409 },
    ),
  );
  await expect(
    createP2OwnerClient('http://localhost:3000', transport).p2PhotoExtract({
      path: { upload: id },
      body: {},
      command: cmd,
    }),
  ).rejects.toBeDefined();
  expect(transport).toHaveBeenCalledTimes(1);
  expect(new Headers(transport.mock.calls[0]![1]?.headers).get('idempotency-key')).toBe(cmd.key);
});
it('keeps tenant and staff clients limited to their declared operation inventory', () => {
  const partner = createP2PartnerClient('http://localhost:3000');
  const staff = createP2StaffClient('http://localhost:3000');
  expect(Object.keys(partner)).toHaveLength(36);
  expect(Object.keys(staff)).toHaveLength(13);
  expect('p2CsvPublish' in partner).toBe(false);
  expect('p2Register' in staff).toBe(false);
});
it('requires explicit analysis revision or fallback for frozen delivery', async () => {
  const transport = vi.fn<typeof fetch>();
  await expect(
    createP2OwnerClient('http://localhost:3000', transport).p2AnalysisDelivery({
      body: {
        email: 'person@example.invalid',
        report: { id, version: 1 },
        offers: false,
        notices: { report: id },
        analysis: { attachmentRevision: '1', fallback: 'unavailable' } as never,
      },
      command: cmd,
    }),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
it('exports a deterministic private-only OpenAPI document with all versioned operations', () => {
  const document = phase2OpenApi();
  expect(document.openapi).toBe('3.1.0');
  const operations = Object.values(document.paths).flatMap((p) => Object.values(p));
  expect(operations).toHaveLength(72);
  expect(new Set(operations.map((p) => p.operationId)).size).toBe(72);
  for (const p of operations) expect(p.security.length).toBeGreaterThan(0);
  expect(document['x-actual-acceptance']).toBe(false);
});
it('documents the actual flat private HTTP error envelope', async () => {
  const origin = 'http://127.0.0.1:3000';
  const api = createHttpApi({
    origin,
    routes: [
      {
        operationId: 'p2PhotoStatus',
        method: 'GET',
        path: '/api/v1/photos/:upload',
        access: 'owner',
        handle: async () => ({ ok: true, value: null }),
      },
    ],
    security: { authenticate: async () => null, quota: async () => ({ allowed: true }) },
  });
  const response = await api(new Request(origin + '/api/v1/photos/' + id));
  expect(response.status).toBe(401);
  const body = await response.json();
  expect(body.code).toBe('unauthorized');
  const operation = phase2OpenApi().paths['/api/v1/photos/{upload}']!.get!;
  const responses = operation.responses as Record<
    string,
    {
      content: {
        'application/json': { schema: { properties: Record<string, unknown>; required: string[] } };
      };
    }
  >;
  const schema = responses['401']!.content['application/json'].schema;
  expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(body).sort());
  expect(schema.required.sort()).toEqual(Object.keys(body).sort());
});

it.each([
  {
    path: { upload: '../secret' },
    bytes: new Uint8Array([1]),
    grant: 'a'.repeat(64),
    command: cmd,
  },
  {
    path: { upload: id, url: 'https://example.invalid' },
    bytes: new Uint8Array([1]),
    grant: 'a'.repeat(64),
    command: cmd,
  },
  { path: { upload: id }, bytes: new Uint8Array(), grant: 'a'.repeat(64), command: cmd },
  { path: { upload: id }, bytes: new Uint8Array(10485761), grant: 'a'.repeat(64), command: cmd },
  { path: { upload: id }, bytes: new Uint8Array([1]), grant: 'not-a-grant', command: cmd },
  {
    path: { upload: id },
    bytes: new Uint8Array([1]),
    grant: 'a'.repeat(64),
    command: { ...cmd, key: '' },
  },
  {
    path: { upload: id },
    bytes: new Uint8Array([1]),
    grant: 'a'.repeat(64),
    command: { ...cmd, csrf: '' },
  },
  { path: { upload: id }, bytes: new Uint8Array([1]), grant: 'a'.repeat(64) },
])('refuses malformed binary admission without invoking its transport %#', async (input) => {
  const transport = vi.fn<typeof fetch>();
  await expect(
    createP2OwnerClient('http://localhost:3000', transport).p2PhotoFinalize(input as never),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
it('encodes only bounded declared query values and preserves the caller abort signal', async () => {
  const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(reply({ text: 'Preview', html: '<p>Preview</p>' })),
    signal = new AbortController().signal;
  await createP2PartnerClient('http://localhost:3000', transport).p2OfferPreview({
    path: { org: id, offer: id },
    query: { version: 1 },
    signal,
  });
  expect(String(transport.mock.calls[0]![0]).endsWith('/preview?version=1')).toBe(true);
  expect(transport.mock.calls[0]![1]?.signal).toBe(signal);
  await expect(
    createP2PartnerClient('http://localhost:3000', transport).p2OfferPreview({
      path: { org: id, offer: id },
      query: { version: 1, sql: 'select' } as never,
    }),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});
it('uploads staff bytes with encoded source metadata and refuses a photo grant on other upload types', async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(reply({ id, phase: 'registered', runId: id, errors: 'row,reason\n' }));
  const client = createP2StaffClient('http://localhost:3000', transport),
    query = {
      templateId: id,
      providerId: id,
      licenseId: id,
      market: 'US' as const,
      effectiveAt: new Date().toISOString(),
      externalVersion: 'synthetic / a&b',
    };
  await client.p2CsvUpload({ query, bytes: new Uint8Array([1]), command: cmd });
  expect(new URL(String(transport.mock.calls[0]![0])).searchParams.get('externalVersion')).toBe(
    query.externalVersion,
  );
  await expect(
    client.p2CsvUpload({ query, bytes: new Uint8Array([1]), command: cmd, grant: 'a'.repeat(64) }),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});
it('projects nested private output and preserves missing-value semantics', async () => {
  const output = {
    id,
    reportId: id,
    version: 1,
    state: 'unavailable',
    output: null,
    providerRequestId: 'PRIVATE',
  };
  const client = createP2OwnerClient(
    'http://localhost:3000',
    vi.fn<typeof fetch>().mockResolvedValue(reply(output)),
  );
  expect((await client.p2AnalysisStatus({ path: { request: id } })).data).not.toHaveProperty(
    'providerRequestId',
  );
});
it('keeps the checked-in OpenAPI artifact equal to its typed contract source', () => {
  expect(JSON.parse(readFileSync('docs/api/phase2-local.openapi.json', 'utf8'))).toEqual(
    phase2OpenApi(),
  );
});
it('builds the owner client without partner/staff schemas or server secrets', async () => {
  const result = await build({
    entryPoints: ['packages/contracts/src/phase2-owner-client.ts'],
    bundle: true,
    minify: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    metafile: true,
  });
  expect(
    Object.keys(result.metafile!.inputs).some((p) =>
      /phase2-(partners|partner-client|staff-client)/.test(p),
    ),
  ).toBe(false);
  const gzipBytes = gzipSync(result.outputFiles![0]!.contents).byteLength;
  expect(gzipBytes).toBeLessThan(120000);
  console.log(
    'P2_OWNER_CLIENT_BUNDLE ' +
      JSON.stringify({
        gzipBytes,
        partnerStaffSchemasIncluded: false,
        actualFrontendAcceptance: false,
      }),
  );
});
