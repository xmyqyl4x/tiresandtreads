import {
  z,
  queueViewSchema,
  reportQueueViewSchema,
  sourceHealthViewSchema,
  strategicRegisterViewSchema,
  seoFindingsViewSchema,
  commercialConfigurationViewSchema,
  commercialPolicySchema,
  commercialPublishInputSchema,
  operationsViewSchema,
  revenueViewSchema,
} from './staff-console.ts';
import { createApiClient } from './transport.ts';
import { createStaffClient } from './operation-client.ts';
export function createStaffConsoleClient(
  base: string,
  session: { bearer: string; csrf: string },
  transport: typeof fetch = fetch,
) {
  const api = createApiClient(base, transport),
    legacy = createStaffClient(base, session, transport),
    headers = { authorization: 'Bearer ' + session.bearer };
  const get = async <T>(path: string, schema: z.ZodType<T>, after?: string) => {
    const r = await api.request<unknown>(
      '/api/v1/staff-console/' + path + (after ? '?after=' + encodeURIComponent(after) : ''),
      { headers },
    );
    return schema.parse(r.data);
  };
  const post = async <T>(
    path: string,
    body: unknown,
    key: string,
    schema: z.ZodType<T>,
    reviewer?: string,
  ) => {
    const r = await api.request<unknown>('/api/v1/staff-console/' + path, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'x-csrf-token': session.csrf,
        'idempotency-key': key,
        ...(reviewer ? { 'x-reviewer-authorization': 'Bearer ' + reviewer } : {}),
      },
      body: JSON.stringify(body),
    });
    return schema.parse(r.data);
  };
  return {
    session: () =>
      get(
        'session',
        z.strictObject({
          csrf: z.string().regex(/^[a-f0-9]{64}$/),
          staffId: z.string().uuid(),
          localOnly: z.literal(true),
        }),
      ),
    queue: async (kind: Parameters<typeof legacy.queue>[0], after?: string) =>
      queueViewSchema.parse((await legacy.queue(kind, after ? { after } : {})).data),
    reports: (after?: string) => get('reports', reportQueueViewSchema, after),
    sources: (after?: string) => get('sources', sourceHealthViewSchema, after),
    strategy: (after?: string) => get('strategy', strategicRegisterViewSchema, after),
    findings: (after?: string) => get('findings', seoFindingsViewSchema, after),
    configuration: () => get('configuration', commercialConfigurationViewSchema),
    operations: async (query: Parameters<typeof legacy.operations>[0]) =>
      operationsViewSchema.parse((await legacy.operations(query)).data),
    revenue: async (query: Parameters<typeof legacy.revenue>[0]) =>
      revenueViewSchema.parse((await legacy.revenue(query)).data),
    recover: async (input: Parameters<typeof legacy.recover>[0], key: string) =>
      z
        .strictObject({
          created: z.boolean(),
          state: z.enum(['executing', 'succeeded', 'failed', 'unknown']),
        })
        .parse((await legacy.recover(input, key)).data),
    preview: (policy: unknown, key: string) =>
      post(
        'preview',
        commercialPolicySchema.parse(policy),
        key,
        z.strictObject({
          policy: commercialPolicySchema,
          checksum: z.string().regex(/^[a-f0-9]{64}$/),
          version: z.number().int().nonnegative(),
        }),
      ),
    publish: (input: z.input<typeof commercialPublishInputSchema>, key: string, reviewer: string) =>
      post(
        'publish',
        commercialPublishInputSchema.parse(input),
        key,
        z.strictObject({ version: z.number().int().positive() }),
        reviewer,
      ),
  };
}
