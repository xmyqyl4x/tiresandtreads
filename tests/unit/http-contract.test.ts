import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { localApiDocument } from '../../scripts/contracts/local-api.mjs';
import { createApiClient } from '../../packages/contracts/src/http.ts';
it('documents every operation-specific input needed by a generated lookup/comparison/fork client', () => {
  const paths = localApiDocument().paths;
  const parameters = (path: string, method: string) =>
    (paths[path]![method] as { parameters: { name: string; in: string; required: boolean }[] })
      .parameters;
  expect(parameters('/api/v1/reference', 'get')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'kind', in: 'query', required: true }),
      expect.objectContaining({ name: 'limit', in: 'query' }),
      expect.objectContaining({ name: 'after', in: 'query' }),
    ]),
  );
  expect(parameters('/api/v1/reports/{reportId}/comparisons/{revision}', 'get')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'version', in: 'query', required: true }),
    ]),
  );
  expect(parameters('/api/v1/shared/fork', 'post')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'X-Share-Token', in: 'header', required: true }),
    ]),
  );
});
it('keeps the local OpenAPI operation inventory generated from actual route bindings', () => {
  expect(JSON.parse(readFileSync('docs/api/local-v1.openapi.json', 'utf8'))).toEqual(
    localApiDocument(),
  );
  expect(Object.values(localApiDocument().paths).flatMap((v) => Object.values(v))).toHaveLength(64);
});
it('preserves the actual gate records and records only the owner-authorized local implementation exception', () => {
  const read = (path: string) =>
    JSON.parse(readFileSync('docs/implementation/evidence/P1/' + path, 'utf8'));
  const authority = read('local-product-development-authorization.json'),
    register = read('s3-service-register.json');
  expect(authority).toMatchObject({
    localImplementationAllowed: true,
    S3Accepted: false,
    S4Accepted: false,
    publicActivation: false,
    hostedProvisioning: false,
    purchases: false,
    actualNotifications: false,
  });
  expect(register.gates).toHaveLength(6);
  expect(
    register.gates.every(
      (g: { status: string; records: unknown[] }) =>
        g.status === 'pending' && g.records.length === 0,
    ),
  ).toBe(true);
});
it('uses one transport client for UI/app/AI callers, refusing cross-origin paths and parsing masked errors', async () => {
  const client = createApiClient(
    'http://127.0.0.1:3210',
    async () => new Response(JSON.stringify({ data: { status: 'local' }, requestId: 'id' })),
  );
  expect(await client.request('/api/v1/reference')).toMatchObject({ data: { status: 'local' } });
  for (const path of ['https://evil.invalid', '//evil.invalid', '/api/v1/\\evil'])
    await expect(client.request(path)).rejects.toThrow();
  const errors = createApiClient(
    'http://127.0.0.1:3210',
    async () =>
      new Response(
        JSON.stringify({
          code: 'not_found',
          messageKey: 'errors.not_found',
          fieldErrors: {},
          retryable: false,
          requestId: '11111111-1111-4111-8111-111111111111',
        }),
        { status: 404 },
      ),
  );
  await expect(errors.request('/api/v1/reports/unknown')).rejects.toMatchObject({
    code: 'not_found',
  });
});
