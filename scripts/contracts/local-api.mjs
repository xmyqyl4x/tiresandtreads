import { consentRoutes } from '../../packages/integrations/src/http/consent.ts';
import { staffRoutes } from '../../packages/integrations/src/http/staff.ts';
import { consentInputSchemas } from '../../packages/contracts/src/consent-inputs.ts';
import { staffInputSchemas } from '../../packages/contracts/src/staff-inputs.ts';
import { operationQuerySchemas } from '../../packages/contracts/src/operation-queries.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { publicOwnerRoutes } from '../../packages/integrations/src/http/public-owner.ts';
import { apiErrorSchema, sessionContracts } from '../../packages/contracts/src/http.ts';
import { reportInputSchemas } from '../../packages/contracts/src/report-inputs.ts';
import { referenceKinds } from '../../packages/application/src/queries/reference.ts';
import { callbackRoutes } from '../../packages/integrations/src/http/callbacks.ts';
import { callbackInputSchemas } from '../../packages/contracts/src/callback-inputs.ts';

export function localApiDocument() {
  // Binding constructs closures only. No service, database, provider or fixture is executed.
  const routes = [
    ...sessionContracts,
    ...callbackRoutes({
      services: {},
      keys: { mail: [], workflow: [] },
      wake: async () => null,
      confirmation: async () => null,
      now: () => '',
    }),
    ...consentRoutes({ contacts: {}, delivery: {}, privacy: {}, policy: async () => null }),
    ...staffRoutes({
      services: {},
      authorize: async () => null,
      artifact: async () => null,
      commandId: () => '',
    }),
    ...publicOwnerRoutes({
      reports: {},
      shareKeys: () => [],
      lookup: async () => null,
      content: async () => null,
      download: async () => null,
    }),
  ];
  const paths = {};
  for (const route of routes) {
    const path = route.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const parameters = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string', maxLength: m[1] === 'token' ? 512 : 128 },
    }));
    if (route.command)
      parameters.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,100}$' },
      });
    if (route.method !== 'GET' && route.access !== 'callback')
      parameters.push({ name: 'Origin', in: 'header', required: true, schema: { type: 'string' } });
    if (route.method !== 'GET' && ['owner', 'staff'].includes(route.access))
      parameters.push({
        name: 'X-CSRF-Token',
        in: 'header',
        required: true,
        schema: { type: 'string' },
      });
    const query = (name, schema, required = false) =>
      parameters.push({ name, in: 'query', required, schema });
    const queryShape = operationQuerySchemas[route.operationId]?.toJSONSchema();
    for (const [name, schema] of Object.entries(queryShape?.properties ?? {}))
      query(name, schema, queryShape.required?.includes(name) ?? false);
    if (route.operationId === 'lookupReference') {
      query('kind', { type: 'string', enum: referenceKinds }, true);
      query('market', { type: 'string', enum: ['US'], default: 'US' });
      query('bundle', { type: 'string', format: 'uuid' });
      query('after', { type: 'string', minLength: 1, maxLength: 512 });
      query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 25 });
      for (const name of ['id', 'makeEntityId', 'vehicleId', 'configurationId', 'modelId', 'skuId'])
        query(name, { type: 'string', format: 'uuid' });
      query('modelYear', { type: 'integer', minimum: 1900, maximum: 2200 });
      for (const name of ['sizeCode', 'locale'])
        query(name, { type: 'string', minLength: 1, maxLength: 100 });
    }
    if (route.operationId === 'getContent') {
      query('path', { type: 'string', default: '/' });
      query('locale', { type: 'string', default: 'en-US' });
      query('market', { type: 'string', default: 'US' });
    }
    if (['readReport', 'readComparison'].includes(route.operationId))
      query(
        'version',
        { type: 'integer', minimum: 1, maximum: 2147483647 },
        route.operationId === 'readComparison',
      );
    if (route.operationId === 'forkReport')
      parameters.push({
        name: 'X-Share-Token',
        in: 'header',
        required: true,
        schema: { type: 'string', maxLength: 512 },
      });
    const signedCallback = ['receiveMailCallback', 'wakeDurableJob'].includes(route.operationId);
    if (signedCallback)
      for (const name of ['svix-id', 'svix-timestamp', 'svix-signature'])
        parameters.push({
          name,
          in: 'header',
          required: true,
          schema: { type: 'string', maxLength: name === 'svix-signature' ? 2048 : 200 },
        });
    if (route.operationId === 'collectEvents')
      parameters.push({
        name: 'X-TT-CMP-Available',
        in: 'header',
        required: true,
        schema: { type: 'string', enum: ['true', 'false'] },
      });
    const pathProof = route.path.includes(':token');
    (paths[path] ??= {})[route.method.toLowerCase()] = {
      operationId: route.operationId,
      parameters,
      'x-local-only': true,
      'x-access': route.access,
      ...(pathProof ? { 'x-capability-transport': 'path' } : {}),
      ...(route.method !== 'GET'
        ? {
            'x-max-body-bytes': route.maxBodyBytes ?? 65536,
            'x-preserve-raw-bytes': route.bodyMode === 'bytes',
          }
        : {}),
      ...(route.access === 'owner'
        ? { security: [{ ownerCookie: [] }, { ownerBearer: [] }] }
        : route.access === 'capability' && !pathProof
          ? { security: [{ capability: [] }] }
          : route.access === 'staff'
            ? { security: [{ staffBearer: [] }] }
            : signedCallback
              ? {
                  security: [
                    {
                      [route.operationId === 'receiveMailCallback' ? 'mailSvix' : 'workflowSvix']:
                        [],
                    },
                  ],
                }
              : {}),
      ...(route.method === 'GET'
        ? {}
        : {
            requestBody: {
              required: true,
              content: {
                [route.bodyMode === 'form'
                  ? 'application/x-www-form-urlencoded'
                  : 'application/json']: {
                  schema:
                    route.operationId === 'createOwnerSession'
                      ? { type: 'object', additionalProperties: false }
                      : ({
                          ...reportInputSchemas,
                          ...consentInputSchemas,
                          ...staffInputSchemas,
                          ...callbackInputSchemas,
                          recordEmailLinkFeedback: callbackInputSchemas.recordEmailFeedback,
                        }[route.operationId]?.toJSONSchema() ?? {
                          type: 'object',
                          required: ['input'],
                          properties: { input: {} },
                          additionalProperties: false,
                        }),
                },
              },
            },
          }),
      responses: Object.fromEntries(
        [
          ...(route.successStatuses ?? [200]),
          400,
          401,
          403,
          404,
          405,
          409,
          413,
          415,
          429,
          500,
          503,
        ].map((status) => [
          status,
          {
            headers: {
              'X-Request-Id': { schema: { type: 'string', format: 'uuid' } },
              'Cache-Control': { schema: { type: 'string', const: 'no-store' } },
              ...(status === 302
                ? { Location: { schema: { type: 'string', format: 'uri', pattern: '^https://' } } }
                : {}),
            },
            description:
              status < 400
                ? 'Versioned local service result; never live acceptance'
                : 'Masked error',
            ...(status === 204 || status === 302
              ? {}
              : {
                  content:
                    status === 200 && route.operationId === 'downloadPdf'
                      ? { 'application/pdf': { schema: { type: 'string', format: 'binary' } } }
                      : {
                          'application/json': {
                            schema:
                              status < 400
                                ? {
                                    type: 'object',
                                    required: ['data', 'requestId'],
                                    properties: {
                                      data: {},
                                      requestId: { type: 'string', format: 'uuid' },
                                    },
                                    additionalProperties: false,
                                  }
                                : { $ref: '#/components/schemas/Error' },
                          },
                        },
                }),
          },
        ]),
      ),
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Tires & Tread local API',
      version: '1.0.0',
      description: 'Loopback development only. Actual S3/S4 acceptance and deployment remain held.',
    },
    paths,
    components: {
      securitySchemes: {
        ownerCookie: { type: 'apiKey', in: 'cookie', name: 'tt_owner' },
        ownerBearer: { type: 'http', scheme: 'bearer' },
        capability: { type: 'http', scheme: 'bearer' },
        mailSvix: {
          type: 'apiKey',
          in: 'header',
          name: 'svix-signature',
          description:
            'Local mail fixture HMAC over message ID, timestamp and original bytes; real provider acceptance remains held.',
        },
        workflowSvix: {
          type: 'apiKey',
          in: 'header',
          name: 'svix-signature',
          description: 'Separate local workflow fixture HMAC; fixed existing job reference only.',
        },
        staffBearer: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Synthetic local fixture only; recent server-held MFA time and current DB permission required',
        },
      },
      schemas: { Error: apiErrorSchema.toJSONSchema() },
    },
  };
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/contracts/local-api.mjs')) {
  const target = 'docs/api/local-v1.openapi.json',
    serialized = JSON.stringify(localApiDocument(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== serialized) throw Error('Local API contract differs');
  } else {
    mkdirSync('docs/api', { recursive: true });
    writeFileSync(target, serialized);
  }
}
