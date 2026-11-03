import { it, expect } from 'vitest';
import { localApiDocument } from '../../scripts/contracts/local-api.mjs';
it('documents required staff dimensions, trusted bearer authority and CSRF for generated clients', () => {
  const doc = localApiDocument() as {
    paths: Record<
      string,
      Record<
        string,
        {
          parameters: { name: string; required: boolean }[];
          security?: unknown;
          requestBody?: {
            content: {
              'application/json': {
                schema: {
                  additionalProperties?: boolean;
                  required?: string[];
                  properties?: Record<string, unknown>;
                };
              };
            };
          };
        }
      >
    >;
  };
  const revenue = doc.paths['/api/v1/staff/advertising/revenue']!.get!;
  expect(revenue.parameters).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'account', required: true }),
      expect.objectContaining({ name: 'day', required: true }),
    ]),
  );
  const prepare = doc.paths['/api/v1/staff/imports/prepare']!.post!;
  expect(prepare.security).toEqual([{ staffBearer: [] }]);
  expect(prepare.parameters).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'X-CSRF-Token', required: true }),
      expect.objectContaining({ name: 'Idempotency-Key', required: true }),
    ]),
  );
  expect(prepare.requestBody!.content['application/json'].schema).toMatchObject({
    additionalProperties: false,
    required: ['artifactId'],
  });
  expect(prepare.requestBody!.content['application/json'].schema.properties).not.toHaveProperty(
    'actorId',
  );
});
it('publishes all 23 consent/staff operations and a public policy discovery read', () => {
  const doc = localApiDocument(),
    operations = Object.entries(doc.paths)
      .filter(
        ([path]) =>
          path.startsWith('/api/v1/staff/') ||
          path.startsWith('/api/v1/privacy/') ||
          path.startsWith('/api/v1/consent/') ||
          path.startsWith('/api/v1/deliveries') ||
          path === '/api/v1/contacts',
      )
      .flatMap(([, methods]) => Object.values(methods)) as {
      operationId: string;
      security?: unknown;
    }[];
  expect(operations).toHaveLength(23);
  expect(operations.find((x) => x.operationId === 'getConsentPolicy')).not.toHaveProperty(
    'security',
  );
  expect(operations.map((x) => x.operationId)).toContain('requestEmailRights');
  expect(operations.map((x) => x.operationId)).toContain('rollbackImport');
});
