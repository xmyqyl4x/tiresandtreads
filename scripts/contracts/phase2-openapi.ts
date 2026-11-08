import { z, p2Uuid } from '../../packages/contracts/src/phase2-wire.ts';
import { ownerP2Operations } from '../../packages/contracts/src/phase2-owner-client.ts';
import { partnerP2Operations } from '../../packages/contracts/src/phase2-partner-client.ts';
import { staffP2Operations } from '../../packages/contracts/src/phase2-staff-client.ts';
const definitions = { ...ownerP2Operations, ...partnerP2Operations, ...staffP2Operations };
type Schema = Record<string, unknown>;
interface Operation {
  operationId: string;
  security: Readonly<Record<string, readonly string[]>>[];
  [key: string]: unknown;
}
export function phase2OpenApi() {
  const paths: Record<string, Record<string, Operation>> = {};
  for (const [name, d] of Object.entries(definitions).sort(([a], [b]) => a.localeCompare(b))) {
    const c = d.contract,
      path = c.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const schema = (s: z.ZodType) => {
      const result = z.toJSONSchema(s, { io: 'input' });
      delete result.$schema;
      return result;
    };
    const parameters: Schema[] = [...c.path.matchAll(/:([A-Za-z]+)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema:
        m[1] === 'version'
          ? {
              type: 'string',
              pattern: '^[1-9][0-9]{0,9}$',
              description: 'Canonical integer report version, maximum2147483647',
            }
          : schema(p2Uuid),
    }));
    const query = schema(d.query) as { properties?: Record<string, Schema>; required?: string[] };
    for (const [key, value] of Object.entries(query.properties ?? {}))
      parameters.push({
        name: key,
        in: 'query',
        required: query.required?.includes(key) ?? false,
        schema: value,
      });
    if (c.command)
      parameters.push(
        ...['X-CSRF-Token', 'Idempotency-Key', 'Origin'].map((name) => ({
          name,
          in: 'header',
          required: true,
          schema: { type: 'string', minLength: 1 },
        })),
      );
    if (name === 'p2PhotoFinalize')
      parameters.push({
        name: 'X-Upload-Grant',
        in: 'header',
        required: true,
        schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      });
    const errors = Object.fromEntries(
      [400, 401, 403, 404, 409, 413, 415, 429, 503].map((n) => [
        n,
        {
          description: 'Opaque application error; no automatic command retry',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['error', 'requestId'],
                properties: {
                  error: {
                    type: 'object',
                    required: ['code'],
                    properties: { code: { type: 'string' } },
                  },
                  requestId: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
      ]),
    );
    const status = name === 'p2PhotoDelete' ? '202' : '200';
    (paths[path] ??= {})[c.method.toLowerCase()] = {
      operationId: name,
      tags: [c.access],
      security: c.access === 'owner' ? [{ session: [] }, { ownerCookie: [] }] : [{ session: [] }],
      parameters,
      'x-current-authority-required': true,
      'x-actual-acceptance': false,
      'x-private-cache-control': 'no-store',
      ...(c.command
        ? {
            'x-command-reconciliation':
              'Duplicate or uncertain command admission returns409; reauthorize and read current state. Never blindly repeat an effect.',
          }
        : {}),
      ...(d.binary
        ? {
            requestBody: {
              required: true,
              content: {
                'application/octet-stream': {
                  schema: { type: 'string', format: 'binary', 'x-max-bytes': c.maxBodyBytes },
                },
              },
            },
          }
        : d.input
          ? {
              requestBody: {
                required: true,
                content: { 'application/json': { schema: schema(d.input) } },
              },
            }
          : {}),
      responses: {
        ...errors,
        [status]: {
          description: 'Local opt-in private response; actual acceptance held',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data', 'requestId'],
                properties: {
                  requestId: { type: 'string', format: 'uuid' },
                  data: schema(d.output),
                },
              },
            },
          },
          headers: { 'Cache-Control': { schema: { const: 'no-store' } } },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Tires & Tread Phase2 local private APIs', version: '1.0.0' },
    'x-actual-acceptance': false,
    paths,
    components: {
      securitySchemes: {
        ownerCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'tt_owner',
          description:
            'Current owner only; never accompanies a partner/staff bearer. CSRF and Origin still required for mutations.',
        },
        session: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Verified owner, partner/current MFA or staff authority as tagged; injected synthetic identity in local proofs. Cookies require the same current authority/CSRF checks.',
        },
      },
    },
  };
}
